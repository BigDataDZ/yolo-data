import { buildOpeningSuggestions } from '../../openingSuggestions.js';
import { resolveThemeBusinessDatasetsAsync } from '../../themeDatasets.js';

// 开场建议的唯一数据来源：主题可见数据集字段、主题绑定指标与用户自己的会话历史。
// 数据集口径复用 agent 的解析方法，保证「建议卡片」和「实际能查的范围」一致。
async function collectThemeSemantics({ theme, user, application, database }) {
  const metricNames = [];
  const dimensionNames = [];
  let datasetName = '';
  const { businessDatasets } = await resolveThemeBusinessDatasetsAsync({
    database,
    businessDatasets: application.businessDatasets,
    user,
    theme,
  });
  // Independent dataset field lookups are commonly remote-store queries; run
  // them together instead of making the first paint wait on each in sequence.
  const fieldsByDataset = await Promise.all(businessDatasets.map((dataset) =>
    application.businessDatasets.getDatasetFieldsAsync(Number(dataset.id), true)));
  for (const [index, dataset] of businessDatasets.entries()) {
    const datasetId = Number(dataset.id);
    if (!datasetId) {
      continue;
    }
    if (!datasetName) {
      datasetName = dataset.name ?? '';
    }
    for (const field of fieldsByDataset[index]) {
      const label = String(field?.displayName || field?.fieldName || '').trim();
      if (!label) {
        continue;
      }
      if (field.role === 'METRIC') {
        metricNames.push(label);
      } else if (field.role === 'DIMENSION') {
        dimensionNames.push(label);
      }
    }
  }
  for (const indicatorId of theme?.indicatorIds ?? []) {
    const indicator = database.localIndicators?.getAsync
      ? await database.localIndicators.getAsync(indicatorId)
      : database.localIndicators?.get?.(indicatorId);
    const label = String(indicator?.bizName || indicator?.name || '').trim();
    if (label) {
      metricNames.push(label);
    }
    for (const dimension of indicator?.dimensions ?? []) {
      const dimensionLabel = String(dimension?.bizName || dimension?.name || '').trim();
      if (dimensionLabel) {
        dimensionNames.push(dimensionLabel);
      }
    }
  }
  return { metricNames, dimensionNames, datasetName };
}

// 「继续上次」：取该主题下最近一次会话的最后几个问题，供用户一键重问。
async function buildResume({ agent, userId, themeId }) {
  const sessions = (await agent.listSessionsAsync(userId))
    .filter((session) => Number(session.themeId) === Number(themeId));
  if (sessions.length === 0) {
    return null;
  }
  const latest = sessions[0];
  const questions = (await agent.listMessagesAsync(latest.id, userId))
    .filter((message) => message.role === 'user')
    .map((message) => String(message.content ?? '').trim())
    .filter(Boolean)
    .slice(-3);
  if (questions.length === 0) {
    return null;
  }
  return {
    sessionId: Number(latest.id),
    title: String(latest.title ?? '').trim() || '未命名会话',
    updatedAt: latest.updatedAt ?? null,
    questions,
  };
}

function countUnique(values) {
  return new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)).size;
}

export function registerOpeningRoutes(table) {
  table.add({
    id: 'themes.suggestions',
    method: 'GET',
    path: '/api/themes/:id(\\d+)/suggestions',
    tags: ['themes'],
    summary: '当前主题的开场示例卡与继续上次入口',
    middleware: ['auth'],
    handler: async (ctx) => {
      const {
        request, response, application, database, agent, params,
        getRequestUser, sendJson,
      } = ctx;
      const user = await getRequestUser(request, database);
      const themeId = Number(params[0]);
      const themes = await agent.getThemesForUserAsync(user.id);
      const theme = themes
        .find((item) => Number(item.id) === themeId);
      if (!theme) {
        throw Object.assign(new Error('theme not found'), { statusCode: 404 });
      }
      // Configured examples are authoritative; semantic metadata cannot affect
      // their cards, so avoid loading every dataset's fields on this hot path.
      const hasExamples = (theme.examples ?? []).some((value) => String(value ?? '').trim());
      const [{ metricNames, dimensionNames, datasetName }, resume] = await Promise.all([
        hasExamples
          ? Promise.resolve({ metricNames: [], dimensionNames: [], datasetName: '' })
          : collectThemeSemantics({ theme, user, application, database }),
        buildResume({ agent, userId: user.id, themeId }),
      ]);
      const { source, cards } = buildOpeningSuggestions({
        examples: theme.examples ?? [],
        metricNames,
        dimensionNames,
      });
      sendJson(response, 200, {
        themeId,
        source,
        cards,
        stats: {
          metricCount: countUnique(metricNames),
          dimensionCount: countUnique(dimensionNames),
          datasetName: datasetName || null,
        },
        resume,
      });
    },
  });
}

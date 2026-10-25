import { normalizeBusinessTerm } from './indicatorSearch.js';
import { getPlatformLexicon, resolveBusinessLexicon } from './businessLexicon.js';
import { CLARIFICATION_PATTERN } from './conversationResolver.js';
import { matchAttributionSignal, isTrendText } from './analysisIntent.js';

export { resolveConversationContext, resolveConversationQuestion } from './conversationResolver.js';

const ARTIFACT_REFRESH_PATTERN =
  /重新(?:查询|取数|拉取)|刷新|最新数据|重查|再查一次/;

function text(question) {
  return normalizeBusinessTerm(question);
}

function compact(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, '').trim();
}

function fieldAliases(field) {
  return [
    field?.fieldName,
    field?.displayName,
    field?.name,
    field?.bizName,
  ].filter(Boolean).map((value) => text(value));
}

function includesAny(source, values) {
  return values.some((value) => value && source.includes(value));
}

function resolveTopN(question) {
  const match = String(question ?? '').match(
    /(?:top\s*(\d+)|前\s*(\d+)|排名前\s*(\d+))/i,
  );
  const value = Number(match?.[1] ?? match?.[2] ?? match?.[3]);
  return Number.isFinite(value) && value > 0
    ? Math.max(1, Math.min(value, 2000))
    : null;
}

const TIME_GRAIN_PATTERNS = [
  [
    'WEEK',
    /(?:按(?:照)?)?每(?:一)?个?(?:周|星期)|按周|周维度|周分组|逐周|周趋势/,
  ],
  [
    'MONTH',
    /(?:按(?:照)?)?每(?:一)?个?月|按月|按月份|月度|月维度|月分组|月份维度|月份分组|逐月|分月|月(?:份)?趋势/,
  ],
  [
    'QUARTER',
    /(?:按(?:照)?)?每(?:一)?个?季度|按季度|季度维度|季度分组|逐季度|季度趋势/,
  ],
  [
    'YEAR',
    /(?:按(?:照)?)?每(?:一)?个?年|按年|年度|年维度|年分组|逐年|年趋势/,
  ],
  [
    'DAY',
    /每天|每日|每一天|按日|日维度|日分组|逐日|日趋势/,
  ],
];

export function extractTimeGrainExpression(question, vocabularyResolver = null) {
  const resolved = vocabularyResolver?.({ question });
  if (resolved?.timeGrain) return resolved.timeGrain;
  const source = text(question);
  for (const [grain, pattern] of TIME_GRAIN_PATTERNS) {
    const match = source.match(pattern);
    if (match) {
      return { grain, sourceText: match[0] };
    }
  }
  return null;
}

export function inferTimeGrain(question, vocabularyResolver = null) {
  return extractTimeGrainExpression(question, vocabularyResolver)?.grain ?? null;
}

export function inferAnalysisMode(question, vocabularyResolver = null) {
  const source = text(question);
  const attributionSignal = matchAttributionSignal(source);
  if (attributionSignal) {
    return {
      mode: 'ATTRIBUTION',
      sourceText: attributionSignal,
      requiresComparison: true,
      requiresBreakdown: true,
    };
  }
  if (vocabularyResolver?.({ question })?.trend || isTrendText(source)) {
    return {
      mode: 'TREND',
      sourceText: source.match(/趋势|走势/)?.[0] ?? '',
      requiresComparison: false,
      requiresBreakdown: false,
    };
  }
  return {
    mode: 'METRIC_QUERY',
    sourceText: '',
    requiresComparison: false,
    requiresBreakdown: false,
  };
}

export function resolveClarificationPolicy(history = [], analysisMode = 'METRIC_QUERY') {
  let used = 0;
  for (let index = (history ?? []).length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role !== 'assistant') {
      break;
    }
    if (!CLARIFICATION_PATTERN.test(String(message.content ?? ''))) {
      break;
    }
    used += 1;
  }
  const max = analysisMode === 'ATTRIBUTION' ? 1 : 2;
  return {
    used,
    max,
    remaining: Math.max(0, max - used),
    allowed: used < max,
    policy: analysisMode === 'ATTRIBUTION'
      ? 'ATTRIBUTION_SINGLE_BATCH'
      : 'STANDARD_BOUNDED',
  };
}

export function isClarificationText(value) {
  return CLARIFICATION_PATTERN.test(String(value ?? ''));
}

export function resolveArtifactReusePolicy(
  question,
  context = {},
  artifactCount = 0,
) {
  const explicitRefresh = ARTIFACT_REFRESH_PATTERN.test(String(question ?? ''));
  const followUpReason = ['result_operation', 'explicit_reference', 'result_reference']
    .includes(context?.reason);
  const reuseArtifactsOnly = Number(artifactCount) > 0
    && !explicitRefresh
    && followUpReason;
  return {
    reuseArtifactsOnly,
    controlledRequeryAllowed: reuseArtifactsOnly,
    explicitRefresh,
    reason: explicitRefresh
      ? 'explicit_refresh'
      : reuseArtifactsOnly
        ? context.reason
        : 'fresh_query_allowed',
  };
}

function inferDatasetMetrics(question, fields) {
  const source = text(question);
  const results = [];
  const add = (field, aggregator, label) => {
    if (field && !results.some((item) => item.field === field.fieldName)) {
      results.push({
        field: field.fieldName,
        aggregator,
        label: label ?? field.displayName ?? field.fieldName,
      });
    }
  };
  const metricFields = (fields ?? []).filter((field) => field.role === 'METRIC');

  for (const field of metricFields) {
    const aliases = fieldAliases(field);
    if (includesAny(source, aliases)) {
      add(field, field.aggregator ?? 'SUM');
    }
  }
  return results;
}

function inferDatasetDimensions(question, fields, vocabularyResolver = null) {
  const source = text(question);
  const candidates = (fields ?? []).filter(
    (field) => field.role === 'DIMENSION' || field.role === 'TIME',
  );
  const selected = [];
  for (const field of candidates) {
    const matched = includesAny(source, fieldAliases(field)) ? field : null;
    if (matched && !selected.includes(matched.fieldName)) {
      selected.push(matched.fieldName);
    }
  }
  if (
    inferTimeGrain(source, vocabularyResolver)
    || Boolean(vocabularyResolver?.({ question })?.trend)
    || /趋势|走势/.test(source)
  ) {
    const dateField = candidates.find((field) => field.role === 'TIME');
    if (dateField && !selected.includes(dateField.fieldName)) {
      selected.unshift(dateField.fieldName);
    }
  }
  return selected.slice(0, 2);
}

export function inferDatasetQuerySpec({
  question,
  fields,
  fallbackMetrics = [],
  fallbackDimensions = [],
  vocabularyResolver = null,
}) {
  const metrics = inferDatasetMetrics(question, fields);
  const inferredDimensions = inferDatasetDimensions(question, fields, vocabularyResolver);
  const detailRequested = Boolean(vocabularyResolver?.({ question })?.detail)
    || /明细|清单|列表|原始记录|所有记录|逐笔/.test(String(question));
  const dimensions = inferredDimensions.length > 0
    ? inferredDimensions
    : detailRequested
      ? fallbackDimensions
      : [];
  const vocabulary = vocabularyResolver?.({ question }) ?? {};
  const topN = vocabulary.topN ?? resolveTopN(question);
  const timeGrain = inferTimeGrain(question, vocabularyResolver);
  const ranking = Boolean(vocabulary.ranking)
    || /排名|排行|对比|最高|最低|top\s*\d*|前\s*\d+/i.test(String(question));
  const effectiveMetrics = metrics.length > 0 ? metrics : fallbackMetrics;
  const order = ranking && effectiveMetrics[0] ? [{
    field: effectiveMetrics[0].field,
    direction: vocabulary.direction ?? (/最低|升序/.test(String(question)) ? 'ASC' : 'DESC'),
  }] : [];
  return {
    metrics: effectiveMetrics,
    dimensions: dimensions.length > 0 ? dimensions : (
      metrics.length > 0 ? [] : fallbackDimensions
    ),
    order,
    limit: topN ?? 200,
    timeGrain,
    aggregationIntent: effectiveMetrics.length > 0
      ? (dimensions.length > 0 ? 'GROUP' : 'SUMMARY')
      : 'DETAIL',
  };
}

function inferIndicatorMetrics(question, metrics, fallbackMetrics, lexicon = null) {
  const source = text(question);
  const matches = [];
  const tax = (lexicon ?? getPlatformLexicon()).taxPrefixes;
  const excludedPrefixes = tax.excluded.map((prefix) => text(prefix));
  const allPrefixes = tax.all.map((prefix) => text(prefix));
  const noTaxRequested = excludedPrefixes.some((prefix) => source.includes(prefix));
  const stripTaxPrefix = (alias) => {
    const prefix = allPrefixes
      .filter((item) => alias.startsWith(item))
      .sort((left, right) => right.length - left.length)[0];
    return prefix ? alias.slice(prefix.length) : alias;
  };
  const excludesTax = (alias) => excludedPrefixes.some((prefix) => alias.startsWith(prefix));
  for (const metric of metrics ?? []) {
    const aliases = [
      metric.metricName,
      metric.name,
      metric.metricBizName,
      metric.bizName,
    ].filter(Boolean).map((value) => text(value));
    let bestScore = 0;
    for (const alias of aliases) {
      if (!alias) {
        continue;
      }
      const coreAlias = stripTaxPrefix(alias);
      let score = 0;
      if (source.includes(alias)) {
        score = alias.length * 10;
      } else if (coreAlias && source.includes(coreAlias)) {
        score = coreAlias.length * 10 + (
          excludesTax(alias) === noTaxRequested ? 20 : 5
        );
      }
      bestScore = Math.max(bestScore, score);
    }
    if (bestScore > 0) {
      matches.push({ metric, score: bestScore });
    }
  }
  if (matches.length === 0) {
    return fallbackMetrics;
  }
  const bestScore = Math.max(...matches.map((item) => item.score));
  return [...new Set(matches
    .filter((item) => item.score === bestScore)
    .map((item) => item.metric.metricBizName ?? item.metric.bizName)
    .filter(Boolean))];
}

function inferIndicatorDimensions(
  question,
  dimensions,
  fallbackDimensions,
  dateField,
  vocabularyResolver = null,
) {
  const source = text(question);
  const selected = [];
  for (const dimension of dimensions ?? []) {
    const matched = includesAny(
      source,
      [
        dimension.dimensionName,
        dimension.name,
        dimension.dimensionBizName,
        dimension.bizName,
      ].filter(Boolean).map((value) => text(value)),
    ) ? dimension : null;
    const name = matched?.dimensionBizName ?? matched?.bizName;
    if (name && !selected.includes(name)) {
      selected.push(name);
    }
  }
  if ((inferTimeGrain(source, vocabularyResolver) || /趋势|走势/.test(source)) && dateField) {
    selected.unshift(dateField);
  }
  const detailRequested = /明细|清单|列表|原始记录|所有记录|逐笔/.test(String(question));
  if (selected.length > 0) {
    return [...new Set(selected)].slice(0, 2);
  }
  if (detailRequested) {
    return fallbackDimensions;
  }
  return [];
}

export function inferIndicatorQuerySpec({
  question,
  metrics,
  dimensions,
  fallbackMetrics = [],
  fallbackDimensions = [],
  dateField = null,
  lexicon = null,
  vocabularyResolver = null,
}) {
  const inferredMetrics = inferIndicatorMetrics(question, metrics, fallbackMetrics, lexicon);
  const inferredDimensions = inferIndicatorDimensions(
    question,
    dimensions,
    fallbackDimensions,
    dateField,
    vocabularyResolver,
  );
  const ranking = Boolean(vocabularyResolver?.({ question })?.ranking)
    || /排名|排行|对比|最高|最低|top\s*\d*|前\s*\d+/i.test(String(question));
  const vocabulary = vocabularyResolver?.({ question }) ?? {};
  const topN = vocabulary.topN ?? resolveTopN(question);
  const timeGrain = inferTimeGrain(question, vocabularyResolver);
  return {
    metrics: inferredMetrics,
    dimensions: inferredDimensions,
    limit: topN ?? 200,
    timeGrain,
    order: ranking && inferredMetrics[0] ? [{
      field: inferredMetrics[0],
      direction: /最低|升序/.test(String(question)) ? 'ASC' : 'DESC',
    }] : [],
    aggregationIntent: inferredMetrics.length > 0
      ? (inferredDimensions.length > 0 ? 'GROUP' : 'SUMMARY')
      : 'DETAIL',
  };
}

export function mergeSemanticFilters(fallbackFilters = [], inferredFilters = []) {
  const merged = new Map();
  for (const filter of fallbackFilters ?? []) {
    const key = String(filter?.bizName ?? filter?.field ?? '').trim();
    if (key) {
      merged.set(key, filter);
    }
  }
  for (const filter of inferredFilters ?? []) {
    const key = String(filter?.bizName ?? filter?.field ?? '').trim();
    if (key) {
      merged.set(key, filter);
    }
  }
  return [...merged.values()];
}

export { resolveTopN };

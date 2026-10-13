import { classifyAnalysisSemantics } from './analysisSemantics.js';

// 图表诉求识别与结果复用选择。
// 回答中的图表一律由平台按结果描述在前端原生渲染，因此“换个图表类型”属于展示层
// 操作：复用已锁定的结果快照重新渲染即可，不需要重新取数，也不应生成图表图片。
const CHART_TYPE_RULES = [
  { type: 'pie', label: '饼图', pattern: /饼图|环形图|环图|甜甜圈/ },
  { type: 'line', label: '折线图', pattern: /折线|曲线图?|趋势线|走势图/ },
  { type: 'bar', label: '柱状图', pattern: /柱状图?|柱形图?|条形图?|直方图/ },
  { type: 'table', label: '表格', pattern: /表格|明细表|数据表/ },
];

const CHART_TYPE_LABELS = new Map(
  CHART_TYPE_RULES.map((rule) => [rule.type, rule.label]),
);

const NEGATION_PATTERN = /不|别|勿|无需|不用|不需要|取消|去掉|剔除/;

// 只改变图表类型、不引入新的取数条件的诉求，才允许复用已锁定结果重新渲染。
// 趋势/走势属于展示意图；一旦出现时间、维度、过滤、排名、对比或派生计算，
// 就必须回到正常查询流程，避免把新问题错当成旧结果的换图。
const RESTYLE_CATEGORIES = new Set(['TREND', 'RESULT_ACTION']);

function isNegated(text, index) {
  return NEGATION_PATTERN.test(text.slice(Math.max(0, index - 4), index));
}

export function chartTypeLabel(type) {
  return CHART_TYPE_LABELS.get(String(type ?? '').trim().toLowerCase()) ?? '图表';
}

export function detectRequestedChartType(question) {
  const text = String(question ?? '').trim();
  if (!text) {
    return null;
  }
  for (const rule of CHART_TYPE_RULES) {
    const match = text.match(rule.pattern);
    if (match && !isNegated(text, match.index)) {
      return rule.type;
    }
  }
  return null;
}

// 纯图表类型切换：返回请求的图表类型，否则返回 null。
export function detectChartRestyle(question) {
  const type = detectRequestedChartType(question);
  if (!type) {
    return null;
  }
  const categories = classifyAnalysisSemantics(question).categories
    .map((category) => category.code);
  if (!categories.every((code) => RESTYLE_CATEGORIES.has(code))) {
    return null;
  }
  return type;
}

// 优先级：调用方显式指定的图表类型 > 用户问题里点名的图表类型 > 主题默认图表 > 自动判定。
export function resolveChartPreference({ preferredChart, question, themeDefault } = {}) {
  const explicit = String(preferredChart ?? '').trim().toLowerCase();
  if (explicit && explicit !== 'auto') {
    return explicit;
  }
  const requested = detectRequestedChartType(question);
  if (requested) {
    return requested;
  }
  const fallback = String(themeDefault ?? '').trim().toLowerCase();
  return fallback && fallback !== 'auto' ? fallback : 'auto';
}

// 选取最近一份带有表格数据的查询结果快照，用于展示层复用。
export function selectReusableSnapshot(artifacts = []) {
  const candidates = (artifacts ?? []).filter((artifact) => (
    artifact?.artifactType === 'QUERY_RESULT'
    && Number(artifact?.metadata?.columnCount ?? artifact?.metadata?.columns?.length ?? 0) > 0
  ));
  return candidates[0] ?? null;
}

// 展示层复用结果的说明文案、执行记录与过程步骤统一在这里生成，便于测试与复用。
export function buildChartRestyleOutcome({ snapshot, rows = [], chartType, chart }) {
  const label = chartTypeLabel(chartType);
  const rowCount = rows.length;
  const message = `已按「${label}」重新展示上一轮锁定的 ${rowCount} 行结果；未重新取数，口径与上一轮一致。`;
  return {
    label,
    message,
    reuseRecord: {
      kind: 'chart_restyle',
      queryArtifactId: snapshot?.id ?? null,
      queryFingerprint: snapshot?.metadata?.queryFingerprint ?? null,
      dataHash: snapshot?.metadata?.dataHash ?? null,
      finalMessage: message,
      toolResult: { rowCount, chart, reused: true },
    },
    processStep: {
      type: 'reuse',
      stageCode: 'EXECUTE',
      status: 'success',
      name: 'render_locked_result_natively',
      skillCode: 'chart_restyle',
      skillName: '图表原生渲染',
      title: '复用锁定结果并切换图表类型',
      detail: `复用「${snapshot?.title ?? '上一轮结果'}」快照，按${label}原生渲染，未重新取数`,
      durationMs: 0,
    },
    executeStage: {
      summary: '复用上一轮锁定的结果快照',
      detail: `复用「${snapshot?.title ?? '上一轮结果'}」的 ${rowCount} 行结果，未重新取数`,
      evidence: [{ type: 'REUSE', artifactId: snapshot?.id ?? null, rowCount }],
    },
    analyzeStage: {
      summary: `选择${chart.type}进行结果展示`,
      detail: chart.reason,
      evidence: [{ type: 'VISUALIZATION', chartType: chart.type, reason: chart.reason }],
    },
  };
}

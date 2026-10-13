// 开场建议：把「这个智能体能问什么」变成首屏可点的示例卡。
//
// 卡片文案只有三个来源，都不内置业务口径：
//   1. 主题里手工配置的 examples —— 原样使用，只按能力关键词归类；
//   2. 该主题绑定指标 / 数据集中已启用字段的业务名 —— 按通用问法拼装；
//   3. 平台通用兜底 —— 主题还没有任何可用元数据时，保证首屏不留白。

export const SUGGESTION_CARD_LIMIT = 6;

// 能力分组，同时决定卡片的展示顺序。
const CAPABILITY_GROUPS = ['趋势', '对比', '拆分', '归因', '排行'];

// 只做能力归类，不含业务词：判断用户配的示例问题属于哪一类问法。
const GROUP_PATTERNS = [
  ['趋势', /趋势|走势|曲线|按天|按日|每天|逐日|按周|按月|月度|季度/],
  ['对比', /对比|相比|同比|环比|同期|上期|变化如何/],
  ['归因', /为什么|原因|归因|影响|拉动|贡献/],
  ['拆分', /拆分|拆开|分组|分布|各|分别/],
  ['排行', /排行|排名|最高|最低|最大|最小|前\s*\d+|top/i],
];

const FALLBACK_GROUP = '示例';

const GENERIC_CARDS = [
  { group: '趋势', question: '近 7 天整体趋势' },
  { group: '对比', question: '本期与上期相比变化如何' },
  { group: '拆分', question: '按维度拆开看看' },
  { group: '归因', question: '帮我分析变化的主要原因' },
];

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function uniqueTexts(values) {
  const seen = new Set();
  const result = [];
  for (const value of values ?? []) {
    const text = cleanText(value);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
  }
  return result;
}

export function classifySuggestion(text) {
  const value = cleanText(text);
  if (!value) {
    return FALLBACK_GROUP;
  }
  for (const [group, pattern] of GROUP_PATTERNS) {
    if (pattern.test(value)) {
      return group;
    }
  }
  return FALLBACK_GROUP;
}

// 按能力顺序拼装卡片：先保证分组多样，再补第二个指标的趋势卡。
function composeSemanticCards(metricNames, dimensionNames) {
  const metrics = uniqueTexts(metricNames);
  const dimensions = uniqueTexts(dimensionNames);
  if (metrics.length === 0) {
    return [];
  }
  const metric = (index) => metrics[index % metrics.length];
  const dimension = (index) => dimensions[index % dimensions.length];
  // 卡片之间轮换指标，避免整屏都在同一个指标上。
  const plan = [
    ['趋势', () => `近 7 天${metric(0)}趋势`],
    ['对比', () => `${metric(1)}本期与上期对比`],
    ['拆分', () => (dimensions.length > 0 ? `按${dimension(0)}拆分${metric(0)}` : null)],
    ['归因', () => `为什么${metric(0)}发生变化`],
    ['趋势', () => (metrics.length > 2 ? `近 30 天${metric(2)}趋势` : null)],
    ['排行', () => (dimensions.length > 0 ? `按${dimension(0)}看${metric(1)}排行` : null)],
  ];
  const cards = [];
  const seen = new Set();
  for (const [group, build] of plan) {
    if (cards.length >= SUGGESTION_CARD_LIMIT) {
      break;
    }
    const question = build();
    if (!question || seen.has(question)) {
      continue;
    }
    seen.add(question);
    cards.push({ group, question });
  }
  return cards;
}

export function buildOpeningSuggestions({ examples = [], metricNames = [], dimensionNames = [] } = {}) {
  const configured = uniqueTexts(examples);
  if (configured.length > 0) {
    return {
      source: 'THEME_EXAMPLES',
      cards: configured.slice(0, SUGGESTION_CARD_LIMIT).map((question) => ({
        group: classifySuggestion(question),
        question,
      })),
    };
  }
  const semanticCards = composeSemanticCards(metricNames, dimensionNames);
  if (semanticCards.length > 0) {
    return { source: 'AUTO_SEMANTIC', cards: semanticCards };
  }
  return { source: 'GENERIC', cards: GENERIC_CARDS.map((card) => ({ ...card })) };
}

export { CAPABILITY_GROUPS, GENERIC_CARDS };

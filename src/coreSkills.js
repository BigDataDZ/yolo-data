import { parseTemporalExpression } from './timeSemantics.js';

// Executable core skills are deliberately registered by code, while SKILL.md
// remains declarative. This keeps hot-plugging safe: an external document can
// enable or configure a resolver, but cannot execute arbitrary JavaScript.
export const CORE_SKILL_DEFINITIONS = [
  {
    code: 'yolo-core-skill.temporal_expression',
    name: '时间表达式解析',
    description: '把自然语言中的日期范围和时间周期解析为结构化时间条件',
    category: 'CORE',
    kind: 'RESOLVER',
    resolverName: 'temporal_expression',
    defaultEnabled: true,
    instruction: '优先将自然语言日期、周期和时间范围转换为结构化时间条件。',
  },
  {
    code: 'yolo-core-skill.business_vocabulary',
    name: '业务词汇解析',
    description: '解析中文时间粒度、排名数量和常用业务表达为结构化意图',
    category: 'CORE',
    kind: 'RESOLVER',
    resolverName: 'business_vocabulary',
    defaultEnabled: true,
    instruction: '将中文业务表达解析为结构化意图，避免在 Agent 工作流中散落正则。',
  },
];

export const CORE_RESOLVER_NAMES = new Set(
  CORE_SKILL_DEFINITIONS.map((skill) => skill.resolverName),
);

const TIME_GRAIN_PATTERNS = [
  ['WEEK', /(?:按(?:照)?)?每(?:一)?个?(?:周|星期)|按周|周维度|周分组|逐周|周趋势/],
  ['MONTH', /(?:按(?:照)?)?每(?:一)?个?月|按月|按月份|月度|月维度|月分组|月份维度|月份分组|逐月|分月|月(?:份)?趋势/],
  ['QUARTER', /(?:按(?:照)?)?每(?:一)?个?季度|按季度|季度维度|季度分组|逐季度|季度趋势/],
  ['YEAR', /(?:按(?:照)?)?每(?:一)?个?年|按年|年度|年维度|年分组|逐年|年趋势/],
  ['DAY', /每天|每日|每一天|按日|日维度|日分组|逐日|日趋势/],
];

export function resolveBusinessVocabulary({ question } = {}) {
  const source = String(question ?? '').replace(/\s+/g, '').trim();
  const trend = /趋势|走势|变化/.test(source);
  const comparison = /对比|相比|同比|环比|同期|上期/.test(source);
  const ranking = /排名|排行|榜单|最高|最低|最多|最少|top\s*\d*|前\s*\d+/i.test(source);
  const direction = /最低|最少|升序/.test(source) ? 'ASC' : 'DESC';
  const detail = /明细|清单|列表|原始记录|所有记录|逐笔/.test(source);
  const breakdown = /拆分|拆开|分组|分布|构成|各|分别/.test(source);
  const result = {
    trend,
    comparison,
    ranking,
    direction,
    detail,
    breakdown,
    presentation: /折线图|柱状图|饼图|表格|可视化|图形/.test(source),
    refresh: /重新(?:查询|取数|拉取)|刷新|最新数据|重查|再查一次/.test(source),
  };
  for (const [grain, pattern] of TIME_GRAIN_PATTERNS) {
    const match = source.match(pattern);
    if (match) {
      result.timeGrain = { grain, sourceText: match[0] };
      break;
    }
  }
  const rankMatch = source.match(/(?:top\s*(\d+)|前\s*(\d+)|排名前\s*(\d+))/i);
  const rank = Number(rankMatch?.[1] ?? rankMatch?.[2] ?? rankMatch?.[3]);
  if (Number.isFinite(rank) && rank > 0) {
    result.topN = Math.max(1, Math.min(rank, 2000));
  }
  const limitMatch = source.match(/返回\s*(\d+)\s*行/i);
  const requestedLimit = Number(limitMatch?.[1]);
  if (Number.isFinite(requestedLimit) && requestedLimit > 0) {
    result.limit = Math.max(1, Math.min(requestedLimit, 2000));
  }
  return result;
}

const BUILTIN_RESOLVERS = {
  temporal_expression: ({ question, now } = {}) => parseTemporalExpression(question, now),
  business_vocabulary: resolveBusinessVocabulary,
};

export class CoreSkillResolverRegistry {
  constructor() {
    this.resolvers = new Map(Object.entries(BUILTIN_RESOLVERS));
  }

  register(name, resolver) {
    if (!name || typeof resolver !== 'function') {
      throw new TypeError('core skill resolver requires a name and function');
    }
    this.resolvers.set(String(name), resolver);
    return this;
  }

  unregister(name) {
    this.resolvers.delete(String(name));
  }

  resolve(name, context = {}) {
    const resolver = this.resolvers.get(String(name));
    return resolver ? resolver(context) : null;
  }

  has(name) {
    return this.resolvers.has(String(name));
  }
}

export function createCoreSkillResolverRegistry() {
  return new CoreSkillResolverRegistry();
}

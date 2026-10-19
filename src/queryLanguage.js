// Generic query-language grammar shared by slot extraction and contract
// coverage. It intentionally contains no tenant, field, metric or enum names:
// those must always come from the active theme's semantic definitions.
export const GENERIC_QUERY_TOKENS = [
  '具体原因',
  '主要原因',
  '主要因素',
  '关键因素',
  '相关维度',
  '相关口径',
  '等相关维度',
  '等相关口径',
  '等维度',
  '等口径',
  '拆解到',
  '拆分到',
  '细分到',
  '拆解',
  '拆分',
  '拆到',
  '拆成',
  '落到',
  '重点分析',
  '重点看',
  '主要分析',
  '主要看',
  '主要来自',
  '主要来源',
  '来源于',
  '来自',
  '关注',
  '聚焦',
  '分组',
  '分布',
  '分项',
  '细分',
  '对比',
  '比较',
  '环比',
  '同比',
  '变化',
  '波动',
  '上升',
  '下降',
  '下滑',
  '增长',
  '减少',
  '影响',
  '贡献',
  '拉动',
  '拖累',
  '金额',
  '幅度',
  '占比',
  '比例',
  '原因',
  '因素',
  '主因',
  '归因',
  '问题',
  '情况',
  '表现',
  '趋势',
  '走势',
  '分析',
  '说明',
  '解释',
  '判断',
  '评估',
  '给出',
  '输出',
  '提供',
  '列出',
  '展示',
  '统计',
  '计算',
  '查询',
  '查看',
  '看看',
  '看下',
  '看一下',
  '告诉我',
  '按照',
  '根据',
  '围绕',
  '帮我',
  '麻烦',
  '请',
  '要求',
  '需要',
  '希望',
  '想要',
  '重点',
  '主要',
  '关键',
  '具体',
  '相关',
  '分别',
  '各自',
  '哪些',
  '哪个',
  '哪类',
  '哪几个',
  '什么',
  '多少',
  '是多少',
  '有哪些',
  '有什么变化',
  '有什么',
  '有没有',
  '是什么',
  '有多少',
  '如何',
  '怎么样',
  '怎么',
  '是否',
  '为什么',
  '为何',
  '以及',
  '并且',
  '同时',
  '另外',
  '然后',
  '还有',
  '或者',
  '还是',
].sort((left, right) => right.length - left.length);

const GENERIC_TOKEN_PATTERN = GENERIC_QUERY_TOKENS.join('|');
const LEADING_PATTERN = new RegExp(`^(?:(?:${GENERIC_TOKEN_PATTERN}))+`, 'i');
const TRAILING_PATTERN = new RegExp(`(?:(?:${GENERIC_TOKEN_PATTERN}))+$`, 'i');
const TRAILING_PARTICLE_PATTERN = /(?:的|地|得|呢|吗|呀|吧|啊|并|再|或)+$/i;

export const ANALYSIS_ACTION_TAIL_PATTERN = new RegExp(
  `(?:拆解到|拆分到|拆解|拆分|拆到|拆成|分组|细分|对比|比较|分析|说明|解释|判断|评估|给出|输出|提供|列出|展示|统计|计算|影响|贡献|拉动|拖累|变化|上升|下降|下滑|增长|减少|金额|幅度|原因|因素|主因)(?:(?:并|再|的|地|得|${GENERIC_TOKEN_PATTERN}))*$`,
  'i',
);

function compact(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s，,。；;：:！!？?、"'“”‘’（）()【】[\]{}]/g, '');
}

export function trimGenericQueryAffixes(value) {
  let current = String(value ?? '').trim();
  for (let index = 0; index < 24; index += 1) {
    const next = current
      .replace(LEADING_PATTERN, '')
      .replace(TRAILING_PATTERN, '')
      .replace(TRAILING_PARTICLE_PATTERN, '')
      .trim();
    if (next === current) {
      break;
    }
    current = next;
  }
  return current;
}

export function stripAnalysisActionTail(value) {
  return String(value ?? '')
    .trim()
    .replace(ANALYSIS_ACTION_TAIL_PATTERN, '')
    .trim();
}

export function isGenericQueryResidual(value) {
  const normalized = compact(value);
  if (!normalized) {
    return true;
  }
  return compact(trimGenericQueryAffixes(normalized)).length === 0;
}

export function cleanGenericQueryPhrase(value) {
  return trimGenericQueryAffixes(stripAnalysisActionTail(trimGenericQueryAffixes(value)));
}

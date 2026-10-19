// Shared analysis-intent signals. These are generic analytical phrases, not
// business vocabulary: field and value semantics still come from the theme.
export const ATTRIBUTION_SIGNAL_PATTERN = new RegExp([
  '具体原因',
  '原因',
  '为何',
  '为什么',
  '归因',
  '主因',
  '因素',
  '驱动',
  '导致',
  '(?:贡献|拖累|拉动)(?:最大|最多|多少|主要|来源|因素|金额|幅度|排名|排序|分析|了)',
  '影响(?:多少|最大|主要|来源|金额|幅度|排名|排序|因素)',
  '(?:哪里|哪儿|哪块)(?:出了?问题|有问题)',
  '(?:不如|差于|低于|高于|好于).{0,12}(?:上月|上期|同期|去年|上周|前期)',
  '(?:上升|下降|下滑|增长|减少|波动|变化).{0,12}(?:分析|拆解|归因|原因|因素|主要|来自|贡献|影响)',
  '(?:分析|拆解|归因).{0,12}(?:上升|下降|下滑|增长|减少|波动|变化)',
  '(?:带来|形成|产生|贡献)(?:了)?(?:主要)?(?:增长|下降|下滑|变化)',
  '(?:哪些|谁).{0,16}(?:带来|形成|贡献).{0,10}(?:增长|下降|下滑|变化)',
  '(?:增长|下降|下滑|变化).{0,10}(?:来自|由)(?:哪些|谁)',
].join('|'), 'i');

export const TREND_SIGNAL_PATTERN = /趋势|走势|变化曲线|变化情况/i;

export function matchAttributionSignal(value) {
  return String(value ?? '').match(ATTRIBUTION_SIGNAL_PATTERN)?.[0]?.trim() ?? '';
}

export function isAttributionText(value) {
  return Boolean(matchAttributionSignal(value));
}

export function isTrendText(value) {
  return TREND_SIGNAL_PATTERN.test(String(value ?? ''));
}

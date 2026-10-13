import { isClarificationText } from './queryIntent.js';

export function buildContractSourceContext({
  inheritQueryContext = false,
  history = [],
  resolvedQuestion = '',
  clarificationText = '',
} = {}) {
  if (!inheritQueryContext) {
    return [
      String(resolvedQuestion ?? '').trim(),
      String(clarificationText ?? '').trim(),
    ].filter(Boolean).join('\n');
  }
  return [
    ...(history ?? [])
      .filter((message) => message?.role === 'user')
      .slice(-4)
      .map((message) => String(message.content ?? '').trim()),
    String(resolvedQuestion ?? '').trim(),
    String(clarificationText ?? '').trim(),
  ].filter(Boolean).join('\n');
}

export function resolveBoundDatasetDimensions(boundContract) {
  return (boundContract?.dimensionFields ?? [])
    .map((dimension) => String(dimension?.field ?? '').trim())
    .filter(Boolean);
}

export function buildStructuredClarification({
  message = '',
  clarificationPolicy = null,
} = {}) {
  if (!isClarificationText(message)) {
    return null;
  }
  const allowed = clarificationPolicy?.allowed !== false;
  const options = allowed
    ? [
      {
        id: 'use-recommended',
        label: '按推荐口径继续',
        description: '采用当前主题提示词中的默认口径和推荐方案直接执行。',
        recommended: true,
      },
      {
        id: 'cancel',
        label: '停止本轮查询',
        description: '保留当前上下文，不执行新的数据查询。',
        recommended: false,
      },
    ]
    : [
      {
        id: 'cancel',
        label: '停止本轮查询',
        description: '当前信息不足，停止执行并等待补充主题规则。',
        recommended: true,
      },
    ];
  return {
    type: allowed ? 'NEEDS_CONFIRMATION' : 'CAPABILITY_GAP',
    prompt: String(message ?? '').trim(),
    recommendedOptionId: options.find((option) => option.recommended)?.id ?? null,
    options,
  };
}

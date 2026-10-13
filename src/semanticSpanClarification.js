const MAX_MODEL_OPTIONS = 6;
const CANCEL_OPTION = {
  id: 'cancel',
  label: '都不是，停止本轮查询',
  description: '保留当前上下文，不执行新的数据查询。',
  recommended: false,
};

function choiceOptionId(label) {
  return `choice:${String(label ?? '').trim()}`;
}

export function collectSemanticSpanGroups(spans = []) {
  const groups = [];
  for (const span of spans ?? []) {
    const candidates = [...new Set(
      (span.candidates ?? [])
        .map((candidate) => candidate?.term)
        .filter(Boolean),
    )];
    groups.push({
      text: String(span.text ?? '').trim(),
      candidates,
      source: candidates.slice(0, MAX_MODEL_OPTIONS),
    });
  }
  return groups.filter((group) => group.text);
}

export function buildSemanticSpanClarification(
  groups = [],
  { allowed = true } = {},
) {
  const usable = (groups ?? []).filter((group) => group?.text);
  if (!allowed || usable.length === 0) {
    return null;
  }
  const unresolved = usable.filter((group) => group.candidates.length === 0);
  if (unresolved.length === usable.length && unresolved.length > 0) {
    return {
      type: 'CAPABILITY_GAP',
      prompt: `当前主题缺少以下业务口径，请先补充业务语义包或主题提示词：${
        unresolved.map((group) => group.text).join('、')
      }。`,
      recommendedOptionId: null,
      options: [],
    };
  }
  const options = [];
  const seen = new Set();
  for (const group of usable) {
    for (const candidate of group.source) {
      const id = choiceOptionId(`${group.text}:${candidate}`);
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      options.push({
        id,
        label: `${group.text} -> ${candidate}`,
        description: '按该语义候选继续解析本轮问题。',
        recommended: false,
      });
      if (options.length >= MAX_MODEL_OPTIONS) {
        break;
      }
    }
    if (options.length >= MAX_MODEL_OPTIONS) {
      break;
    }
  }
  if (options.length === 0) {
    return {
      type: 'CAPABILITY_GAP',
      prompt: `当前主题无法解析以下业务片段：${
        usable.map((group) => group.text).join('、')
      }。`,
      recommendedOptionId: null,
      options: [],
    };
  }
  return {
    type: 'NEEDS_CONFIRMATION',
    prompt: `以下业务片段需要确认对应口径：${
      usable.map((group) => group.text).join('、')
    }。`,
    recommendedOptionId: null,
    options: [...options, { ...CANCEL_OPTION }],
  };
}

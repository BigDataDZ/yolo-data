const DIMENSION_CONNECTOR_PATTERN = /^(?:分别|各自|分开|分组|逐项|逐个)$/;

function compact(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s，,。；;：:！!？?、"'“”‘’（）()【】[\]{}]/g, '');
}

export function inferConditionBindings(conditions, bindings) {
  const cloned = (bindings ?? []).map((binding) => ({
    ...binding,
    conditionIds: [...(binding.conditionIds ?? [])],
  }));
  for (const condition of conditions) {
    const kindToBinding = {
      METRIC: 'METRIC',
      DIMENSION: 'DIMENSION',
      FILTER: 'FILTER',
      SCOPE: 'SCOPE',
      TIME: 'TIME',
      DERIVED: 'DERIVED',
    };
    const bindingType = kindToBinding[condition.kind];
    if (!bindingType) {
      continue;
    }
    const candidates = cloned.filter((binding) => {
      const type = binding.kind ?? bindingType;
      return type === bindingType;
    });
    if (candidates.some((binding) => binding.conditionIds.includes(condition.id))) {
      continue;
    }
    if (candidates.length === 1) {
      candidates[0].conditionIds.push(condition.id);
      continue;
    }
    const matching = candidates.filter((binding) => {
      const source = compact(condition.sourceText);
      const bindingText = compact(
        binding.requested || binding.sourceText || binding.label || '',
      );
      return source && (
        source.includes(bindingText)
        || bindingText.includes(source)
      );
    });
    if (matching.length === 1) {
      matching[0].conditionIds.push(condition.id);
      continue;
    }
    if (
      bindingType === 'DIMENSION'
      && candidates.length > 1
      && DIMENSION_CONNECTOR_PATTERN.test(String(condition.sourceText ?? '').trim())
    ) {
      for (const binding of candidates) {
        binding.conditionIds.push(condition.id);
      }
    }
  }
  return cloned;
}

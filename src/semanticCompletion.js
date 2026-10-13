function compact(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s，,。；;：:！!？?、"'“”‘’（）()【】[\]{}]/g, '');
}

function semanticSourceMatches(left, right) {
  const a = compact(left);
  const b = compact(right);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function semanticConditionKinds(category) {
  if (category.code === 'DIMENSION') {
    return ['DIMENSION', 'FILTER'];
  }
  if (category.code === 'COMPARISON') {
    return ['COMPARISON', 'CALCULATION', 'RESULT_ACTION'];
  }
  if (category.code === 'CALCULATION') {
    return ['CALCULATION', 'COMPARISON', 'METRIC'];
  }
  if (category.code === 'SCOPE') {
    return ['SCOPE', 'FILTER'];
  }
  if (category.code === 'FILTER') {
    return ['FILTER', 'SCOPE', 'ANALYSIS_STAGE'];
  }
  if (category.code === 'RESULT_ACTION') {
    return ['RESULT_ACTION', 'CALCULATION'];
  }
  return [category.conditionKind];
}

export function findSemanticCondition(conditions, category) {
  const kinds = new Set(semanticConditionKinds(category));
  const matched = conditions.find((condition) => (
    kinds.has(condition.kind)
    && semanticSourceMatches(condition.sourceText, category.sourceText)
  ));
  if (
    matched
    || category.code !== 'DIMENSION'
    || !/^(?:分别|各自|分开)$/.test(compact(category.sourceText))
  ) {
    return matched;
  }
  return conditions.find((condition) => condition.kind === 'FILTER') ?? null;
}

export function completePlatformSemanticConditions(
  profile,
  conditions,
  resolveRanking = () => null,
) {
  const added = [];
  const addedScopeModifiers = [];
  let rankLimit = null;
  for (const category of profile?.categories ?? []) {
    if (!category.autoComplete || category.code === 'TIME_WINDOW') {
      continue;
    }
    const existing = findSemanticCondition(conditions, category);
    if (existing) {
      continue;
    }
    let index = conditions.length + 1;
    while (conditions.some((condition) => (
      condition.id === `semantic-auto-${index}`
    ))) {
      index += 1;
    }
    const condition = {
      id: `semantic-auto-${index}`,
      sourceText: category.sourceText,
      kind: category.conditionKind,
      status: 'RESOLVED',
      reason: `平台按${category.label}语义自动补全`,
      ruleSource: `analysisSemantics:${category.code}`,
    };
    conditions.push(condition);
    added.push(condition);
    if (category.code === 'SCOPE') {
      addedScopeModifiers.push({
        sourceText: category.sourceText,
        action: 'NO_FILTER',
        ruleSource: `analysisSemantics:${category.code}`,
        conditionIds: [condition.id],
      });
    }
    if (category.code === 'RANKING') {
      const topN = resolveRanking(category.sourceText);
      if (Number.isFinite(topN) && topN > 0) {
        rankLimit = topN;
      }
    }
  }
  return { added, addedScopeModifiers, rankLimit };
}

export function auditSemanticCategories(profile, conditions, issues) {
  for (const category of profile?.categories ?? []) {
    if (
      category.owner === 'PLATFORM'
      || category.code === 'TIME_WINDOW'
      || findSemanticCondition(conditions, category)
    ) {
      continue;
    }
    issues.push({
      level: 'ERROR',
      code: 'SEMANTIC_CATEGORY_NOT_BOUND',
      phase: 'PLAN',
      categoryCode: category.code,
      message: `检测到${category.label}语义「${category.sourceText}」，但条件账本没有对应的 ${category.conditionKind}/${category.code} 条件。`,
    });
  }
}

export function buildSemanticCoverage(
  profile,
  conditions,
  automaticConditionIds = [],
  automaticSources = [],
) {
  const automatic = new Set(automaticConditionIds);
  return (profile?.categories ?? []).map((category) => {
    const condition = findSemanticCondition(conditions, category);
    const automaticallyCompleted = automatic.has(condition?.id)
      || automaticSources.some((source) => (
        semanticSourceMatches(source, category.sourceText)
      ));
    return {
      code: category.code,
      label: category.label,
      owner: category.owner,
      conditionKind: category.conditionKind,
      sourceText: category.sourceText,
      status: condition
        ? automaticallyCompleted
          ? 'AUTO_COMPLETED'
          : 'BOUND'
        : 'MISSING',
    };
  });
}

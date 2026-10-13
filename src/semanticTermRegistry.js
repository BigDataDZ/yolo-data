import { resolveBusinessLexicon } from './businessLexicon.js';

function compactTerm(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s，,。；;：:！!？?、"'“”‘’（）()【】[\]{}_-]/g, '');
}

function diceCoefficient(left, right) {
  const a = compactTerm(left);
  const b = compactTerm(right);
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  if (a.includes(b) || b.includes(a)) {
    return Math.max(0.82, Math.min(a.length, b.length) / Math.max(a.length, b.length));
  }
  if (a.length < 2 || b.length < 2) {
    return 0;
  }
  const bigrams = (value) => Array.from(
    { length: value.length - 1 },
    (_, index) => value.slice(index, index + 2),
  );
  const leftBigrams = bigrams(a);
  const rightCounts = new Map();
  for (const value of bigrams(b)) {
    rightCounts.set(value, (rightCounts.get(value) ?? 0) + 1);
  }
  let overlap = 0;
  for (const value of leftBigrams) {
    const count = rightCounts.get(value) ?? 0;
    if (count > 0) {
      overlap += 1;
      rightCounts.set(value, count - 1);
    }
  }
  return (2 * overlap) / (leftBigrams.length + Math.max(1, b.length - 1));
}

function uniqueEntries(entries) {
  const seen = new Set();
  return (entries ?? []).filter((entry) => {
    const key = [
      entry.kind,
      entry.field,
      entry.value,
      entry.source,
      compactTerm(entry.term),
    ].join('|');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return Boolean(entry.term);
  });
}

function fieldAliases(field, type = 'FIELD') {
  const aliases = [
    field?.fieldName,
    field?.displayName,
    field?.dimensionName,
    field?.metricName,
    field?.name,
  ].map(String).filter(Boolean);
  if (type === 'METRIC') {
    aliases.push(
      field?.metricBizName,
      field?.bizName,
      field?.description,
    );
  } else if (type === 'DIMENSION') {
    aliases.push(
      field?.dimensionBizName,
      field?.bizName,
      field?.description,
    );
  }
  return [...new Set(aliases.map(String).filter((value) => (
    compactTerm(value).length >= 2
  )))];
}

function fieldValues(field) {
  const values = Array.isArray(field?.valueDomain?.values)
    ? field.valueDomain.values
    : Array.isArray(field?.values)
      ? field.values
      : [];
  return values
    .map((item) => String(item?.value ?? item ?? '').trim())
    .filter(Boolean);
}

function valueAliases(field, value) {
  return (field?.valueDomain?.aliases?.[value] ?? field?.valueAliases?.[value] ?? [])
    .map(String)
    .filter(Boolean);
}

function addFieldEntries(entries, field, kind, priority) {
  const fieldType = kind === 'VALUE' ? 'FIELD' : kind;
  for (const alias of fieldAliases(field, fieldType)) {
    entries.push({
      term: alias,
      kind,
      field: field?.fieldName
        ?? field?.metricBizName
        ?? field?.dimensionBizName
        ?? field?.name
        ?? '',
      value: null,
      aliases: [alias],
      source: `dataset-field:${field?.fieldName ?? field?.name ?? ''}`,
      confidence: 1,
      priority,
    });
  }
}

function addValueEntries(entries, field, priority) {
  for (const value of fieldValues(field)) {
    const aliases = [value, ...valueAliases(field, value)];
    for (const alias of aliases) {
      entries.push({
        term: alias,
        kind: 'VALUE',
        field: field?.fieldName
          ?? field?.metricBizName
          ?? field?.dimensionBizName
          ?? field?.name
          ?? '',
        value,
        aliases,
        source: `dataset-value:${field?.fieldName ?? field?.name ?? ''}`,
        confidence: alias === value ? 1 : 0.95,
        priority,
      });
    }
  }
}

function policyEntries(entries, policy) {
  for (const rule of policy?.metrics ?? []) {
    const field = rule?.target?.field ?? rule?.target?.outputField ?? '';
    for (const alias of [...(rule.aliases ?? []), rule.concept]) {
      entries.push({
        term: alias,
        kind: 'METRIC',
        field,
        value: null,
        aliases: rule.aliases ?? [],
        source: `semantic-policy:${rule.id}`,
        confidence: 1,
        priority: 120,
      });
    }
  }
  for (const rule of policy?.dimensions ?? []) {
    for (const alias of [...(rule.aliases ?? []), rule.concept]) {
      entries.push({
        term: alias,
        kind: 'DIMENSION',
        field: rule.field ?? '',
        value: null,
        aliases: rule.aliases ?? [],
        source: `semantic-policy:${rule.id}`,
        confidence: 1,
        priority: 120,
      });
    }
  }
  for (const rule of policy?.filters ?? []) {
    const value = Array.isArray(rule.value) ? rule.value : [rule.value];
    for (const alias of [...(rule.aliases ?? []), rule.concept]) {
      entries.push({
        term: alias,
        kind: 'FILTER',
        field: rule.field ?? '',
        value,
        aliases: rule.aliases ?? [],
        source: `semantic-policy:${rule.id}`,
        confidence: 1,
        priority: 120,
      });
    }
  }
  for (const group of policy?.enumGroups ?? []) {
    for (const alias of [...(group.aliases ?? []), group.name]) {
      entries.push({
        term: alias,
        kind: 'FILTER_GROUP',
        field: group.field ?? '',
        value: group.values ?? [],
        aliases: group.aliases ?? [],
        source: `semantic-policy:${group.id}`,
        confidence: 1,
        priority: 120,
      });
    }
  }
}

export function buildSemanticTermRegistry({
  fields = [],
  indicator = null,
  theme = {},
  sourceContext = '',
} = {}) {
  const entries = [];
  for (const field of fields ?? []) {
    const role = String(field?.role ?? '').toUpperCase();
    if (role === 'TIME') {
      addFieldEntries(entries, field, 'TIME', 100);
      continue;
    }
    if (role === 'METRIC' || role === 'IDENTIFIER') {
      addFieldEntries(entries, field, 'METRIC', 100);
      continue;
    }
    addFieldEntries(entries, field, 'DIMENSION', 90);
    addValueEntries(entries, field, 80);
  }
  for (const metric of indicator?.metrics ?? []) {
    addFieldEntries(entries, metric, 'METRIC', 110);
  }
  for (const dimension of indicator?.dimensions ?? []) {
    addFieldEntries(entries, dimension, 'DIMENSION', 100);
    addValueEntries(entries, dimension, 85);
  }
  policyEntries(entries, theme?.semanticPolicy);
  const lexicon = resolveBusinessLexicon(theme);
  for (const [dimension, values] of Object.entries(
    lexicon?.dimensionValues ?? {},
  )) {
    for (const value of values) {
      entries.push({
        term: value,
        kind: 'VALUE',
        field: dimension,
        value,
        aliases: [value],
        source: 'business-lexicon:dimensionValues',
        confidence: 1,
        priority: 115,
      });
    }
  }
  for (const match of String(sourceContext ?? '').matchAll(
    /([^=，,；;。\n]+?)\s*=\s*([^=，,；;。\n]+)/g,
  )) {
    const field = String(match[1] ?? '').trim();
    const value = String(match[2] ?? '').trim();
    if (field && value) {
      entries.push({
        term: value,
        kind: 'VALUE',
        field,
        value,
        aliases: [value],
        source: 'confirmed-source-context',
        confidence: 1,
        priority: 130,
      });
    }
  }
  return {
    entries: uniqueEntries(entries).sort((left, right) => (
      right.priority - left.priority
      || right.confidence - left.confidence
    )),
  };
}

export function resolveSemanticTerm(term, registry, {
  minimumScore = 0.72,
  limit = 6,
} = {}) {
  const target = compactTerm(term);
  if (!target || target.length < 2) {
    return [];
  }
  const scored = [];
  for (const entry of registry?.entries ?? []) {
    const entryTerm = compactTerm(entry.term);
    if (!entryTerm) {
      continue;
    }
    let score = diceCoefficient(target, entryTerm);
    let mode = 'FUZZY';
    if (target === entryTerm) {
      score = 1;
      mode = 'EXACT';
    } else if ((entry.aliases ?? []).some((alias) => (
      compactTerm(alias) === target
    ))) {
      score = 1;
      mode = 'ALIAS';
    } else if (
      target.length >= 3
      && (entryTerm.includes(target) || target.includes(entryTerm))
    ) {
      score = Math.max(
        score,
        Math.min(target.length, entryTerm.length) / Math.max(target.length, entryTerm.length),
      );
      mode = 'SUBSTRING';
    }
    score *= entry.confidence ?? 1;
    if (score >= minimumScore) {
      scored.push({ ...entry, score, mode });
    }
  }
  return scored
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ confidence: _confidence, priority: _priority, ...entry }) => entry);
}

export { compactTerm, diceCoefficient };

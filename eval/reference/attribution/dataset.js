// 归因算法共用的数据集读取工具：周期解析、按维度聚合、聚合方式。
// 纯函数。行对象只按传入的字段名读取，不认识任何业务概念。

import { toNumber, toText } from './schema.js';

export const ADDITIVE_AGGREGATORS = new Set(['SUM', 'COUNT']);
export const AGGREGATORS = new Set(['SUM', 'COUNT', 'AVG', 'MIN', 'MAX']);

// 从结果集中解析"本期 / 上期"两个周期。
// 只接受两种依据：显式 currentPeriod/previousPeriod，或 periodOrder（前两个）。
// 不按行内出现顺序猜测——那会随数据排序方式漂移，违背"无依据不猜测"的边界。
export function resolvePeriods({
  rows = [],
  periodKey = '__period',
  currentPeriod = null,
  previousPeriod = null,
  periodOrder = [],
} = {}) {
  const normalize = (value) => toText(value);
  const explicitCurrent = normalize(currentPeriod);
  const explicitPrevious = normalize(previousPeriod);
  const available = distinctPeriods(rows, periodKey);
  if (explicitCurrent && explicitPrevious) {
    return {
      currentPeriod: explicitCurrent,
      previousPeriod: explicitPrevious,
      inferred: false,
      available,
    };
  }
  const order = (Array.isArray(periodOrder) ? periodOrder : [])
    .map(normalize)
    .filter(Boolean);
  return {
    currentPeriod: explicitCurrent || order[0] || null,
    previousPeriod: explicitPrevious || order[1] || null,
    inferred: true,
    available,
  };
}

export function distinctPeriods(rows, periodKey) {
  const seen = [];
  for (const row of rows ?? []) {
    const value = toText(row?.[periodKey]);
    if (value && !seen.includes(value)) {
      seen.push(value);
    }
  }
  return seen;
}

export function aggregateValues(values, aggregator) {
  const numbers = (values ?? [])
    .map(toNumber)
    .filter((value) => value !== null);
  const mode = toText(aggregator).toUpperCase() || 'SUM';
  if (mode === 'COUNT') {
    return numbers.length;
  }
  if (numbers.length === 0) {
    return 0;
  }
  if (mode === 'AVG') {
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  }
  if (mode === 'MIN') {
    return Math.min(...numbers);
  }
  if (mode === 'MAX') {
    return Math.max(...numbers);
  }
  return numbers.reduce((sum, value) => sum + value, 0);
}

// 按"维度值 × 周期"聚合指标，返回 [{ key, label, dimension, base, current, delta, seed }]。
// - keyOf(row) 决定分组键，调用方用它可以做多级路径分组（例如 [大区, 城市]）。
// - 分组顺序按 key 首次出现顺序保留，最终排序交给 finalizeAttribution，保证确定性。
export function aggregateByKey({
  rows = [],
  keyOf,
  labelOf = null,
  metricKey,
  periodKey = '__period',
  currentPeriod,
  previousPeriod,
  aggregator = 'SUM',
  depth = 0,
}) {
  const buckets = new Map();
  for (const row of rows ?? []) {
    const rawKey = keyOf(row);
    const path = Array.isArray(rawKey) ? rawKey : [rawKey];
    const normalized = path.map((item) => toText(item));
    if (normalized.some((item) => item === '')) {
      continue;
    }
    const key = normalized.join('\u001f');
    const period = toText(row?.[periodKey]);
    const bucket = buckets.get(key) ?? {
      key,
      parts: normalized,
      label: labelOf ? toText(labelOf(row, normalized)) : normalized.join(' / '),
      dimension: null,
      baseValues: [],
      currentValues: [],
      depth,
      seed: row,
    };
    if (period === toText(currentPeriod)) {
      bucket.currentValues.push(row?.[metricKey]);
    } else if (period === toText(previousPeriod)) {
      bucket.baseValues.push(row?.[metricKey]);
    }
    buckets.set(key, bucket);
  }
  const result = [];
  for (const bucket of buckets.values()) {
    // 完全不在两个目标周期内的分组不产出，避免用 0 冒充"无数据"。
    if (bucket.baseValues.length === 0 && bucket.currentValues.length === 0) {
      continue;
    }
    const base = aggregateValues(bucket.baseValues, aggregator);
    const current = aggregateValues(bucket.currentValues, aggregator);
    result.push({
      key: bucket.key,
      label: bucket.label,
      parts: bucket.parts,
      dimension: bucket.dimension,
      base,
      current,
      delta: current - base,
      depth,
      seed: bucket.seed,
    });
  }
  return result;
}

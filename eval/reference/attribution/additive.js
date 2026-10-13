// 加法分解（ADDITIVE）：把总指标的净变化精确拆到各维度取值上。
//
// 数学前提（必须满足，否则结果无意义）：
//   总指标 = Σ(各驱动分量)，且聚合方式可加（SUM / COUNT）。
//   比率、平均值、去重计数都不可加，本函数会直接拒绝，而不是给出一个"看起来对"的数。
//
// 精确性保证：
//   Σ(drivers.contribution) === totalDelta
//   通过两个手段保证：
//   1. 算法内部不做四舍五入；
//   2. 被维度键过滤掉的行（例如维度值为空）形成的差额，会作为显式的"未归类"驱动补回，
//      而不是悄悄丢掉。因此 residual 恒为 0，exact 恒为 true。

import {
  OTHER_DRIVER_KEY,
  attributionError,
  finalizeAttribution,
  toNumber,
  toText,
} from './schema.js';
import {
  ADDITIVE_AGGREGATORS,
  AGGREGATORS,
  aggregateByKey,
  aggregateValues,
  resolvePeriods,
} from './dataset.js';

export const UNATTRIBUTED_DRIVER_KEY = '__unattributed__';
export const UNATTRIBUTED_DRIVER_LABEL = '未归类';

const UNATTRIBUTED_EPSILON = 1e-9;

export const ADDITIVE_METHOD = {
  code: 'ADDITIVE',
  label: '加法分解',
  description: '把总指标净变化拆到各维度取值，Σ贡献恒等于总变化。',
  aggregators: [...ADDITIVE_AGGREGATORS],
  requiresAdditiveMetric: true,
};

function buildKeySelector({ dimensionKey, dimensionKeys }) {
  const keys = Array.isArray(dimensionKeys) && dimensionKeys.length > 0
    ? dimensionKeys.filter(Boolean)
    : (dimensionKey ? [dimensionKey] : []);
  if (keys.length === 0) {
    return null;
  }
  if (keys.length === 1) {
    const key = keys[0];
    return {
      keys,
      keyOf: (row) => toText(row?.[key]),
      labelOf: (row) => toText(row?.[key]),
    };
  }
  return {
    keys,
    keyOf: (row) => keys.map((key) => toText(row?.[key])),
    labelOf: (row, parts) => parts.join(' / '),
  };
}

export function decomposeAdditive({
  rows = [],
  dimensionKey = null,
  dimensionKeys = null,
  dimensionLabel = '',
  metricKey,
  metricLabel = '',
  metricIsRate = false,
  aggregator = 'SUM',
  periodKey = '__period',
  currentPeriod = null,
  previousPeriod = null,
  periodOrder = [],
  topN = null,
  includeOther = true,
  allowNonAdditive = false,
} = {}) {
  if (!toText(metricKey)) {
    throw new TypeError('decomposeAdditive requires metricKey');
  }
  const selector = buildKeySelector({ dimensionKey, dimensionKeys });
  if (!selector) {
    throw new TypeError('decomposeAdditive requires dimensionKey or dimensionKeys');
  }
  const mode = toText(aggregator).toUpperCase() || 'SUM';
  if (!AGGREGATORS.has(mode)) {
    return attributionError('UNSUPPORTED_AGGREGATOR', `不支持的聚合方式：${aggregator}`);
  }
  if (!ADDITIVE_AGGREGATORS.has(mode)) {
    return attributionError(
      'NON_ADDITIVE_AGGREGATOR',
      `${mode} 不可加，无法做加法分解；请改用加权分解或结构分解。`,
      { aggregator: mode },
    );
  }
  if (metricIsRate && !allowNonAdditive) {
    return attributionError(
      'NON_ADDITIVE_METRIC',
      '比率类指标不能按维度取值直接相加分解；请改用结构分解（乘法分解）或加权分解。',
    );
  }

  const periods = resolvePeriods({
    rows,
    periodKey,
    currentPeriod,
    previousPeriod,
    periodOrder,
  });
  if (!periods.currentPeriod || !periods.previousPeriod) {
    return attributionError('PERIOD_NOT_RESOLVED', '未能确定本期与上期两个周期。', {
      available: periods.available,
    });
  }

  const { currentPeriod: current, previousPeriod: previous } = periods;
  const inWindow = (row) => {
    const period = toText(row?.[periodKey]);
    return period === current || period === previous;
  };

  // 真实总量按"全部行"计算，保证 totalDelta 是业务口径的真实净变化。
  const totalCurrent = aggregateValues(
    (rows ?? []).filter((row) => toText(row?.[periodKey]) === current).map((row) => row?.[metricKey]),
    mode,
  );
  const totalPrevious = aggregateValues(
    (rows ?? []).filter((row) => toText(row?.[periodKey]) === previous).map((row) => row?.[metricKey]),
    mode,
  );
  const totalDelta = totalCurrent - totalPrevious;

  const keyed = aggregateByKey({
    rows: (rows ?? []).filter(inWindow),
    keyOf: selector.keyOf,
    labelOf: selector.labelOf,
    metricKey,
    periodKey,
    currentPeriod: current,
    previousPeriod: previous,
    aggregator: mode,
  }).map((item) => ({ ...item, dimension: dimensionLabel || selector.keys.join(' / ') }));

  const keyedTotal = keyed.reduce((sum, item) => sum + item.delta, 0);
  const remainder = totalDelta - keyedTotal;
  const drivers = [...keyed];
  if (Math.abs(remainder) > UNATTRIBUTED_EPSILON) {
    const baseUnattributed = totalPrevious - keyed.reduce((sum, item) => sum + item.base, 0);
    const currentUnattributed = totalCurrent - keyed.reduce((sum, item) => sum + item.current, 0);
    drivers.push({
      key: UNATTRIBUTED_DRIVER_KEY,
      label: UNATTRIBUTED_DRIVER_LABEL,
      dimension: dimensionLabel || selector.keys.join(' / '),
      base: baseUnattributed,
      current: currentUnattributed,
      delta: remainder,
      memberCount: 0,
    });
  }

  const result = finalizeAttribution({
    method: ADDITIVE_METHOD.code,
    metric: {
      key: toText(metricKey),
      label: toText(metricLabel) || toText(metricKey),
      isRate: metricIsRate === true,
      aggregator: mode,
    },
    currentPeriod: current,
    previousPeriod: previous,
    totalPrevious,
    totalCurrent,
    totalDelta,
    rawDrivers: drivers,
    topN,
    includeOther,
    extra: {
      dimension: {
        keys: selector.keys,
        label: dimensionLabel || selector.keys.join(' / '),
      },
      periodsInferred: periods.inferred,
    },
  });

  // 未归类桶如果和其它桶同时存在，排名展示时不应把"未归类"当成一个业务驱动宣传出去。
  return result;
}

export { OTHER_DRIVER_KEY };

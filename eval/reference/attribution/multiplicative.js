// 乘法分解（MULTIPLICATIVE）：把"乘积型"指标的变化拆到各个因子，
// 典型场景是量价拆解（金额 = 销量 × 单价）、以及多因子连乘（金额 = 客户数 × 客单价 × 频次）。
//
// 数学保证（精确恒等，非近似）：
//   设 T = Π F_i，则
//   ΔT = Σ_i ΔF_i · (Π_{j<i} F_j^{p_j}) · (Π_{j>i} F_j^{q_j})
//   其中 interactionPolicy='FIRST' 时 p=1,q=0（后位因子用基期值）；
//        interactionPolicy='LAST'  时 p=0,q=1（前位因子用基期值）。
//   两因子场景额外支持 'SPLIT'：交互项均分到两个因子。
//
// 交互项（ΔF_i·ΔF_j 这类二阶项）不会被丢弃，也不会被静默归零——
// 它按策略显式归属，因此 Σfactors.contribution 恒等于 ΔT。

import { attributionError, directionOf, safeDivide, toNumber, toText } from './schema.js';

export const MULTIPLICATIVE_METHOD = {
  code: 'MULTIPLICATIVE',
  label: '乘法分解',
  description: '把乘积型指标（如金额=量×价）的变化精确拆到各因子，交互项按策略显式归属。',
  aggregators: [],
  requiresAdditiveMetric: false,
};

export const INTERACTION_POLICIES = ['FIRST', 'LAST', 'SPLIT'];

const CONSISTENCY_EPSILON = 1e-6;

function normalizeFactor(factor, index) {
  const base = toNumber(factor?.base);
  const current = toNumber(factor?.current);
  if (base === null || current === null) {
    return null;
  }
  return {
    key: toText(factor?.key) || `factor_${index + 1}`,
    label: toText(factor?.label) || toText(factor?.key) || `因子${index + 1}`,
    unit: toText(factor?.unit) || '',
    base,
    current,
    delta: current - base,
  };
}

function productOf(factors, pick) {
  return factors.reduce((product, factor) => product * pick(factor), 1);
}

export function decomposeMultiplicative({
  factors = [],
  metricKey = 'metric',
  metricLabel = '',
  metricUnit = '',
  interactionPolicy = 'FIRST',
  declaredTotalBase = null,
  declaredTotalCurrent = null,
} = {}) {
  const normalized = (factors ?? []).map(normalizeFactor);
  if (normalized.length < 2) {
    return attributionError('FACTOR_COUNT_INVALID', '乘法分解至少需要两个因子。');
  }
  if (normalized.some((factor) => factor === null)) {
    return attributionError('FACTOR_VALUE_INVALID', '因子缺少可用的基期或本期数值。');
  }
  const policy = toText(interactionPolicy).toUpperCase() || 'FIRST';
  if (!INTERACTION_POLICIES.includes(policy)) {
    return attributionError('UNSUPPORTED_INTERACTION_POLICY', `不支持的交互项策略：${interactionPolicy}`, {
      supported: INTERACTION_POLICIES,
    });
  }
  if (policy === 'SPLIT' && normalized.length !== 2) {
    return attributionError('SPLIT_REQUIRES_TWO_FACTORS', '均分交互项只适用于两因子分解。');
  }

  const productBase = productOf(normalized, (factor) => factor.base);
  const productCurrent = productOf(normalized, (factor) => factor.current);
  const totalDelta = productCurrent - productBase;

  const contributions = normalized.map((factor, index) => {
    const before = normalized.slice(0, index);
    const after = normalized.slice(index + 1);
    if (policy === 'SPLIT') {
      const other = normalized[index === 0 ? 1 : 0];
      const main = other.base * factor.delta;
      const interaction = factor.delta * other.delta;
      return { factor, main, interaction, contribution: main + interaction / 2 };
    }
    const prefix = before.reduce(
      (product, item) => product * (policy === 'FIRST' ? item.current : item.base),
      1,
    );
    const suffix = after.reduce(
      (product, item) => product * (policy === 'FIRST' ? item.base : item.current),
      1,
    );
    const main = prefix * factor.delta * suffix;
    return { factor, main, interaction: null, contribution: main };
  });

  const totalMovement = contributions.reduce((sum, item) => sum + Math.abs(item.contribution), 0);
  const contributionSum = contributions.reduce((sum, item) => sum + item.contribution, 0);

  const ranked = [...contributions]
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const byMagnitude = Math.abs(right.item.contribution) - Math.abs(left.item.contribution);
      if (byMagnitude !== 0) {
        return byMagnitude;
      }
      return left.index - right.index;
    });
  const magnitudeRank = new Map(ranked.map((entry, position) => [entry.index, position + 1]));

  const outFactors = contributions.map((item, index) => ({
    key: item.factor.key,
    label: item.factor.label,
    unit: item.factor.unit,
    index,
    rank: index + 1,
    rankByMagnitude: magnitudeRank.get(index),
    base: item.factor.base,
    current: item.factor.current,
    delta: item.factor.delta,
    contribution: item.contribution,
    contributionRate: safeDivide(item.contribution, totalDelta),
    movementShare: safeDivide(Math.abs(item.contribution), totalMovement),
    direction: directionOf(item.delta),
    effect: directionOf(item.contribution) === 'INCREASE'
      ? 'PULL'
      : directionOf(item.contribution) === 'DECREASE'
        ? 'DRAG'
        : 'NEUTRAL',
  }));

  // 交互项 = 总变化中未被"主效应"（其他因子固定在基期）解释的部分。
  // 该口径对三种策略统一成立：FIRST/LAST 已把交互项分配进主效应（交互项为 0），
  // SPLIT 则先保留主效应之和、把交互项均分到各因子。
  const mainSum = contributions.reduce((sum, item) => sum + item.main, 0);
  const interactionTerm = totalDelta - mainSum;

  const declaredBase = toNumber(declaredTotalBase);
  const declaredCurrent = toNumber(declaredTotalCurrent);

  return {
    ok: true,
    version: 1,
    method: MULTIPLICATIVE_METHOD.code,
    metric: { key: toText(metricKey), label: toText(metricLabel) || toText(metricKey), unit: toText(metricUnit) },
    interactionPolicy: policy,
    interactionTerm,
    base: { total: productBase },
    current: { total: productCurrent },
    totalDelta,
    changeRate: safeDivide(totalDelta, Math.abs(productBase)),
    direction: directionOf(totalDelta),
    factors: outFactors,
    productConsistency: {
      declaredBase,
      declaredCurrent,
      baseResidual: declaredBase === null ? null : productBase - declaredBase,
      currentResidual: declaredCurrent === null ? null : productCurrent - declaredCurrent,
      consistent: declaredBase === null && declaredCurrent === null
        ? true
        : Math.abs((declaredBase === null ? productBase : productBase - declaredBase)) <= CONSISTENCY_EPSILON
          && Math.abs((declaredCurrent === null ? productCurrent : productCurrent - declaredCurrent)) <= CONSISTENCY_EPSILON,
    },
    summary: {
      factorCount: outFactors.length,
      topPull: outFactors.filter((factor) => factor.effect === 'PULL')
        .sort((left, right) => right.contribution - left.contribution)[0] ?? null,
      topDrag: outFactors.filter((factor) => factor.effect === 'DRAG')
        .sort((left, right) => left.contribution - right.contribution)[0] ?? null,
      totalMovement,
    },
    residual: totalDelta - contributionSum,
    exact: Math.abs(totalDelta - contributionSum) <= CONSISTENCY_EPSILON,
  };
}

export { CONSISTENCY_EPSILON };

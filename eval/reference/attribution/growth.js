// 增长贡献分解（GROWTH_CONTRIBUTION）：回答"这个增长/下滑，谁拉动、谁拖累、各拉了多少"。
//
// 与加法分解的区别：
//   - 加法分解解释的是"净变化额"（单位 = 指标单位）；
//   - 增长贡献解释的是"增长率"（单位 = 百分点 pp），用来回答"增长率里各驱动占几个点"。
//
// 数学关系（加法指标 Y = Σ y_i）：
//   g = ΔY / |Y_base|               整体增长率
//   c_i = Δy_i / |Y_base|           第 i 个驱动对增长率的贡献（pp）
//   Σ c_i = g                       精确成立（当含未归类/其他桶时）
//
// 分母口径：默认用 |Y_base|（绝对值），因为利润、差额等指标基数可能为负，
// 直接用带符号基数会让"下滑时贡献为正"这类反直觉结果出现。可用 baseMode='SIGNED' 切回。

import { toNumber, toText, safeDivide } from './schema.js';
import { decomposeAdditive } from './additive.js';

export const GROWTH_METHOD = {
  code: 'GROWTH_CONTRIBUTION',
  label: '增长贡献分解',
  description: '把整体增长率拆到各驱动，单位百分点，区分拉动与拖累。',
  aggregators: ['SUM', 'COUNT'],
  requiresAdditiveMetric: true,
};

export function decomposeGrowthContribution(options = {}) {
  const additive = decomposeAdditive(options);
  if (additive.ok !== true) {
    return additive;
  }

  const baseMode = toText(options.baseMode).toUpperCase() === 'SIGNED' ? 'SIGNED' : 'ABSOLUTE';
  const baseValue = toNumber(additive.base.total) ?? 0;
  const denominator = baseMode === 'SIGNED' ? baseValue : Math.abs(baseValue);
  const growthRate = additive.totalDelta / denominator;
  const growthRateDefined = Number.isFinite(growthRate) && denominator !== 0;

  const drivers = additive.drivers.map((driver) => {
    const contributionToGrowth = growthRateDefined
      ? safeDivide(driver.delta, denominator)
      : null;
    return {
      ...driver,
      contributionToGrowth,
      effect: driver.direction === 'INCREASE'
        ? 'PULL'
        : driver.direction === 'DECREASE'
          ? 'DRAG'
          : 'NEUTRAL',
    };
  });

  const pullDrivers = drivers
    .filter((driver) => driver.effect === 'PULL' && !driver.aggregated)
    .sort((left, right) => (right.contributionToGrowth ?? 0) - (left.contributionToGrowth ?? 0));
  const dragDrivers = drivers
    .filter((driver) => driver.effect === 'DRAG' && !driver.aggregated)
    .sort((left, right) => (left.contributionToGrowth ?? 0) - (right.contributionToGrowth ?? 0));

  return {
    ...additive,
    method: GROWTH_METHOD.code,
    baseMode,
    growthRate: growthRateDefined ? growthRate : null,
    growthRateDefined,
    drivers,
    summary: {
      ...additive.summary,
      pullCount: drivers.filter((driver) => driver.effect === 'PULL').length,
      dragCount: drivers.filter((driver) => driver.effect === 'DRAG').length,
      topPull: pullDrivers[0] ?? null,
      topDrag: dragDrivers[0] ?? null,
    },
  };
}

// 归因结果的结构定义与收敛工具。
//
// 设计约束（务必保持）：
// 1. 纯函数、无副作用、不引入任何业务词（业务词只来自主题语义包与词表）。
// 2. 算法内部**不做四舍五入**，保证结构性精度；四舍五入只是展示层的事。
//    这样 Σdriver.contribution 才能与 totalDelta 精确相等。
// 3. 所有"份额类"指标都必须显式声明分母，避免"占总体变化 / 占变动总量"被混用。
//
// 份额口径说明（这是本库相对旧实现最关键的修正）：
// - contributionRate = delta / totalDelta
//     含义："对总体净变化"的贡献率，带符号，各项相加 ≈ 1（含 other 桶时精确为 1）。
//     仅在 totalDelta 显著非零时有意义；totalDelta 趋近 0 时置 null。
// - movementShare = |delta| / Σ|delta|
//     含义："变动影响力"占比，恒非负，各项相加精确为 1。
//     用于 totalDelta 正负相抵（净变化接近 0）时判断"谁影响最大"。

export const OTHER_DRIVER_KEY = '__other__';
export const OTHER_DRIVER_LABEL = '其他';

// 净变化小于该阈值时，认为"净变化为零"，contributionRate 不再具备解释力。
export const DELTA_EPSILON = 1e-9;

export const ATTRIBUTION_DIRECTIONS = ['INCREASE', 'DECREASE', 'FLAT'];

export function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function toText(value) {
  return String(value ?? '').trim();
}

// 安全除法：分母为 0、非有限或分子为空时返回 null，绝不返回 Infinity / NaN。
export function safeDivide(numerator, denominator) {
  const left = toNumber(numerator);
  const right = toNumber(denominator);
  if (left === null || right === null || right === 0) {
    return null;
  }
  const result = left / right;
  return Number.isFinite(result) ? result : null;
}

export function directionOf(delta, epsilon = DELTA_EPSILON) {
  const value = toNumber(delta);
  if (value === null || Math.abs(value) <= epsilon) {
    return 'FLAT';
  }
  return value > 0 ? 'INCREASE' : 'DECREASE';
}

export function roundTo(value, precision) {
  const number = toNumber(value);
  if (number === null) {
    return value ?? null;
  }
  if (!Number.isInteger(precision)) {
    return number;
  }
  const factor = 10 ** Math.max(0, Math.min(12, precision));
  return Math.round(number * factor) / factor;
}

// 归因分析的统一失败形状，便于上游用同一个分支处理。
export function attributionError(code, message, details = {}) {
  return { ok: false, error: { code, message, ...details } };
}

// 计算驱动因素列表的收敛视图：排序、排名、截断、other 桶、份额、摘要、残差。
//
// 入参 rawDrivers 元素形状：{ key, label, dimension?, base, current, delta }
export function finalizeAttribution({
  method,
  metric,
  currentPeriod = null,
  previousPeriod = null,
  totalPrevious,
  totalCurrent,
  totalDelta,
  rawDrivers = [],
  topN = null,
  includeOther = true,
  extra = {},
} = {}) {
  const drivers = rawDrivers
    .map((driver) => ({
      key: toText(driver.key),
      label: toText(driver.label) || toText(driver.key),
      dimension: driver.dimension ?? null,
      base: toNumber(driver.base) ?? 0,
      current: toNumber(driver.current) ?? 0,
      delta: toNumber(driver.delta) ?? 0,
      depth: Number.isInteger(driver.depth) ? driver.depth : 0,
      parentKey: driver.parentKey ?? null,
      memberCount: Number.isInteger(driver.memberCount) ? driver.memberCount : 1,
      seed: driver.seed ?? null,
    }))
    // 排序必须稳定且确定：先按 |delta| 降序，再按 key 的本地化数值顺序，避免同值抖动。
    .sort((left, right) => {
      const byMagnitude = Math.abs(right.delta) - Math.abs(left.delta);
      if (byMagnitude !== 0) {
        return byMagnitude;
      }
      return String(left.key).localeCompare(String(right.key), 'zh-CN', { numeric: true });
    });

  const limit = Number.isInteger(topN) && topN > 0 ? topN : null;
  const truncated = Boolean(limit && drivers.length > limit);
  let kept = truncated ? drivers.slice(0, limit) : drivers;
  let otherDriver = null;
  if (truncated && includeOther) {
    const rest = drivers.slice(limit);
    otherDriver = {
      key: OTHER_DRIVER_KEY,
      label: OTHER_DRIVER_LABEL,
      dimension: null,
      base: rest.reduce((sum, item) => sum + item.base, 0),
      current: rest.reduce((sum, item) => sum + item.current, 0),
      delta: rest.reduce((sum, item) => sum + item.delta, 0),
      depth: 0,
      parentKey: null,
      memberCount: rest.reduce((sum, item) => sum + item.memberCount, 0),
      aggregated: true,
      seed: null,
    };
    kept = [...kept, otherDriver];
  }

  const totalMovement = drivers.reduce((sum, item) => sum + Math.abs(item.delta), 0);
  const netDelta = toNumber(totalDelta) ?? 0;
  const netExplained = kept.reduce((sum, item) => sum + item.delta, 0);

  let cumulative = 0;
  const outDrivers = kept.map((driver, index) => {
    const contributionRate = Math.abs(netDelta) <= DELTA_EPSILON
      ? null
      : safeDivide(driver.delta, netDelta);
    cumulative += contributionRate ?? 0;
    return {
      key: driver.key,
      label: driver.label,
      dimension: driver.dimension,
      rank: index + 1,
      base: driver.base,
      current: driver.current,
      delta: driver.delta,
      contribution: driver.delta,
      contributionRate,
      movementShare: safeDivide(Math.abs(driver.delta), totalMovement),
      cumulativeRate: Math.abs(netDelta) <= DELTA_EPSILON ? null : cumulative,
      direction: directionOf(driver.delta),
      depth: driver.depth,
      parentKey: driver.parentKey,
      memberCount: driver.memberCount,
      aggregated: driver.aggregated === true,
      seed: driver.seed,
    };
  });

  const increases = outDrivers.filter((item) => item.direction === 'INCREASE');
  const decreases = outDrivers.filter((item) => item.direction === 'DECREASE');
  const residual = netDelta - netExplained;

  return {
    ok: true,
    version: 1,
    method,
    metric: metric ?? null,
    currentPeriod,
    previousPeriod,
    base: { period: previousPeriod, total: toNumber(totalPrevious) },
    current: { period: currentPeriod, total: toNumber(totalCurrent) },
    totalDelta: netDelta,
    changeRate: safeDivide(netDelta, Math.abs(toNumber(totalPrevious) ?? 0) || null),
    direction: directionOf(netDelta),
    drivers: outDrivers,
    summary: {
      driverCount: outDrivers.length,
      totalDriverCount: drivers.length,
      truncated,
      includeOther,
      increaseCount: increases.length,
      decreaseCount: decreases.length,
      flatCount: outDrivers.filter((item) => item.direction === 'FLAT').length,
      topIncrease: increases[0] ?? null,
      topDecrease: decreases[0] ?? null,
      topDriver: outDrivers[0]?.key === OTHER_DRIVER_KEY ? null : (outDrivers[0] ?? null),
      totalMovement,
      // 集中度：Top1 驱动占全部变动量的比例，越高说明越集中。
      concentration: outDrivers.length > 0 && totalMovement > 0
        ? Math.abs(outDrivers[0].delta) / totalMovement
        : null,
    },
    // 精确性证据：Σcontribution - totalDelta。含 other 桶时应恒为 0（浮点误差内）。
    residual,
    exact: Math.abs(residual) <= 1e-6,
    ...extra,
  };
}

// 校验一个归因结果是否满足"贡献可加"：Σdrivers.contribution === totalDelta。
export function isAttributionExact(result, tolerance = 1e-6) {
  if (!result || result.ok !== true || !Array.isArray(result.drivers)) {
    return false;
  }
  const sum = result.drivers.reduce((total, driver) => total + (toNumber(driver.contribution) ?? 0), 0);
  return Math.abs(sum - (toNumber(result.totalDelta) ?? 0)) <= tolerance;
}

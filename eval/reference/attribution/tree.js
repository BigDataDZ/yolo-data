// 归因树（ADDITIVE_TREE）：把净变化沿"维度层级"逐层下钻拆解。
//
// 输入是带层级维度的明细行（例如 大区 -> 城市 -> 门店），输出是一棵精确可加的归因树：
//   每个节点 delta = Σ(子节点 delta)，根节点 delta = 总净变化。
// 因此任意一层的贡献都能自洽地解释上层变化，这是"逐层下钻找根因"的数学底座。
//
// 树是完整的（不截断）。截断是展示层关注点，由 pruneTree 显式完成：
//   剪枝会把被删子树折叠成"其他"节点，保持 Σ 子节点 = 父节点 不变。
//
// 份额口径与 additive.js 保持一致：
//   contributionRate = delta / 父节点净变化（带符号，父净变化≈0 时置 null）
//   movementShare    = |delta| / 兄弟节点全部变动量（恒非负，正负相抵时仍可判断谁影响最大）

import {
  OTHER_DRIVER_KEY,
  OTHER_DRIVER_LABEL,
  attributionError,
  directionOf,
  safeDivide,
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

export const TREE_METHOD = {
  code: 'ADDITIVE_TREE',
  label: '层级归因树',
  description: '沿维度层级逐层拆解净变化，节点贡献自洽，支持逐层下钻。',
  aggregators: [...ADDITIVE_AGGREGATORS],
  requiresAdditiveMetric: true,
};

export const TREE_ROOT_KEY = '__total__';
export const TREE_ROOT_LABEL = '全部';

const TREE_EPSILON = 1e-9;

// 自底向上：非叶节点 base/current 由子节点汇总；叶节点保留聚合值。
function summarizeChildren(children) {
  return children.map((child) => {
    if ((child.children ?? []).length === 0) {
      return { ...child, children: [] };
    }
    const summarized = summarizeChildren(child.children);
    return {
      ...child,
      base: summarized.reduce((sum, item) => sum + item.base, 0),
      current: summarized.reduce((sum, item) => sum + item.current, 0),
      children: summarized,
    };
  });
}

// 自顶向下：补 delta、方向、份额。movementShare 的分母是"兄弟节点全部变动量"。
function decorateSubtree(node, parentDelta) {
  const delta = (node.current ?? 0) - (node.base ?? 0);
  const siblings = Array.isArray(node.siblingMovement)
    ? node.siblingMovement
    : null;
  return {
    key: node.key,
    label: node.label,
    dimension: node.dimension ?? null,
    depth: node.depth,
    path: node.path,
    base: node.base,
    current: node.current,
    delta,
    direction: directionOf(delta),
    contributionRate: parentDelta !== null && Math.abs(parentDelta) > TREE_EPSILON
      ? safeDivide(delta, parentDelta)
      : null,
    movementShare: siblings === null ? null : safeDivide(Math.abs(delta), siblings),
    aggregated: node.aggregated === true,
    memberCount: node.memberCount,
    children: decorateChildren(node.children ?? [], delta),
  };
}

function decorateChildren(children, parentDelta) {
  const movement = children.reduce(
    (sum, item) => sum + Math.abs((item.current ?? 0) - (item.base ?? 0)),
    0,
  );
  return children.map((child) => decorateSubtree({ ...child, siblingMovement: movement }, parentDelta));
}

export function buildAttributionTree({
  rows = [],
  levels = [],
  metricKey,
  metricLabel = '',
  aggregator = 'SUM',
  periodKey = '__period',
  currentPeriod = null,
  previousPeriod = null,
  periodOrder = [],
} = {}) {
  if (!toText(metricKey)) {
    throw new TypeError('buildAttributionTree requires metricKey');
  }
  const normalizedLevels = (levels ?? [])
    .map((level, index) => ({
      key: toText(level?.key ?? level?.field),
      label: toText(level?.label) || toText(level?.key ?? level?.field) || `层级${index + 1}`,
    }))
    .filter((level) => level.key);
  if (normalizedLevels.length === 0) {
    return attributionError('LEVELS_REQUIRED', '归因树至少需要一个层级维度。');
  }
  const mode = toText(aggregator).toUpperCase() || 'SUM';
  if (!AGGREGATORS.has(mode)) {
    return attributionError('UNSUPPORTED_AGGREGATOR', `不支持的聚合方式：${aggregator}`);
  }
  if (!ADDITIVE_AGGREGATORS.has(mode)) {
    return attributionError(
      'NON_ADDITIVE_AGGREGATOR',
      `${mode} 不可加，无法构建层级归因树。`,
      { aggregator: mode },
    );
  }

  const periods = resolvePeriods({ rows, periodKey, currentPeriod, previousPeriod, periodOrder });
  if (!periods.currentPeriod || !periods.previousPeriod) {
    return attributionError('PERIOD_NOT_RESOLVED', '未能确定本期与上期两个周期。', {
      available: periods.available,
    });
  }
  const { currentPeriod: current, previousPeriod: previous } = periods;

  const totalCurrent = aggregateValues(
    (rows ?? []).filter((row) => toText(row?.[periodKey]) === current).map((row) => row?.[metricKey]),
    mode,
  );
  const totalPrevious = aggregateValues(
    (rows ?? []).filter((row) => toText(row?.[periodKey]) === previous).map((row) => row?.[metricKey]),
    mode,
  );

  const deepest = aggregateByKey({
    rows,
    keyOf: (row) => normalizedLevels.map((level) => row?.[level.key]),
    metricKey,
    periodKey,
    currentPeriod: current,
    previousPeriod: previous,
    aggregator: mode,
  });

  // 按完整路径构造嵌套结构；同一父路径下的重复子键自然合并。
  const rootChildren = [];
  const childrenByPath = new Map([['', rootChildren]]);
  for (const item of deepest) {
    for (let depth = 0; depth < item.parts.length; depth += 1) {
      const pathKey = item.parts.slice(0, depth + 1).join('\u001f');
      if (!childrenByPath.has(pathKey)) {
        const parentKey = depth === 0 ? '' : item.parts.slice(0, depth).join('\u001f');
        const node = {
          key: item.parts[depth],
          label: item.parts[depth],
          dimension: normalizedLevels[depth].label,
          depth,
          path: item.parts.slice(0, depth + 1),
          base: 0,
          current: 0,
          children: [],
        };
        childrenByPath.set(pathKey, node.children);
        childrenByPath.get(parentKey).push(node);
      }
    }
  }
  // 叶子节点取聚合行的值；是否叶子由结构决定（无子节点），不依赖构造顺序。
  const leafByPath = new Map(deepest.map((item) => [item.parts.join('\u001f'), item]));
  const assignLeafValues = (nodes) => {
    for (const node of nodes) {
      if ((node.children ?? []).length === 0) {
        const leaf = leafByPath.get(node.path.join('\u001f'));
        node.base = leaf ? leaf.base : 0;
        node.current = leaf ? leaf.current : 0;
      }
      assignLeafValues(node.children);
    }
  };
  assignLeafValues(rootChildren);

  const root = {
    key: TREE_ROOT_KEY,
    label: TREE_ROOT_LABEL,
    dimension: null,
    depth: -1,
    path: [],
    base: totalPrevious,
    current: totalCurrent,
    children: summarizeChildren(rootChildren),
  };
  const tree = decorateSubtree(root, null);

  const residual = tree.delta - (totalCurrent - totalPrevious);
  return {
    ok: true,
    version: 1,
    method: TREE_METHOD.code,
    metric: {
      key: toText(metricKey),
      label: toText(metricLabel) || toText(metricKey),
      isRate: false,
      aggregator: mode,
    },
    currentPeriod: current,
    previousPeriod: previous,
    base: { period: previous, total: totalPrevious },
    current: { period: current, total: totalCurrent },
    totalDelta: tree.delta,
    changeRate: safeDivide(tree.delta, Math.abs(totalPrevious)),
    direction: directionOf(tree.delta),
    levels: normalizedLevels,
    root: tree,
    residual,
    exact: Math.abs(residual) <= 1e-6,
  };
}

// 展示层剪枝：每层只保留影响最大的 topN 个子节点，其余折叠为"其他"。
// 折叠保证 Σ子节点 delta === 父节点 delta，因此剪枝后的树仍然精确可加。
export function pruneTree(node, topNPerLevel) {
  if (!node || !Array.isArray(node.children) || node.children.length === 0) {
    return node;
  }
  const limit = Number.isInteger(topNPerLevel) && topNPerLevel > 0 ? topNPerLevel : null;
  let children = [...node.children].sort((left, right) => {
    const byMagnitude = Math.abs(right.delta) - Math.abs(left.delta);
    if (byMagnitude !== 0) {
      return byMagnitude;
    }
    return String(left.key).localeCompare(String(right.key), 'zh-CN', { numeric: true });
  });
  if (limit && children.length > limit) {
    const rest = children.slice(limit);
    const otherBase = rest.reduce((sum, item) => sum + item.base, 0);
    const otherCurrent = rest.reduce((sum, item) => sum + item.current, 0);
    children = [
      ...children.slice(0, limit),
      {
        key: OTHER_DRIVER_KEY,
        label: OTHER_DRIVER_LABEL,
        dimension: rest[0].dimension,
        depth: rest[0].depth ?? 0,
        path: [...(node.path ?? []), OTHER_DRIVER_KEY],
        base: otherBase,
        current: otherCurrent,
        delta: otherCurrent - otherBase,
        direction: directionOf(otherCurrent - otherBase),
        aggregated: true,
        memberCount: rest.length,
        children: [],
      },
    ];
  }
  const movement = children.reduce((sum, item) => sum + Math.abs(item.delta), 0);
  return {
    ...node,
    children: children.map((child) => ({
      ...child,
      movementShare: safeDivide(Math.abs(child.delta), movement),
      contributionRate: Math.abs(node.delta) > TREE_EPSILON
        ? safeDivide(child.delta, node.delta)
        : null,
      children: (pruneTree(child, topNPerLevel) ?? { children: [] }).children ?? [],
    })),
  };
}

// 把树摊平成带 depth / parentKey 的行，供表格或瀑布图消费。
export function flattenTree(node, parentKey = null, accumulator = []) {
  if (!node) {
    return accumulator;
  }
  if (node.key !== TREE_ROOT_KEY) {
    accumulator.push({
      key: node.key,
      label: node.label,
      dimension: node.dimension,
      depth: Math.max(0, node.depth ?? 0),
      parentKey,
      base: node.base,
      current: node.current,
      delta: node.delta,
      contribution: node.delta,
      contributionRate: node.contributionRate ?? null,
      movementShare: node.movementShare ?? null,
      direction: node.direction ?? directionOf(node.delta),
      aggregated: node.aggregated === true,
    });
  }
  for (const child of node.children ?? []) {
    flattenTree(child, node.key, accumulator);
  }
  return accumulator;
}

// 树的可加性自检：任意节点 Σ子节点 delta 与自身 delta 的最大偏差。
export function treeExactness(node, tolerance = 1e-6) {
  if (!node) {
    return { exact: true, maxResidual: 0 };
  }
  const children = Array.isArray(node.children) ? node.children : [];
  const childSum = children.reduce((sum, child) => sum + (toNumber(child.delta) ?? 0), 0);
  const ownResidual = children.length === 0
    ? 0
    : (toNumber(node.delta) ?? 0) - childSum;
  let maxResidual = Math.abs(ownResidual);
  let exact = Math.abs(ownResidual) <= tolerance;
  for (const child of children) {
    const childResult = treeExactness(child, tolerance);
    maxResidual = Math.max(maxResidual, childResult.maxResidual);
    exact = exact && childResult.exact;
  }
  return { exact, maxResidual };
}

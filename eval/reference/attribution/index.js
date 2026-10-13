// 归因算法库统一入口：注册可用方法并提供统一分发。
//
// 使用方式：
//   import { decomposeAttribution } from './attribution/index.js';
//   const result = decomposeAttribution({ method: 'ADDITIVE', ... });
//
// 所有方法都返回统一形状：
//   { ok: true,  ...result }  或  { ok: false, error: { code, message, ... } }
// 精确性契约（ok 时）：
//   Σ(drivers|factors).contribution === totalDelta，residual 恒在浮点误差内；
//   isAttributionExact(result) / treeExactness(node) 可随时复检。

import { ADDITIVE_METHOD, decomposeAdditive, UNATTRIBUTED_DRIVER_KEY } from './additive.js';
import { GROWTH_METHOD, decomposeGrowthContribution } from './growth.js';
import { MULTIPLICATIVE_METHOD, decomposeMultiplicative, INTERACTION_POLICIES } from './multiplicative.js';
import { TREE_METHOD, buildAttributionTree, pruneTree, flattenTree, treeExactness, TREE_ROOT_KEY } from './tree.js';

export const ATTRIBUTION_METHODS = [
  ADDITIVE_METHOD,
  GROWTH_METHOD,
  MULTIPLICATIVE_METHOD,
  TREE_METHOD,
];

const METHOD_BY_CODE = new Map(
  ATTRIBUTION_METHODS.map((method) => [method.code, method]),
);

export function attributionMethod(code) {
  return METHOD_BY_CODE.get(String(code ?? '').trim().toUpperCase()) ?? null;
}

export function attributionMethodCodes() {
  return ATTRIBUTION_METHODS.map((method) => method.code);
}

// 统一分发：未注册的方法码直接返回错误，而不是静默回退到某个默认算法。
export function decomposeAttribution({ method = ADDITIVE_METHOD.code, ...options } = {}) {
  const definition = attributionMethod(method);
  if (!definition) {
    return {
      ok: false,
      error: {
        code: 'UNKNOWN_METHOD',
        message: `未注册的归因方法：${method}`,
        supported: attributionMethodCodes(),
      },
    };
  }
  switch (definition.code) {
    case GROWTH_METHOD.code:
      return decomposeGrowthContribution(options);
    case MULTIPLICATIVE_METHOD.code:
      return decomposeMultiplicative(options);
    case TREE_METHOD.code:
      return buildAttributionTree(options);
    case ADDITIVE_METHOD.code:
    default:
      return decomposeAdditive(options);
  }
}

export {
  ADDITIVE_METHOD,
  GROWTH_METHOD,
  MULTIPLICATIVE_METHOD,
  TREE_METHOD,
  decomposeAdditive,
  decomposeGrowthContribution,
  decomposeMultiplicative,
  buildAttributionTree,
  pruneTree,
  flattenTree,
  treeExactness,
  UNATTRIBUTED_DRIVER_KEY,
  INTERACTION_POLICIES,
  TREE_ROOT_KEY,
};

export {
  OTHER_DRIVER_KEY,
  OTHER_DRIVER_LABEL,
  DELTA_EPSILON,
  ATTRIBUTION_DIRECTIONS,
  attributionError,
  directionOf,
  isAttributionExact,
  roundTo,
  safeDivide,
  toNumber,
  toText,
} from './schema.js';

export {
  ADDITIVE_AGGREGATORS,
  AGGREGATORS,
  aggregateByKey,
  aggregateValues,
  distinctPeriods,
  resolvePeriods,
} from './dataset.js';

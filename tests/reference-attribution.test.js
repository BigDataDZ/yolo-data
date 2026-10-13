import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADDITIVE_METHOD,
  ATTRIBUTION_METHODS,
  decomposeAdditive,
  decomposeAttribution,
  decomposeGrowthContribution,
  decomposeMultiplicative,
  buildAttributionTree,
  flattenTree,
  isAttributionExact,
  pruneTree,
  safeDivide,
  treeExactness,
  UNATTRIBUTED_DRIVER_KEY,
  OTHER_DRIVER_KEY,
} from '../eval/reference/attribution/index.js';

const CURRENT = '本期';
const PREVIOUS = '上期';

function row(period, channel, amount) {
  return { __period: period, 渠道: channel, 销售额: amount };
}

function closeTo(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be close to ${expected}`,
  );
}

test('schema helpers never return Infinity or NaN shares', () => {
  assert.equal(safeDivide(1, 0), null);
  assert.equal(safeDivide(null, 2), null);
  assert.equal(safeDivide('3', '4'), 0.75);
});

test('additive decomposition is exact and sums contributions to total delta', () => {
  const result = decomposeAdditive({
    rows: [
      row(PREVIOUS, 'A', 100),
      row(PREVIOUS, 'B', 50),
      row(CURRENT, 'A', 120),
      row(CURRENT, 'B', 40),
    ],
    dimensionKey: '渠道',
    metricKey: '销售额',
    currentPeriod: CURRENT,
    previousPeriod: PREVIOUS,
  });

  assert.equal(result.ok, true);
  assert.equal(result.method, 'ADDITIVE');
  assert.equal(result.base.total, 150);
  assert.equal(result.current.total, 160);
  assert.equal(result.totalDelta, 10);
  assert.equal(result.exact, true);
  assert.equal(isAttributionExact(result), true);
  assert.equal(result.residual, 0);

  const channelA = result.drivers.find((driver) => driver.key === 'A');
  const channelB = result.drivers.find((driver) => driver.key === 'B');
  assert.equal(channelA.delta, 20);
  assert.equal(channelA.direction, 'INCREASE');
  assert.equal(channelB.delta, -10);
  assert.equal(channelB.direction, 'DECREASE');

  // 贡献率（占净变化）之和精确为 1；变动影响力（占全部变动量）之和精确为 1。
  const rateSum = result.drivers.reduce((sum, driver) => sum + driver.contributionRate, 0);
  const movementSum = result.drivers.reduce((sum, driver) => sum + driver.movementShare, 0);
  closeTo(rateSum, 1);
  closeTo(movementSum, 1);
  closeTo(channelA.contributionRate, 2);
  closeTo(channelB.contributionRate, -1);
  closeTo(channelA.movementShare, 20 / 30);
});

test('additive decomposition aggregates repeated rows per driver', () => {
  const result = decomposeAdditive({
    rows: [
      row(PREVIOUS, 'A', 60),
      row(PREVIOUS, 'A', 40),
      row(CURRENT, 'A', 130),
    ],
    dimensionKey: '渠道',
    metricKey: '销售额',
    currentPeriod: CURRENT,
    previousPeriod: PREVIOUS,
  });
  assert.equal(result.ok, true);
  assert.equal(result.totalDelta, 30);
  assert.equal(result.drivers[0].base, 100);
  assert.equal(result.drivers[0].current, 130);
});

test('additive decomposition folds rows without dimension value into an unattributed bucket', () => {
  const result = decomposeAdditive({
    rows: [
      row(PREVIOUS, 'A', 100),
      row(PREVIOUS, '', 50),
      row(CURRENT, 'A', 120),
      row(CURRENT, '', 40),
    ],
    dimensionKey: '渠道',
    metricKey: '销售额',
    currentPeriod: CURRENT,
    previousPeriod: PREVIOUS,
  });
  assert.equal(result.ok, true);
  assert.equal(result.totalDelta, 10);
  const unattributed = result.drivers.find((driver) => driver.key === UNATTRIBUTED_DRIVER_KEY);
  assert.ok(unattributed, 'missing dimension rows must surface as an explicit bucket');
  assert.equal(unattributed.delta, -10);
  assert.equal(isAttributionExact(result), true);
});

test('topN truncation keeps exactness through an explicit other bucket', () => {
  const rows = [];
  for (let index = 0; index < 5; index += 1) {
    rows.push(row(PREVIOUS, `渠道${index}`, 100));
    rows.push(row(CURRENT, `渠道${index}`, 100 + (index + 1) * 10));
  }
  const exact = decomposeAdditive({
    rows,
    dimensionKey: '渠道',
    metricKey: '销售额',
    currentPeriod: CURRENT,
    previousPeriod: PREVIOUS,
    topN: 2,
  });
  assert.equal(exact.ok, true);
  assert.equal(exact.summary.truncated, true);
  assert.equal(exact.drivers.length, 3);
  assert.equal(exact.drivers[2].key, OTHER_DRIVER_KEY);
  assert.equal(exact.drivers[2].aggregated, true);
  assert.equal(exact.drivers[2].memberCount, 3);
  assert.equal(isAttributionExact(exact), true);

  const lossy = decomposeAdditive({
    rows,
    dimensionKey: '渠道',
    metricKey: '销售额',
    currentPeriod: CURRENT,
    previousPeriod: PREVIOUS,
    topN: 2,
    includeOther: false,
  });
  assert.equal(lossy.drivers.length, 2);
  assert.equal(lossy.exact, false);
  assert.notEqual(lossy.residual, 0);
});

test('additive decomposition rejects non-additive metrics and aggregators', () => {
  const options = {
    rows: [row(PREVIOUS, 'A', 10), row(CURRENT, 'A', 12)],
    dimensionKey: '渠道',
    metricKey: '毛利率',
    metricIsRate: true,
    currentPeriod: CURRENT,
    previousPeriod: PREVIOUS,
  };
  const rejected = decomposeAdditive(options);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'NON_ADDITIVE_METRIC');

  const averaged = decomposeAdditive({ ...options, metricIsRate: false, aggregator: 'AVG' });
  assert.equal(averaged.ok, false);
  assert.equal(averaged.error.code, 'NON_ADDITIVE_AGGREGATOR');
});

test('additive decomposition refuses to guess periods from row order', () => {
  const guessed = decomposeAdditive({
    rows: [row(PREVIOUS, 'A', 10), row(CURRENT, 'A', 12)],
    dimensionKey: '渠道',
    metricKey: '销售额',
  });
  assert.equal(guessed.ok, false);
  assert.equal(guessed.error.code, 'PERIOD_NOT_RESOLVED');
  assert.deepEqual(guessed.error.available.sort(), [CURRENT, PREVIOUS].sort());

  const ordered = decomposeAdditive({
    rows: [row(PREVIOUS, 'A', 10), row(CURRENT, 'A', 12)],
    dimensionKey: '渠道',
    metricKey: '销售额',
    periodOrder: [CURRENT, PREVIOUS],
  });
  assert.equal(ordered.ok, true);
  assert.equal(ordered.currentPeriod, CURRENT);
  assert.equal(ordered.previousPeriod, PREVIOUS);
  assert.equal(ordered.periodsInferred, true);
});

test('growth contribution splits the growth rate into exact percentage points', () => {
  const result = decomposeGrowthContribution({
    rows: [
      row(PREVIOUS, 'A', 100),
      row(PREVIOUS, 'B', 50),
      row(CURRENT, 'A', 120),
      row(CURRENT, 'B', 40),
    ],
    dimensionKey: '渠道',
    metricKey: '销售额',
    currentPeriod: CURRENT,
    previousPeriod: PREVIOUS,
  });

  assert.equal(result.ok, true);
  assert.equal(result.method, 'GROWTH_CONTRIBUTION');
  closeTo(result.growthRate, 10 / 150);

  const channelA = result.drivers.find((driver) => driver.key === 'A');
  const channelB = result.drivers.find((driver) => driver.key === 'B');
  closeTo(channelA.contributionToGrowth, 20 / 150);
  closeTo(channelB.contributionToGrowth, -10 / 150);
  assert.equal(channelA.effect, 'PULL');
  assert.equal(channelB.effect, 'DRAG');

  const pointSum = result.drivers.reduce((sum, driver) => sum + driver.contributionToGrowth, 0);
  closeTo(pointSum, result.growthRate);
  assert.equal(result.summary.topPull.key, 'A');
  assert.equal(result.summary.topDrag.key, 'B');
});

test('growth contribution handles a zero base without inventing rates', () => {
  const result = decomposeGrowthContribution({
    rows: [row(PREVIOUS, 'A', 0), row(CURRENT, 'A', 12)],
    dimensionKey: '渠道',
    metricKey: '销售额',
    currentPeriod: CURRENT,
    previousPeriod: PREVIOUS,
  });
  assert.equal(result.ok, true);
  assert.equal(result.growthRateDefined, false);
  assert.equal(result.growthRate, null);
  assert.equal(result.drivers[0].contributionToGrowth, null);
  // 变动影响力仍然可用，用于回答"谁影响最大"。
  assert.equal(result.drivers[0].movementShare, 1);
});

test('multiplicative decomposition is exact for every interaction policy', () => {
  const factors = [
    { key: 'volume', label: '销量', base: 100, current: 110 },
    { key: 'price', label: '单价', base: 10, current: 9 },
  ];
  for (const interactionPolicy of ['FIRST', 'LAST', 'SPLIT']) {
    const result = decomposeMultiplicative({ factors, interactionPolicy });
    assert.equal(result.ok, true, interactionPolicy);
    assert.equal(result.base.total, 1000);
    assert.equal(result.current.total, 990);
    assert.equal(result.totalDelta, -10);
    const contributionSum = result.factors.reduce((sum, factor) => sum + factor.contribution, 0);
    closeTo(contributionSum, -10);
    assert.equal(result.exact, true);
  }

  const split = decomposeMultiplicative({ factors, interactionPolicy: 'SPLIT' });
  closeTo(split.factors[0].contribution, 95);
  closeTo(split.factors[1].contribution, -105);
  closeTo(split.interactionTerm, -10);
});

test('multiplicative decomposition validates policies and factor counts', () => {
  const twoFactors = [
    { key: 'a', base: 1, current: 2 },
    { key: 'b', base: 3, current: 4 },
  ];
  const invalidPolicy = decomposeMultiplicative({ factors: twoFactors, interactionPolicy: 'RANDOM' });
  assert.equal(invalidPolicy.ok, false);
  assert.equal(invalidPolicy.error.code, 'UNSUPPORTED_INTERACTION_POLICY');

  const splitOnThree = decomposeMultiplicative({
    factors: [...twoFactors, { key: 'c', base: 5, current: 6 }],
    interactionPolicy: 'SPLIT',
  });
  assert.equal(splitOnThree.ok, false);
  assert.equal(splitOnThree.error.code, 'SPLIT_REQUIRES_TWO_FACTORS');

  const tooFew = decomposeMultiplicative({ factors: [{ key: 'a', base: 1, current: 2 }] });
  assert.equal(tooFew.ok, false);
  assert.equal(tooFew.error.code, 'FACTOR_COUNT_INVALID');
});

test('multiplicative decomposition reports declared total mismatch honestly', () => {
  const result = decomposeMultiplicative({
    factors: [
      { key: 'volume', base: 100, current: 110 },
      { key: 'price', base: 10, current: 9 },
    ],
    declaredTotalBase: 1000,
    declaredTotalCurrent: 995,
  });
  assert.equal(result.ok, true);
  assert.equal(result.productConsistency.consistent, false);
  assert.equal(result.productConsistency.currentResidual, -5);
});

test('attribution tree stays additive at every level', () => {
  const rows = [
    { __period: PREVIOUS, 大区: '华东', 城市: '上海', 销售额: 60 },
    { __period: PREVIOUS, 大区: '华东', 城市: '杭州', 销售额: 40 },
    { __period: PREVIOUS, 大区: '华南', 城市: '广州', 销售额: 50 },
    { __period: CURRENT, 大区: '华东', 城市: '上海', 销售额: 70 },
    { __period: CURRENT, 大区: '华东', 城市: '杭州', 销售额: 45 },
    { __period: CURRENT, 大区: '华南', 城市: '广州', 销售额: 40 },
  ];
  const tree = buildAttributionTree({
    rows,
    levels: [
      { key: '大区', label: '大区' },
      { key: '城市', label: '城市' },
    ],
    metricKey: '销售额',
    currentPeriod: CURRENT,
    previousPeriod: PREVIOUS,
  });

  assert.equal(tree.ok, true);
  assert.equal(tree.method, 'ADDITIVE_TREE');
  assert.equal(tree.totalDelta, 5);
  assert.equal(tree.exact, true);
  assert.equal(treeExactness(tree.root).exact, true);

  const east = tree.root.children.find((node) => node.key === '华东');
  const south = tree.root.children.find((node) => node.key === '华南');
  assert.equal(east.delta, 15);
  assert.equal(south.delta, -10);
  closeTo(east.contributionRate, 3);
  const shanghai = east.children.find((node) => node.key === '上海');
  assert.equal(shanghai.delta, 10);

  const flat = flattenTree(tree.root);
  assert.equal(flat.length, 5);
  assert.equal(flat[0].key, '华东');
  assert.equal(flat[0].depth, 0);
  assert.equal(flat[1].parentKey, '华东');
});

test('pruneTree keeps the tree exact while collapsing small branches', () => {
  const rows = [];
  const cities = [
    ['华东', '上海', 60, 70],
    ['华东', '杭州', 40, 45],
    ['华南', '广州', 50, 40],
  ];
  for (const [region, city, base, current] of cities) {
    rows.push({ __period: PREVIOUS, 大区: region, 城市: city, 销售额: base });
    rows.push({ __period: CURRENT, 大区: region, 城市: city, 销售额: current });
  }
  const tree = buildAttributionTree({
    rows,
    levels: [{ key: '大区' }, { key: '城市' }],
    metricKey: '销售额',
    currentPeriod: CURRENT,
    previousPeriod: PREVIOUS,
  });
  const pruned = pruneTree(tree.root, 1);
  assert.equal(treeExactness(pruned).exact, true);

  const rootOther = pruned.children.find((node) => node.key === OTHER_DRIVER_KEY);
  assert.ok(rootOther, 'pruned root must keep an other bucket');
  assert.equal(rootOther.delta, -10);
  const flat = flattenTree(pruned);
  assert.ok(flat.length < flattenTree(tree.root).length);
});

test('decomposeAttribution dispatches registered methods and rejects unknown codes', () => {
  assert.deepEqual(
    ATTRIBUTION_METHODS.map((method) => method.code),
    ['ADDITIVE', 'GROWTH_CONTRIBUTION', 'MULTIPLICATIVE', 'ADDITIVE_TREE'],
  );

  const dispatched = decomposeAttribution({
    method: 'ADDITIVE',
    rows: [row(PREVIOUS, 'A', 10), row(CURRENT, 'A', 12)],
    dimensionKey: '渠道',
    metricKey: '销售额',
    currentPeriod: CURRENT,
    previousPeriod: PREVIOUS,
  });
  assert.equal(dispatched.ok, true);
  assert.equal(dispatched.method, ADDITIVE_METHOD.code);

  const unknown = decomposeAttribution({ method: 'SHAPLEY' });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'UNKNOWN_METHOD');
  assert.deepEqual(unknown.error.supported, ['ADDITIVE', 'GROWTH_CONTRIBUTION', 'MULTIPLICATIVE', 'ADDITIVE_TREE']);
});

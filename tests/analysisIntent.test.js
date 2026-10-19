import assert from 'node:assert/strict';
import test from 'node:test';

import { isAttributionText } from '../src/analysisIntent.js';

test('attribution intent covers causal, contribution and comparison diagnoses', () => {
  const questions = [
    '9月业绩环比下降的原因是什么',
    '哪些客户拖累了增长，哪些品类贡献最大',
    '9月销售额环比变化，帮我看看客户结构哪里出了问题',
    '9月业绩不如上月，主要是客户还是品类',
    '9月业绩环比下降，客户结构和品类结构分别影响多少',
    '分析9月销售业绩变化，要求拆到客户和品类',
  ];

  for (const question of questions) {
    assert.equal(isAttributionText(question), true, question);
  }
});

test('plain comparisons and trend questions are not forced into attribution', () => {
  assert.equal(isAttributionText('9月比8月销售额是多少'), false);
  assert.equal(isAttributionText('本月销售额趋势按周'), false);
  assert.equal(isAttributionText('各品类贡献率'), false);
});

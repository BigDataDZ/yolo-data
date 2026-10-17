import assert from 'node:assert/strict';
import test from 'node:test';

import { MULTI_TURN_CASES, runMultiTurnSuite } from '../eval/multiTurnCases.mjs';

test('multi-turn context eval covers the required six conversation modes', () => {
  const categories = new Set(MULTI_TURN_CASES.map((item) => item.category));
  assert.deepEqual([...categories].sort(), [
    '话题切换',
    '记忆冲突',
    '指标不变但时间变化',
    '指代结果',
    '澄清回答',
    '连续追问',
  ].sort());
});

test('multi-turn context eval passes every deterministic case', () => {
  const results = runMultiTurnSuite();
  const failed = results.filter((result) => !result.passed);
  assert.deepEqual(failed, []);
  assert.equal(results.length, 6);
});

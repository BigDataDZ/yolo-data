import assert from 'node:assert/strict';
import test from 'node:test';

import { runChecks } from '../scripts/check-architecture.mjs';
import { findBusinessVocabulary } from '../scripts/businessVocabularyRules.mjs';

test('business vocabulary guard detects high-confidence domain terms', () => {
  assert.deepEqual(findBusinessVocabulary('const region = "华东";'), [
    { term: '华东', line: 1 },
  ]);
  assert.deepEqual(findBusinessVocabulary('const title = "经营总览";'), [
    { term: '经营总览', line: 1 },
  ]);
});

test('business vocabulary guard allows generic analytical language', () => {
  assert.deepEqual(findBusinessVocabulary('执行结果按维度分组，并计算合计与趋势'), []);
  assert.deepEqual(findBusinessVocabulary('const ratio = value / total;'), []);
});

test('production source tree has no hardcoded business vocabulary', () => {
  const issues = runChecks().issues.filter((issue) => issue.rule === 'NO-BUSINESS-VOCAB');
  assert.deepEqual(issues, []);
});

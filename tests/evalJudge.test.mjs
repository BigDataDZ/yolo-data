import assert from 'node:assert/strict';
import test from 'node:test';
import { runLevel, runAllLevels } from '../scripts/run-eval.mjs';
import { runL3Case } from '../eval/answerCase.mjs';

const validVerdict = JSON.stringify({
  answersQuestion: true, consistentWithData: true, needsReplan: false,
  reason: 'Matches the supplied data', hint: '',
});

for (const { name, judge, attempted, legacyRan } of [
  { name: 'missing', judge: null, attempted: 0, legacyRan: 0 },
  { name: 'throws', judge: async () => { throw new Error('offline'); }, attempted: 2, legacyRan: 0 },
  { name: 'malformed', judge: async () => 'not-json', attempted: 2, legacyRan: 2 },
  { name: 'empty', judge: async () => '', attempted: 2, legacyRan: 2 },
  { name: 'null response', judge: async () => null, attempted: 2, legacyRan: 2 },
  { name: 'unrelated JSON', judge: async () => '{}', attempted: 2, legacyRan: 2 },
  { name: 'partial verdict', judge: async () => '{"answersQuestion":true}', attempted: 2, legacyRan: 2 },
  { name: 'string consistency', judge: async () => '{"answersQuestion":true,"consistentWithData":"false","needsReplan":false}', attempted: 2, legacyRan: 2 },
  { name: 'string replan', judge: async () => '{"answersQuestion":true,"consistentWithData":true,"needsReplan":"false"}', attempted: 2, legacyRan: 2 },
]) {
  test(`L3 keeps ${name} judgments pending while retaining deterministic fixture checks`, async () => {
    const report = await runLevel('L3', { judge });
    assert.equal(report.totals.judgePending, 2);
    assert.equal(report.totals.judgeAttempted, attempted);
    assert.equal(report.totals.judgeCompleted, 0);
    assert.equal(report.totals.judgeRan, legacyRan);
    assert.equal(report.totals.cases, 2);
    assert.equal(report.totals.passed, 2);
    assert.equal(report.totals.failed, 0);
    assert.equal(report.totals.passRate, 1);
    assert.deepEqual(report.results.map((r) => r.reflection.passed), [true, false]);
    for (const result of report.results) {
      assert.equal(result.judgePending, true);
      assert.equal(result.judgeAttempted, attempted > 0);
      assert.equal(result.judgeCompleted, false);
      assert.equal(result.judgeAvailable, legacyRan > 0);
      assert.equal(result.reflection.degraded, true);
    }
  });
}

test('a valid judge completes L3 judgments without masking a deterministic numeric failure', async () => {
  const report = await runLevel('L3', { judge: async () => validVerdict });
  assert.equal(report.totals.judgePending, 0);
  assert.equal(report.totals.judgeAttempted, 2);
  assert.equal(report.totals.judgeCompleted, 2);
  assert.equal(report.totals.judgeRan, 2);
  assert.equal(report.totals.passed, 2);
  assert.deepEqual(report.results.map((r) => r.reflection.passed), [true, false]);
  assert.ok(report.results.every((r) => r.judgeCompleted && !r.judgePending));
});

test('a no-data fixture skips judgment without becoming pending or attempted', async () => {
  const result = await runL3Case({
    id: 'no-data', question: '销售额', answer: '请补充时间范围',
    result: { columns: [], rows: [] },
    expectReflect: { shouldPass: true, needsReplan: false },
  }, async () => { throw new Error('no-data fixtures must skip the judge'); });
  assert.equal(result.passed, true);
  assert.equal(result.judgePending, false);
  assert.equal(result.judgeAttempted, false);
  assert.equal(result.judgeCompleted, false);
  assert.equal(result.judgeAvailable, false);
});

test('valid negative judgments count as completed and still fail mismatching fixture expectations', async () => {
  const report = await runLevel('L3', { judge: async () => JSON.stringify({
    answersQuestion: false, consistentWithData: false, needsReplan: true,
    reason: 'Off topic', hint: 'Change the query dimension',
  }) });
  assert.equal(report.totals.judgeCompleted, 2);
  assert.equal(report.totals.judgePending, 0);
  assert.equal(report.totals.passed, 0);
  assert.equal(report.totals.failed, 2);
  assert.ok(report.results.every((r) => r.reflection.needsReplan));
});

test('all-level report keeps fixture totals consistent while L3 judgments are pending', async () => {
  const report = await runAllLevels({ judge: async () => 'not-json' });
  assert.equal(report.levels.L3.totals.judgePending, 2);
  assert.equal(report.levels.L3.totals.judgeCompleted, 0);
  for (const level of ['L1', 'L2']) {
    assert.equal(report.levels[level].totals.judgeAttempted, 0);
    assert.equal(report.levels[level].totals.judgeCompleted, 0);
    assert.equal(report.levels[level].totals.judgePending, 0);
  }
  assert.equal(report.overall.cases, Object.values(report.levels).reduce((sum, r) => sum + r.totals.cases, 0));
  assert.equal(report.overall.passed, report.overall.cases);
  assert.equal(report.overall.failed, 0);
  assert.equal(report.overall.accuracy, 1);
});

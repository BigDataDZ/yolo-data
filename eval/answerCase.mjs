// Eval status is separate from production reflection and fixture pass/fail.
import { reflectOnAnswer } from '../src/reflection.js';

export async function runL3Case(evalCase, judge) {
  let judgeAttempted = false;
  const trackedJudge = typeof judge === 'function' ? (...args) => {
    judgeAttempted = true;
    return judge(...args);
  } : null;
  const reflection = await reflectOnAnswer({
    question: evalCase.question,
    answer: evalCase.answer,
    result: evalCase.result,
    judge: trackedJudge,
  });
  const expect = evalCase.expectReflect ?? {};
  const checks = [];
  if (expect.shouldPass !== undefined) {
    checks.push({
      assertion: 'shouldPass',
      ok: reflection.passed === expect.shouldPass,
      expected: expect.shouldPass,
      actual: reflection.passed,
    });
  }
  if (expect.needsReplan !== undefined) {
    checks.push({
      assertion: 'needsReplan',
      ok: reflection.needsReplan === expect.needsReplan,
      expected: expect.needsReplan,
      actual: reflection.needsReplan,
    });
  }
  const judgePending = reflection.degraded;
  const judgeCompleted = reflection.judgeUsed && !reflection.degraded;
  return {
    id: evalCase.id,
    description: evalCase.description ?? '',
    passed: checks.every((check) => check.ok),
    judgeAvailable: reflection.judgeUsed,
    judgePending,
    judgeAttempted,
    judgeCompleted,
    checks,
    reflection,
  };
}

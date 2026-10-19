import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveConversationContext } from '../src/conversationResolver.js';
import {
  TURN_TYPES,
  completeTaskState,
  createTurnContext,
  formatTaskForPrompt,
  publicContextDecision,
  serializeTaskForContract,
} from '../src/turnContext.js';

function salesHistory() {
  const context = createTurnContext({ question: '查询本月销售额，只看华东' });
  return [
    { role: 'user', content: context.originalQuestion },
    {
      role: 'assistant',
      content: '本月华东销售额为100万元。',
      result: {
        taskState: completeTaskState({
          contextTask: context.taskState,
          answer: {
            resolvedQuestion: context.question,
            queryFingerprint: 'sales-fingerprint-123',
            dataHash: 'sales-data-hash-123',
          },
          artifactId: 'sales-artifact-123',
          messageId: 'sales-message-123',
        }),
      },
    },
  ];
}

for (const { name, question, options, extraHistory = [], reason } of [
  { name: 'explicit new question', question: '新问题，查询今年订单量',
    reason: 'explicit_new_task' },
  { name: 'forced task reset', question: '那按渠道拆开呢',
    options: { forceNewTask: true }, reason: 'forced_new_task' },
  { name: 'zero inheritance budget', question: '那按渠道拆开呢',
    options: { maxInheritTurns: 0 }, reason: 'task_context_expired' },
  { name: 'elapsed history budget', question: '那按渠道拆开呢',
    options: { maxInheritTurns: 1 }, reason: 'task_context_expired',
    extraHistory: [
      { role: 'user', content: '谢谢' },
      { role: 'assistant', content: '不客气' },
      { role: 'user', content: '好的' },
    ] },
]) {
  test(`${name} clears prior result from task state, prompt and execution contract`, () => {
    const history = [...salesHistory(), ...extraHistory];
    const context = resolveConversationContext(question, history, options);

    assert.equal(context.turnType, TURN_TYPES.NEW_TASK);
    assert.equal(context.reason, reason);
    assert.notEqual(context.taskId, history[1].result.taskState.taskId);
    assert.deepEqual(context.inheritedSlots, {});
    assert.equal(publicContextDecision(context).referencedArtifactId, null);
    assert.equal(context.taskState.result, null);
    for (const serialized of [
      JSON.stringify(context.taskState),
      formatTaskForPrompt(context.taskState),
      serializeTaskForContract(context.taskState),
    ]) {
      assert.doesNotMatch(serialized, /sales-(?:artifact|fingerprint|data-hash|message)-123/);
    }
  });
}

for (const { question, turnType, referencedArtifactId } of [
  { question: '那按渠道拆开呢', turnType: TURN_TYPES.CONTINUATION,
    referencedArtifactId: null },
  { question: '导出Excel', turnType: TURN_TYPES.RESULT_OPERATION,
    referencedArtifactId: 'sales-artifact-123' },
  { question: '上述结果按渠道拆开', turnType: TURN_TYPES.CONTINUATION,
    referencedArtifactId: 'sales-artifact-123' },
]) {
  test(`${question} preserves the eligible result and its lineage`, () => {
    const history = salesHistory();
    const context = resolveConversationContext(question, history);

    assert.equal(context.turnType, turnType);
    assert.equal(context.taskId, history[1].result.taskState.taskId);
    assert.equal(publicContextDecision(context).referencedArtifactId, referencedArtifactId);
    assert.deepEqual(context.taskState.result, {
      artifactId: 'sales-artifact-123',
      messageId: 'sales-message-123',
      queryFingerprint: 'sales-fingerprint-123',
      dataHash: 'sales-data-hash-123',
    });
    assert.match(formatTaskForPrompt(context.taskState), /sales-artifact-123/);
    assert.match(serializeTaskForContract(context.taskState), /sales-artifact-123/);
  });
}

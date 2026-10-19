import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveConversationRuntime } from '../src/conversationRuntime.js';
import { SessionMemoryStore } from '../src/memory.js';
import { completeTaskState, createTurnContext, TURN_TYPES } from '../src/turnContext.js';

function salesMemory({ inheritDepth = 0 } = {}) {
  const initial = createTurnContext({ question: '查询销售额，本月，只看华东' });
  const taskState = completeTaskState({
    contextTask: { ...initial.taskState, inheritDepth },
    answer: {
      resolvedQuestion: initial.question,
      queryFingerprint: 'sales-fingerprint-123',
      dataHash: 'sales-data-hash-123',
    },
    artifactId: 'sales-artifact-123',
    messageId: 'sales-message-123',
  });
  const rows = [
    { id: 'user-123', role: 'user', content: initial.originalQuestion },
    {
      id: 'sales-message-123', role: 'assistant', content: '本月华东销售额为100万元。',
      result: { question: initial.question, taskState, artifactId: 'sales-artifact-123' },
    },
  ];
  const memory = new SessionMemoryStore({
    getChatSession: () => ({ id: 'session-123', themeId: 'sales' }),
    listChatMessages: () => rows,
  });
  return { memory, taskState };
}

async function resolveBudget(options = {}, fixtureOptions = {}) {
  const { memory, taskState } = salesMemory(fixtureOptions);
  const runtime = await resolveConversationRuntime({
    memory,
    sessionId: 'session-123',
    userId: 'user-123',
    question: '那按渠道拆开呢',
    classifier: false,
    harness: { mode: 'local-rule' },
    ...options,
  });
  return { ...runtime, previousTask: taskState };
}

test('runtime zero turn budget starts a clean execution task despite completed history', async () => {
  const { conversationContext: context, executionContext, understanding, previousTask } =
    await resolveBudget({ maxInheritTurns: 0 });

  assert.equal(understanding.turns[1].taskState.result.artifactId, 'sales-artifact-123');
  assert.equal(context.turnType, TURN_TYPES.NEW_TASK);
  assert.equal(context.reason, 'task_context_expired');
  assert.notEqual(context.taskId, previousTask.taskId);
  assert.deepEqual(context.inheritedSlots, {});
  assert.equal(context.taskState.result, null);
  assert.equal(executionContext.taskState.result, null);
  assert.deepEqual(executionContext.messages, []);
  assert.doesNotMatch(executionContext.sourceContext, /本月|华东|销售额|sales-(?:artifact|fingerprint|data-hash|message)-123/);
  assert.doesNotMatch(executionContext.systemMessage.content, /sales-(?:artifact|fingerprint|data-hash|message)-123/);
});

test('runtime zero slot budget excludes prior conditions from the execution contract', async () => {
  const { conversationContext: context, executionContext, previousTask } =
    await resolveBudget({ maxInheritedSlots: 0 });

  assert.equal(context.turnType, TURN_TYPES.CONTINUATION);
  assert.equal(context.taskId, previousTask.taskId);
  assert.deepEqual(context.inheritedSlots, {});
  assert.equal(context.inheritQueryContext, false);
  assert.doesNotMatch(executionContext.sourceContext, /本月|华东|销售额/);
  assert.match(executionContext.sourceContext, /渠道/);
  assert.equal(context.taskState.result.artifactId, 'sales-artifact-123');
});

for (const { name, options } of [
  { name: 'omitted', options: {} },
  { name: 'undefined', options: { maxInheritTurns: undefined, maxInheritedSlots: undefined } },
  { name: 'null', options: { maxInheritTurns: null, maxInheritedSlots: null } },
]) {
  test(`runtime ${name} budgets retain default inheritance`, async () => {
    const { conversationContext: context, executionContext } = await resolveBudget(options);

    assert.equal(context.turnType, TURN_TYPES.CONTINUATION);
    assert.equal(context.inheritBudget.maxTurns, 4);
    assert.equal(context.inheritBudget.maxSlots, 3);
    assert.deepEqual(Object.keys(context.inheritedSlots), ['metric', 'time', 'filters']);
    for (const condition of ['销售额', '本月', '华东']) {
      assert.ok(executionContext.sourceContext.includes(condition));
    }
  });
}

test('runtime positive budgets limit inherited slots and allow remaining turns', async () => {
  const { conversationContext: context, executionContext } = await resolveBudget({
    maxInheritTurns: 2, maxInheritedSlots: 1,
  }, { inheritDepth: 1 });

  assert.equal(context.turnType, TURN_TYPES.CONTINUATION);
  assert.equal(context.inheritBudget.usedTurns, 2);
  assert.equal(context.inheritBudget.remainingTurns, 0);
  assert.deepEqual(Object.keys(context.inheritedSlots), ['metric']);
  assert.match(executionContext.sourceContext, /销售额/);
  assert.doesNotMatch(executionContext.sourceContext, /本月|华东/);
});

test('runtime positive turn budget expires at its configured depth', async () => {
  const { conversationContext: context, executionContext } = await resolveBudget({
    maxInheritTurns: 1, maxInheritedSlots: 1,
  }, { inheritDepth: 1 });

  assert.equal(context.turnType, TURN_TYPES.NEW_TASK);
  assert.equal(context.reason, 'task_context_expired');
  assert.deepEqual(context.inheritedSlots, {});
  assert.equal(executionContext.taskState.result, null);
});

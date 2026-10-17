import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TURN_TYPES,
  completeTaskState,
  createTurnContext,
} from '../src/turnContext.js';

function slot(value, source = 'explicit') {
  return { value, sourceText: value, source };
}

function completedHistory(context, content = '查询已完成') {
  return [
    { role: 'user', content: context.originalQuestion },
    {
      role: 'assistant',
      content,
      result: {
        taskState: completeTaskState({
          contextTask: context.taskState,
          answer: { resolvedQuestion: context.question },
          artifactId: `artifact-${context.turnId}`,
        }),
      },
    },
  ];
}

test('continuations keep the task id, advance the turn id and inherit field by field', () => {
  const first = createTurnContext({
    question: '查询本月含税销售金额',
    turnType: TURN_TYPES.NEW_TASK,
  });
  const second = createTurnContext({
    question: '那按渠道拆开呢',
    history: completedHistory(first),
    turnType: TURN_TYPES.CONTINUATION,
  });

  assert.equal(second.taskId, first.taskId);
  assert.equal(second.rootTaskId, first.rootTaskId);
  assert.notEqual(second.turnId, first.turnId);
  assert.equal(second.inheritDepth, 1);
  assert.deepEqual(Object.keys(second.inheritedSlots).sort(), ['metric', 'time']);
  assert.deepEqual(Object.keys(second.explicitSlots), ['dimensions']);
});

test('inheritance budget caps both fields and consecutive turns', () => {
  const first = createTurnContext({
    question: '查询本月含税销售金额',
    turnType: TURN_TYPES.NEW_TASK,
  });
  const fieldBudget = createTurnContext({
    question: '按渠道拆开',
    history: completedHistory(first),
    turnType: TURN_TYPES.CONTINUATION,
    maxInheritedSlots: 1,
  });
  assert.deepEqual(Object.keys(fieldBudget.inheritedSlots), ['metric']);
  assert.equal(fieldBudget.inheritBudget.remainingSlots, 0);

  const depthBudget = createTurnContext({
    question: '那按周拆开呢',
    history: completedHistory(first),
    turnType: TURN_TYPES.CONTINUATION,
    maxInheritTurns: 0,
  });
  assert.equal(depthBudget.turnType, TURN_TYPES.NEW_TASK);
  assert.equal(depthBudget.reason, 'task_context_expired');
  assert.deepEqual(depthBudget.inheritedSlots, {});
});

test('forceNewTask ignores structured history even when the previous task is recent', () => {
  const first = createTurnContext({
    question: '查询本月含税销售金额',
    turnType: TURN_TYPES.NEW_TASK,
  });
  const forced = createTurnContext({
    question: '那按渠道拆开呢',
    history: completedHistory(first),
    turnType: TURN_TYPES.CONTINUATION,
    forceNewTask: true,
  });

  assert.equal(forced.turnType, TURN_TYPES.NEW_TASK);
  assert.notEqual(forced.taskId, first.taskId);
  assert.deepEqual(forced.inheritedSlots, {});
  assert.equal(forced.question, '那按渠道拆开呢');
});

test('memory defaults fill only missing fields and never override explicit conditions', () => {
  const context = createTurnContext({
    question: '查询本月订单量',
    turnType: TURN_TYPES.NEW_TASK,
    memorySlots: {
      metric: [slot('含税销售金额', 'memory')],
      time: [slot('近7天', 'memory')],
      dimensions: [slot('渠道', 'memory')],
    },
  });

  assert.deepEqual(context.explicitSlots.time.map((item) => item.value), ['本月']);
  assert.equal(context.slots.metric[0].value, '本月订单量');
  assert.deepEqual(context.memorySlots.dimensions.map((item) => item.value), ['渠道']);
  assert.equal(context.slots.time.some((item) => item.value === '近7天'), false);
});

test('completed task state keeps identifiers and result lineage for the next turn', () => {
  const context = createTurnContext({
    question: '查询本月含税销售金额',
    turnType: TURN_TYPES.NEW_TASK,
  });
  const completed = completeTaskState({
    contextTask: context.taskState,
    answer: {
      resolvedQuestion: context.question,
      semanticParse: {
        metricFields: [{ sourceText: '含税销售金额' }],
        timeWindows: [{ sourceText: '本月' }],
      },
      queryFingerprint: 'fp-1',
      dataHash: 'hash-1',
    },
    artifactId: 'artifact-1',
    messageId: 'message-1',
  });

  assert.equal(completed.taskId, context.taskId);
  assert.equal(completed.turnId, context.turnId);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.result.artifactId, 'artifact-1');
  assert.equal(completed.result.queryFingerprint, 'fp-1');
  assert.equal(completed.result.messageId, 'message-1');
});

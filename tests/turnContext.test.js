import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TURN_TYPES,
  completeTaskState,
  createTurnContext,
  extractExplicitSlots,
  previousTaskFromHistory,
} from '../src/turnContext.js';
import { resolveConversationContext } from '../src/conversationResolver.js';

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

test('analysis wording is not captured as a dimension', () => {
  const slots = extractExplicitSlots(
    '26年9月份的业绩对比上月有什么变化？按照客户结构、品类等相关维度帮我分析下降或上升的主要因素',
  );

  assert.deepEqual(slots.dimensions.map((item) => item.value), ['客户结构', '品类']);
  assert.equal(
    slots.dimensions.some((item) => /分析|下降|上升|或/.test(item.value)),
    false,
  );
  assert.deepEqual(slots.analysisMode.map((item) => item.value), ['ATTRIBUTION']);
});

test('dimension separators and the adverb 分别 are not captured as fields', () => {
  const slots = extractExplicitSlots(
    '9月业绩环比下降，分别按客户名称和商品分类分析',
  );
  const values = slots.dimensions.map((item) => item.value);

  assert.deepEqual(values, ['客户名称', '商品分类']);
  assert.equal(values.some((value) => /分别|影响|分类分析/.test(value)), false);
});

test('complex analysis questions expose their breakdown dimensions', () => {
  const cases = [
    [
      '9月业绩环比下降，客户结构和品类结构分别影响多少',
      ['客户结构', '品类结构'],
    ],
    [
      '9月销售变化主要来自哪些客户，为什么',
      ['客户'],
    ],
    [
      '分析9月销售业绩变化，要求拆到客户和品类，给出主因',
      ['客户', '品类'],
    ],
    [
      '9月业绩环比怎么样？重点看客户和品类',
      ['客户', '品类'],
    ],
    [
      '9月销售额为什么下降，按品类、客户、省区、渠道拆分并给出影响金额',
      ['品类', '客户', '省区', '渠道'],
    ],
  ];

  for (const [question, expected] of cases) {
    const slots = extractExplicitSlots(question);
    assert.deepEqual(
      slots.dimensions.map((item) => item.value),
      expected,
      question,
    );
  }
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

test('memory defaults fill only relevant fields and never override explicit conditions', () => {
  const context = createTurnContext({
    question: '查询本月订单量',
    turnType: TURN_TYPES.NEW_TASK,
    memorySlots: {
      metric: [slot('含税销售金额', 'memory')],
      time: [slot('近7天', 'memory')],
      dimensions: [slot('渠道', 'memory')],
      analysisMode: [slot('ATTRIBUTION', 'memory')],
    },
  });

  assert.deepEqual(context.explicitSlots.time.map((item) => item.value), ['本月']);
  assert.equal(context.slots.metric[0].value, '本月订单量');
  assert.equal(context.memorySlots.dimensions, undefined, '未提及的记忆维度不能自动进入执行契约');
  assert.equal(context.memorySlots.analysisMode, undefined, '记忆中的执行模式不能污染普通问数');
  assert.equal(context.slots.time.some((item) => item.value === '近7天'), false);
});

test('explicit dimensions still bind normally when memory also defines them', () => {
  const context = createTurnContext({
    question: '查询本月各渠道订单量',
    turnType: TURN_TYPES.NEW_TASK,
    memorySlots: {
      dimensions: [slot('渠道', 'memory')],
    },
  });

  assert.deepEqual(context.explicitSlots.dimensions.map((item) => item.value), ['渠道']);
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

test('a unit preference is an instruction, not a data query', () => {
  const context = resolveConversationContext('默认要带上单位万元', []);

  assert.equal(context.turnType, TURN_TYPES.INSTRUCTION);
  assert.equal(context.mode, 'INSTRUCTION');
  assert.equal(context.conversationDirective.unit, '万元');
  assert.equal(context.conversationDirective.scope, 'SESSION');
  assert.deepEqual(context.inheritedSlots, {});
  assert.deepEqual(context.slots, {});
  assert.deepEqual(context.memorySlots, {});
});

test('a unit phrase inside a real question stays in the query lane', () => {
  const context = resolveConversationContext('2026年9月销售额按万元展示', []);

  assert.equal(context.turnType, TURN_TYPES.NEW_TASK);
  assert.equal(context.conversationDirective, null);
});

test('a decimal precision follow-up is an instruction with no inherited query slots', () => {
  const first = createTurnContext({
    question: '查询2026年9月各省区业绩',
    turnType: TURN_TYPES.NEW_TASK,
  });
  const history = completedHistory(first);
  const context = resolveConversationContext('保留两位小数', history);

  assert.equal(context.turnType, TURN_TYPES.INSTRUCTION);
  assert.equal(context.mode, 'INSTRUCTION');
  assert.equal(context.conversationDirective.kind, 'DISPLAY_DECIMALS');
  assert.equal(context.conversationDirective.decimals, 2);
  assert.deepEqual(context.inheritedSlots, {});
  assert.deepEqual(context.slots, {});
});

test('instructions never inherit slots and are skipped when finding the previous task', () => {
  const first = createTurnContext({
    question: '查询本月含税销售金额',
    turnType: TURN_TYPES.NEW_TASK,
  });
  const history = completedHistory(first);
  const instruction = resolveConversationContext('以后统一按万元展示', history);
  history.push({
    role: 'user',
    content: instruction.originalQuestion,
  });
  history.push({
    role: 'assistant',
    content: '已记住',
    result: {
      taskState: completeTaskState({
        contextTask: instruction.taskState,
        answer: { resolvedQuestion: instruction.question },
      }),
    },
  });

  assert.deepEqual(instruction.inheritedSlots, {});
  assert.equal(previousTaskFromHistory(history).task.taskId, first.taskId);
});

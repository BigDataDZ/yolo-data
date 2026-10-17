import { resolveConversationContext } from '../src/queryIntent.js';
import { completeTaskState, extractMemorySlots } from '../src/turnContext.js';

export const MULTI_TURN_CASES = [
  {
    id: 'MULTI-FOLLOW-UP',
    category: '连续追问',
    description: '省略指标和时间时，只继承相关槽位',
    turns: [
      { question: '查询本月含税销售金额', expect: { turnType: 'NEW_TASK' } },
      {
        question: '那按区域拆开呢',
        expect: {
          turnType: 'CONTINUATION',
          inherited: ['metric', 'time'],
          explicit: ['dimensions'],
          taskIdSameAs: 0,
          inheritDepth: 1,
        },
      },
    ],
  },
  {
    id: 'MULTI-TOPIC-SWITCH',
    category: '话题切换',
    description: '完整的新问题不继承上一任务条件',
    turns: [
      { question: '查询本月含税销售金额', expect: { turnType: 'NEW_TASK' } },
      {
        question: '查询上月标准配送的订单量',
        expect: {
          turnType: 'NEW_TASK',
          inherited: [],
          taskIdDifferentFrom: 0,
          inheritDepth: 0,
        },
      },
    ],
  },
  {
    id: 'MULTI-TIME-REVISION',
    category: '指标不变但时间变化',
    description: '时间修正只替换时间槽位，指标继续继承',
    turns: [
      { question: '查询本月含税销售金额', expect: { turnType: 'NEW_TASK' } },
      {
        question: '改成上个月',
        expect: {
          turnType: 'REVISION',
          inherited: ['metric'],
          explicit: ['time'],
          cleared: ['time'],
          taskIdSameAs: 0,
          inheritDepth: 1,
        },
      },
    ],
  },
  {
    id: 'MULTI-RESULT-REFERENCE',
    category: '指代结果',
    description: '上表操作绑定上一轮结果产物，而不是重新猜指标',
    turns: [
      {
        question: '查询本月含税销售金额',
        artifact: 'artifact-sales-1',
        expect: { turnType: 'NEW_TASK' },
      },
      {
        question: '把上表按区域排序',
        expect: {
          turnType: 'RESULT_OPERATION',
          inherited: ['metric', 'time'],
          referencedArtifactId: 'artifact-sales-1',
          taskIdSameAs: 0,
        },
      },
    ],
  },
  {
    id: 'MULTI-MEMORY-CONFLICT',
    category: '记忆冲突',
    description: '长期记忆只提供默认值，当前显式条件优先',
    turns: [
      {
        question: '查询本月订单量',
        memoryTexts: ['默认按含税销售金额口径，近7天看数'],
        expect: {
          turnType: 'NEW_TASK',
          resolvedIncludes: ['本月', '订单量'],
          resolvedExcludes: ['含税销售金额', '近7天'],
        },
      },
    ],
  },
  {
    id: 'MULTI-CLARIFICATION-ANSWER',
    category: '澄清回答',
    description: '澄清回答通过结构化槽位补齐，不拼接原始对话',
    turns: [
      {
        question: '各区域订单量对比',
        assistantContent: '请补充订单口径和时间范围',
        expect: { turnType: 'NEW_TASK' },
      },
      {
        question: '本月',
        expect: {
          turnType: 'CLARIFICATION_ANSWER',
          inherited: ['dimensions', 'metric'],
          explicit: ['time'],
          resolvedExcludes: ['请补充订单口径和时间范围', '请确认区域字段'],
          taskIdSameAs: 0,
        },
      },
    ],
  },
];

function sortedKeys(value) {
  return Object.keys(value ?? {}).sort();
}

function check(assertion, ok, expected, actual) {
  return { assertion, ok, expected, actual };
}

function checkTurnExpectation(context, previousContexts, expect = {}) {
  const checks = [];
  if (expect.turnType) {
    checks.push(check('turnType', context.turnType === expect.turnType, expect.turnType, context.turnType));
  }
  if (expect.inherited) {
    const actual = sortedKeys(context.inheritedSlots);
    checks.push(check('inherited', JSON.stringify(actual) === JSON.stringify(expect.inherited.slice().sort()), expect.inherited, actual));
  }
  if (expect.explicit) {
    const actual = sortedKeys(context.explicitSlots);
    checks.push(check('explicit', expect.explicit.every((key) => actual.includes(key)), expect.explicit, actual));
  }
  if (expect.cleared) {
    const actual = [...(context.clearedSlots ?? [])].sort();
    checks.push(check('cleared', expect.cleared.every((key) => actual.includes(key)), expect.cleared, actual));
  }
  if (expect.referencedArtifactId !== undefined) {
    checks.push(check('referencedArtifactId', context.referencedArtifactId === expect.referencedArtifactId, expect.referencedArtifactId, context.referencedArtifactId));
  }
  if (expect.taskIdSameAs !== undefined) {
    checks.push(check('taskIdSameAs', context.taskId === previousContexts[expect.taskIdSameAs]?.taskId, previousContexts[expect.taskIdSameAs]?.taskId, context.taskId));
  }
  if (expect.taskIdDifferentFrom !== undefined) {
    checks.push(check('taskIdDifferentFrom', context.taskId !== previousContexts[expect.taskIdDifferentFrom]?.taskId, `!= ${previousContexts[expect.taskIdDifferentFrom]?.taskId}`, context.taskId));
  }
  if (expect.inheritDepth !== undefined) {
    checks.push(check('inheritDepth', context.inheritDepth === expect.inheritDepth, expect.inheritDepth, context.inheritDepth));
  }
  for (const text of expect.resolvedIncludes ?? []) {
    checks.push(check('resolvedIncludes', context.question.includes(text), text, context.question));
  }
  for (const text of expect.resolvedExcludes ?? []) {
    checks.push(check('resolvedExcludes', !context.question.includes(text), `!${text}`, context.question));
  }
  return checks;
}

function runCase(evalCase) {
  const history = [];
  const contexts = [];
  const checks = [];
  for (const [index, turn] of evalCase.turns.entries()) {
    const memoryTexts = turn.memoryTexts ?? [];
    const context = resolveConversationContext(turn.question, history, {
      memorySlots: memoryTexts.length > 0
        ? extractMemorySlots(...memoryTexts)
        : {},
    });
    contexts.push(context);
    checks.push(...checkTurnExpectation(context, contexts, turn.expect));
    const completed = completeTaskState({
      contextTask: context.taskState,
      answer: { resolvedQuestion: context.question },
      artifactId: turn.artifact ?? `artifact-${evalCase.id}-${index + 1}`,
      messageId: `message-${evalCase.id}-${index + 1}`,
    });
    history.push({ role: 'user', content: turn.question, result: { question: turn.question } });
    history.push({
      role: 'assistant',
      content: turn.assistantContent ?? '查询已完成。',
      result: {
        question: turn.question,
        resolvedQuestion: context.question,
        artifactId: turn.artifact ?? null,
        taskState: completed,
      },
    });
  }
  return {
    id: evalCase.id,
    category: evalCase.category,
    description: evalCase.description,
    passed: checks.every((item) => item.ok),
    checks,
  };
}

export function runMultiTurnSuite() {
  return MULTI_TURN_CASES.map(runCase);
}

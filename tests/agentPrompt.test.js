import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSystemPrompt } from '../src/agent.js';

test('attribution system prompt renders the analysis result file contract', () => {
  const prompt = buildSystemPrompt({
    user: { displayName: 'Tester', username: 'tester' },
    theme: {
      name: 'Test theme',
      systemPrompt: '',
      description: '',
      examples: [],
      semanticPolicy: {},
    },
    scope: { rowPolicies: [] },
    indicators: [],
    skills: [],
    analysisMode: { mode: 'ATTRIBUTION' },
    clarificationPolicy: { allowed: false },
    taskState: null,
    question: '分析变化原因',
  });

  assert.match(prompt, /output\/analysis\.json/);
  assert.doesNotMatch(prompt, /undefined/);
});

test('session directives are injected into the execution prompt', () => {
  const prompt = buildSystemPrompt({
    user: { displayName: 'Tester', username: 'tester' },
    theme: {
      name: 'Test theme',
      systemPrompt: '',
      description: '',
      examples: [],
      semanticPolicy: {},
    },
    scope: { rowPolicies: [] },
    indicators: [],
    skills: [],
    analysisMode: { mode: 'METRIC_QUERY' },
    clarificationPolicy: { allowed: true },
    taskState: null,
    question: '查询本月销售额',
    conversationDirectives: [{
      kind: 'DISPLAY_UNIT',
      unit: '万元',
      displayScale: 0.0001,
    }],
  });

  assert.match(prompt, /会话级输出指令/);
  assert.match(prompt, /本会话金额默认按万元展示/);
});

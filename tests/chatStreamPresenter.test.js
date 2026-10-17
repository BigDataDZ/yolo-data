import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assistantTextChunks,
  createChatStreamPresenter,
} from '../src/chatStreamPresenter.js';

test('chat stream presenter turns workflow stages into readable progress', () => {
  const present = createChatStreamPresenter();
  const [started] = present({ type: 'run_started' });
  assert.equal(started.type, 'assistant_progress');
  assert.equal(started.status, 'running');
  assert.match(started.text, /理解问题/);

  const [running] = present({
    type: 'workflow_stage',
    stage: { code: 'EXECUTE', name: '执行查询', status: 'RUNNING', summary: '' },
  });
  assert.equal(running.id, 'stage-EXECUTE');
  assert.equal(running.status, 'running');
  assert.match(running.text, /只读查询/);

  const [done] = present({
    type: 'workflow_stage',
    stage: { code: 'EXECUTE', name: '执行查询', status: 'SUCCESS', summary: '返回 42 行' },
  });
  assert.equal(done.id, 'stage-EXECUTE');
  assert.equal(done.status, 'done');
  assert.equal(done.detail, '返回 42 行');
});

test('chat stream presenter exposes tool activity without private reasoning', () => {
  const present = createChatStreamPresenter();
  const [step] = present({
    type: 'process_step',
    step: {
      id: 'step-3',
      stageCode: 'EXECUTE',
      status: 'success',
      title: '执行数据集查询',
      detail: '42 行',
    },
  });
  assert.equal(step.id, 'step-step-3');
  assert.equal(step.status, 'done');
  assert.equal(step.text, '执行数据集查询');
});

test('assistant text chunks preserve the complete answer', () => {
  const message = '第一段业务结论。\n\n第二段包含 **重点指标** 与明细说明。';
  const chunks = assistantTextChunks(message, { targetChunks: 8, minChunkSize: 3 });
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(''), message);
  assert.ok(chunks.every((chunk) => chunk.length <= Math.ceil(message.length / 8) + 1));
});

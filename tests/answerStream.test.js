import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgressiveAnswerEmitter } from '../src/answerStream.js';

test('progressive answer emits one provisional stream and ignores later previews', () => {
  const events = [];
  const emitter = createProgressiveAnswerEmitter((event) => events.push(event));
  assert.equal(emitter.emit('第一段业务结论。第二段补充说明。'), true);
  assert.equal(emitter.emit('不应再次发送'), false);
  assert.equal(events[0].type, 'assistant_answer_start');
  assert.equal(events[0].preliminary, true);
  assert.ok(events.filter((event) => event.type === 'assistant_delta').length > 0);
  assert.equal(
    events.filter((event) => event.type === 'assistant_delta')
      .map((event) => event.text)
      .join(''),
    '第一段业务结论。第二段补充说明。',
  );
});

test('progressive answer ignores empty previews', () => {
  const events = [];
  const emitter = createProgressiveAnswerEmitter((event) => events.push(event));
  assert.equal(emitter.emit('  '), false);
  assert.equal(emitter.started, false);
  assert.equal(events.length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionMemoryStore } from '../src/memory.js';

test('understanding context uses async chat-session APIs when provided', async () => {
  const database = {
    isAsyncPlatformStore: true,
    getChatSessionAsync: async (id, userId) => {
      assert.equal(id, 17);
      assert.equal(userId, 4);
      return { id: 17, userId: 4, themeId: 9 };
    },
    listChatMessagesAsync: async () => [{
      id: 1,
      role: 'user',
      content: '最近的销售额是多少？',
      result: { question: '最近的销售额是多少？' },
    }],
    getChatSession() { throw new Error('sync API must not be called'); },
    listChatMessages() { throw new Error('sync API must not be called'); },
  };
  const memory = new SessionMemoryStore(database);
  memory.userMemories = {
    buildContextMessageAsync: async () => ({ role: 'system', content: '记忆摘要' }),
    buildContextMessage() { throw new Error('sync memory API must not be called'); },
  };
  const context = await memory.buildUnderstandingContextAsync(17, 4);
  assert.equal(context.themeId, 9);
  assert.equal(context.turns.length, 1);
  assert.equal(context.turns[0].question, '最近的销售额是多少？');
  assert.equal(context.memoryMessage.content, '记忆摘要');
});

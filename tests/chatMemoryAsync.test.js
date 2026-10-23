import assert from 'node:assert/strict';
import test from 'node:test';
import { appendUserQuestionWithAttachmentsAsync } from '../src/chatAttachments.js';
import { SessionMemoryStore } from '../src/memory.js';
import { WorkspaceService } from '../src/workspace.js';

function asyncOnlyDatabase() {
  const calls = [];
  return {
    calls,
    appendChatMessage: () => { throw new Error('sync append must not be called'); },
    appendChatMessageAsync: async (input) => {
      calls.push(input);
      return { id: calls.length, ...input };
    },
    getChatSession: () => { throw new Error('sync session read must not be called'); },
    listChatMessages: () => { throw new Error('sync message read must not be called'); },
    getChatSessionAsync: async () => ({ id: 7, userId: 3, themeId: 2 }),
    listChatMessagesAsync: async () => [],
  };
}

test('async chat question persistence uses appendChatMessageAsync and awaits its message id', async () => {
  const database = asyncOnlyDatabase();
  const memory = new SessionMemoryStore(database);
  const result = await appendUserQuestionWithAttachmentsAsync({
    memory,
    workspace: null,
    session: { id: 7 },
    user: { id: 3 },
    question: '查询上周销售额',
  });

  assert.equal(result.message.id, 1);
  assert.equal(database.calls.length, 1);
  assert.deepEqual(database.calls[0], {
    sessionId: 7,
    userId: 3,
    role: 'user',
    content: '查询上周销售额',
    result: { attachments: [], question: '查询上周销售额' },
  });
});

test('async assistant messages and history use only asynchronous persistence APIs', async () => {
  const database = asyncOnlyDatabase();
  const memory = new SessionMemoryStore(database);
  const message = await memory.appendAssistantMessageAsync(7, 3, '已完成', { data: { rows: [] } });
  const history = await memory.listMessagesAsync(7, 3);

  assert.equal(message.id, 1);
  assert.deepEqual(history, []);
  assert.equal(database.calls[0].role, 'assistant');
});

test('async-only session operations and understanding context never call SQLite methods', async () => {
  const calls = [];
  const database = {
    isAsyncPlatformStore: true,
    createChatSession: () => { throw new Error('sync create must not be called'); },
    listChatSessions: () => { throw new Error('sync list must not be called'); },
    getChatSession: () => { throw new Error('sync get must not be called'); },
    listChatMessages: () => { throw new Error('sync messages must not be called'); },
    deleteChatSession: () => { throw new Error('sync delete must not be called'); },
    createChatSessionAsync: async (input) => { calls.push(['create', input]); return { id: 7, ...input }; },
    listChatSessionsAsync: async (userId) => { calls.push(['list', userId]); return [{ id: 7 }]; },
    getChatSessionAsync: async (id, userId) => { calls.push(['session', id, userId]); return { id, userId, themeId: 2 }; },
    listChatMessagesAsync: async (id, userId) => { calls.push(['messages', id, userId]); return [{ id: 1, role: 'user', content: '本月销售额' }]; },
    deleteChatSessionAsync: async (id, userId) => { calls.push(['delete', id, userId]); return true; },
  };
  const userMemories = {
    buildContextMessage: () => { throw new Error('sync user memory must not be called'); },
    buildContextMessageAsync: async (userId, themeId) => `memory:${userId}:${themeId}`,
  };
  const memory = new SessionMemoryStore(database, { userMemories });

  assert.equal((await memory.createSessionAsync({ userId: 3, themeId: 2 })).id, 7);
  assert.deepEqual(await memory.listSessionsAsync(3), [{ id: 7 }]);
  assert.equal((await memory.getSessionAsync(7, 3)).themeId, 2);
  assert.deepEqual(await memory.listMessagesAsync(7, 3), [{ id: 1, role: 'user', content: '本月销售额' }]);
  assert.equal(await memory.deleteSessionAsync(7, 3), true);
  const context = await memory.buildUnderstandingContextAsync(7, 3);
  assert.equal(context.memoryMessage, 'memory:3:2');
  assert.equal(context.messages[0].content, '本月销售额');
  assert.deepEqual(calls.map(([name]) => name), ['create', 'list', 'session', 'messages', 'delete', 'session', 'messages']);
});

test('question attachments and workspace async methods do not fall back to sync platform methods', async () => {
  const database = {
    isAsyncPlatformStore: true,
    getWorkspaceBySession: () => { throw new Error('sync workspace lookup must not be called'); },
    ensureWorkspace: () => { throw new Error('sync workspace create must not be called'); },
    getWorkspaceArtifact: () => { throw new Error('sync artifact read must not be called'); },
    bindWorkspaceArtifactsToMessage: () => { throw new Error('sync artifact bind must not be called'); },
    getWorkspaceBySessionAsync: async () => null,
    ensureWorkspaceAsync: async () => ({ id: 10, userId: 3, sessionId: 7 }),
    getWorkspaceArtifactAsync: async (id) => ({ id, artifactType: 'FILE', sessionId: 7, title: 'data.csv', metadata: { source: { name: 'data.csv' } } }),
    bindWorkspaceArtifactsToMessageAsync: async () => 1,
  };
  const service = new WorkspaceService(database);
  const workspace = await service.ensureForSessionAsync({ userId: 3, themeId: 2, sessionId: 7, name: 'workspace' });
  assert.equal(workspace.id, 10);

  const memory = new SessionMemoryStore(asyncOnlyDatabase());
  const result = await appendUserQuestionWithAttachmentsAsync({
    memory,
    workspace: service,
    session: { id: 7 },
    user: { id: 3 },
    question: '使用附件分析',
    artifactIds: ['file-1'],
  });
  assert.equal(result.attachments[0].artifactId, 'file-1');
  assert.equal(result.message.id, 1);
});

test('async-only platform store reports missing async contract instead of calling a missing sync API', async () => {
  const memory = new SessionMemoryStore({ isAsyncPlatformStore: true });
  await assert.rejects(
    memory.appendUserMessageAsync(7, 3, 'question'),
    /Async platform database is missing appendChatMessageAsync\(\)/,
  );
});

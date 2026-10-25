import { callPlatformDatabase } from './platformDatabaseAccess.js';
import { projectUnderstandingContext } from './sessionContextProjection.js';
export { buildExecutionContext } from './sessionContextProjection.js';

export function buildUnderstandingContext(memory, sessionId, userId) {
  const session = memory.getSession(sessionId, userId);
  const rows = memory.database.listChatMessages(sessionId, userId, memory.contextLimit);
  const memoryMessage = memory.userMemories?.buildContextMessage(userId, session.themeId) ?? null;
  return projectUnderstandingContext(session, rows, memoryMessage);
}

export async function buildUnderstandingContextAsync(memory, sessionId, userId) {
  const session = await memory.getSessionAsync(sessionId, userId);
  const rows = await callPlatformDatabase(memory.database, 'listChatMessagesAsync', 'listChatMessages', sessionId, userId, memory.contextLimit);
  const memoryMessage = memory.userMemories?.buildContextMessageAsync
    ? await memory.userMemories.buildContextMessageAsync(userId, session.themeId)
    : memory.database.isAsyncPlatformStore
      ? null
      : memory.userMemories?.buildContextMessage(userId, session.themeId) ?? null;
  return projectUnderstandingContext(session, rows, memoryMessage);
}

export function buildLegacyModelContext(memory, sessionId, userId) {
  const context = buildUnderstandingContext(memory, sessionId, userId);
  return context.memoryMessage
    ? [context.memoryMessage, ...context.messages]
    : context.messages;
}

export function updateInitialTitle(memory, sessionId, content) {
  const session = memory.database.getChatSession(sessionId);
  if (!session || session.title !== '新会话') {
    return session;
  }
  const title = String(content ?? '').trim().replace(/\s+/g, ' ').slice(0, 24) || '新会话';
  return memory.database.updateChatSession(sessionId, { title });
}

export async function updateInitialTitleAsync(memory, sessionId, content) {
  const session = await callPlatformDatabase(memory.database, 'getChatSessionAsync', 'getChatSession', sessionId);
  if (!session || session.title !== '新会话') return session;
  const title = String(content ?? '').trim().replace(/\s+/g, ' ').slice(0, 24) || '新会话';
  return callPlatformDatabase(memory.database, 'updateChatSessionAsync', 'updateChatSession', sessionId, { title });
}

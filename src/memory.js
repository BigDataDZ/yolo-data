import { buildExecutionContext, buildLegacyModelContext, buildUnderstandingContext, buildUnderstandingContextAsync, updateInitialTitle, updateInitialTitleAsync } from './sessionMemoryContext.js';
import { callPlatformDatabase } from './platformDatabaseAccess.js';

// 会话记忆只负责“理解上下文”；执行阶段通过结构化任务状态单独装配，
// 避免原始聊天记录和长期记忆直接污染查询契约。
export class SessionMemoryStore {
  constructor(database, { contextLimit = 20, userMemories = null } = {}) {
    this.database = database;
    this.contextLimit = contextLimit;
    this.userMemories = userMemories;
    this.distiller = null;
  }

  attachDistiller(distiller) {
    this.distiller = distiller;
    return this;
  }

  createSession({ userId, themeId, title, modelId = null }) {
    return this.database.createChatSession({ userId, themeId, title, modelId });
  }

  async createSessionAsync(args) {
    return callPlatformDatabase(this.database, 'createChatSessionAsync', 'createChatSession', args);
  }
  async listSessionsAsync(userId) {
    return callPlatformDatabase(this.database, 'listChatSessionsAsync', 'listChatSessions', userId);
  }
  async getSessionAsync(sessionId, userId) {
    const session = await callPlatformDatabase(this.database, 'getChatSessionAsync', 'getChatSession', sessionId, userId);
    if (!session) throw new Error('chat session not found');
    return session;
  }
  async listMessagesAsync(sessionId, userId, limit = 100) {
    const messages = await callPlatformDatabase(this.database, 'listChatMessagesAsync', 'listChatMessages', sessionId, userId, limit);
    if (messages === null) throw new Error('chat session not found');
    return messages;
  }
  async deleteSessionAsync(sessionId, userId) { return callPlatformDatabase(this.database, 'deleteChatSessionAsync', 'deleteChatSession', sessionId, userId); }
  async appendUserMessageAsync(sessionId, userId, content, result = {}) {
    return callPlatformDatabase(this.database, 'appendChatMessageAsync', 'appendChatMessage', { sessionId, userId, role: 'user', content, result });
  }
  async appendAssistantMessageAsync(sessionId, userId, content, result) {
    const message = await callPlatformDatabase(this.database, 'appendChatMessageAsync', 'appendChatMessage', { sessionId, userId, role: 'assistant', content, result });
    void this.distillAfterTurnAsync({ sessionId, userId, content, result });
    return message;
  }

  listSessions(userId) {
    return this.database.listChatSessions(userId);
  }

  getSession(sessionId, userId) {
    const session = this.database.getChatSession(sessionId, userId);
    if (!session) {
      throw new Error('chat session not found');
    }
    return session;
  }

  listMessages(sessionId, userId, limit = 100) {
    const messages = this.database.listChatMessages(sessionId, userId, limit);
    if (messages === null) {
      throw new Error('chat session not found');
    }
    return messages;
  }

  deleteSession(sessionId, userId) {
    return this.database.deleteChatSession(sessionId, userId);
  }

  appendUserMessage(sessionId, userId, content, result = {}) {
    return this.database.appendChatMessage({
      sessionId,
      userId,
      role: 'user',
      content,
      result,
    });
  }

  appendAssistantMessage(sessionId, userId, content, result) {
    const message = this.database.appendChatMessage({
      sessionId,
      userId,
      role: 'assistant',
      content,
      result,
    });
    this.distillAfterTurn({ sessionId, userId, content, result });
    return message;
  }

  buildUnderstandingContext(sessionId, userId) {
    return buildUnderstandingContext(this, sessionId, userId);
  }

  buildUnderstandingContextAsync(sessionId, userId) {
    return buildUnderstandingContextAsync(this, sessionId, userId);
  }

  buildExecutionContext({ taskState = null, question = '' } = {}) {
    return buildExecutionContext({ taskState, question });
  }

  // 兼容旧调用：旧入口只返回理解上下文，不再承担执行契约装配。
  buildModelContext(sessionId, userId) {
    return buildLegacyModelContext(this, sessionId, userId);
  }

  // 长期记忆沉淀是旁路：失败、超时或未配置模型都不影响本轮回答。
  distillAfterTurn({ sessionId, userId, content, result }) {
    // 失败轮次没有可沉淀的结论，直接跳过，避免无意义的模型调用。
    if (!this.distiller || result?.error || !String(content ?? '').trim()) {
      return;
    }
    try {
      const session = this.database.getChatSession(sessionId);
      const question = this.database.listChatMessages(sessionId, userId, this.contextLimit)
        .filter((message) => message.role === 'user')
        .at(-1)?.content ?? '';
      void this.distiller.ingest({
        userId,
        themeId: session?.themeId ?? null,
        sessionId,
        question,
        answer: content,
      }).catch(() => {});
    } catch {
      // 沉淀失败不影响主流程
    }
  }

  async distillAfterTurnAsync({ sessionId, userId, content, result }) {
    if (!this.distiller || result?.error || !String(content ?? '').trim()) return;
    try {
      const session = await callPlatformDatabase(this.database, 'getChatSessionAsync', 'getChatSession', sessionId, userId);
      const messages = await callPlatformDatabase(this.database, 'listChatMessagesAsync', 'listChatMessages', sessionId, userId, this.contextLimit);
      const question = messages
        .filter((message) => message.role === 'user')
        .at(-1)?.content ?? '';
      await this.distiller.ingest({
        userId,
        themeId: session?.themeId ?? null,
        sessionId,
        question,
        answer: content,
      });
    } catch {
      // Memory distillation is best-effort and must not affect the answer.
    }
  }

  maybeSetInitialTitle(sessionId, content) {
    return updateInitialTitle(this, sessionId, content);
  }

  async maybeSetInitialTitleAsync(sessionId, content) {
    return updateInitialTitleAsync(this, sessionId, content);
  }
}

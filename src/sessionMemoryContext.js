import { serializeTaskForContract } from './turnContext.js';

export function buildUnderstandingContext(memory, sessionId, userId) {
  const session = memory.getSession(sessionId, userId);
  const rows = memory.database.listChatMessages(sessionId, userId, memory.contextLimit);
  const turns = rows.map((message) => {
    const taskState = message.result?.taskState ?? null;
    return {
      id: message.id,
      role: message.role,
      content: String(message.content ?? ''),
      question: message.result?.question ?? String(message.content ?? ''),
      taskState,
      artifactId: message.result?.artifactId ?? null,
      messageId: message.id,
    };
  });
  const messages = turns.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const memoryMessage = memory.userMemories?.buildContextMessage(userId, session.themeId) ?? null;
  const lastTaskState = [...turns].reverse().find((message) => message.taskState)?.taskState ?? null;
  return {
    messages,
    turns,
    memoryMessage,
    lastTaskState,
    historyMessageCount: messages.length,
    themeId: session.themeId,
  };
}

export function buildExecutionContext({ taskState = null, question = '' } = {}) {
  const sourceContext = serializeTaskForContract(taskState, question);
  const systemMessage = taskState
    ? {
      role: 'system',
      content: [
        '本轮执行契约（唯一可用的会话上下文）：',
        sourceContext,
        '执行约束：只能使用上面的显式条件和继承槽位；不得自行引用原始聊天历史、长期记忆或其他任务的指标、时间、筛选和结果。',
      ].join('\n'),
    }
    : null;
  return {
    messages: [],
    systemMessage,
    sourceContext,
    taskState,
  };
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

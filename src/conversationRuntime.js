import { resolveConversationContext } from './conversationResolver.js';
import { refineTurnContextWithHarness } from './turnRouter.js';
import { extractMemorySlots } from './turnContext.js';

// 理解通道可以使用原始会话与长期记忆；执行通道只接收结构化任务契约。
// 这里把两者固定成一次装配，避免调用方再次把 history 塞进查询消息。
export async function resolveConversationRuntime({
  memory,
  sessionId,
  userId,
  question,
  forceNewTask = false,
  harness,
  theme = null,
  user = null,
  signal = null,
  memoryTexts = [],
  classifier = true,
  maxInheritTurns,
  maxInheritedSlots,
} = {}) {
  const understanding = await memory.buildUnderstandingContextAsync(sessionId, userId);
  const memorySlots = extractMemorySlots(
    ...(memoryTexts ?? []),
    understanding.memoryMessage?.retrievalText ?? '',
  );
  let conversationContext = resolveConversationContext(
    question,
    understanding.turns,
    {
      forceNewTask,
      memorySlots,
      classifier,
      ...(maxInheritTurns != null ? { maxInheritTurns } : {}),
      ...(maxInheritedSlots != null ? { maxInheritedSlots } : {}),
    },
  );
  conversationContext = await refineTurnContextWithHarness({
    context: conversationContext,
    history: understanding.turns,
    harness,
    theme,
    user,
    signal,
  });
  const execution = memory.buildExecutionContext({
    taskState: conversationContext.taskState,
    question: conversationContext.question,
  });
  return {
    understanding,
    history: understanding.messages,
    memorySlots,
    conversationContext,
    executionContext: execution,
  };
}

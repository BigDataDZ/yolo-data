import { setTimeout as delay } from 'node:timers/promises';

import {
  assistantTextChunks,
  createChatStreamPresenter,
} from '../chatStreamPresenter.js';
import { createStreamHeartbeat } from '../answerStream.js';

async function streamAssistantAnswer(writeEvent, message, signal) {
  const chunks = assistantTextChunks(message);
  if (chunks.length === 0) {
    return;
  }
  writeEvent({ type: 'assistant_answer_start' });
  for (const text of chunks) {
    if (signal.aborted) {
      return;
    }
    writeEvent({ type: 'assistant_delta', text });
    try {
      await delay(8, undefined, { signal });
    } catch {
      return;
    }
  }
  writeEvent({ type: 'assistant_answer_done' });
}

export async function answerChatStream({
  agent,
  user,
  body,
  signal,
  writeEvent,
}) {
  const present = createChatStreamPresenter();
  let provisionalAnswerStarted = false;
  const emit = (event) => {
    if (event?.type === 'assistant_answer_start' && event.preliminary) {
      provisionalAnswerStarted = true;
    }
    heartbeat.observe(event);
    writeEvent(event);
    for (const derivedEvent of present(event)) {
      writeEvent(derivedEvent);
    }
  };
  const heartbeat = createStreamHeartbeat({ writeEvent });
  try {
    const answer = await agent.answer({
      userId: user.id,
      themeId: body.themeId ? Number(body.themeId) : undefined,
      sessionId: body.sessionId ? Number(body.sessionId) : undefined,
      question: body.question,
      preferredChart: body.preferredChart,
      clarificationOptionId: body.clarificationOptionId,
      clarificationOptionLabel: body.clarificationOptionLabel,
      modelId: body.modelId ? Number(body.modelId) : null,
      attachmentArtifactIds: body.attachmentArtifactIds,
      forceNewTask: Boolean(body.forceNewTask),
      signal,
      onEvent: emit,
    });
    if (provisionalAnswerStarted) {
      if (!signal?.aborted) {
        writeEvent({ type: 'assistant_answer_replace', text: answer.message });
        writeEvent({ type: 'assistant_answer_done' });
      }
    } else {
      await streamAssistantAnswer(writeEvent, answer.message, signal);
    }
    return answer;
  } finally {
    heartbeat.stop();
  }
}

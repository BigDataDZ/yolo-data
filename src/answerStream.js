import { assistantTextChunks } from './chatStreamPresenter.js';

function elapsedSeconds(startedAt, now = Date.now()) {
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

// Query tools can finish before the final answer and reflection pass. Emit the
// grounded deterministic summary immediately as a provisional answer; the
// final response is sent as an atomic replacement so the UI never accumulates
// two competing conclusions.
export function createProgressiveAnswerEmitter(emit) {
  let started = false;
  return {
    emit(text) {
      if (started || typeof emit !== 'function') {
        return false;
      }
      const message = String(text ?? '').trim();
      if (!message) {
        return false;
      }
      started = true;
      emit({ type: 'assistant_answer_start', preliminary: true });
      for (const chunk of assistantTextChunks(message, {
        targetChunks: 80,
        minChunkSize: 12,
      })) {
        emit({ type: 'assistant_delta', text: chunk, preliminary: true });
      }
      return true;
    },
    get started() {
      return started;
    },
  };
}

export function createStreamHeartbeat({
  writeEvent,
  intervalMs = 10_000,
  startedAt = Date.now(),
} = {}) {
  let currentText = 'DataAgent 正在处理当前问题';
  const timer = setInterval(() => {
    const seconds = elapsedSeconds(startedAt);
    writeEvent?.({
      type: 'assistant_progress',
      id: 'stream-heartbeat',
      status: 'running',
      text: currentText,
      detail: `已持续 ${seconds} 秒，服务仍在执行，没有中断`,
    });
  }, Math.max(1_000, Number(intervalMs) || 10_000));
  timer.unref?.();
  return {
    observe(event) {
      if (event?.type === 'assistant_progress' && event.text) {
        currentText = String(event.text);
      } else if (event?.type === 'workflow_stage' && event.stage?.status === 'RUNNING') {
        currentText = String(event.stage.summary || event.stage.name || currentText);
      }
    },
    stop() {
      clearInterval(timer);
    },
  };
}

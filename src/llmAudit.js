function digest(value, limit = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export class LlmAuditService {
  constructor(database) {
    this.database = database;
  }

  async record({
    userId,
    sessionId,
    themeId,
    callType,
    provider,
    model,
    messages,
    response,
    tokenUsage,
    latencyMs,
    success,
    errorMessage,
  }) {
    try {
      const prompt = Array.isArray(messages)
        ? messages.map((message) => `${message.role}: ${message.content ?? ''}`).join('\n')
        : messages;
      return await this.database.logLlmCallAsync({
        userId,
        sessionId,
        themeId,
        callType,
        provider,
        model,
        promptDigest: digest(prompt),
        responseDigest: digest(response),
        tokenUsage,
        latencyMs,
        success,
        errorMessage,
      });
    } catch {
      return null;
    }
  }

  async list(limit = 200) {
    return this.database.listLlmLogsAsync(limit);
  }

  async stats() {
    return this.database.llmLogStatsAsync();
  }
}

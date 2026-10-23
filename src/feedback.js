export class FeedbackService {
  constructor(database, growth = null) {
    this.database = database;
    this.growth = growth;
  }

  submit({
    userId,
    themeId,
    sessionId,
    messageId,
    question,
    correct,
    comment,
    corrected,
  }) {
    const message = messageId
      ? this.database.getChatMessage(messageId, userId)
      : null;
    if (messageId && !message) {
      throw new Error('assistant message not found');
    }
    const resolvedThemeId = themeId
      ?? message?.result?.theme?.id
      ?? this.database.getChatSession(sessionId, userId)?.themeId;
    if (!userId || !resolvedThemeId) {
      throw new Error('user and theme are required');
    }
    const id = this.database.saveFeedback({
      userId,
      themeId: resolvedThemeId,
      sessionId: sessionId ?? message?.sessionId,
      messageId,
      question: question || message?.result?.question || '',
      correct: Boolean(correct),
      comment,
      corrected,
    });
    if (!correct) {
      this.growth?.record({
        term: question || message?.result?.question || `message-${messageId}`,
        kind: 'FEEDBACK',
        source: 'USER_FEEDBACK',
        context: {
          userId,
          themeId: resolvedThemeId,
          sessionId: sessionId ?? message?.sessionId,
          messageId,
          comment,
          corrected,
        },
      });
    }
    return {
      id,
      correct: Boolean(correct),
      message: '反馈已记录',
    };
  }

  async submitAsync(args) {
    if (!this.database.isAsyncPlatformStore) return this.submit(args);
    const { userId, themeId, sessionId, messageId, question, correct, comment, corrected } = args;
    const message = messageId ? await this.database.getChatMessageAsync(messageId, userId) : null;
    if (messageId && !message) throw new Error('assistant message not found');
    const session = !themeId && !message ? await this.database.getChatSessionAsync(sessionId, userId) : null;
    const resolvedThemeId = themeId ?? message?.result?.theme?.id ?? session?.themeId;
    if (!userId || !resolvedThemeId) throw new Error('user and theme are required');
    const id = await this.database.saveFeedbackAsync({ userId, themeId: resolvedThemeId, sessionId: sessionId ?? message?.sessionId,
      messageId, question: question || message?.result?.question || '', correct: Boolean(correct), comment, corrected });
    if (!correct) this.growth?.record({ term: question || message?.result?.question || `message-${messageId}`, kind: 'FEEDBACK', source: 'USER_FEEDBACK',
      context: { userId, themeId: resolvedThemeId, sessionId: sessionId ?? message?.sessionId, messageId, comment, corrected } });
    return { id, correct: Boolean(correct), message: '反馈已记录' };
  }

  list({ themeId = null, correct = null, limit = 100 } = {}) {
    return this.database.listFeedback({ themeId, correct, limit });
  }

  async listAsync(options = {}) {
    return this.database.isAsyncPlatformStore
      ? this.database.listFeedbackAsync(options)
      : this.list(options);
  }

  promptHints(themeId, limit = 8) {
    return this.database.listFeedback({ themeId, correct: false, limit })
      .map((item) => {
        const corrected = item.corrected ?? {};
        const correction = corrected.indicatorId
          ? `；修正指标：${corrected.indicatorId}`
          : '';
        return `- 问题「${item.question}」${item.comment ? `，反馈：${item.comment}` : ''}${correction}`;
      });
  }

  async promptHintsAsync(themeId, limit = 8) {
    const items = this.database.isAsyncPlatformStore
      ? await this.database.listFeedbackAsync({ themeId, correct: false, limit })
      : this.database.listFeedback({ themeId, correct: false, limit });
    return items.map((item) => {
      const corrected = item.corrected ?? {};
      const correction = corrected.indicatorId ? `；修正指标：${corrected.indicatorId}` : '';
      return `- 问题「${item.question}」${item.comment ? `，反馈：${item.comment}` : ''}${correction}`;
    });
  }
}

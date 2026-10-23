export class GrowthService {
  constructor(database) {
    this.database = database;
  }

  record({
    term,
    kind = 'QUESTION',
    source = 'ASK',
    context = {},
  }) {
    const input = {
      term,
      kind,
      source,
      context,
    };
    return this.database.isAsyncPlatformStore
      ? this.database.recordKnowledgeGapAsync(input)
      : this.database.recordKnowledgeGap(input);
  }

  list({ includeClosed = false, limit = 200 } = {}) {
    return this.database.listKnowledgeGaps({ includeClosed, limit });
  }

  listAsync(options = {}) {
    return this.database.isAsyncPlatformStore
      ? this.database.listKnowledgeGapsAsync(options)
      : this.list(options);
  }

  dismiss(id, resolution = {}) {
    return this.database.updateKnowledgeGap(id, {
      dismissed: true,
      resolution,
    });
  }

  resolve(id, resolution = {}) {
    return this.database.updateKnowledgeGap(id, {
      resolved: true,
      resolution,
    });
  }

  reopen(id) {
    return this.database.updateKnowledgeGap(id, {
      dismissed: false,
      resolved: false,
      resolution: {},
    });
  }

  updateAsync(id, patch) {
    return this.database.isAsyncPlatformStore
      ? this.database.updateKnowledgeGapAsync(id, patch)
      : this.database.updateKnowledgeGap(id, patch);
  }
}

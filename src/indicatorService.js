/** Local indicator catalog boundary.
 *  The agent depends on this contract rather than on a remote platform.
 */
export class LocalIndicatorService {
  constructor(repository) {
    this.repository = repository;
    this.mode = 'local';
  }

  async listTypes() { return this.repository.listTypesAsync(); }

  async listCatalog({ keyword = '', typeId = '', pageSize = 500 } = {}) {
    const list = await this.repository.listAsync({ keyword, typeId, limit: pageSize, enabledOnly: true });
    return { list, total: list.length, current: 1, pageSize };
  }

  async getIndicator(id) {
    const indicator = await this.repository.getAsync(id);
    if (!indicator) throw Object.assign(new Error('indicator not found'), { statusCode: 404 });
    return indicator;
  }

  async queryIndicator() {
    throw Object.assign(new Error('指标目录只负责本地口径管理，数据库取数必须使用业务数据集'), {
      code: 'LOCAL_INDICATOR_QUERY_UNSUPPORTED',
    });
  }

  async queryIndicatorPresentationEvidence() { return { columns: [], rows: [] }; }
}

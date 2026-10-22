const bool = (value) => value === true || Number(value) === 1;
const parse = (value, fallback) => {
  try { return value == null || value === '' ? fallback : JSON.parse(value); }
  catch { return fallback; }
};
const timestamp = () => new Date().toISOString();

// Async persistence boundary for user grants and row/column policies.
export class PermissionRepository {
  constructor(store) { this.store = store; }

  async getProfile(userId) {
    const id = Number(userId);
    const [themeRows, indicatorRows, datasetRows, rowRows, columnRows] = await Promise.all([
      this.store.query('SELECT theme_id AS themeId, can_query AS canQuery, can_manage AS canManage FROM user_theme_grants WHERE user_id=?', [id]),
      this.store.query('SELECT indicator_id AS indicatorId, can_query AS canQuery FROM user_indicator_grants WHERE user_id=?', [id]),
      this.store.query(`SELECT dg.dataset_id AS datasetId, d.code, d.name, dg.can_query AS canQuery
        FROM user_dataset_grants dg JOIN business_datasets d ON d.id=dg.dataset_id WHERE dg.user_id=?`, [id]),
      this.store.query(`SELECT id, theme_id AS themeId, dimension, operator, values_json AS valuesJson,
        value_source AS valueSource, attribute_key AS attributeKey, enabled FROM row_policies WHERE user_id=? ORDER BY id`, [id]),
      this.store.query(`SELECT id, theme_id AS themeId, column_name AS columnName, action,
        mask_value AS maskValue, enabled FROM column_policies WHERE user_id=? ORDER BY id`, [id]),
    ]);
    return {
      themeGrants: themeRows.map((row) => ({ ...row, themeId: Number(row.themeId), canQuery: bool(row.canQuery), canManage: bool(row.canManage) })),
      indicatorGrants: indicatorRows.map((row) => ({ ...row, canQuery: bool(row.canQuery) })),
      datasetGrants: datasetRows.map((row) => ({ ...row, datasetId: Number(row.datasetId), canQuery: bool(row.canQuery) })),
      rowPolicies: rowRows.map((row) => ({ ...row, id: Number(row.id), themeId: row.themeId == null ? null : Number(row.themeId), values: parse(row.valuesJson, []), enabled: bool(row.enabled) })),
      columnPolicies: columnRows.map((row) => ({ ...row, id: Number(row.id), themeId: row.themeId == null ? null : Number(row.themeId), enabled: bool(row.enabled) })),
    };
  }

  async replaceProfile(userId, payload = {}) {
    const id = Number(userId);
    const now = timestamp();
    const rows = Array.isArray(payload.rowPolicies) ? payload.rowPolicies : [];
    const columns = Array.isArray(payload.columnPolicies) ? payload.columnPolicies : [];
    await this.store.transaction(async (tx) => {
      for (const table of ['user_theme_grants', 'user_indicator_grants', 'user_dataset_grants', 'row_policies', 'column_policies']) {
        await tx.execute(`DELETE FROM ${table} WHERE user_id=?`, [id]);
      }
      for (const grant of Array.isArray(payload.themeGrants) ? payload.themeGrants : []) {
        await tx.execute('INSERT INTO user_theme_grants (user_id, theme_id, can_query, can_manage) VALUES (?, ?, ?, ?)',
          [id, Number(grant.themeId), grant.canQuery === false ? 0 : 1, grant.canManage ? 1 : 0]);
      }
      for (const grant of Array.isArray(payload.indicatorGrants) ? payload.indicatorGrants : []) {
        await tx.execute('INSERT INTO user_indicator_grants (user_id, indicator_id, can_query) VALUES (?, ?, ?)',
          [id, String(grant.indicatorId), grant.canQuery === false ? 0 : 1]);
      }
      for (const grant of Array.isArray(payload.datasetGrants) ? payload.datasetGrants : []) {
        await tx.execute('INSERT INTO user_dataset_grants (user_id, dataset_id, can_query) VALUES (?, ?, ?)',
          [id, Number(grant.datasetId), grant.canQuery === false ? 0 : 1]);
      }
      for (const policy of rows) {
        await tx.execute(`INSERT INTO row_policies (user_id, theme_id, dimension, operator, values_json,
          value_source, attribute_key, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          id, policy.themeId ? Number(policy.themeId) : null, String(policy.dimension ?? '').trim(),
          String(policy.operator ?? 'IN').trim().toUpperCase(), JSON.stringify(policy.values ?? []),
          String(policy.valueSource ?? 'FIXED').trim().toUpperCase(), policy.attributeKey ? String(policy.attributeKey) : null,
          policy.enabled === false ? 0 : 1, now, now,
        ]);
      }
      for (const policy of columns) {
        await tx.execute(`INSERT INTO column_policies (user_id, theme_id, column_name, action, mask_value,
          enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
          id, policy.themeId ? Number(policy.themeId) : null, String(policy.columnName ?? '').trim(),
          String(policy.action ?? 'MASK').trim().toUpperCase(), String(policy.maskValue ?? '***'),
          policy.enabled === false ? 0 : 1, now, now,
        ]);
      }
    });
    return this.getProfile(id);
  }
}

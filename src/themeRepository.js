import { mergeThemeSemanticPolicy } from './themeSemanticRules.js';
import { normalizeSemanticPolicy } from './semanticPolicy.js';

const json = (value, fallback) => {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};
const list = (value) => [...new Set((Array.isArray(value) ? value : [])
  .map((item) => String(item ?? '').trim()).filter(Boolean))];
const now = () => new Date().toISOString();

// Async platform-store boundary for theme management. Legacy synchronous
// methods remain available to subsystems that have not yet been migrated.
export class ThemeRepository {
  constructor(store) { this.store = store; }

  mapRow(row, indicators = [], skills = []) {
    if (!row) return null;
    const modelIds = json(row.modelIdsJson, []).map(Number).filter(Number.isFinite);
    return {
      ...row, id: Number(row.id), indicatorIds: indicators,
      allowedDimensions: json(row.allowedDimensionsJson, []),
      llmConfig: json(row.llmConfigJson, {}), datasetIds: json(row.datasetIdsJson, []),
      businessDatasetIds: json(row.businessDatasetIdsJson, []),
      primaryBusinessDatasetId: row.primaryBusinessDatasetId == null ? null : Number(row.primaryBusinessDatasetId),
      modelIds, defaultModelId: row.defaultModelId == null ? null : Number(row.defaultModelId),
      semanticValueConfig: json(row.semanticValueConfigJson, {}),
      semanticPolicy: mergeThemeSemanticPolicy(row.systemPrompt, json(row.semanticPolicyJson, {})),
      examples: json(row.examplesJson, []), skillCodes: skills,
    };
  }

  async getThemeAsync(id) {
    const [row] = await this.store.query(`SELECT id, name, description,
      system_prompt AS systemPrompt, indicator_ids_json AS indicatorIdsJson,
      allowed_dimensions_json AS allowedDimensionsJson, llm_config_json AS llmConfigJson,
      dataset_ids_json AS datasetIdsJson, business_dataset_ids_json AS businessDatasetIdsJson,
      primary_business_dataset_id AS primaryBusinessDatasetId, model_ids_json AS modelIdsJson,
      default_model_id AS defaultModelId, semantic_value_config_json AS semanticValueConfigJson,
      semantic_policy_json AS semanticPolicyJson, examples_json AS examplesJson,
      default_chart AS defaultChart, status, created_at AS createdAt, updated_at AS updatedAt
      FROM themes WHERE id = ?`, [Number(id)]);
    if (!row) return null;
    const indicators = await this.store.query('SELECT indicator_id AS id FROM theme_indicators WHERE theme_id=? ORDER BY indicator_id', [Number(id)]);
    const skills = await this.store.query('SELECT skill_code AS code FROM theme_skills WHERE theme_id=? AND enabled=1 ORDER BY skill_code', [Number(id)]);
    return this.mapRow(row, indicators.map((item) => String(item.id)), skills.map((item) => item.code));
  }

  async listThemesAsync() {
    const rows = await this.store.query('SELECT id FROM themes ORDER BY id');
    return Promise.all(rows.map((row) => this.getThemeAsync(row.id)));
  }

  async saveThemeAsync(payload, id = null) {
    const name = String(payload.name ?? '').trim();
    if (!name) throw new Error('theme name is required');
    const timestamp = now();
    const existing = id ? await this.getThemeAsync(id) : null;
    if (id && !existing) throw new Error('theme not found');
    const indicatorIds = Object.prototype.hasOwnProperty.call(payload, 'indicatorIds')
      ? list(payload.indicatorIds) : (existing?.indicatorIds ?? []);
    const modelRows = await this.store.query('SELECT id FROM models');
    const validModels = new Set(modelRows.map((row) => Number(row.id)));
    const modelIds = [...new Set(list(payload.modelIds).map(Number))].filter((value) => validModels.has(value));
    const requestedDefault = Number(payload.defaultModelId);
    const defaultModelId = modelIds.includes(requestedDefault) ? requestedDefault : (modelIds[0] ?? null);
    const businessDatasetIds = [...new Set(list(payload.businessDatasetIds).map(Number).filter(Number.isFinite))];
    const primary = Object.prototype.hasOwnProperty.call(payload, 'businessDatasetIds')
      && !Object.prototype.hasOwnProperty.call(payload, 'primaryBusinessDatasetId')
      ? null : (Number(payload.primaryBusinessDatasetId) || null);
    if (primary && !businessDatasetIds.includes(primary)) businessDatasetIds.push(primary);
    const semanticConfig = payload.semanticValueConfig ?? existing?.semanticValueConfig ?? {};
    const values = [name, String(payload.description ?? ''), String(payload.systemPrompt ?? ''),
      JSON.stringify(indicatorIds), JSON.stringify(payload.allowedDimensions ?? []),
      JSON.stringify(payload.llmConfig ?? {}), JSON.stringify(payload.datasetIds ?? []),
      JSON.stringify(payload.examples ?? []), JSON.stringify(businessDatasetIds), primary,
      JSON.stringify(modelIds), defaultModelId, JSON.stringify(semanticConfig),
      JSON.stringify(normalizeSemanticPolicy(payload.semanticPolicy)),
      String(payload.defaultChart ?? 'auto'), Number(payload.status ?? 1), timestamp];
    await this.store.transaction(async (tx) => {
      if (id) {
        await tx.execute(`UPDATE themes SET name=?, description=?, system_prompt=?, indicator_ids_json=?,
          allowed_dimensions_json=?, llm_config_json=?, dataset_ids_json=?, examples_json=?,
          business_dataset_ids_json=?, primary_business_dataset_id=?, model_ids_json=?, default_model_id=?,
          semantic_value_config_json=?, semantic_policy_json=?, default_chart=?, status=?, updated_at=? WHERE id=?`,
        [...values, Number(id)]);
      } else {
        const result = await tx.execute(`INSERT INTO themes (name, description, system_prompt,
          indicator_ids_json, allowed_dimensions_json, llm_config_json, dataset_ids_json, examples_json,
          business_dataset_ids_json, primary_business_dataset_id, model_ids_json, default_model_id,
          semantic_value_config_json, semantic_policy_json, default_chart, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...values, timestamp]);
        id = result.insertId;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'indicatorIds') || !existing) {
        await tx.execute('DELETE FROM theme_indicators WHERE theme_id=?', [Number(id)]);
        for (const indicatorId of indicatorIds) await tx.execute(
          'INSERT INTO theme_indicators (theme_id, indicator_id, created_at) VALUES (?, ?, ?)',
          [Number(id), indicatorId, timestamp]);
      }
      if (Array.isArray(payload.skillCodes)) {
        await tx.execute('DELETE FROM theme_skills WHERE theme_id=?', [Number(id)]);
        for (const code of list(payload.skillCodes)) await tx.execute(
          'INSERT INTO theme_skills (theme_id, skill_code, enabled, config_json) SELECT ?, code, 1, \'{}\' FROM skills WHERE code=? AND status=1',
          [Number(id), code]);
      }
    });
    return this.getThemeAsync(id);
  }

  async setThemeStatusAsync(id, status) {
    if (!await this.getThemeAsync(id)) return null;
    await this.store.execute('UPDATE themes SET status=?, updated_at=? WHERE id=?', [Number(status) === 0 ? 0 : 1, now(), Number(id)]);
    return this.getThemeAsync(id);
  }
  async updateThemePromptAsync(id, prompt) {
    if (!await this.getThemeAsync(id)) return null;
    await this.store.execute('UPDATE themes SET system_prompt=?, updated_at=? WHERE id=?', [String(prompt ?? ''), now(), Number(id)]);
    return this.getThemeAsync(id);
  }
  async deleteThemeAsync(id) {
    const result = await this.store.execute('DELETE FROM themes WHERE id=?', [Number(id)]);
    return Number(result.affectedRows) > 0;
  }

  async replaceIndicatorThemesAsync(indicatorId, themeIds = []) {
    const normalizedIndicatorId = String(indicatorId ?? '').trim();
    if (!normalizedIndicatorId) throw new Error('indicatorId is required');
    const ids = [...new Set((Array.isArray(themeIds) ? themeIds : [])
      .map(Number).filter((value) => Number.isInteger(value) && value > 0))];
    const timestamp = now();
    const relations = [];
    await this.store.transaction(async (tx) => {
      await tx.execute('DELETE FROM theme_indicators WHERE indicator_id=?', [normalizedIndicatorId]);
      for (const themeId of ids) {
        const found = await tx.query('SELECT id FROM themes WHERE id=?', [themeId]);
        if (!found.length) continue;
        await tx.execute('INSERT INTO theme_indicators (theme_id, indicator_id, created_at) VALUES (?, ?, ?)',
          [themeId, normalizedIndicatorId, timestamp]);
        relations.push({ themeId, indicatorId: normalizedIndicatorId });
      }
    });
    return relations;
  }
}

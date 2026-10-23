import crypto from 'node:crypto';
import { validateLocalIndicator } from './localIndicatorValidation.js';
import { attachSqliteAsyncStore } from './sqliteAsyncStore.js';
function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export class LocalIndicatorRepository {
  constructor(db, asyncStore = db) {
    this.db = db;
    this.asyncStore = typeof asyncStore.query === 'function'
      ? asyncStore
      : attachSqliteAsyncStore({}, db);
  }

  async save(payload, id = null) {
    payload = validateLocalIndicator(payload);
    const indicatorId = id
      ? String(id).trim()
      : `local:${crypto.randomUUID()}`;
    if (!indicatorId.startsWith('local:')) {
      throw Object.assign(new Error('local indicator id must use the local: prefix'), { statusCode: 400 });
    }
    const name = String(payload.name ?? '').trim();
    const bizName = String(payload.bizName ?? '').trim();
    const timestamp = nowIso();
    const indicator = {
      id: indicatorId,
      name,
      bizName,
      typeId: String(payload.typeId ?? '').trim(),
      typeName: String(payload.typeName ?? '').trim() || '通用指标',
      indicatorLevel: String(payload.indicatorLevel ?? 'ATOMIC').trim().toUpperCase(),
      businessCaliber: String(payload.businessCaliber ?? '').trim(),
      description: String(payload.description ?? '').trim(),
      owner: String(payload.owner ?? '').trim(),
      department: String(payload.department ?? '').trim(),
      status: payload.status === 0 ? 0 : 1,
      metrics: Array.isArray(payload.metrics) ? payload.metrics : [],
      dimensions: Array.isArray(payload.dimensions) ? payload.dimensions : [],
      models: Array.isArray(payload.models) ? payload.models : [],
      raw: {
        ...(payload.raw && typeof payload.raw === 'object' ? payload.raw : {}),
        localManaged: true,
      },
    };
    const upsertSql = this.asyncStore.backend === 'mysql' ? `
      INSERT INTO local_indicators (
        id, name, biz_name, type_id, type_name, indicator_level,
        business_caliber, description, owner, department, status,
        metrics_json, dimensions_json, models_json, raw_json, synced_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name), biz_name = VALUES(biz_name), type_id = VALUES(type_id),
        type_name = VALUES(type_name), indicator_level = VALUES(indicator_level),
        business_caliber = VALUES(business_caliber), description = VALUES(description),
        owner = VALUES(owner), department = VALUES(department), status = VALUES(status),
        metrics_json = VALUES(metrics_json), dimensions_json = VALUES(dimensions_json),
        models_json = VALUES(models_json), raw_json = VALUES(raw_json), updated_at = VALUES(updated_at)
    ` : `
      INSERT INTO local_indicators (
        id, name, biz_name, type_id, type_name, indicator_level,
        business_caliber, description, owner, department, status,
        metrics_json, dimensions_json, models_json, raw_json, synced_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        biz_name = excluded.biz_name,
        type_id = excluded.type_id,
        type_name = excluded.type_name,
        indicator_level = excluded.indicator_level,
        business_caliber = excluded.business_caliber,
        description = excluded.description,
        owner = excluded.owner,
        department = excluded.department,
        status = excluded.status,
        metrics_json = excluded.metrics_json,
        dimensions_json = excluded.dimensions_json,
        models_json = excluded.models_json,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at
    `;
    await this.asyncStore.execute(upsertSql, [
      indicatorId,
      indicator.name,
      indicator.bizName,
      indicator.typeId,
      indicator.typeName,
      indicator.indicatorLevel,
      indicator.businessCaliber,
      indicator.description,
      indicator.owner,
      indicator.department,
      indicator.status,
      JSON.stringify(indicator.metrics),
      JSON.stringify(indicator.dimensions),
      JSON.stringify(indicator.models),
      JSON.stringify(indicator.raw),
      timestamp,
      timestamp,
    ]);
    return this.getAsync(indicatorId);
  }

  async getAsync(id) {
    const [row] = await this.asyncStore.query(`
      SELECT id, name, biz_name AS bizName, type_id AS typeId,
             type_name AS typeName, indicator_level AS indicatorLevel,
             business_caliber AS businessCaliber, description, owner, department,
             status, metrics_json AS metricsJson, dimensions_json AS dimensionsJson,
             models_json AS modelsJson, raw_json AS rawJson,
             synced_at AS syncedAt, updated_at AS updatedAt
      FROM local_indicators WHERE id = ?
    `, [String(id)]);
    return this.mapRow(row);
  }

  async deleteAsync(id) {
    const result = await this.asyncStore.execute('DELETE FROM local_indicators WHERE id = ?', [String(id)]);
    return Number(result.affectedRows) > 0;
  }

  async listAsync({ keyword = '', typeId = '', limit = 500, enabledOnly = false } = {}) {
    const normalizedKeyword = String(keyword).trim().toLowerCase();
    const normalizedTypeId = String(typeId ?? '').trim();
    const rows = await this.asyncStore.query(`SELECT id, name, biz_name AS bizName,
      type_id AS typeId, type_name AS typeName, indicator_level AS indicatorLevel,
      business_caliber AS businessCaliber, description, owner, department, status,
      metrics_json AS metricsJson, dimensions_json AS dimensionsJson,
      models_json AS modelsJson, raw_json AS rawJson, synced_at AS syncedAt,
      updated_at AS updatedAt FROM local_indicators WHERE (? = 0 OR status = 1) ORDER BY name`, [enabledOnly ? 1 : 0]);
    return rows.map((row) => this.mapRow(row))
      .filter((item) => !normalizedTypeId || String(item.typeId) === normalizedTypeId)
      .filter((item) => !normalizedKeyword || [item.name, item.bizName, item.description,
        item.businessCaliber, item.typeName].some((value) => String(value ?? '').toLowerCase().includes(normalizedKeyword)))
      .slice(0, Math.max(1, Math.min(Number(limit) || 500, 2000)));
  }

  async listTypesAsync() {
    const byId = new Map();
    for (const indicator of await this.listAsync({ limit: 2000 })) {
      const id = String(indicator.typeId || indicator.typeName);
      if (id && !byId.has(id)) byId.set(id, { id, name: indicator.typeName || id, code: '', parentId: '' });
    }
    return [...byId.values()];
  }

  async countAsync() {
    const [row] = await this.asyncStore.query('SELECT COUNT(*) AS count FROM local_indicators');
    return Number(row?.count ?? 0);
  }

  mapRow(row) {
    if (!row) {
      return null;
    }
    return {
      ...row,
      metrics: parseJson(row.metricsJson, []),
      dimensions: parseJson(row.dimensionsJson, []),
      models: parseJson(row.modelsJson, []),
      raw: parseJson(row.rawJson, {}),
    };
  }
}

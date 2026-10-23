function nowIso() {
  return new Date().toISOString();
}

function asBool(value) {
  return value === 1 || value === true;
}

// Model persistence is kept behind this boundary so the same domain contract
// can later be implemented by the asynchronous MySQL platform store.
export class ModelRepository {
  constructor(db, asyncStore = db) {
    this.db = db;
    this.asyncStore = asyncStore;
  }

  async listModelsAsync() {
    const rows = await this.asyncStore.query(`
      SELECT id, name, provider, model_name AS modelName, base_url AS baseUrl,
             api_key_env AS apiKeyEnv, api_key_encrypted AS apiKeyEncrypted,
             temperature, max_tokens AS maxTokens, timeout_ms AS timeoutMs,
             max_tool_rounds AS maxToolRounds, is_default AS isDefault,
             status, created_at AS createdAt, updated_at AS updatedAt
      FROM models ORDER BY is_default DESC, id
    `);
    return rows.map((row) => ({
      ...row,
      id: Number(row.id),
      isDefault: asBool(row.isDefault),
      hasApiKey: Boolean(row.apiKeyEncrypted),
      status: Number(row.status ?? 1),
    }));
  }

  async getModelAsync(id) {
    return (await this.listModelsAsync()).find((model) => model.id === Number(id)) ?? null;
  }

  async saveModelAsync(payload, id = null) {
    const timestamp = nowIso();
    const name = String(payload.name ?? '').trim();
    const modelName = String(payload.modelName ?? payload.model ?? '').trim();
    if (!name || !modelName) throw new Error('model name and model identifier are required');
    const values = [
      name, String(payload.provider ?? 'deepseek').trim().toLowerCase(), modelName,
      String(payload.baseUrl ?? '').trim(), String(payload.apiKeyEnv ?? '').trim(),
      String(payload.apiKeyEncrypted ?? '').trim() || null,
      Number(payload.temperature ?? 0), Math.max(0, Number(payload.maxTokens ?? 0) || 0),
      Math.max(1000, Number(payload.timeoutMs ?? 60000) || 60000),
      Math.max(1, Number(payload.maxToolRounds ?? 12) || 12),
      payload.isDefault === true ? 1 : 0, Number(payload.status ?? 1), timestamp,
    ];
    await this.asyncStore.transaction(async (tx) => {
      if (payload.isDefault === true) await tx.execute('UPDATE models SET is_default = 0');
      if (id) {
        await tx.execute(`UPDATE models SET name=?, provider=?, model_name=?, base_url=?,
          api_key_env=?, api_key_encrypted=?, temperature=?, max_tokens=?, timeout_ms=?,
          max_tool_rounds=?, is_default=?, status=?, updated_at=? WHERE id=?`,
        [...values, Number(id)]);
      } else {
        const result = await tx.execute(`INSERT INTO models
          (name, provider, model_name, base_url, api_key_env, api_key_encrypted,
           temperature, max_tokens, timeout_ms, max_tool_rounds, is_default, status,
           created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...values.slice(0, 12), timestamp, timestamp]);
        id = result.insertId;
      }
    });
    return this.getModelAsync(id);
  }

  async setModelDefaultAsync(id) {
    if (!await this.getModelAsync(id)) return null;
    await this.asyncStore.transaction(async (tx) => {
      await tx.execute('UPDATE models SET is_default = 0');
      await tx.execute('UPDATE models SET is_default = 1, updated_at = ? WHERE id = ?',
        [nowIso(), Number(id)]);
    });
    return this.getModelAsync(id);
  }

  async deleteModelAsync(id) {
    const result = await this.asyncStore.execute('DELETE FROM models WHERE id = ?', [Number(id)]);
    return Number(result.affectedRows) > 0;
  }

  listModels() {
    return this.db.prepare(`
      SELECT id, name, provider, model_name AS modelName, base_url AS baseUrl,
             api_key_env AS apiKeyEnv, api_key_encrypted AS apiKeyEncrypted,
             temperature, max_tokens AS maxTokens, timeout_ms AS timeoutMs,
             max_tool_rounds AS maxToolRounds, is_default AS isDefault,
             status, created_at AS createdAt, updated_at AS updatedAt
      FROM models
      ORDER BY is_default DESC, id
    `).all().map((row) => ({
      ...row,
      isDefault: asBool(row.isDefault),
      hasApiKey: Boolean(row.apiKeyEncrypted),
      status: Number(row.status ?? 1),
    }));
  }

  getModel(id) {
    return this.listModels().find((model) => Number(model.id) === Number(id)) ?? null;
  }

  saveModel(payload, id = null) {
    const timestamp = nowIso();
    const name = String(payload.name ?? '').trim();
    const modelName = String(payload.modelName ?? payload.model ?? '').trim();
    if (!name || !modelName) {
      throw new Error('model name and model identifier are required');
    }
    const provider = String(payload.provider ?? 'deepseek').trim().toLowerCase();
    const isDefault = payload.isDefault === true;
    this.db.exec('BEGIN');
    try {
      if (isDefault) {
        this.db.prepare('UPDATE models SET is_default = 0').run();
      }
      const normalized = {
        name,
        provider,
        modelName,
        baseUrl: String(payload.baseUrl ?? '').trim(),
        apiKeyEnv: String(payload.apiKeyEnv ?? '').trim(),
        apiKeyEncrypted: String(payload.apiKeyEncrypted ?? '').trim() || null,
        temperature: Number(payload.temperature ?? 0),
        maxTokens: Math.max(0, Number(payload.maxTokens ?? 0) || 0),
        timeoutMs: Math.max(1000, Number(payload.timeoutMs ?? 60000) || 60000),
        maxToolRounds: Math.max(1, Number(payload.maxToolRounds ?? 12) || 12),
        isDefault,
        status: Number(payload.status ?? 1),
      };
      if (id) {
        this.db.prepare(`
          UPDATE models
          SET name = ?, provider = ?, model_name = ?, base_url = ?,
              api_key_env = ?, api_key_encrypted = ?,
              temperature = ?, max_tokens = ?, timeout_ms = ?,
              max_tool_rounds = ?, is_default = ?, status = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          normalized.name,
          normalized.provider,
          normalized.modelName,
          normalized.baseUrl,
          normalized.apiKeyEnv,
          normalized.apiKeyEncrypted,
          normalized.temperature,
          normalized.maxTokens,
          normalized.timeoutMs,
          normalized.maxToolRounds,
          normalized.isDefault ? 1 : 0,
          normalized.status,
          timestamp,
          Number(id),
        );
      } else {
        const result = this.db.prepare(`
          INSERT INTO models
            (name, provider, model_name, base_url, api_key_env,
             api_key_encrypted, temperature, max_tokens, timeout_ms,
             max_tool_rounds, is_default, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          normalized.name,
          normalized.provider,
          normalized.modelName,
          normalized.baseUrl,
          normalized.apiKeyEnv,
          normalized.apiKeyEncrypted,
          normalized.temperature,
          normalized.maxTokens,
          normalized.timeoutMs,
          normalized.maxToolRounds,
          normalized.isDefault ? 1 : 0,
          normalized.status,
          timestamp,
          timestamp,
        );
        id = Number(result.lastInsertRowid);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getModel(id);
  }

  setModelDefault(id) {
    const model = this.getModel(id);
    if (!model) {
      return null;
    }
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE models SET is_default = 0').run();
      this.db.prepare(`
        UPDATE models SET is_default = 1, updated_at = ? WHERE id = ?
      `).run(nowIso(), Number(id));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getModel(id);
  }

  deleteModel(id) {
    return this.db.prepare('DELETE FROM models WHERE id = ?').run(Number(id)).changes > 0;
  }
}

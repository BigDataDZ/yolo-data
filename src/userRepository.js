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

function asJson(value) {
  return JSON.stringify(value ?? {});
}

const USER_ROLES = new Set(['ADMIN', 'ANALYST']);

function normalizeUserRole(value) {
  const role = String(value ?? '').trim().toUpperCase();
  return USER_ROLES.has(role) ? role : 'ANALYST';
}

export class UserRepository {
  constructor(db, asyncStore = db) {
    this.db = db;
    this.asyncStore = asyncStore;
  }

  mapRow(row) {
    return row
      ? {
        ...row,
        role: normalizeUserRole(row.role),
        attributes: parseJson(row.attributesJson, {}),
      }
      : null;
  }

  async listUsersAsync() {
    const rows = await this.asyncStore.query(`SELECT id, username,
      display_name AS displayName, role, status, attributes_json AS attributesJson,
      created_at AS createdAt, updated_at AS updatedAt FROM app_users ORDER BY id`);
    return rows.map((row) => this.mapRow({ ...row, id: Number(row.id) }));
  }

  async getUserAsync(id) {
    const rows = await this.asyncStore.query(`SELECT id, username,
      display_name AS displayName, role, status, attributes_json AS attributesJson,
      created_at AS createdAt, updated_at AS updatedAt FROM app_users WHERE id = ?`,
    [Number(id)]);
    return this.mapRow(rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null);
  }

  async getUserByUsernameAsync(username) {
    const rows = await this.asyncStore.query(`SELECT id, username,
      display_name AS displayName, role, status, attributes_json AS attributesJson,
      created_at AS createdAt, updated_at AS updatedAt FROM app_users WHERE username = ?`,
    [username]);
    return this.mapRow(rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null);
  }

  async saveUserAsync(payload, id = null) {
    const timestamp = nowIso();
    const username = String(payload.username ?? '').trim();
    const displayName = String(payload.displayName ?? '').trim();
    if (!username || !displayName) throw new Error('username and displayName are required');
    const values = [username, displayName, normalizeUserRole(payload.role),
      Number(payload.status ?? 1), asJson(payload.attributes ?? {}), timestamp];
    if (id) {
      await this.asyncStore.execute(`UPDATE app_users SET username=?, display_name=?, role=?,
        status=?, attributes_json=?, updated_at=? WHERE id=?`, [...values, Number(id)]);
      return this.getUserAsync(id);
    }
    const result = await this.asyncStore.execute(`INSERT INTO app_users
      (username, display_name, role, status, attributes_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [...values.slice(0, 5), timestamp, timestamp]);
    return this.getUserAsync(result.insertId);
  }

  listUsers() {
    return this.db.prepare(`
      SELECT id, username, display_name AS displayName, role, status,
             attributes_json AS attributesJson, created_at AS createdAt,
             updated_at AS updatedAt
      FROM app_users ORDER BY id
    `).all().map((row) => this.mapRow(row));
  }

  getUser(id) {
    return this.mapRow(this.db.prepare(`
      SELECT id, username, display_name AS displayName, role, status,
             attributes_json AS attributesJson, created_at AS createdAt,
             updated_at AS updatedAt
      FROM app_users WHERE id = ?
    `).get(Number(id)));
  }

  getUserByUsername(username) {
    return this.mapRow(this.db.prepare(`
      SELECT id, username, display_name AS displayName, role, status,
             attributes_json AS attributesJson, created_at AS createdAt,
             updated_at AS updatedAt
      FROM app_users WHERE username = ?
    `).get(username));
  }

  saveUser(payload, id = null) {
    const timestamp = nowIso();
    const username = String(payload.username ?? '').trim();
    const displayName = String(payload.displayName ?? '').trim();
    const role = normalizeUserRole(payload.role);
    const attributesJson = asJson(payload.attributes ?? {});
    if (!username || !displayName) {
      throw new Error('username and displayName are required');
    }

    if (id) {
      this.db.prepare(`
        UPDATE app_users
        SET username = ?, display_name = ?, role = ?, status = ?,
            attributes_json = ?, updated_at = ?
        WHERE id = ?
      `).run(username, displayName, role, Number(payload.status ?? 1),
        attributesJson, timestamp, Number(id));
      return this.getUser(id);
    }

    const result = this.db.prepare(`
      INSERT INTO app_users
        (username, display_name, role, status, attributes_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(username, displayName, role, Number(payload.status ?? 1),
      attributesJson, timestamp, timestamp);
    return this.getUser(Number(result.lastInsertRowid));
  }
}

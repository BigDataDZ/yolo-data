// Authentication core: password hashing, session persistence and cookie
// helpers. Kept out of database.js so the storage module stays focused on
// domain tables, mirroring the datasourceCrypto split.
import crypto from 'node:crypto';

export const SESSION_COOKIE = 'yolo_session';
export const DEFAULT_PASSWORD = 'yolo123456';
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const MIN_PASSWORD_LENGTH = 6;

function scrypt(password, salt, length = KEY_LENGTH) {
  return crypto.scryptSync(String(password), salt, length, SCRYPT_OPTIONS);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = scrypt(password, salt);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[1], 'hex');
    expected = Buffer.from(parts[2], 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }
  const derived = scrypt(password, salt, expected.length);
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

export function assertPasswordUsable(password) {
  const text = String(password ?? '');
  if (text.length < MIN_PASSWORD_LENGTH) {
    throw Object.assign(
      new Error(`密码长度至少 ${MIN_PASSWORD_LENGTH} 位`),
      { statusCode: 400 },
    );
  }
  return text;
}

// 生产环境默认强制登录；本地开发保留 x-user-id 直连，方便脚本与测试。
export function resolveAuthMode(config) {
  const explicit = String(config?.authMode ?? process.env.AUTH_MODE ?? '').trim().toLowerCase();
  if (explicit && explicit !== 'dev' && explicit !== 'session') {
    throw new Error(`Unsupported AUTH_MODE ${JSON.stringify(explicit)}; supported modes: dev, session`);
  }
  const nodeEnv = String(config?.nodeEnv ?? process.env.NODE_ENV ?? '').trim().toLowerCase();
  return explicit || (nodeEnv === 'production' ? 'session' : 'dev');
}

// 历史库中的用户没有口令，这里按默认口令补齐，保证首次登录可用。
export async function seedDefaultPasswordsAsync(database, defaultPassword) {
  const fallback = String(defaultPassword ?? process.env.DEFAULT_USER_PASSWORD ?? '').trim()
    || DEFAULT_PASSWORD;
  const rows = await database.query(`
    SELECT id FROM app_users
    WHERE password_hash IS NULL OR password_hash = ''
  `);
  if (rows.length === 0) {
    return 0;
  }
  const timestamp = new Date().toISOString();
  for (const row of rows) {
    await database.execute('UPDATE app_users SET password_hash = ?, updated_at = ? WHERE id = ?',
      [hashPassword(fallback), timestamp, row.id]);
  }
  return rows.length;
}

export async function setUserPasswordAsync(database, userId, password) {
  const plain = assertPasswordUsable(password);
  const result = await database.execute(
    'UPDATE app_users SET password_hash = ?, updated_at = ? WHERE id = ?',
    [hashPassword(plain), new Date().toISOString(), Number(userId)],
  );
  return Number(result.affectedRows) > 0;
}

export function defaultPassword() {
  const configured = String(process.env.DEFAULT_USER_PASSWORD ?? '').trim();
  return configured.length >= MIN_PASSWORD_LENGTH ? configured : DEFAULT_PASSWORD;
}

export function setDefaultUserPasswordAsync(database, userId) {
  return setUserPasswordAsync(database, userId, defaultPassword());
}

export async function checkUserPasswordAsync(database, user, password) {
  if (!user) return false;
  const rows = await database.query(
    'SELECT password_hash AS passwordHash FROM app_users WHERE id = ?',
    [Number(user.id)],
  );
  return verifyPassword(password, rows[0]?.passwordHash);
}

export async function createSessionAsync(database, userId, ttlHours = 12) {
  const hours = Number.isFinite(Number(ttlHours)) && Number(ttlHours) > 0
    ? Number(ttlHours) : 12;
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  const expiresAt = new Date(now + hours * 3600 * 1000).toISOString();
  await database.execute('DELETE FROM user_sessions WHERE expires_at <= ?', [timestamp]);
  await database.execute(`INSERT INTO user_sessions
    (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
  [sha256(token), Number(userId), timestamp, timestamp, expiresAt]);
  return { token, expiresAt, maxAgeSeconds: Math.round(hours * 3600) };
}

export async function resolveSessionAsync(database, token) {
  if (!token) return null;
  const rows = await database.query(`SELECT id, user_id AS userId, expires_at AS expiresAt
    FROM user_sessions WHERE token_hash = ?`, [sha256(token)]);
  const row = rows[0];
  if (!row) return null;
  if (Date.parse(row.expiresAt) <= Date.now()) {
    await database.execute('DELETE FROM user_sessions WHERE id = ?', [row.id]);
    return null;
  }
  await database.execute('UPDATE user_sessions SET last_seen_at = ? WHERE id = ?',
    [new Date().toISOString(), row.id]);
  const user = await database.userRepository.getUserAsync(row.userId);
  return !user || Number(user.status ?? 1) === 0 ? null : user;
}

export async function deleteSessionAsync(database, token) {
  if (token) await database.execute('DELETE FROM user_sessions WHERE token_hash = ?', [sha256(token)]);
}

export async function deleteUserSessionsAsync(database, userId, keepToken = null) {
  if (keepToken) {
    await database.execute('DELETE FROM user_sessions WHERE user_id = ? AND token_hash != ?',
      [Number(userId), sha256(keepToken)]);
  } else {
    await database.execute('DELETE FROM user_sessions WHERE user_id = ?', [Number(userId)]);
  }
}

export function readCookie(request, name = SESSION_COOKIE) {
  const header = request?.headers?.cookie ?? '';
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) {
      continue;
    }
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

export function readSessionToken(request) {
  return readCookie(request, SESSION_COOKIE);
}

export function sessionCookie(token, { maxAgeSeconds = 43_200, secure = false } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.round(maxAgeSeconds))}`,
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function clearSessionCookie({ secure = false } = {}) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

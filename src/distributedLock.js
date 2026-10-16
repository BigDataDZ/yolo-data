// 分布式会话锁骨架（P0-1 的一部分）。
//
// 现状：SQLite 单节点 + Node 单进程，会话编辑/执行没有跨请求互斥。多实例部署时
// 需要真正的分布式锁（Redis 等）。这里给出统一接口 + 两种后端：
//   - 'sqlite'（默认）：基于租约表的进程级互斥，跨进程能力受限于 SQLite 单写者，
//     但比"无锁"强，且零依赖，可直接用于单节点生产。
//   - 'redis'：接口占位，需接入 Redis 客户端（ioredis/redis）与 REDIS_URL。
//     真正的分布式互斥依赖这里，故在未提供客户端时明确报错，而不是假装成功。

export function createDistributedLock({ backend = 'sqlite', database = null, redis = null } = {}) {
  if (backend === 'redis') {
    if (!redis) {
      // 诚实失败：不伪造一个非分布式的锁。
      return {
        backend: 'redis',
        enabled: false,
        async acquire() {
          throw new Error('分布式锁 backend=redis 但未提供 Redis 客户端，请配置 REDIS_URL 并注入客户端');
        },
        async release() { return false; },
        async refresh() { return false; },
      };
    }
    return createRedisLock(redis);
  }

  // 默认 sqlite 租约锁。
  if (!database) {
    throw new Error('distributedLock backend=sqlite 需要 database 实例');
  }
  database.ensureColumn?.('app_users', 'id', 'INTEGER');
  try {
    database.db.exec(`
      CREATE TABLE IF NOT EXISTS session_locks (
        key TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
  } catch {
    // 表已存在则忽略
  }
  return createSqliteLock(database);
}

function createSqliteLock(database) {
  function expired(rows) {
    return rows.length === 0 || Date.parse(rows[0].expires_at) <= Date.now();
  }
  return {
    backend: 'sqlite',
    enabled: true,
    async acquire(key, owner, ttlMs = 30_000) {
      const now = Date.now();
      const expiresAt = new Date(now + ttlMs).toISOString();
      const existing = database.db
        .prepare('SELECT owner, expires_at FROM session_locks WHERE key = ?')
        .get(key);
      if (existing && !expired([existing])) {
        return false; // 被他人持有
      }
      database.db
        .prepare(`
          INSERT INTO session_locks (key, owner, expires_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
        `)
        .run(key, owner, expiresAt);
      return true;
    },
    async release(key, owner) {
      const row = database.db
        .prepare('SELECT owner FROM session_locks WHERE key = ?')
        .get(key);
      if (!row || row.owner !== owner) {
        return false;
      }
      database.db.prepare('DELETE FROM session_locks WHERE key = ?').run(key);
      return true;
    },
    async refresh(key, owner, ttlMs = 30_000) {
      const row = database.db
        .prepare('SELECT owner FROM session_locks WHERE key = ?')
        .get(key);
      if (!row || row.owner !== owner) {
        return false;
      }
      database.db
        .prepare('UPDATE session_locks SET expires_at = ? WHERE key = ?')
        .run(new Date(Date.now() + ttlMs).toISOString(), key);
      return true;
    },
  };
}

function createRedisLock(redis) {
  // redis 需提供 set(key, val, { nx: true, px }) / del / pexpire 语义的客户端。
  // 这里用最小接口约定，避免引入具体客户端依赖。
  const LOCK_PREFIX = 'yolo:lock:';
  return {
    backend: 'redis',
    enabled: true,
    async acquire(key, owner, ttlMs = 30_000) {
      const ok = await redis.set(LOCK_PREFIX + key, owner, { nx: true, px: ttlMs });
      return Boolean(ok);
    },
    async release(key, owner) {
      const full = LOCK_PREFIX + key;
      const script = `if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end`;
      const result = await redis.eval?.(script, 1, full, owner);
      return Number(result) === 1;
    },
    async refresh(key, owner, ttlMs = 30_000) {
      const full = LOCK_PREFIX + key;
      const current = await redis.get(full);
      if (current !== owner) return false;
      await redis.pexpire(full, ttlMs);
      return true;
    },
  };
}

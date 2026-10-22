import path from 'node:path';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';

function normalizeConfig(config = {}) {
  const database = String(config.database ?? '').trim();
  const user = String(config.user ?? '').trim();
  if (!database || !user) {
    throw new Error('平台 MySQL 必须配置 PLATFORM_DB_NAME 和 PLATFORM_DB_USER');
  }
  return {
    host: String(config.host ?? '127.0.0.1').trim(),
    port: Number(config.port ?? 3306),
    database,
    user,
    password: String(config.password ?? ''),
    charset: String(config.charset ?? 'utf8mb4').trim() || 'utf8mb4',
    waitForConnections: true,
    connectionLimit: Math.max(1, Number(config.connectionLimit ?? 10) || 10),
    timezone: 'Z',
  };
}

export class MysqlPlatformStore {
  constructor(config = {}, { poolFactory = mysql.createPool } = {}) {
    this.config = normalizeConfig(config);
    this.initSqlPath = String(config.initSqlPath ?? './config/platform/mysql-init.sql').trim();
    this.poolFactory = poolFactory;
    this.pool = null;
  }

  async connect() {
    if (!this.pool) {
      this.pool = this.poolFactory(this.config);
    }
    const connection = await this.pool.getConnection();
    connection.release();
    return this;
  }
  async query(sql, values = []) {
    if (!this.pool) await this.connect();
    const [rows] = await this.pool.query(sql, values);
    return rows;
  }

  async execute(sql, values = []) {
    if (!this.pool) await this.connect();
    const [result] = await this.pool.execute(sql, values);
    return result;
  }

  async transaction(callback) {
    if (!this.pool) await this.connect();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback({
        query: (sql, values = []) => connection.query(sql, values).then(([rows]) => rows),
        execute: (sql, values = []) => connection.execute(sql, values).then(([value]) => value),
      });
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async initialize(sqlPath = this.initSqlPath) {
    const source = await fs.readFile(sqlPath, 'utf8');
    const statements = splitSqlStatements(source);
    if (!this.pool) this.pool = this.poolFactory(this.config);
    const connection = await this.pool.getConnection();
    try {
      for (const statement of statements) {
        try {
          await connection.query(statement);
        } catch (error) {
          // The generated bootstrap uses idempotent tables, but MySQL does not
          // support CREATE INDEX IF NOT EXISTS. Re-running it may hit this case.
          if (error.code !== 'ER_DUP_KEYNAME') throw error;
        }
      }
    } finally {
      connection.release();
    }
    const migrationDirectory = path.join(path.dirname(sqlPath), 'mysql-migrations');
    return statements.length + await this.applySqlMigrations(migrationDirectory);
  }

  async applySqlMigrations(directory) {
    let files;
    try {
      files = (await fs.readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
    } catch (error) {
      if (error.code === 'ENOENT') return 0;
      throw error;
    }
    let appliedStatements = 0;
    for (const name of files) {
      const key = name.replace(/\.sql$/i, '');
      const previous = await this.query(
        'SELECT 1 FROM schema_migrations WHERE `key` = ? LIMIT 1',
        [key],
      );
      if (previous.length > 0) continue;
      const statements = splitSqlStatements(await fs.readFile(path.join(directory, name), 'utf8'));
      await this.transaction(async (tx) => {
        for (const statement of statements) {
          const addColumn = statement.match(
            /^ALTER\s+TABLE\s+([\w]+)\s+ADD\s+COLUMN\s+([\w]+)/i,
          );
          if (addColumn) {
            const [, table, column] = addColumn;
            const existing = await tx.query(
              `SELECT 1 FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
              [table, column],
            );
            if (existing.length > 0) continue;
          }
          const createIndex = statement.match(
            /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+([\w]+)/i,
          );
          if (createIndex) {
            const existing = await tx.query(
              `SELECT 1 FROM information_schema.statistics
               WHERE table_schema = DATABASE() AND index_name = ? LIMIT 1`,
              [createIndex[1]],
            );
            if (existing.length > 0) continue;
          }
          try {
            await tx.query(statement);
          } catch (error) {
            // A column may already be present in a fresh schema even when an
            // older compatibility migration has not been recorded yet. MySQL
            // DDL auto-commits, so this can also occur after an interrupted run.
            if (addColumn && error.code === 'ER_DUP_FIELDNAME') continue;
            throw error;
          }
          appliedStatements += 1;
        }
        await tx.execute(
          'INSERT INTO schema_migrations (`key`, applied_at) VALUES (?, ?)',
          [key, new Date().toISOString()],
        );
      });
    }
    return appliedStatements;
  }

  async close() {
    await this.pool?.end();
    this.pool = null;
  }
}

export function splitSqlStatements(source) {
  return source
    .split(/^\s*--\s*STATEMENT\s*$/m)
    .flatMap((part) => part.split(/;\s*(?=\r?\n|$)/))
    .map((statement) => statement.replace(/^(?:\s*--[^\r\n]*(?:\r?\n|$))+/, '').trim())
    .filter((statement) => statement && !/^--/.test(statement));
}

export { normalizeConfig as normalizeMysqlPlatformConfig };

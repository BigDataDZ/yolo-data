import { createRequire } from 'node:module';
import { classifyColumnType, quoteIdentifier } from './common.js';

const require = createRequire(import.meta.url);

export const mysqlDialect = {
  code: 'MYSQL',
  quoteIdentifier,
  classifyColumnType,
  prepareSql: (sql) => sql,
  countDistinct: (expression) => `COUNT(DISTINCT ${expression})`,
  limitClause: () => 'LIMIT ?',
  timeGrainExpr(column, grain) {
    switch (String(grain ?? '').toUpperCase()) {
      case 'DAY': return `DATE_FORMAT(${column}, '%Y-%m-%d')`;
      case 'WEEK': return `DATE_FORMAT(DATE_SUB(DATE(${column}), INTERVAL WEEKDAY(${column}) DAY), '%Y-%m-%d')`;
      case 'MONTH': return `DATE_FORMAT(${column}, '%Y-%m')`;
      case 'QUARTER': return `CONCAT(YEAR(${column}), '-Q', QUARTER(${column}))`;
      case 'YEAR': return `DATE_FORMAT(${column}, '%Y')`;
      default: return column;
    }
  },
  metadataSql(kind) {
    if (kind === 'schemas') return 'SHOW DATABASES';
    if (kind === 'tables') return `
      SELECT table_name AS tableName, table_type AS tableType,
             table_comment AS tableComment, table_rows AS approxRows
      FROM information_schema.tables WHERE table_schema = ?
      ORDER BY table_rows DESC, table_name`;
    if (kind === 'columns') return `
      SELECT ordinal_position AS ordinalPosition, column_name AS columnName,
             data_type AS dataType, column_type AS columnType,
             is_nullable AS isNullable, column_comment AS columnComment
      FROM information_schema.columns WHERE table_schema = ? AND table_name = ?
      ORDER BY ordinal_position`;
    throw new Error(`unsupported metadata kind: ${kind}`);
  },
  createPool(source, password) {
    let mysql;
    try { mysql = require('mysql2/promise'); } catch (cause) {
      throw new Error('mysql2 驱动未安装：MySQL、TiDB 或 Doris 数据源需要先执行 npm install mysql2', { cause });
    }
    return mysql.createPool({
      host: source.host, port: Number(source.port), user: source.username, password,
      database: source.databaseName || undefined,
      waitForConnections: true, connectionLimit: 4, maxIdle: 2,
      idleTimeout: 60_000, queueLimit: 20, charset: 'utf8mb4',
      timezone: '+08:00', dateStrings: true, multipleStatements: false, connectTimeout: 10_000,
    });
  },
};

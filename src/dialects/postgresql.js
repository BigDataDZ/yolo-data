import { createRequire } from 'node:module';
import { classifyColumnType, postgresParameters, quoteIdentifier } from './common.js';

const require = createRequire(import.meta.url);

export function postgresPoolOptions(source, password) {
  const ssl = source.options?.ssl;
  return {
    host: source.host, port: Number(source.port ?? 5432), user: source.username, password,
    database: source.databaseName || undefined,
    max: 4, idleTimeoutMillis: 60_000, connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    options: '-c timezone=Asia/Shanghai -c default_transaction_read_only=on',
    ssl: ssl ? { rejectUnauthorized: true, ...(ssl.ca ? { ca: ssl.ca } : {}) } : false,
  };
}

// Match mysql2's [rows, fields] contract without global pg type-parser changes.
// Dates remain database-local strings; bigint/numeric retain their precision.
export function adaptPostgresPool(pool, types) {
  pool.on('error', () => {}); // pg removes broken idle clients; never crash the server.
  return {
    async query(input, values) {
      const query = typeof input === 'string' ? { sql: input, values } : input;
      const result = await pool.query({
        text: postgresParameters(query.sql), values: query.values,
        query_timeout: query.timeout ?? 20_000,
        types: { getTypeParser(oid, format) {
          return [1082, 1114, 1184].includes(oid) ? (value) => value : types.getTypeParser(oid, format);
        } },
      });
      return [result.rows, result.fields.map((field) => ({ ...field, type: field.dataTypeID }))];
    },
    end: () => pool.end(),
  };
}

export const postgresqlDialect = {
  code: 'POSTGRESQL',
  quoteIdentifier: (name) => quoteIdentifier(name, '"'),
  classifyColumnType,
  prepareSql: postgresParameters,
  countDistinct: (expression) => `COUNT(DISTINCT ${expression})`,
  limitClause: () => 'LIMIT ?',
  timeGrainExpr(column, grain) {
    const formats = { DAY: 'YYYY-MM-DD', MONTH: 'YYYY-MM', QUARTER: 'YYYY-"Q"Q', YEAR: 'YYYY' };
    const normalized = String(grain ?? '').toUpperCase();
    if (normalized === 'WEEK') return `to_char(date_trunc('week', ${column}::timestamp), 'YYYY-MM-DD')`;
    return formats[normalized] ? `to_char(${column}::timestamp, '${formats[normalized]}')` : column;
  },
  metadataSql(kind) {
    if (kind === 'schemas') return `SELECT schema_name FROM information_schema.schemata
      WHERE schema_name <> 'information_schema' AND schema_name !~ '^pg_' ORDER BY schema_name`;
    if (kind === 'tables') return `
      SELECT t.table_name AS "tableName", t.table_type AS "tableType",
             COALESCE(obj_description(c.oid, 'pg_class'), '') AS "tableComment",
             GREATEST(c.reltuples, 0) AS "approxRows"
      FROM information_schema.tables t
      JOIN pg_namespace n ON n.nspname = t.table_schema
      JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = t.table_name
      WHERE t.table_schema = ? ORDER BY c.reltuples DESC, t.table_name`;
    if (kind === 'columns') return `
      SELECT a.attnum AS "ordinalPosition", a.attname AS "columnName",
             format_type(a.atttypid, NULL) AS "dataType",
             format_type(a.atttypid, a.atttypmod) AS "columnType",
             CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS "isNullable",
             COALESCE(col_description(c.oid, a.attnum), '') AS "columnComment"
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ? AND c.relname = ? AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`;
    throw new Error(`unsupported metadata kind: ${kind}`);
  },
  createPool(source, password) {
    let pg;
    try { pg = require('pg'); } catch (cause) {
      throw new Error('pg 驱动未安装：PostgreSQL 数据源需要先执行 npm install --no-save pg', { cause });
    }
    return adaptPostgresPool(new pg.Pool(postgresPoolOptions(source, password)), pg.types);
  },
};

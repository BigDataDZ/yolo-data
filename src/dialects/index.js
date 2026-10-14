import { mysqlDialect } from './mysql.js';
import { postgresqlDialect } from './postgresql.js';

const PORTS = { MYSQL: 3306, TIDB: 4000, DORIS: 9030, POSTGRESQL: 5432 };

export function normalizeDbType(value = 'DORIS') {
  const code = String(value).trim().toUpperCase();
  if (code === 'POSTGRES' || code === 'PG') return 'POSTGRESQL';
  return Object.hasOwn(PORTS, code) ? code : 'MYSQL';
}

export function getDialect(dbType) {
  return normalizeDbType(dbType) === 'POSTGRESQL' ? postgresqlDialect : mysqlDialect;
}

export function normalizeDataSource(payload) {
  const dbType = normalizeDbType(payload.dbType);
  if (dbType === 'POSTGRESQL' && !String(payload.databaseName ?? '').trim()) {
    throw Object.assign(new Error('PostgreSQL 数据源必须指定连接数据库，数据集的 schema 单独配置'), { statusCode: 400 });
  }
  const port = Number(payload.port ?? PORTS[dbType]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error('数据源端口必须为 1–65535 的整数'), { statusCode: 400 });
  }
  return { ...payload, dbType, port };
}

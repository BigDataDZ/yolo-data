// 演示数据的 SQL / CSV 组装：表结构与演示数据都来自 config/demo 下的 schema，
// 口径只维护一份，导出与「启动自动建表灌数」共用同一套渲染逻辑。

import fs from 'node:fs';

const SCHEMA_URL = new URL('../../config/demo/ads_sale_detail.schema.json', import.meta.url);

export function loadDemoSchema() {
  return JSON.parse(fs.readFileSync(SCHEMA_URL, 'utf8'));
}

function quoteName(name, dbType) {
  return dbType === 'MYSQL' || dbType === 'DORIS' ? `\`${name}\`` : `"${name}"`;
}

function escapeLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

// Doris 用用户给的原表结构（DUPLICATE KEY + INVERTED 索引）；
// MySQL 侧去掉 OLAP 语法，换成 InnoDB + 普通索引，便于本地一键演示。
export function buildCreateTableSql(schema = loadDemoSchema(), { dbType = 'MYSQL' } = {}) {
  const dialect = String(dbType).toUpperCase() === 'DORIS' ? 'DORIS' : 'MYSQL';
  const columns = schema.columns.map((column) => {
    const nullable = column.nullable === false ? 'NOT NULL' : 'NULL';
    const comment = String(column.comment ?? '').replace(/'/g, "''");
    return `  ${quoteName(column.name, dialect)} ${column.type} ${nullable} COMMENT '${comment}'`;
  });
  const tail = dialect === 'DORIS'
    ? [
      '  INDEX idx_customer_name (`customer_name`) USING INVERTED',
      '  INDEX idx_bloc_name (`bloc_name`) USING INVERTED',
      '  INDEX idx_sdt (`sales_date`) USING INVERTED',
    ]
    : [
      '  KEY `idx_customer_name` (`customer_name`(64))',
      '  KEY `idx_bloc_name` (`bloc_name`(64))',
      '  KEY `idx_sdt` (`sales_date`)',
    ];
  const body = [...columns, ...tail].join(',\n');
  if (dialect === 'DORIS') {
    return `CREATE TABLE IF NOT EXISTS ${quoteName(schema.table, dialect)} (\n${body}\n) `
      + `ENGINE=OLAP\nDUPLICATE KEY(\`sales_date\`)\nCOMMENT '${schema.comment ?? ''}'`;
  }
  return `CREATE TABLE IF NOT EXISTS ${quoteName(schema.table, dialect)} (\n${body}\n) `
    + `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='${schema.comment ?? ''}'`;
}

export function buildInsertStatements(schema, rows, { batchSize = 200, dbType = 'MYSQL' } = {}) {
  const dialect = String(dbType).toUpperCase() === 'DORIS' ? 'DORIS' : 'MYSQL';
  const columns = schema.columns.map((column) => column.name);
  const head = `INSERT INTO ${quoteName(schema.table, dialect)} `
    + `(${columns.map((name) => quoteName(name, dialect)).join(', ')}) VALUES`;
  const size = Math.max(1, Math.min(Number(batchSize) || 200, 1000));
  const statements = [];
  for (let offset = 0; offset < rows.length; offset += size) {
    const slice = rows.slice(offset, offset + size);
    const values = slice.map((row) => (
      `  (${columns.map((name) => escapeLiteral(row[name])).join(', ')})`
    )).join(',\n');
    statements.push(`${head}\n${values};`);
  }
  return statements;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(schema, rows) {
  const columns = schema.columns.map((column) => column.name);
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((name) => csvCell(row[name])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function buildDemoSqlScript(schema, rows, { dbType = 'MYSQL', dropTable = true } = {}) {
  const lines = [
    `-- YOLO Data 演示数据：${schema.comment ?? schema.table}`,
    `-- 生成行数：${rows.length}；方言：${String(dbType).toUpperCase()}`,
    '',
  ];
  if (dropTable) {
    lines.push(`DROP TABLE IF EXISTS ${quoteName(schema.table, dbType)};`, '');
  }
  lines.push(`${buildCreateTableSql(schema, { dbType })};`, '');
  lines.push(...buildInsertStatements(schema, rows, { dbType }));
  return `${lines.join('\n')}\n`;
}

export default { loadDemoSchema, buildCreateTableSql, buildInsertStatements, toCsv, buildDemoSqlScript };

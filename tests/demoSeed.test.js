import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSalesRows } from '../config/demo/salesDemoData.mjs';
import {
  buildCreateTableSql,
  buildDemoSqlScript,
  buildInsertStatements,
  loadDemoSchema,
  toCsv,
} from '../src/demo/demoSql.js';

const schema = loadDemoSchema();

test('演示数据：行数、日期区间与确定性', () => {
  const rows = generateSalesRows({ rows: 500, startDate: '2025-01-01', endDate: '2025-12-31' });
  assert.equal(rows.length, 500);
  assert.equal(rows[0].sales_date.startsWith('2025-01-01'), true);
  const last = rows[rows.length - 1].sales_date;
  assert.equal(last <= '2025-12-31', true);
  const again = generateSalesRows({ rows: 500, startDate: '2025-01-01', endDate: '2025-12-31' });
  assert.deepEqual(again, rows, '同一 seed 必须产出同一批数据');
  const shuffled = generateSalesRows({ rows: 500, startDate: '2025-01-01', endDate: '2025-12-31', seed: 7 });
  assert.notDeepEqual(shuffled[0], rows[0], '换 seed 应当产出不同数据');
});

test('演示数据：列与 schema 严格对齐', () => {
  const rows = generateSalesRows({ rows: 50 });
  const expected = schema.columns.map((column) => column.name);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), expected);
  }
});

test('演示数据：金额口径自洽', () => {
  const rows = generateSalesRows({ rows: 300 });
  for (const row of rows) {
    assert.equal(row.sale_amt, Number((row.sale_qty * row.sale_price).toFixed(6)));
    assert.equal(row.sale_cost, Number((row.sale_qty * row.cost_price).toFixed(6)));
    assert.equal(row.profit, Number((row.sale_amt - row.sale_cost).toFixed(6)));
    assert.equal(row.sale_amt_no_tax, Number((row.sale_amt / (1 + row.tax_rate)).toFixed(6)));
    assert.equal(row.tax_amt, Number((row.sale_amt - row.sale_amt_no_tax).toFixed(6)));
    assert.equal(row.profit_no_tax, Number((row.sale_amt_no_tax - row.sale_cost_no_tax).toFixed(6)));
    assert.ok(row.profit > 0, '演示数据应当全部有毛利');
  }
});

test('演示数据：客户与商品维度规模符合预期', () => {
  const rows = generateSalesRows({ rows: 2000 });
  assert.equal(new Set(rows.map((row) => row.customer_code)).size, 8);
  assert.ok(new Set(rows.map((row) => row.goods_code)).size >= 15);
});

test('演示数据：MySQL 与 Doris 建表语句差异正确', () => {
  const mysql = buildCreateTableSql(schema, { dbType: 'MYSQL' });
  const doris = buildCreateTableSql(schema, { dbType: 'DORIS' });
  assert.match(mysql, /ENGINE=InnoDB/);
  assert.doesNotMatch(mysql, /DUPLICATE KEY/);
  assert.doesNotMatch(mysql, /USING INVERTED/);
  assert.match(doris, /ENGINE=OLAP/);
  assert.match(doris, /DUPLICATE KEY\(`sales_date`\)/);
  for (const column of schema.columns) {
    assert.ok(mysql.includes(`\`${column.name}\``), `MySQL DDL 缺少 ${column.name}`);
    assert.ok(doris.includes(`\`${column.name}\``), `Doris DDL 缺少 ${column.name}`);
  }
});

test('演示数据：INSERT 分批与占位值个数正确', () => {
  const rows = generateSalesRows({ rows: 120 });
  const statements = buildInsertStatements(schema, rows, { batchSize: 50, dbType: 'MYSQL' });
  assert.equal(statements.length, 3);
  const first = statements[0];
  const tuples = first.split('\n').filter((line) => line.trim().startsWith('('));
  assert.equal(tuples.length, 50);
  for (const tuple of tuples) {
    // 去掉行尾用于拼接的逗号/分号，只看元组本身的值个数。
    const inner = tuple.trim().replace(/^\(/, '').replace(/\)[,;]?$/, '');
    assert.equal((inner.match(/,/g) ?? []).length, schema.columns.length - 1);
  }
  const script = buildDemoSqlScript(schema, rows, { dbType: 'DORIS' });
  assert.match(script, /DROP TABLE IF EXISTS `ads_sale_detail`;/);
  assert.doesNotMatch(script, /undefined|NaN/);
});

test('演示数据：CSV 表头与转义', () => {
  const rows = generateSalesRows({ rows: 5 });
  const csv = toCsv(schema, rows);
  const lines = csv.trimEnd().split('\n');
  assert.equal(lines.length, 6);
  assert.equal(lines[0].split(',').length, schema.columns.length);
  assert.equal(csv.includes('"'), false, '当前维度池不应触发引号转义');
});

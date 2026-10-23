// 导出演示数据：CSV（通用）+ MySQL/Doris 两版 INSERT 脚本。
// 用法：
//   node scripts/demo-export.mjs --rows 5000 --out data/demo
//   node scripts/demo-export.mjs --rows 500 --start 2025-01-01 --end 2025-12-31
// 生成结果在 data/ 下（已被 .gitignore 忽略），不会污染仓库。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSalesRows } from '../config/demo/salesDemoData.mjs';
import {
  buildCreateTableSql,
  buildDemoSqlScript,
  buildInsertStatements,
  loadDemoSchema,
  toCsv,
} from '../src/demo/demoSql.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : 'true';
    args[key] = value;
  }
  return args;
}

const args = readArgs(process.argv.slice(2));
const schema = loadDemoSchema();
const rows = generateSalesRows({
  rows: Number(args.rows ?? 5000),
  startDate: args.start,
  endDate: args.end,
  seed: args.seed ? Number(args.seed) : undefined,
});
const outDir = path.resolve(projectRoot, args.out ?? path.join('data', 'demo'));
fs.mkdirSync(outDir, { recursive: true });

const files = [];
const csvPath = path.join(outDir, `${schema.table}.csv`);
fs.writeFileSync(csvPath, toCsv(schema, rows), 'utf8');
files.push(csvPath);

if (String(args.format ?? 'both') !== 'csv') {
  const mysqlPath = path.join(outDir, `${schema.table}.mysql.sql`);
  fs.writeFileSync(mysqlPath, buildDemoSqlScript(schema, rows, { dbType: 'MYSQL' }), 'utf8');
  files.push(mysqlPath);

  const dorisPath = path.join(outDir, `${schema.table}.doris.sql`);
  fs.writeFileSync(dorisPath, buildDemoSqlScript(schema, rows, { dbType: 'DORIS' }), 'utf8');
  files.push(dorisPath);

  const ddlPath = path.join(outDir, `${schema.table}.ddl.sql`);
  fs.writeFileSync(ddlPath, [
    '-- MySQL 版建表语句',
    `${buildCreateTableSql(schema, { dbType: 'MYSQL' })};`,
    '',
    '-- Doris 版建表语句',
    `${buildCreateTableSql(schema, { dbType: 'DORIS' })};`,
    '',
  ].join('\n'), 'utf8');
  files.push(ddlPath);
}

const totalAmount = rows.reduce((sum, row) => sum + row.sale_amt, 0);
const totalProfit = rows.reduce((sum, row) => sum + row.profit, 0);
const statements = buildInsertStatements(schema, rows, { batchSize: 200 });

console.log(`已生成 ${rows.length} 行演示数据（${rows[0]?.sales_date} ~ ${rows[rows.length - 1]?.sales_date}）`);
console.log(`客户 ${new Set(rows.map((row) => row.customer_code)).size} 个 / 商品 ${new Set(rows.map((row) => row.goods_code)).size} 个 / 字段 ${schema.columns.length} 列`);
console.log(`含税销售额 ${totalAmount.toFixed(2)} 元，毛利 ${totalProfit.toFixed(2)} 元（${(totalProfit / totalAmount * 100).toFixed(2)}%）`);
console.log(`INSERT 批次 ${statements.length} 条`);
for (const file of files) {
  const size = fs.statSync(file).size;
  console.log(`  ${path.relative(projectRoot, file)}  ${(size / 1024).toFixed(1)} KB`);
}

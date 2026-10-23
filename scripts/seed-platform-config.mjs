#!/usr/bin/env node
// Import the checked-in configuration snapshot on first MySQL initialization.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { createMysqlPlatformStore } from '../src/platformDatabase.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotPath = path.join(root, 'config', 'bootstrap', 'platform-seed.json');
const snapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
const allowedTables = new Set([
  'app_users', 'models', 'skills', 'platform_settings', 'data_sources',
  'business_datasets', 'dataset_fields', 'themes', 'indicator_types',
  'local_indicators', 'theme_skills', 'theme_indicators', 'user_theme_grants',
  'user_dataset_grants', 'user_indicator_grants', 'row_policies',
  'column_policies', 'semantic_value_domains', 'semantic_value_overrides',
  'semantic_value_snapshots', 'semantic_value_snapshot_items',
  'theme_semantic_value_domains',
]);
const forbiddenColumns = /(?:password|secret|api.?key|access.?token|refresh.?token|last_test_(?:at|ok|message))/i;
for (const [table, rows] of Object.entries(snapshot.tables ?? {})) {
  if (!allowedTables.has(table) || !Array.isArray(rows)) {
    throw new Error(`初始化快照包含不允许的表：${table}`);
  }
  for (const row of rows) {
    if (Object.keys(row).some((column) => forbiddenColumns.test(column))) {
      throw new Error(`初始化快照 ${table} 包含凭据或运行态字段，拒绝导入。`);
    }
  }
}
const config = loadConfig().platformDatabase;
if (config.backend !== 'mysql') throw new Error('platform-seed import currently requires PLATFORM_DB_BACKEND=mysql');
const store = createMysqlPlatformStore(config);
await store.connect();
try {
  await store.initialize(config.mysql.initSqlPath);
  const rowCounts = await Promise.all(Object.keys(snapshot.tables).map(async (table) => {
    const [row] = await store.query(`SELECT COUNT(*) AS count FROM \u0060${table}\u0060`);
    return Number(row?.count ?? 0);
  }));
  if (rowCounts.some((count) => count > 0)) {
    console.log('平台配置表已有数据，跳过初始化导入。');
    process.exitCode = 0;
  } else {
    await store.transaction(async (tx) => {
      for (const [table, rows] of Object.entries(snapshot.tables)) {
        for (const row of rows) {
          const columns = Object.keys(row);
          if (columns.length === 0) continue;
          const placeholders = columns.map(() => '?').join(', ');
          const names = columns.map((column) => `\u0060${column.replaceAll('\u0060', '\u0060\u0060')}\u0060`).join(', ');
          const values = columns.map((column) => row[column] instanceof Date
            ? row[column].toISOString().slice(0, 19).replace('T', ' ')
            : row[column]);
          await tx.execute(`INSERT INTO \u0060${table}\u0060 (${names}) VALUES (${placeholders})`, values);
        }
      }
    });
    console.log('平台配置初始化完成（不含凭据、日志及 ads_sale_detail）。');
  }
} finally {
  await store.close();
}

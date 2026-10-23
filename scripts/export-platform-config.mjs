#!/usr/bin/env node
// Export portable platform configuration. Runtime history, logs, sessions,
// secrets, and the demo fact table are deliberately excluded.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { loadConfig } from '../src/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'config', 'bootstrap', 'platform-seed.json');
const tables = [
  'app_users', 'models', 'skills', 'platform_settings',
  'data_sources', 'business_datasets', 'dataset_fields',
  'themes', 'indicator_types', 'local_indicators',
  'theme_skills', 'theme_indicators', 'user_theme_grants',
  'user_dataset_grants', 'user_indicator_grants', 'row_policies',
  'column_policies',
  'semantic_value_domains', 'semantic_value_overrides',
  'semantic_value_snapshots', 'semantic_value_snapshot_items',
  'theme_semantic_value_domains',
];
const omittedColumns = new Set([
  'password_hash', 'encrypted_password', 'api_key_encrypted',
  'last_test_at', 'last_test_ok', 'last_test_message',
]);

function scrub(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ');
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/(?:password|secret|api.?key|access.?token|refresh.?token)/i.test(key))
      .map(([key, item]) => [key, scrub(item)]));
  }
  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
    try { return JSON.stringify(scrub(JSON.parse(value))); } catch { /* keep non-JSON text */ }
  }
  return value;
}

const config = loadConfig().platformDatabase;
const connection = await mysql.createConnection({
  host: config.mysql.host, port: config.mysql.port,
  user: config.mysql.user, password: config.mysql.password,
  database: config.mysql.database, charset: config.mysql.charset,
});
try {
  const tablesData = {};
  for (const table of tables) {
    const [rows] = await connection.query('SELECT * FROM ?? ORDER BY 1', [table]);
    tablesData[table] = rows.map((row) => Object.fromEntries(
      Object.entries(row)
        .filter(([key]) => !omittedColumns.has(key.toLowerCase()))
        .map(([key, value]) => [key, scrub(value)]),
    )).map((row) => table === 'data_sources' ? { ...row, encrypted_password: '' } : row);
  }
  const snapshot = {
    format: 1,
    generatedAt: new Date().toISOString(),
    sourceDatabase: config.mysql.database,
    excluded: ['ads_sale_detail', 'logs', 'audit/history', 'sessions', 'workspaces', 'credentials'],
    tables: tablesData,
  };
  await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`已导出 ${tables.length} 张配置表到 ${path.relative(root, outputPath)}（凭据与运行日志已排除）。`);
} finally {
  await connection.end();
}

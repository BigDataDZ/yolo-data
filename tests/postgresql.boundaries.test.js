import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import test from 'node:test';
import { getDialect } from '../src/dialects/index.js';
import { adaptPostgresPool, postgresPoolOptions } from '../src/dialects/postgresql.js';
import { dialectDataset } from './fixtures/dialectDataset.js';

const enabled = Boolean(process.env.YOLO_PG_TEST_DATABASE);
function source(overrides = {}) {
  return {
    dbType: 'POSTGRESQL', host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432), username: process.env.PGUSER,
    databaseName: process.env.YOLO_PG_TEST_DATABASE, ...overrides,
  };
}
const password = process.env.PGPASSWORD ?? '';

test('live PG preserves bigint and numeric strings beyond Number precision', { skip: !enabled }, async () => {
  const pool = getDialect('PG').createPool(source(), password);
  try {
    const [rows] = await pool.query(`SELECT '9007199254740993'::bigint AS large_id,
      '9007199254740993.123456789'::numeric AS precise_amount`);
    assert.equal(rows[0].large_id, '9007199254740993');
    assert.equal(rows[0].precise_amount, '9007199254740993.123456789');
    const { default: pg } = await import('pg');
    const setup = new pg.Pool({ database: process.env.YOLO_PG_TEST_DATABASE });
    const schema = `yolo_precision_${process.pid}_${Date.now()}`;
    try {
      await setup.query(`CREATE SCHEMA "${schema}"`);
      await setup.query(`CREATE TABLE "${schema}".sales(amount numeric(40,9))`);
      await setup.query(`INSERT INTO "${schema}".sales VALUES ('9007199254740993.123456789'), ('0.000000001')`);
      const { service } = dialectDataset('POSTGRESQL', schema);
      service.getPoolById = () => pool;
      const result = await service.executeQuery({ datasetId: 1, request: { metrics: ['amount'] }, userId: 1 });
      assert.equal(result.rows[0].amount, '9007199254740993.123456790');
    } finally {
      await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await setup.end();
    }
  } finally { await pool.end(); }
});

test('live PG rejects bad credentials/database, cancels slow queries and remains usable', { skip: !enabled }, async () => {
  const dialect = getDialect('PG');
  for (const [settings, credential, code] of [
    [source(), `${password}_invalid`, '28P01'],
    [source({ databaseName: `missing_${Date.now()}` }), password, '3D000'],
    [source({ port: 1 }), password, 'ECONNREFUSED'],
  ]) {
    const pool = dialect.createPool(settings, credential);
    try { await assert.rejects(() => pool.query('SELECT 1'), { code }); }
    finally { await pool.end(); }
  }
  const pool = dialect.createPool(source(), password);
  try {
    await pool.query("SET statement_timeout = '30ms'");
    await assert.rejects(() => pool.query('SELECT pg_sleep(1)'), { code: '57014' });
    assert.equal((await pool.query('SELECT 1 AS healthy'))[0][0].healthy, 1);
    await pool.query("SET statement_timeout = '20s'");
    await assert.rejects(() => pool.query({ sql: 'SELECT pg_sleep(0.2)', timeout: 30 }), /timeout/i);
    assert.equal((await pool.query('SELECT 1 AS recovered'))[0][0].recovered, 1);
  } finally { await pool.end(); }
});

test('live PG replaces an idle connection terminated by the server', { skip: !enabled }, async () => {
  const { default: pg } = await import('pg');
  const raw = new pg.Pool(postgresPoolOptions(source(), password));
  const pool = adaptPostgresPool(raw, pg.types);
  const admin = new pg.Pool({ database: process.env.YOLO_PG_TEST_DATABASE });
  try {
    const [rows] = await pool.query('SELECT pg_backend_pid() AS pid');
    const disconnected = once(raw, 'error', { signal: AbortSignal.timeout(5000) });
    await admin.query('SELECT pg_terminate_backend($1)', [rows[0].pid]);
    const [error] = await disconnected;
    assert.match(error.message, /terminat|connection/i);
    const [replacement] = await pool.query('SELECT pg_backend_pid() AS pid');
    assert.notEqual(replacement[0].pid, rows[0].pid);
  } finally { await pool.end(); await admin.end(); }
});

test('live PG TLS verifies trusted CA and refuses an untrusted server certificate', {
  skip: !enabled || !process.env.YOLO_PG_TEST_CA,
}, async () => {
  const dialect = getDialect('PG');
  const ca = fs.readFileSync(process.env.YOLO_PG_TEST_CA, 'utf8');
  const trusted = dialect.createPool(source({ options: { ssl: { ca } } }), password);
  try {
    const [rows] = await trusted.query('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
    assert.equal(rows[0].ssl, true);
  } finally { await trusted.end(); }
  const untrusted = dialect.createPool(source({ options: { ssl: true } }), password);
  try {
    await assert.rejects(() => untrusted.query('SELECT 1'), (error) => (
      /certificate|self.signed|issuer/i.test(error.message)
    ));
  } finally { await untrusted.end(); }
});

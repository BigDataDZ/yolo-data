import assert from 'node:assert/strict';
import test from 'node:test';
import { getDialect } from '../src/dialects/index.js';
import { dialectDataset, dialectRequest } from './fixtures/dialectDataset.js';

// Opt-in only: point at a disposable test database. Never use a business DB.
test('live PostgreSQL: discover metadata, execute scoped aggregation, sample and profile', {
  skip: !process.env.YOLO_PG_TEST_DATABASE,
}, async () => {
  const { default: pg } = await import('pg');
  const databaseName = process.env.YOLO_PG_TEST_DATABASE;
  const schemaName = `yolo_test_${process.pid}_${Date.now()}`;
  const setup = new pg.Pool({ database: databaseName });
  const { service, source, dataset, fields } = dialectDataset('POSTGRESQL', schemaName);
  const pgDialect = getDialect('PG');
  Object.assign(source, {
    host: process.env.PGHOST ?? 'localhost', port: Number(process.env.PGPORT ?? 5432),
    username: process.env.PGUSER, databaseName,
  });
  const pool = pgDialect.createPool(source, process.env.PGPASSWORD ?? '');
  service.getPool = () => pool;
  service.getPoolById = () => pool;
  try {
    await setup.query(`CREATE SCHEMA "${schemaName}"`);
    await setup.query(`CREATE TABLE "${schemaName}".sales (day date, region text, order_id text, amount numeric(12,2))`);
    await setup.query(`INSERT INTO "${schemaName}".sales VALUES
      ('2026-01-04','east','a',10), ('2026-01-05','west','b',20), ('2026-02-01','east','c',30)`);
    const schemas = await service.listDatabases(1);
    assert.ok(schemas.includes(schemaName));
    const tables = await service.listTables(1, schemaName);
    assert.equal(tables[0].tableName, 'sales');
    const columns = await service.listColumns(1, schemaName, 'sales');
    assert.deepEqual(columns.map((column) => column.columnName), ['day', 'region', 'order_id', 'amount']);
    const result = await service.executeQuery({ datasetId: 1, request: dialectRequest, userId: 1 });
    assert.deepEqual(result.rows.map((row) => [row.day, Number(row.east_amount), Number(row.orders)]), [['2026-01', 10, 2], ['2026-02', 30, 1]]);
    for (const [grain, keys] of Object.entries({
      DAY: ['2026-01-04', '2026-01-05', '2026-02-01'],
      WEEK: ['2025-12-29', '2026-01-05', '2026-01-26'],
      MONTH: ['2026-01', '2026-02'], QUARTER: ['2026-Q1'], YEAR: ['2026'],
    })) {
      const query = service.buildQuery(1, { dimensions: ['day'], timeGrain: grain, metrics: ['amount'], order: [{ field: 'day', direction: 'ASC' }] });
      assert.deepEqual((await pool.query(query))[0].map((row) => row.day), keys);
    }
    const ordered = service.buildQuery(1, { ...dialectRequest, order: [{ field: 'amount', direction: 'DESC' }] });
    assert.equal((await pool.query(ordered))[0][0].day, '2026-02');
    const sample = await service.sampleDataset(1, 2);
    assert.equal(sample.rows.length, 2);
    const ranges = await service.listFieldRanges(service.getDataset(1), service.getDatasetFields(1));
    assert.equal(ranges.day.min, '2026-01-04');
    assert.equal(ranges.day.max, '2026-02-01');
    assert.deepEqual((await service.listDistinctFieldValues(1, 'region')).sort(), ['east', 'west']);
    assert.equal((await service.sampleForProfiling(dataset, fields, 2)).rows.length, 2);
    dataset.config.autoLatestDateRange = true;
    const latest = await service.executeQuery({ datasetId: 1, request: { metrics: ['amount'] }, userId: 1 });
    assert.equal(Number(latest.rows[0].amount), 60);
    assert.match(latest.sql, /"day" >= \$1 AND "day" <= \$2/);
    await assert.rejects(() => pool.query(`DELETE FROM "${schemaName}".sales`), /read.only/i);
  } finally {
    await pool.end();
    await setup.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await setup.end();
  }
});

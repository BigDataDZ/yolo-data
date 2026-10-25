import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PlatformDatabase } from '../src/database.js';
import { BusinessDatasetService } from '../src/businessDatasets.js';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'async-dataset-'));
  const database = new PlatformDatabase(path.join(directory, 'test.db'));
  t.after(async () => { await database.closeAsync(); fs.rmSync(directory, { recursive: true, force: true }); });
  const source = database.saveDataSource({ code: 'async_source', name: 'Async source', dbType: 'MYSQL', host: 'unused' });
  const dataset = database.saveBusinessDataset({ code: 'async_sales', name: 'Async sales', datasourceId: source.id,
    schemaName: 'main', primaryTable: 'async_sales_fixture', config: { autoLatestDateRange: false } });
  database.replaceDatasetFields(dataset.id, [
    { fieldName: 'region', displayName: 'Region', semanticType: 'STRING', role: 'DIMENSION', aggregator: 'NONE' },
    { fieldName: 'sales', displayName: 'Sales', semanticType: 'NUMBER', role: 'METRIC', aggregator: 'SUM' },
    { fieldName: 'hidden', role: 'METRIC', aggregator: 'SUM', enabled: false },
  ]);
  database.db.exec("CREATE TABLE async_sales_fixture(region TEXT, sales REAL, hidden REAL); INSERT INTO async_sales_fixture VALUES ('East',10,1),('East',20,2),('West',5,3)");
  const fail = () => { throw new Error('synchronous metadata fallback forbidden'); };
  const adapter = { isAsyncPlatformStore: true,
    getBusinessDatasetAsync: (...args) => database.getBusinessDatasetAsync(...args),
    listDatasetFieldsAsync: (...args) => database.listDatasetFieldsAsync(...args),
    logDatasetQueryAsync: (...args) => database.logDatasetQueryAsync(...args),
    getBusinessDataset: fail, listDatasetFields: fail,
  };
  const service = new BusinessDatasetService({ database: adapter, crypto: {}, config: {} });
  let queries = 0;
  service.getPoolByIdAsync = async () => ({ async query({ sql, values }) {
    queries++;
    const statement = database.db.prepare(sql);
    return [statement.all(...values), statement.columns()];
  } });
  return { database, service, dataset, queries: () => queries };
}

test('async-only metadata can compile and execute aggregate queries with limit probing', async t => {
  const { database, service, dataset, queries } = fixture(t);
  const result = await service.executeQuery({ datasetId: dataset.id,
    request: { metrics: ['sales'], dimensions: ['region'], order: [{ field: 'region', direction: 'ASC' }], limit: 1 } });
  assert.deepEqual(result.rows.map(row => ({ ...row })), [{ region: 'East', sales: 30 }]);
  assert.equal(result.truncated, true);
  assert.equal(result.limit, 1);
  assert.equal(result.columns.find(column => column.bizName === 'sales').role, 'METRIC');
  assert.equal(queries(), 1);
  assert.equal(database.listDatasetQueryLogs()[0].success, true);
});

test('async metadata excludes disabled fields and query failures retain failure logs', async t => {
  const { database, service, dataset, queries } = fixture(t);
  await assert.rejects(service.executeQuery({ datasetId: dataset.id, request: { metrics: ['hidden'] } }), /metric field not found/);
  assert.equal(queries(), 0);
  database.db.exec('DROP TABLE async_sales_fixture');
  await assert.rejects(service.executeQuery({ datasetId: dataset.id, request: { metrics: ['sales'] } }), /no such table/);
  assert.equal(queries(), 1);
  assert.equal(database.listDatasetQueryLogs()[0].success, false);
  assert.match(database.listDatasetQueryLogs()[0].errorMessage, /no such table/);
});

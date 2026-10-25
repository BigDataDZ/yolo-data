import assert from 'node:assert/strict';
import test from 'node:test';
import { initializePlatformDatabase } from '../src/platformDatabase.js';
import { BusinessDatasetService } from '../src/businessDatasets.js';

const databaseName = process.env.YOLO_MYSQL_UPLOAD_TEST_DATABASE;
test('live MySQL platform compiles and executes business queries without synchronous metadata', { skip: !databaseName }, async t => {
  const connection = {
    host: process.env.YOLO_MYSQL_UPLOAD_TEST_HOST ?? '127.0.0.1',
    port: Number(process.env.YOLO_MYSQL_UPLOAD_TEST_PORT ?? 3306), database: databaseName,
    user: process.env.YOLO_MYSQL_UPLOAD_TEST_USER ?? 'root',
    password: process.env.YOLO_MYSQL_UPLOAD_TEST_PASSWORD ?? 'test',
  };
  const platform = await initializePlatformDatabase({ backend: 'mysql', mysql: connection });
  const database = platform.database;
  const service = new BusinessDatasetService({ database, crypto: { decrypt: value => value }, config: {} });
  let sourceId, datasetId;
  t.after(async () => {
    try {
      await service.close();
      if (datasetId) await database.deleteBusinessDatasetAsync(datasetId);
      if (sourceId) await database.dataSourceRepository.deleteDataSourceAsync(sourceId);
      await database.execute('DROP TABLE IF EXISTS async_query_acceptance');
    }
    finally { await platform.close(); }
  });
  await database.execute('CREATE TABLE async_query_acceptance (region VARCHAR(20), sales DECIMAL(10,2), hidden INT)');
  await database.execute("INSERT INTO async_query_acceptance VALUES ('East',10,1),('East',20,2),('West',5,3)");
  const source = await database.dataSourceRepository.saveDataSourceAsync({ code: 'async_query_source', name: 'Async query',
    dbType: 'MYSQL', host: connection.host, port: connection.port, databaseName,
    username: connection.user, encryptedPassword: connection.password });
  sourceId = source.id;
  const dataset = await database.saveBusinessDatasetAsync({ code: 'async_query_dataset', name: 'Async query dataset',
    datasourceId: source.id, schemaName: databaseName, primaryTable: 'async_query_acceptance',
    config: { autoLatestDateRange: false } });
  datasetId = dataset.id;
  await database.replaceDatasetFieldsAsync(dataset.id, [
    { fieldName: 'region', role: 'DIMENSION', semanticType: 'STRING', aggregator: 'NONE' },
    { fieldName: 'sales', role: 'METRIC', semanticType: 'NUMBER', aggregator: 'SUM' },
    { fieldName: 'hidden', role: 'METRIC', aggregator: 'SUM', enabled: false },
  ]);
  const userId = (await database.listUsersAsync()).find(user => user.username === 'admin').id;
  const result = await service.executeQuery({ datasetId: dataset.id, userId, request: {
    metrics: ['sales'], dimensions: ['region'], order: [{ field: 'region', direction: 'ASC' }], limit: 1,
  } });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].region, 'East');
  assert.equal(Number(result.rows[0].sales), 30);
  assert.equal(result.truncated, true);
  assert.equal(result.columns.find(column => column.bizName === 'sales').role, 'METRIC');
  await assert.rejects(service.executeQuery({ datasetId: dataset.id, userId, request: { metrics: ['hidden'] } }), /metric field not found/);
  const logs = await database.listDatasetQueryLogsAsync();
  assert.ok(logs.some(log => Number(log.datasetId) === Number(dataset.id) && log.success));
});

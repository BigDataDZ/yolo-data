import assert from 'node:assert/strict';
import test from 'node:test';
import { PlatformDatabase } from '../src/database.js';
import { BusinessDatasetService } from '../src/businessDatasets.js';

function fixture(t, status = 0) {
  const database = new PlatformDatabase(':memory:');
  const service = new BusinessDatasetService({ database, crypto: {}, config: {} });
  const source = database.saveDataSource({
    code: 'guarded', name: 'Guarded', dbType: 'MYSQL', host: 'never-connect.invalid',
    port: 3306, databaseName: 'analytics', username: 'reader', status,
  });
  const dataset = database.saveBusinessDataset({
    code: 'sales', name: 'Sales', datasourceId: source.id,
    schemaName: 'analytics', primaryTable: 'sales', status: 1,
  });
  database.replaceDatasetFields(dataset.id, [{
    fieldName: 'amount', displayName: 'Amount', dataType: 'decimal',
    semanticType: 'NUMBER', role: 'METRIC', aggregator: 'SUM', enabled: true,
  }]);
  const calls = { created: 0, queried: 0, ended: 0 };
  service.createPool = () => {
    calls.created += 1;
    return {
      query: async () => {
        calls.queried += 1;
        return [[{ amount: 42 }], [{ name: 'amount' }]];
      },
      end: async () => { calls.ended += 1; },
    };
  };
  t.after(async () => { await service.close(); database.close(); });
  const execute = () => service.executeQuery({
    datasetId: dataset.id, request: { metrics: ['amount'] },
  });
  const setStatus = value => database.saveDataSource({ ...source, status: value }, source.id);
  return { database, service, source, dataset, calls, execute, setStatus };
}

function disabled(error) {
  assert.equal(error.statusCode, 403);
  assert.match(error.message, /data source.*disabled/i);
  return true;
}

test('disabled datasource rejects business queries before creating a connection', async t => {
  const { execute, calls } = fixture(t);
  await assert.rejects(execute, disabled);
  assert.equal(calls.created, 0);
  assert.equal(calls.queried, 0);
});

test('disabling a cached datasource denies the next query and re-enabling restores it', async t => {
  const { service, source, calls, execute, setStatus } = fixture(t, 1);
  assert.deepEqual((await execute()).rows, [{ amount: 42 }]);
  setStatus(0);
  await assert.rejects(execute, disabled);
  assert.throws(() => service.getPool(source), disabled);
  assert.equal(calls.created, 1);
  assert.equal(calls.queried, 1);
  setStatus(1);
  assert.deepEqual((await execute()).rows, [{ amount: 42 }]);
  assert.equal(calls.queried, 2);
});

for (const [name, operation] of [
  ['schemas', f => f.service.listDatabases(f.source.id)],
  ['tables', f => f.service.listTables(f.source.id, 'analytics')],
  ['columns', f => f.service.listColumns(f.source.id, 'analytics', 'sales')],
  ['samples', f => f.service.sampleDataset(f.dataset.id)],
  ['distinct values', f => f.service.listDistinctFieldValues(f.dataset.id, 'amount')],
  ['profiling', f => f.service.profileDataset(f.dataset.id)],
]) {
  test(`disabled datasource denies ${name} without connecting`, async t => {
    const f = fixture(t);
    await assert.rejects(() => operation(f), disabled);
    assert.equal(f.calls.created, 0);
    assert.equal(f.calls.queried, 0);
  });
}

test('normal dataset discovery hides disabled sources while admin discovery retains them', t => {
  const { database, service, source, dataset, setStatus } = fixture(t);
  const user = database.getUserByUsername('east_manager');
  database.grantDatasetAccess(user.id, dataset.id, true);
  assert.deepEqual(service.listDatasets(), []);
  assert.deepEqual(service.listDatasets({ userId: user.id }), []);
  assert.equal(service.listDatasets({ includeDisabled: true })[0].id, dataset.id);
  assert.equal(service.listDataSources().find(item => item.id === source.id).status, 0);
  setStatus(1);
  assert.equal(service.listDatasets({ userId: user.id })[0].id, dataset.id);
});

test('admin connection tests remain available for disabled sources', async t => {
  const { service, source, calls } = fixture(t);
  const result = await service.testDataSource(source.id);
  assert.equal(result.lastTestOk, true);
  assert.equal(result.status, 0);
  assert.deepEqual(calls, { created: 1, queried: 1, ended: 1 });
});

test('profiling rejects disablement during sampling instead of hiding the range-query denial', async t => {
  const { database, service, dataset, calls, setStatus } = fixture(t, 1);
  database.replaceDatasetFields(dataset.id, [{
    fieldName: 'ordered_at', displayName: 'Order date', dataType: 'date',
    semanticType: 'DATE', role: 'TIME', enabled: true,
  }]);
  const createPool = service.createPool;
  let releaseSample;
  let samplingStarted;
  const started = new Promise(resolve => { samplingStarted = resolve; });
  service.createPool = source => {
    const pool = createPool(source);
    return {
      ...pool,
      query: async (...args) => {
        const waiting = new Promise(resolve => { releaseSample = resolve; });
        samplingStarted();
        await waiting;
        return pool.query(...args);
      },
    };
  };
  const profiling = service.profileDataset(dataset.id);
  await started;
  setStatus(0);
  releaseSample();
  await assert.rejects(profiling, disabled);
  assert.equal(calls.queried, 1);
});

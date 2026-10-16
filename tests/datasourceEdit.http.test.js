import assert from 'node:assert/strict';
import test from 'node:test';
import { withSkillServer as withServer } from './fixtures/skillServer.js';
import { buildRouteTable } from '../src/server.js';

function withSkillServer(run) {
  return withServer(({ baseUrl, ...fixture }) => run({ ...fixture, request: async (route, { cookie, method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(`${baseUrl}${route}`, { method, headers: {
      'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { response, data: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text };
  } }));
}

const payload = { code: 'editable_pg', name: 'Editable PG', dbType: 'POSTGRESQL',
  host: 'old.example', port: 5432, databaseName: 'analytics', username: 'reader',
  password: 'original-password', options: { ssl: { ca: 'TEST CA' } } };

test('datasource updates reject anonymous and analyst sessions including forged admin headers', async () => {
  await withSkillServer(async ({ application, request, login }) => {
    const source = application.businessDatasets.saveDataSource(payload);
    const before = application.database.getDataSource(source.id);
    const cookie = await login('east_manager');
    for (const [credentials, status] of [[{}, 401], [{ cookie }, 403], [{ cookie, headers: { 'x-user-id': '1' } }, 403]]) {
      const result = await request(`/api/data-sources/${source.id}`, {
        ...credentials, method: 'PUT', body: { name: 'unauthorized' },
      });
      assert.equal(result.response.status, status);
      assert.deepEqual(application.database.getDataSource(source.id), before);
    }
    assert.equal(application.database.listAuditLogs().some(log => log.action === 'DATASOURCE_UPDATE'), false);
  });
});

test('partial datasource edits preserve PostgreSQL configuration and empty passwords, replacing stale pools', async () => {
  await withSkillServer(async ({ application, request, login }) => {
    const service = application.businessDatasets;
    const database = application.database;
    const source = service.saveDataSource(payload);
    database.updateDataSourceTest(source.id, { ok: true, message: 'previous test passed' });
    const ended = [];
    service.createPool = record => ({ host: record.host, end: async () => { ended.push(record.host); } });
    try {
      const oldPool = service.getPool(source);
      const cookie = await login('admin');
      const rename = await request(`/api/data-sources/${source.id}`, {
        cookie, method: 'PUT', body: { name: 'Renamed PG' },
      });
      assert.equal(rename.response.status, 200);
      assert.equal(rename.data.dbType, 'POSTGRESQL');
      assert.equal(rename.data.lastTestOk, true);
      assert.equal(Object.hasOwn(rename.data, 'encryptedPassword'), false);
      const updated = await request(`/api/data-sources/${source.id}`, {
        cookie, method: 'PUT', body: { host: 'new.example', password: '' },
      });
      assert.equal(updated.response.status, 200);
      assert.equal(updated.data.lastTestOk, null);
      assert.equal(updated.data.lastTestAt, null);
      const stored = database.getDataSource(source.id);
      assert.equal(stored.encryptedPassword, source.encryptedPassword);
      assert.equal(stored.databaseName, 'analytics');
      assert.equal(stored.port, 5432);
      assert.equal(stored.username, 'reader');
      assert.equal(stored.code, 'editable_pg');
      assert.deepEqual(stored.options, { ssl: { ca: 'TEST CA' } });
      assert.notEqual(service.getPool(stored), oldPool);
      assert.equal(service.getPool(stored).host, 'new.example');
      assert.ok(ended.includes('old.example'));
      const audit = database.listAuditLogs().filter(log => log.action === 'DATASOURCE_UPDATE');
      assert.equal(audit.length, 2);
      assert.equal(audit[0].userId, database.getUserByUsername('admin').id);
      assert.equal(audit[0].detail.datasourceId, source.id);
      assert.equal(JSON.stringify(audit).includes('original-password'), false);
      assert.equal(JSON.stringify(audit).includes(source.encryptedPassword), false);
    } finally { await service.close(); }
  });
});

test('datasource edits encrypt replacement passwords without exposing credentials or auditing them', async () => {
  await withSkillServer(async ({ application, request, login }) => {
    const source = application.businessDatasets.saveDataSource(payload);
    const cookie = await login('admin');
    const result = await request(`/api/data-sources/${source.id}`, {
      cookie, method: 'PUT', body: { password: 'replacement-password' },
    });
    assert.equal(result.response.status, 200);
    const stored = application.database.getDataSource(source.id);
    assert.notEqual(stored.encryptedPassword, source.encryptedPassword);
    assert.equal(application.datasourceCrypto.decrypt(stored.encryptedPassword), 'replacement-password');
    const exposed = JSON.stringify([result.data, application.database.listAuditLogs()]);
    assert.equal(exposed.includes('replacement-password'), false);
    assert.equal(exposed.includes(stored.encryptedPassword), false);
  });
});

test('invalid datasource edits and missing ids produce explicit errors without mutation or audit', async () => {
  await withSkillServer(async ({ application, request, login }) => {
    const source = application.businessDatasets.saveDataSource(payload);
    const before = application.database.getDataSource(source.id);
    const cookie = await login('admin');
    for (const body of [null, [], {}, { name: '' }, { host: '' }, { name: {} },
      { password: null }, { port: 0 }, { port: true }, { databaseName: '' },
      { code: 'other' }, { dbType: 'MYSQL' }, { encryptedPassword: 'injected' },
      { options: null }, { options: [] }, { options: { ssl: { ca: 123 } } }]) {
      const result = await request(`/api/data-sources/${source.id}`, { cookie, method: 'PUT', body });
      assert.equal(result.response.status, 400, JSON.stringify(body));
      assert.deepEqual(application.database.getDataSource(source.id), before);
    }
    assert.equal((await request('/api/data-sources/999999', { cookie, method: 'PUT', body: { name: 'Missing' } })).response.status, 404);
    assert.equal(application.database.listAuditLogs().some(log => log.action === 'DATASOURCE_UPDATE'), false);
  });
});

test('datasource create and connection-test responses also omit password ciphertext', async () => {
  await withSkillServer(async ({ application, request, login }) => {
    const cookie = await login('admin');
    const created = await request('/api/data-sources', { cookie, method: 'POST', body: payload });
    assert.equal(created.response.status, 200);
    assert.equal(Object.hasOwn(created.data, 'encryptedPassword'), false);
    application.businessDatasets.createPool = () => ({ query: async () => [[{ ok: 1 }]], end: async () => {} });
    const tested = await request(`/api/data-sources/${created.data.id}/test`, { cookie, method: 'POST' });
    assert.equal(tested.response.status, 200);
    assert.equal(tested.data.lastTestOk, true);
    assert.equal(Object.hasOwn(tested.data, 'encryptedPassword'), false);
  });
});

test('a delayed update body preserves credentials changed while the body was being read', async () => {
  await withSkillServer(async ({ application }) => {
    const { database, businessDatasets: service } = application;
    const source = service.saveDataSource(payload);
    let release;
    const body = new Promise(resolve => { release = resolve; });
    const route = buildRouteTable().routes.find(item => item.id === 'dataSources.update');
    const saving = route.handler({ application, database, params: [String(source.id)],
      user: database.getUserByUsername('admin'), readJson: () => body, sendJson: () => {},
    });
    const rotated = service.saveDataSource({ ...source, host: 'rotated.example', password: 'rotated-password' }, source.id);
    release({ name: 'Delayed rename' });
    await saving;
    const stored = database.getDataSource(source.id);
    assert.equal(stored.name, 'Delayed rename');
    assert.equal(stored.encryptedPassword, rotated.encryptedPassword);
    assert.equal(stored.host, 'rotated.example');
  });
});

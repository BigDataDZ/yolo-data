import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveAuthMode } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { createApplication } from '../src/application.js';

for (const mode of ['oidc', 'sessoin', ' OIDC ']) {
  test(`loadConfig rejects unsupported AUTH_MODE ${JSON.stringify(mode)}`, () => {
    for (const nodeEnv of ['', 'production']) {
      assert.throws(
        () => loadConfig({ AUTH_MODE: mode, NODE_ENV: nodeEnv }),
        /AUTH_MODE.*dev.*session/,
      );
    }
  });

  test(`resolveAuthMode rejects unsupported override ${JSON.stringify(mode)}`, () => {
    assert.throws(
      () => resolveAuthMode({ authMode: mode, nodeEnv: '' }),
      /AUTH_MODE.*dev.*session/,
    );
  });
}

for (const [mode, nodeEnv, expected] of [
  ['dev', 'production', 'dev'],
  [' DeV ', 'production', 'dev'],
  ['session', '', 'session'],
  [' SESSION ', '', 'session'],
  ['', '', 'dev'],
  ['  ', '', 'dev'],
  ['', 'production', 'session'],
  ['  ', ' Production ', 'session'],
]) {
  test(`auth mode ${JSON.stringify(mode)} in ${JSON.stringify(nodeEnv)} resolves to ${expected}`, () => {
    assert.equal(loadConfig({ AUTH_MODE: mode, NODE_ENV: nodeEnv }).authMode, expected);
    assert.equal(resolveAuthMode({ authMode: mode, nodeEnv }), expected);
  });
}

test('loadConfig defaults absent AUTH_MODE according to NODE_ENV', () => {
  assert.equal(loadConfig({}).authMode, 'dev');
  assert.equal(loadConfig({ NODE_ENV: 'production' }).authMode, 'session');
});

test('dev mode binds to loopback unless HOST is explicitly overridden', () => {
  assert.equal(loadConfig({}).host, '127.0.0.1');
  assert.equal(loadConfig({ NODE_ENV: 'production' }).host, '0.0.0.0');
  assert.equal(loadConfig({ HOST: '0.0.0.0' }).host, '0.0.0.0');
});

test('demo database name falls back to platform database when demo database is blank', () => {
  const config = loadConfig({ DEMO_DB_DATABASE: '', PLATFORM_DB_NAME: 'yolo_platform' });
  assert.equal(config.bootstrapDatasource.demo.schemaName, 'yolo_platform');
});

test('application rejects unsupported auth overrides before creating persistent state', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yolo-auth-mode-'));
  const config = {
    ...loadConfig({ USER_MEMORY_MAINTENANCE_INTERVAL_MS: '0' }),
    authMode: 'oidc',
    dbPath: path.join(directory, 'platform.db'),
    datasourceSecretKeyPath: path.join(directory, '.datasource-key'),
  };
  try {
    await assert.rejects(async () => {
      const application = await createApplication(config);
      await application.database.closeAsync();
    }, /AUTH_MODE.*dev.*session/);
    assert.deepEqual(fs.readdirSync(directory), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

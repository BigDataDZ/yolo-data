import assert from 'node:assert/strict';
import test from 'node:test';
import { mcpHttpRuntime } from './fixtures/mcpHttpRuntime.js';
import { getDefaultMcpConfig, getMcpConfigAsync, setMcpConfigAsync, _resetMcpConfigCache } from '../src/mcp/config.js';

for (const asyncOnly of [false, true]) {
  test(`persisted MCP origins control HTTP admission on ${asyncOnly ? 'async-only' : 'SQLite'} storage`, async t => {
    const env = await mcpHttpRuntime(t, { asyncOnly, allowedOrigins: ['https://trusted.example'] });
    const denied = await env.initialize({ origin: 'https://other.example' });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, -32002);
    assert.equal((await env.initialize({})).status, 403);
    const allowed = await env.initialize({ origin: 'https://trusted.example' });
    assert.equal(allowed.status, 200);
    assert.match(await allowed.text(), /yolo-data-agent/);
    _resetMcpConfigCache();
    assert.deepEqual((await getMcpConfigAsync(env.database)).allowedOrigins, ['https://trusted.example']);
    assert.deepEqual(env.sqlite.getPlatformSetting('mcp').value.allowedOrigins, ['https://trusted.example']);
    await setMcpConfigAsync(env.database, { ...env.settings, allowedOrigins: ['invalid-origin'] });
    assert.equal((await env.initialize({ origin: 'https://trusted.example' })).status, 403);
    await setMcpConfigAsync(env.database, { ...env.settings, allowedOrigins: [] });
    assert.equal((await env.initialize({})).status, 200);
  });
}

test('default MCP origin arrays are independently owned', () => {
  const first = getDefaultMcpConfig();
  assert.deepEqual(first.allowedOrigins, []);
  first.allowedOrigins.push('https://example.test');
  assert.deepEqual(getDefaultMcpConfig().allowedOrigins, []);
});

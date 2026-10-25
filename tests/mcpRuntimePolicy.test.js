import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpHttpRuntime } from './fixtures/mcpHttpRuntime.js';
import { setMcpConfigAsync } from '../src/mcp/config.js';

async function connect(t, env) {
  const client = new Client({ name: 'runtime-policy', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(env.url), { requestInit: { headers: env.headers } });
  await client.connect(transport);
  t.after(() => client.close());
  return client;
}
for (const sessionMode of ['stateful', 'stateless']) for (const change of ['mode', 'toolOverride']) {
  test(`${sessionMode} MCP refreshes ${change} on the next request`, async t => {
    const env = await mcpHttpRuntime(t, { sessionMode, asyncOnly: sessionMode === 'stateless' });
    const first = await connect(t, env);
    assert.ok((await first.listTools()).tools.some(tool => tool.name === 'execute_query'));
    const policy = { ...env.settings, ...(change === 'mode' ? { mode: 'read' } : { toolOverrides: { execute_query: false } }) };
    await setMcpConfigAsync(env.database, policy);
    const current = await connect(t, env);
    assert.equal((await current.listTools()).tools.some(tool => tool.name === 'execute_query'), false);
    let stale;
    try { stale = await first.listTools(); } catch { stale = null; }
    assert.equal(stale?.tools.some(tool => tool.name === 'execute_query') ?? false, false);
    await setMcpConfigAsync(env.database, env.settings);
    const restored = await connect(t, env);
    assert.ok((await restored.listTools()).tools.some(tool => tool.name === 'execute_query'));
  });
}

test('MCP applies new burst limits while stable settings preserve consumed tokens', async t => {
  const env = await mcpHttpRuntime(t, { asyncOnly: true, rateLimit: { rpm: 0.01, burst: 3 } });
  assert.equal((await env.initialize({})).status, 200);
  await setMcpConfigAsync(env.database, { ...env.settings, rateLimit: { rpm: 0.01, burst: 1 } });
  assert.equal((await env.initialize({})).status, 200);
  assert.equal((await env.initialize({})).status, 429);
  await setMcpConfigAsync(env.database, { ...env.settings, rateLimit: { rpm: 0.01, burst: 2 } });
  assert.equal((await env.initialize({})).status, 200);
  assert.equal((await env.initialize({})).status, 200);
  assert.equal((await env.initialize({})).status, 429);
});

test('MCP applies updated refill rates without waiting for a restart', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const env = await mcpHttpRuntime(t, { rateLimit: { rpm: 60, burst: 1 } });
  assert.equal((await env.initialize({})).status, 200);
  assert.equal((await env.initialize({})).status, 429);
  await setMcpConfigAsync(env.database, { ...env.settings, rateLimit: { rpm: 120, burst: 1 } });
  assert.equal((await env.initialize({})).status, 200);
  now += 500;
  assert.equal((await env.initialize({})).status, 200);
  assert.equal((await env.initialize({})).status, 429);
});

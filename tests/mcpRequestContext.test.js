import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpServer } from '../src/mcp/server.js';
import { createMcpSessionManager } from '../src/mcp/transport.js';
import { auditToolCall } from '../src/mcp/audit.js';

const initialContext = { tenantId: 'initial', keyId: 'initial-key', tenantScope: [] };
const contextA = {
  tenantId: 'synthetic-a', keyId: 'synthetic-key-a', requestId: 'request-a', tenantScope: [1],
};
const contextB = {
  tenantId: 'synthetic-b', keyId: 'synthetic-key-b', requestId: 'request-b', tenantScope: [2],
};
const emptyCatalog = { indicators: [], total: 0, source: 'LOCAL' };

test('registered tools use replaced request identity for auditing and tenant scope', async () => {
  const audits = [];
  const deps = {
    requestContext: initialContext,
    database: { addAuditLog: (entry) => audits.push(entry) },
    auditToolCall,
    agent: { getIndicatorsForUser: async () => emptyCatalog },
  };
  const server = createMcpServer({ config: { mode: 'read' }, deps });
  try {
    deps.requestContext = contextA;
    const result = await server._registeredTools.list_metrics.handler({ userId: 1, themeId: 1 });
    assert.equal(result.isError, undefined);
    assert.deepEqual(JSON.parse(result.content[0].text).indicators, []);
    assert.equal(audits[0].detail.tenantId, 'synthetic-a');
    assert.equal(audits[0].detail.apiKeyId, 'synthetic-key-a');
    assert.equal(audits[0].detail.requestId, 'request-a');

    const forbidden = await server._registeredTools.list_metrics.handler({ userId: 1, themeId: 2 });
    assert.equal(forbidden.isError, true);
    assert.equal(JSON.parse(forbidden.content[0].text).error.code, -32002);
  } finally {
    await server.close();
  }
});

for (const sessionMode of ['stateless', 'stateful']) {
  test(`${sessionMode} HTTP requests retain separate identity across overlapping tool awaits`, async () => {
    const audits = [];
    const observations = [];
    let releaseFirst;
    let firstStarted;
    const firstEntered = new Promise((resolve) => { firstStarted = resolve; });
    const firstReleased = new Promise((resolve) => { releaseFirst = resolve; });
    const manager = createMcpSessionManager({
      sessionMode,
      buildServer: (deps) => createMcpServer({ config: { mode: 'read' }, deps }),
      buildDeps: () => {
        const deps = {
          requestContext: initialContext,
          database: { addAuditLog: (entry) => audits.push(entry) },
          auditToolCall,
          agent: {
            async getIndicatorsForUser(userId) {
              if (userId === 1) {
                firstStarted();
                await firstReleased;
              }
              observations.push({ userId, ...deps.requestContext });
              return emptyCatalog;
            },
          },
        };
        return deps;
      },
    });
    const httpServer = createServer((req, res) => {
      const requestContext = req.headers['x-synthetic-identity'] === 'b' ? contextB : contextA;
      manager.handle(req, res, requestContext).catch(() => {
        res.writeHead(500).end();
      });
    });
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const url = new URL(`http://127.0.0.1:${httpServer.address().port}/mcp`);
    let identity = 'a';
    const client = new Client({ name: 'request-context-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(url, {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('x-synthetic-identity', identity);
        return fetch(input, { ...init, headers });
      },
    });
    try {
      await client.connect(transport);
      const first = client.callTool({ name: 'list_metrics', arguments: { userId: 1, themeId: 1 } });
      await firstEntered;
      identity = 'b';
      const second = await client.callTool({ name: 'list_metrics', arguments: { userId: 2, themeId: 2 } });
      releaseFirst();
      const firstResult = await first;
      assert.equal(firstResult.isError, undefined);
      assert.equal(second.isError, undefined);
      assert.deepEqual(observations.map(({ userId, tenantId, keyId, requestId }) => (
        { userId, tenantId, keyId, requestId }
      )), [
        { userId: 2, tenantId: 'synthetic-b', keyId: 'synthetic-key-b', requestId: 'request-b' },
        { userId: 1, tenantId: 'synthetic-a', keyId: 'synthetic-key-a', requestId: 'request-a' },
      ]);
      assert.deepEqual(audits.map(({ detail }) => [detail.tenantId, detail.apiKeyId, detail.requestId]), [
        ['synthetic-b', 'synthetic-key-b', 'request-b'],
        ['synthetic-a', 'synthetic-key-a', 'request-a'],
      ]);
      const forbidden = await client.callTool({ name: 'list_metrics', arguments: { userId: 2, themeId: 1 } });
      assert.equal(forbidden.isError, true);
      assert.equal(JSON.parse(forbidden.content[0].text).error.code, -32002);
      assert.equal(manager.sessionCount(), sessionMode === 'stateful' ? 1 : 0);
    } finally {
      releaseFirst();
      await client.close();
      manager.closeAll();
      httpServer.closeAllConnections();
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });
}

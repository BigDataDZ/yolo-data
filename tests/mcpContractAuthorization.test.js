import assert from 'node:assert/strict';
import test from 'node:test';
import { PlatformDatabase } from '../src/database.js';
import { createMcpServer } from '../src/mcp/server.js';
import { auditToolCall } from '../src/mcp/audit.js';

for (const asyncOnly of [false, true]) for (const denied of ['tenant', 'scope']) {
  test(`saved MCP contracts reject ${denied} violations on ${asyncOnly ? 'async-only' : 'SQLite'} storage`, async t => {
    const database = new PlatformDatabase(':memory:');
    t.after(() => database.closeAsync());
    const userId = database.getUserByUsername('admin').id;
    database.saveMcpQueryContract({ contractId: 'mcq_private', tenantId: 'tenant-a', userId,
      themeId: 1, sourceType: 'INDICATOR', indicatorId: 'sales_amount',
      contractJson: { metrics: ['sales_amount'], dimensions: [], dateInfo: { dateMode: 'ALL' } },
      expiresAt: '2999-01-01T00:00:00.000Z' });
    const fail = () => { throw new Error('sync fallback forbidden'); };
    let contexts = 0, queries = 0;
    const deps = { database: asyncOnly ? {
      async getMcpQueryContractAsync(id) { return database.getMcpQueryContract(id); },
      async addAuditLogAsync(entry) { return database.addAuditLog(entry); },
      getMcpQueryContract: fail,
    } : database, auditToolCall,
    requestContext: denied === 'tenant' ? { tenantId: 'tenant-b', tenantScope: [], keyId: 'key-b' }
      : { tenantId: 'tenant-a', tenantScope: [2], keyId: 'key-a' },
    agent: {
      async resolveContextAsync() { contexts++; return { theme: { id: 1 }, scope: { allowed: true } }; },
      queryContractCompiler: { review: () => ({ valid: true }) },
      indicatorService: {
        async getIndicator() { return { id: 'sales_amount' }; },
        async queryIndicator() { queries++; return { columns: ['sales'], rows: [{ sales: 12 }] }; },
      },
    } };
    const server = createMcpServer({ config: { mode: 'full' }, deps });
    t.after(() => server.close());
    const execute = () => server._registeredTools.execute_query.handler({ contractId: 'mcq_private' });
    const crossTenant = await execute();
    assert.equal(crossTenant.isError, true);
    assert.equal(JSON.parse(crossTenant.content[0].text).error.code, -32002);
    assert.equal(contexts, 0);
    assert.equal(queries, 0);
    deps.requestContext = { tenantId: 'tenant-a', tenantScope: [2], keyId: 'key-a' };
    const narrowed = await execute();
    assert.equal(narrowed.isError, true);
    assert.equal(JSON.parse(narrowed.content[0].text).error.code, -32002);
    assert.equal(contexts, 0);
    assert.equal(queries, 0);
    deps.requestContext = { tenantId: 'tenant-a', tenantScope: ['1'], keyId: 'key-a' };
    const allowed = await execute();
    assert.equal(allowed.isError, undefined);
    assert.equal(JSON.parse(allowed.content[0].text).rows[0].sales, 12);
    assert.equal(contexts, 1);
    assert.equal(queries, 1);
    assert.deepEqual(database.listAuditLogs().map(row => row.detail.outcome), ['success', 'error', 'error']);
  });
}

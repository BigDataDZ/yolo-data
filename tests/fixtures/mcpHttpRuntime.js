import { createServer } from 'node:http';
import { PlatformDatabase } from '../../src/database.js';
import { createMcpModule } from '../../src/mcp/index.js';
import { generateApiKey } from '../../src/mcp/auth.js';
import { setMcpConfigAsync, _resetMcpConfigCache } from '../../src/mcp/config.js';

export async function mcpHttpRuntime(t, { asyncOnly = false, ...config } = {}) {
  const sqlite = new PlatformDatabase(':memory:');
  const fail = () => { throw new Error('sync fallback forbidden'); };
  const database = asyncOnly ? {
    isAsyncPlatformStore: true,
    async getPlatformSettingAsync(...args) { return sqlite.getPlatformSetting(...args); },
    async savePlatformSettingAsync(...args) { return sqlite.savePlatformSetting(...args); },
    async getMcpApiKeyByHashAsync(...args) { return sqlite.getMcpApiKeyByHash(...args); },
    async addAuditLogAsync(...args) { return sqlite.addAuditLog(...args); },
    getPlatformSetting: fail, savePlatformSetting: fail,
  } : sqlite;
  const { rawKey } = generateApiKey(sqlite, { name: 'HTTP runtime fixture', tenantId: 'fixture' });
  _resetMcpConfigCache();
  const settings = { enabled: true, mode: 'full', sessionMode: 'stateful',
    rateLimit: { rpm: 1000, burst: 100 }, ...config };
  await setMcpConfigAsync(database, settings);
  const module = createMcpModule({ database, config: {}, workspace: {}, agent: {
    async getIndicatorsForUser() { return { indicators: [], total: 0 }; },
  } });
  const server = createServer((request, response) => {
    module.handle({ request, response }).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    module.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await sqlite.closeAsync(); _resetMcpConfigCache();
  });
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const headers = { authorization: `Bearer ${rawKey}`, 'content-type': 'application/json',
    accept: 'application/json, text/event-stream' };
  const initialize = extraHeaders => fetch(url, { method: 'POST', headers: { ...headers, ...extraHeaders },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fixture', version: '1' },
    } }) });
  return { sqlite, database, settings, module, url, headers, initialize };
}

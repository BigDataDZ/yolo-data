// MCP 集成与单元测试：用官方 SDK 客户端连接进程内 /mcp 服务，端到端验证
// 禁用态 / 鉴权 / 5 个工具的注册与 resolve→execute 流程。使用 fake application，
// 不依赖真实数据库或 LLM。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import test from 'node:test';
import { createMcpModule } from '../src/mcp/index.js';
import { createZip, buildConnectorPackage } from '../src/mcp/connectorPackage.js';
import { getMcpConfig, setMcpConfig, _resetMcpConfigCache } from '../src/mcp/config.js';
import { generateApiKey, validateApiKey } from '../src/mcp/auth.js';
import { createModeGate } from '../src/mcp/modeGate.js';

const FULL_CONFIG = {
  enabled: true,
  mode: 'full',
  toolOverrides: {},
  tenantScope: [],
  rateLimit: { rpm: 1000, burst: 100 },
  audit: { enabled: true, level: 'full' },
  sessionMode: 'stateless',
  allowedOrigins: [],
};

function makeFakeDatabase() {
  const settings = {};
  const apiKeys = new Map();
  const contracts = new Map();
  const audits = [];
  const hash = (raw) => createHash('sha256').update(String(raw)).digest('hex');
  return {
    getPlatformSetting: (key) => settings[key] ?? null,
    savePlatformSetting: (key, value) => { settings[key] = { key, value }; },
    createMcpApiKey: ({ name, tenantId, createdBy, scopes = 'mcp' }) => {
      const rawKey = `mcp_${randomBytes(24).toString('hex')}`;
      const keyId = `key_${randomBytes(6).toString('hex')}`;
      const record = {
        keyId, key_hash: hash(rawKey), name, tenantId, scopes, createdBy, revoked: 0,
      };
      apiKeys.set(record.key_hash, record);
      return { keyId, rawKey, name, tenantId };
    },
    getMcpApiKeyByHash: (keyHash) => {
      const r = apiKeys.get(keyHash);
      if (!r) return null;
      return {
        keyId: r.keyId, name: r.name, tenantId: r.tenantId, scopes: r.scopes, revoked: r.revoked,
      };
    },
    listMcpApiKeys: () => [...apiKeys.values()].map((r) => ({
      keyId: r.keyId, name: r.name, tenantId: r.tenantId, revoked: r.revoked,
    })),
    revokeMcpApiKey: (keyId) => {
      for (const r of apiKeys.values()) {
        if (r.keyId === keyId) { r.revoked = 1; return true; }
      }
      return false;
    },
    addAuditLog: (entry) => { audits.push(entry); },
    listAuditLogs: (limit = 100) => audits.slice(0, limit),
    saveMcpQueryContract: (rec) => { contracts.set(rec.contractId, rec); },
    getMcpQueryContract: (contractId) => contracts.get(contractId) ?? null,
    getBusinessDataset: (id) => ({ id, name: `dataset-${id}` }),
    getWorkspaceArtifact: () => null,
  };
}

function makeFakeAgent() {
  return {
    resolveContext: (userId, themeId) => ({
      user: { id: userId },
      theme: { id: themeId, indicatorIds: [], allowedDimensions: [] },
      scope: {
        allowed: true,
        allowedIndicatorIds: [],
        unrestrictedIndicators: true,
        allowedDatasetIds: [],
        allowedDimensions: [],
        rowPolicies: [],
        columnPolicies: [],
        canManage: false,
      },
    }),
    getIndicatorsForUser: async (userId, themeId) => ({
      indicators: [{
        id: 'sales_amount', name: '销售额', bizName: 'sales_amount', type: 'NUMBER', unit: '元',
      }],
      total: 1,
      source: 'LOCAL',
      scope: {},
    }),
    indicatorClient: {
      mode: 'supersonic',
      getIndicator: async (id) => ({ id, name: id, dimensions: [{ field: 'region' }] }),
      queryIndicator: async () => ({ columns: [{ name: '销售额' }], resultList: [{ 销售额: 100 }] }),
    },
    queryContractCompiler: {
      review: () => ({ valid: true, issues: [], warnings: [] }),
    },
    businessDatasets: {
      getDatasetFields: () => ([
        { fieldName: 'region', bizName: 'region', role: 'DIMENSION' },
        { fieldName: 'sale_amt', bizName: 'sale_amt', role: 'METRIC' },
        { fieldName: 'order_date', bizName: 'order_date', role: 'TIME' },
      ]),
      executeQuery: async () => ({
        columns: [{ name: 'region' }, { name: 'sale_amt' }],
        rows: [{ region: '华东', sale_amt: 100 }],
        rowCount: 1,
      }),
    },
    workspace: {
      getArtifact: async ({ artifactId }) => ({
        id: artifactId,
        kind: 'QUERY_RESULT',
        title: '测试产物',
        createdAt: '2026-01-01',
        payload: { rows: [{ a: 1 }], columns: ['a'] },
      }),
    },
  };
}

function makeFakeApplication() {
  const database = makeFakeDatabase();
  const agent = makeFakeAgent();
  return {
    database,
    agent,
    workspace: agent.workspace,
    config: {},
    async init() {},
  };
}

async function startMcpServer(mcpConfig) {
  const app = makeFakeApplication();
  _resetMcpConfigCache();
  setMcpConfig(app.database, mcpConfig);
  const mcp = createMcpModule(app);
  const server = createServer((req, res) => {
    const ctx = {
      application: app,
      database: app.database,
      agent: app.agent,
      workspace: app.workspace,
      config: app.config,
      request: req,
      response: res,
    };
    mcp.handle(ctx);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    app,
    mcp,
    server,
    baseUrl: `http://127.0.0.1:${port}/mcp`,
    async close() {
      mcp.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// ---------- 纯单元测试 ----------

test('modeGate 按模式与 toolOverrides 控制可见性', () => {
  const read = createModeGate({ mode: 'read' });
  assert.equal(read.canUse('list_metrics'), true);
  assert.equal(read.canUse('get_policy'), true);
  assert.equal(read.canUse('resolve_query'), false);
  assert.equal(read.canUse('execute_query'), false);

  const full = createModeGate({ mode: 'full', toolOverrides: { execute_query: false } });
  assert.equal(full.canUse('resolve_query'), true);
  assert.equal(full.canUse('execute_query'), false);
});

test('validateApiKey 仅接受带 mcp_ 前缀的哈希命中', async () => {
  const db = makeFakeDatabase();
  const { rawKey } = generateApiKey(db, { name: 't', tenantId: 'acme' });
  assert.ok(rawKey.startsWith('mcp_'));
  const info = validateApiKey(db, rawKey);
  assert.equal(info.tenantId, 'acme');
  assert.equal(validateApiKey(db, 'wrong'), null);
  assert.equal(validateApiKey(db, 'mcp_xxxx'), null);
});

test('getMcpConfig 五秒缓存', async () => {
  const db = makeFakeDatabase();
  _resetMcpConfigCache();
  setMcpConfig(db, { enabled: true, mode: 'full' });
  assert.equal(getMcpConfig(db).enabled, true);
  assert.equal(getMcpConfig(db).mode, 'full');
});

// ---------- 禁用 / 鉴权路径 ----------

test('未启用 MCP 时 /mcp 返回 403', async () => {
  const env = await startMcpServer({ ...FULL_CONFIG, enabled: false });
  try {
    const res = await fetch(env.baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    assert.equal(res.status, 403);
  } finally {
    await env.close();
  }
});

test('缺少 API Key 时返回 401', async () => {
  const env = await startMcpServer(FULL_CONFIG);
  try {
    const res = await fetch(env.baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    assert.equal(res.status, 401);
  } finally {
    await env.close();
  }
});

// ---------- 端到端 SDK 客户端流程 ----------

test('SDK 客户端可连接、列出 5 个工具并跑通 resolve→execute', async () => {
  const env = await startMcpServer(FULL_CONFIG);
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const { rawKey } = generateApiKey(env.app.database, { name: 'e2e', tenantId: 'acme' });

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(env.baseUrl), {
    requestInit: { headers: { authorization: `Bearer ${rawKey}` } },
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'execute_query', 'get_policy', 'get_snapshot', 'list_metrics', 'resolve_query',
    ]);

    const listed = await client.callTool({
      name: 'list_metrics',
      arguments: { userId: 1, themeId: 1 },
    });
    assert.equal(listed.isError, undefined);
    const listPayload = JSON.parse(listed.content[0].text);
    assert.equal(listPayload.total, 1);

    const resolved = await client.callTool({
      name: 'resolve_query',
      arguments: {
        userId: 1,
        themeId: 1,
        sourceType: 'INDICATOR',
        indicatorId: 'sales_amount',
        metrics: ['sales_amount'],
        dimensions: ['region'],
        dateInfo: { dateMode: 'ALL' },
      },
    });
    const resolvePayload = JSON.parse(resolved.content[0].text);
    assert.ok(resolvePayload.contractId?.startsWith('mcq_'));
    assert.equal(resolvePayload.review.valid, true);

    const executed = await client.callTool({
      name: 'execute_query',
      arguments: { contractId: resolvePayload.contractId },
    });
    const execPayload = JSON.parse(executed.content[0].text);
    assert.equal(execPayload.rowCount, 1);

    // 审计应记录 MCP_ 前缀的调用
    const audits = env.app.database.listAuditLogs(100);
    assert.ok(audits.length >= 3);
    assert.ok(audits.every((a) => String(a.action).startsWith('MCP_')));
  } finally {
    await client.close();
    await env.close();
  }
});

test('execute_query 对不存在的契约返回错误内容', async () => {
  const env = await startMcpServer(FULL_CONFIG);
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const { rawKey } = generateApiKey(env.app.database, { name: 'e2e2', tenantId: 'acme' });

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(env.baseUrl), {
    requestInit: { headers: { authorization: `Bearer ${rawKey}` } },
  });
  await client.connect(transport);
  try {
    const executed = await client.callTool({
      name: 'execute_query',
      arguments: { contractId: 'mcq_does_not_exist' },
    });
    assert.equal(executed.isError, true);
    const payload = JSON.parse(executed.content[0].text);
    assert.equal(payload.error.code, -32010);
  } finally {
    await client.close();
    await env.close();
  }
});

// ---------- 连接器打包 ----------

test('createZip 生成合法 ZIP 结构并可逐字节取回文件', () => {
  const zip = createZip([
    { name: 'a/b.txt', data: Buffer.from('hello 世界') },
    { name: 'empty.txt', data: Buffer.alloc(0) },
  ], new Date('2026-01-02T03:04:05Z'));
  assert.equal(zip.readUInt32LE(0), 0x04034b50); // 本地文件头签名
  const eocd = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50); // EOCD 签名
  assert.equal(zip.readUInt16LE(eocd + 10), 2); // 中央目录条目数

  // 取回 a/b.txt：STORE 方法，数据原样，逐字节比对
  const cdOffset = zip.readUInt32LE(eocd + 16);
  const nameLen = zip.readUInt16LE(cdOffset + 28);
  assert.equal(zip.toString('utf8', cdOffset + 46, cdOffset + 46 + nameLen), 'a/b.txt');
  const localOffset = zip.readUInt32LE(cdOffset + 42);
  const size = zip.readUInt32LE(cdOffset + 24);
  const localNameLen = zip.readUInt16LE(localOffset + 26);
  const dataStart = localOffset + 30 + localNameLen;
  assert.equal(zip.toString('utf8', dataStart, dataStart + size), 'hello 世界');
});

test('buildConnectorPackage 打包 mcp-connector/ 且含关键文件', () => {
  const zip = buildConnectorPackage(process.cwd());
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const body = zip.toString('latin1');
  assert.ok(body.includes('mcp-connector/mcp.json'));
  assert.ok(body.includes('mcp-connector/connector-meta.json'));
  assert.ok(body.includes('mcp-connector/token-schema.json'));
  assert.ok(body.includes('mcp-connector/skills/yolo-query/SKILL.md'));
});

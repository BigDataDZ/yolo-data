// MCP 管理后台路由：配置开关、API Key 管理、审计查询。全部需 admin 中间件。
import { setMcpConfig, getMcpConfig, getDefaultMcpConfig } from '../../mcp/config.js';
import { generateApiKey, revokeApiKey, listApiKeys } from '../../mcp/auth.js';

export function registerMcpAdminRoutes(table) {
  table.add({
    id: 'mcp-settings-get',
    method: 'GET',
    path: '/admin/mcp/settings',
    middleware: ['admin'],
    summary: '读取 MCP 配置',
    handler: async (ctx) => {
      ctx.sendJson(ctx.response, 200, getMcpConfig(ctx.database));
    },
  });

  table.add({
    id: 'mcp-settings-put',
    method: 'PUT',
    path: '/admin/mcp/settings',
    middleware: ['admin'],
    summary: '更新 MCP 配置（enabled/mode/rateLimit/tenantScope/sessionMode 等）',
    handler: async (ctx) => {
      const body = await ctx.readJson(ctx.request);
      const next = setMcpConfig(ctx.database, body);
      ctx.sendJson(ctx.response, 200, next);
    },
  });

  table.add({
    id: 'mcp-keys-post',
    method: 'POST',
    path: '/admin/mcp/keys',
    middleware: ['admin'],
    summary: '创建 MCP API Key（明文仅返回一次）',
    handler: async (ctx) => {
      const body = await ctx.readJson(ctx.request);
      const createdBy = ctx.user?.id ?? null;
      const result = generateApiKey(ctx.database, {
        name: body.name ?? 'mcp',
        tenantId: body.tenantId ?? 'default',
        createdBy,
      });
      ctx.sendJson(ctx.response, 201, result);
    },
  });

  table.add({
    id: 'mcp-keys-get',
    method: 'GET',
    path: '/admin/mcp/keys',
    middleware: ['admin'],
    summary: '列出 MCP API Key（不含哈希）',
    handler: async (ctx) => {
      ctx.sendJson(ctx.response, 200, listApiKeys(ctx.database));
    },
  });

  table.add({
    id: 'mcp-key-delete',
    method: 'DELETE',
    path: '/admin/mcp/keys/:id',
    middleware: ['admin'],
    summary: '吊销 MCP API Key',
    handler: async (ctx) => {
      const keyId = ctx.params[0];
      const ok = revokeApiKey(ctx.database, keyId);
      ctx.sendJson(ctx.response, 200, { revoked: Boolean(ok) });
    },
  });

  table.add({
    id: 'mcp-audit-get',
    method: 'GET',
    path: '/admin/mcp/audit',
    middleware: ['admin'],
    summary: '查询 MCP 审计日志',
    handler: async (ctx) => {
      const limit = Math.min(Number(ctx.query.get('limit')) || 100, 500);
      const rows = ctx.database.listAuditLogs(limit) ?? [];
      const mcpRows = rows.filter((r) => String(r.action ?? '').startsWith('MCP_'));
      ctx.sendJson(ctx.response, 200, { total: mcpRows.length, items: mcpRows });
    },
  });
}

export { getDefaultMcpConfig };

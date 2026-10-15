// MCP 模块入口：对外暴露 { handle, isEnabled, close }。
// 负责 API Key 鉴权、Origin 校验、速率限制、请求级上下文注入、原始 body 读取，
// 并把请求委派给 transport 层。路由处理器只需 await mcp.handle(ctx)。
import { randomUUID } from 'node:crypto';
import { createMcpSessionManager } from './transport.js';
import { createMcpServer } from './server.js';
import { getMcpConfig } from './config.js';
import { createMcpRateLimiter } from './rateLimit.js';
import { validateApiKey, isOriginAllowed } from './auth.js';
import { MCP_ERROR, auditToolCall } from './audit.js';

function jsonRpcError(res, status, code, message) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

export function createMcpModule(application) {
  const { database, agent, workspace, config } = application;
  let rateLimiter = null;
  let manager = null;
  let managerMode = null;

  function ensureRateLimiter(cfg) {
    if (!rateLimiter) {
      rateLimiter = createMcpRateLimiter({
        rpm: cfg.rateLimit?.rpm ?? 60,
        burst: cfg.rateLimit?.burst ?? 10,
      });
    }
    return rateLimiter;
  }

  function ensureManager(cfg) {
    if (!manager || managerMode !== cfg.sessionMode) {
      rateLimiter = ensureRateLimiter(cfg);
      manager = createMcpSessionManager({
        sessionMode: cfg.sessionMode,
        buildServer: (deps) => createMcpServer({ config: cfg, deps }),
        buildDeps: () => ({
          agent,
          workspace,
          database,
          config,
          rateLimiter,
          auditToolCall,
          requestContext: {
            tenantId: 'default', keyId: null, scopes: ['mcp'], tenantScope: [], requestId: null,
          },
        }),
      });
      managerMode = cfg.sessionMode;
    }
    return manager;
  }

  async function handle(ctx) {
    const cfg = getMcpConfig(database);
    if (!cfg.enabled) {
      return jsonRpcError(ctx.response, 403, MCP_ERROR.NOT_OPEN, 'MCP 服务未启用');
    }
    const authHeader = ctx.request.headers['authorization'] ?? '';
    const rawKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const keyInfo = rawKey ? validateApiKey(database, rawKey) : null;
    if (!keyInfo) {
      return jsonRpcError(ctx.response, 401, MCP_ERROR.UNAUTHENTICATED, '无效或缺失的 API Key');
    }
    if (!isOriginAllowed(ctx.request.headers.origin, cfg.allowedOrigins)) {
      return jsonRpcError(ctx.response, 403, MCP_ERROR.FORBIDDEN, 'Origin 不被允许');
    }
    const limiter = ensureRateLimiter(cfg);
    if (!limiter.check(keyInfo.keyId)) {
      return jsonRpcError(ctx.response, 429, MCP_ERROR.RATE_LIMITED, '请求过于频繁，请稍后重试');
    }
    const requestContext = {
      tenantId: keyInfo.tenantId,
      keyId: keyInfo.keyId,
      scopes: keyInfo.scopes,
      tenantScope: cfg.tenantScope ?? [],
      requestId: randomUUID(),
    };
    const m = ensureManager(cfg);
    // 不预读 body：交由 SDK 的 StreamableHTTPServerTransport 自行读取请求流，
    // 避免流被消费后 SDK 解析到空 body（Parse error）。
    await m.handle(ctx.request, ctx.response, requestContext);
  }

  return {
    handle,
    isEnabled: () => getMcpConfig(database).enabled,
    close: () => manager?.closeAll(),
  };
}

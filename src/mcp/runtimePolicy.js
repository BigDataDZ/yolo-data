import { createMcpSessionManager } from './transport.js';
import { createMcpServer } from './server.js';
import { createMcpRateLimiter } from './rateLimit.js';
import { auditToolCall } from './audit.js';

export function createMcpRuntime(application) {
  const { database, agent, workspace, config } = application;
  let rateLimiter = null;
  let limiterPolicy = null;
  let manager = null;
  let managerPolicy = null;

  function ensureRateLimiter(cfg) {
    const rpm = cfg.rateLimit?.rpm ?? 60;
    const burst = cfg.rateLimit?.burst ?? 10;
    const policy = JSON.stringify([rpm, burst]);
    if (!rateLimiter || limiterPolicy !== policy) {
      rateLimiter = createMcpRateLimiter({ rpm, burst });
      limiterPolicy = policy;
    }
    return rateLimiter;
  }

  function ensureManager(cfg) {
    const overrides = Object.entries(cfg.toolOverrides ?? {}).sort(([left], [right]) => left.localeCompare(right));
    const policy = JSON.stringify([cfg.sessionMode, cfg.mode, overrides]);
    if (!manager || managerPolicy !== policy) {
      manager?.closeAll();
      ensureRateLimiter(cfg);
      manager = createMcpSessionManager({
        sessionMode: cfg.sessionMode,
        buildServer: deps => createMcpServer({ config: cfg, deps }),
        buildDeps: () => ({ agent, workspace, database, config, rateLimiter, auditToolCall,
          requestContext: {
            tenantId: 'default', keyId: null, scopes: ['mcp'], tenantScope: [], requestId: null,
          },
        }),
      });
      managerPolicy = policy;
    }
    return manager;
  }

  return { ensureRateLimiter, ensureManager, close: () => manager?.closeAll() };
}

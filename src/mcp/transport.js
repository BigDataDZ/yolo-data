// MCP 传输层：在原生 node:http 的 req/res 上桥接官方 SDK 的
// StreamableHTTPServerTransport。支持两种会话模式：
//  - stateless：每请求独立服务实例 + JSON 响应（默认，最稳，无状态泄漏）
//  - stateful ：按 mcp-session-id 复用服务实例，SSE 流式（需 GET/DELETE 配合）
// 请求级上下文（租户 / API Key / 作用域 / requestId）通过 deps.requestContext
// 注入，每次 handle 前刷新，保证并发请求各取所需。

import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export function createMcpSessionManager({ sessionMode = 'stateless', buildServer, buildDeps }) {
  const stateful = sessionMode === 'stateful';
  const sessions = new Map(); // sessionId -> { server, transport, deps }

  async function handle(req, res, requestContext) {
    const headerSessionId = req.headers['mcp-session-id'];
    let entry;
    if (stateful && headerSessionId && sessions.has(headerSessionId)) {
      entry = sessions.get(headerSessionId);
    } else {
      const deps = buildDeps();
      const server = buildServer(deps);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: stateful ? () => randomUUID() : undefined,
        enableJsonResponse: !stateful,
      });
      // eslint-disable-next-line no-await-in-loop
      await server.connect(transport);
      entry = { server, transport, deps };
      if (stateful) {
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
      }
    }
    entry.deps.requestContext = requestContext;
    try {
      await entry.transport.handleRequest(req, res);
    } finally {
      if (stateful && entry.transport.sessionId && !sessions.has(entry.transport.sessionId)) {
        sessions.set(entry.transport.sessionId, entry);
      }
    }
  }

  function closeAll() {
    for (const { transport } of sessions.values()) {
      try { transport.close(); } catch { /* ignore */ }
    }
    sessions.clear();
  }

  return {
    handle,
    closeAll,
    sessionCount: () => sessions.size,
  };
}

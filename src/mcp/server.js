// 组装 MCP 服务：基于官方 McpServer 注册 5 个工具，按 modeGate 选择性注册。
// 权限不足的工具对 AI 客户端完全不可见（注册阶段即跳过）。

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createModeGate } from './modeGate.js';
import { registerListMetrics } from './tools/list_metrics.js';
import { registerGetPolicy } from './tools/get_policy.js';
import { registerGetSnapshot } from './tools/get_snapshot.js';
import { registerResolveQuery } from './tools/resolve_query.js';
import { registerExecuteQuery } from './tools/execute_query.js';

const TOOL_REGISTRY = [
  ['list_metrics', registerListMetrics],
  ['get_policy', registerGetPolicy],
  ['get_snapshot', registerGetSnapshot],
  ['resolve_query', registerResolveQuery],
  ['execute_query', registerExecuteQuery],
];

export function createMcpServer({ config, deps }) {
  const server = new McpServer({ name: 'yolo-data-agent', version: '1.0.0' });
  const modeGate = createModeGate(config);
  const toolCtx = { ...deps, modeGate };
  for (const [name, register] of TOOL_REGISTRY) {
    if (!modeGate.canUse(name)) continue;
    register(server, toolCtx);
  }
  return server;
}

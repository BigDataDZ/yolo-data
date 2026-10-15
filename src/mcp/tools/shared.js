// 工具层共享辅助：错误构造、审计元信息、租户作用域校验、结果归一化、
// 统一的工具错误包装（转 JSON-RPC 错误内容，不泄露内部实现）。

import { MCP_ERROR, translateMcpError } from '../audit.js';

export { MCP_ERROR };

export function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function buildMeta(toolName, requestContext, args) {
  return {
    toolName,
    requestId: requestContext?.requestId ?? null,
    tenantId: requestContext?.tenantId ?? 'unknown',
    apiKeyId: requestContext?.keyId ?? 'unknown',
    parameters: args,
  };
}

export function assertTenantScope(ctx, themeId) {
  const scope = ctx?.requestContext?.tenantScope;
  if (Array.isArray(scope) && scope.length > 0 && !scope.map(String).includes(String(themeId))) {
    throw fail(MCP_ERROR.FORBIDDEN, `主题 ${themeId} 不在本租户授权范围内`);
  }
}

export function normalizeResult(result = {}) {
  const rows = result.rows ?? result.resultList ?? [];
  const columns = result.columns ?? (rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]) : []);
  return { columns, rows, rowCount: rows.length };
}

// 工具处理器均经此包装：抛错时翻译成统一 MCP 错误内容（isError=true），
// 异常信息不外泄。审计由工具内部的 auditToolCall 在 finally 记录。
export function wrapToolHandler(cb) {
  return async (args, extra) => {
    try {
      return await cb(args, extra);
    } catch (error) {
      const mapped = translateMcpError(error);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: { code: mapped.code, message: mapped.message } }),
        }],
        isError: true,
      };
    }
  };
}

// MCP 审计与错误翻译。审计复用现有 database.addAuditLog（与全站审计同一张表），
// 字段对齐设计中的 McpAuditEntry（入参脱敏 / 出参摘要 / 耗时）。错误不抛栈、
// 不暴露表名 / 不泄露内部实现。

export const MCP_ERROR = {
  NOT_OPEN: -32000,
  UNAUTHENTICATED: -32001,
  FORBIDDEN: -32002,
  RATE_LIMITED: -32003,
  CONTRACT_NOT_FOUND: -32010,
  CONTRACT_EXPIRED: -32011,
  EXECUTION_FAILED: -32020,
  INTERNAL: -32603,
};

function sanitize(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitize);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (/key|secret|token|password|authorization/i.test(key)) {
        out[key] = '***';
        continue;
      }
      out[key] = val && typeof val === 'object' ? sanitize(val) : (
        typeof val === 'string' && val.length > 200 ? `${val.slice(0, 200)}…` : val
      );
    }
    return out;
  }
  return value;
}

function summarize(result) {
  if (!result || !Array.isArray(result.content)) return undefined;
  try {
    const text = result.content.map((c) => c?.text ?? '').join(' ');
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  } catch {
    return undefined;
  }
}

// 包裹一次工具调用：成功/失败均写审计，异常原样上抛（由上层翻译）。
export async function auditToolCall(database, meta, fn) {
  const start = Date.now();
  let outcome = 'success';
  let errorCode;
  let resultSummary;
  try {
    const result = await fn();
    resultSummary = summarize(result);
    return result;
  } catch (error) {
    outcome = 'error';
    errorCode = error?.code ?? MCP_ERROR.INTERNAL;
    throw error;
  } finally {
    try {
      database.addAuditLog({
        userId: null,
        themeId: null,
        action: `MCP_${meta.toolName}`,
        detail: {
          timestamp: new Date().toISOString(),
          requestId: meta.requestId,
          toolName: meta.toolName,
          tenantId: meta.tenantId ?? 'unknown',
          apiKeyId: meta.apiKeyId ?? 'unknown',
          parameters: sanitize(meta.parameters),
          outcome,
          errorCode,
          durationMs: Date.now() - start,
          resultSummary,
        },
      });
    } catch {
      // 审计失败绝不影响工具调用本身
    }
  }
}

export function translateMcpError(error) {
  if (error && typeof error.code === 'number') return error;
  if (error && /(contract|契约).*(不存在|失效|过期)/i.test(error.message ?? '')) {
    return { code: MCP_ERROR.CONTRACT_NOT_FOUND, message: '查询契约不存在或已过期，请重新执行 resolve_query。' };
  }
  if (error && /(权限|permission|forbidden)/i.test(error.message ?? '')) {
    return { code: MCP_ERROR.FORBIDDEN, message: '无权限执行此操作，请联系管理员申请权限。' };
  }
  if (error && /(过期|expired)/i.test(error.message ?? '')) {
    return { code: MCP_ERROR.CONTRACT_EXPIRED, message: '查询契约已过期，请重新编译契约。' };
  }
  return {
    code: MCP_ERROR.INTERNAL,
    message: '服务暂时不可用，请稍后重试。',
  };
}

// MCP 认证：独立 API Key（不复用用户 Session），绑定租户。
// 仅存储 SHA-256 哈希，明文仅在创建时返回一次。同时提供 Origin 校验辅助（防 DNS rebinding）。

import crypto from 'node:crypto';

export function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(String(rawKey ?? '')).digest('hex');
}

export function validateApiKey(database, rawKey) {
  const trimmed = String(rawKey ?? '').trim();
  if (!trimmed || !trimmed.startsWith('mcp_')) {
    return null;
  }
  const info = database.getMcpApiKeyByHash(hashApiKey(trimmed));
  if (!info) return null;
  return { keyId: info.keyId, tenantId: info.tenantId, scopes: info.scopes };
}

export async function validateApiKeyAsync(database, rawKey) {
  const trimmed = String(rawKey ?? '').trim();
  if (!trimmed || !trimmed.startsWith('mcp_')) return null;
  const info = database.getMcpApiKeyByHashAsync
    ? await database.getMcpApiKeyByHashAsync(hashApiKey(trimmed))
    : database.getMcpApiKeyByHash(hashApiKey(trimmed));
  if (!info) return null;
  return { keyId: info.keyId, tenantId: info.tenantId, scopes: info.scopes };
}

export function generateApiKey(database, { name, tenantId, createdBy } = {}) {
  return database.createMcpApiKey({ name, tenantId, createdBy });
}

export function revokeApiKey(database, keyId) {
  return database.revokeMcpApiKey(keyId);
}

export function listApiKeys(database) {
  return database.listMcpApiKeys();
}

// Origin 校验：当配置了允许源时才强制；未配置则放行（真实门禁是 API Key + 管理员开关）。
export function isOriginAllowed(origin, allowedOrigins) {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    return true;
  }
  if (!origin) return false;
  try {
    const req = new URL(origin);
    return allowedOrigins.some((allowed) => {
      try {
        const a = new URL(allowed);
        return req.hostname === a.hostname
          && req.protocol === a.protocol
          && (req.port || (req.protocol === 'https:' ? '443' : '80')) === (a.port || (a.protocol === 'https:' ? '443' : '80'));
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

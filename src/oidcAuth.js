// OIDC 身份校验骨架（P0-1 的一部分）。
//
// 目标：用标准 OIDC（Authorization Code / Implicit 拿到的 JWT）替换开发态的
// x-user-id 直通，使生产部署可接入企业 IdP（Keycloak / Auth0 / Azure AD / 飞书等）。
//
// 实现约束：
//   - 零新增依赖，校验用 Node 内置 Web Crypto（crypto.subtle）。
//   - 未配置 AUTH_OIDC_ISSUER 时整个模块为 no-op，回落到既有 dev/session 逻辑，
//     不改变现有行为。
//   - 仅做 JWT 签名校验 + exp/iss/aud 断言；用户信息用 sub / email 映射到 app_users。
//
// 接入点（在 http/support.js 的 getRequestUser 里，当 resolveAuthMode()==='oidc' 时调用）：
//   const principal = await verifyOidcToken(getBearer(request), oidc);
//   return database.getUserByExternalId(principal.sub) ?? mapByEmail(principal.email);

import crypto from 'node:crypto';

function b64urlToBuf(value) {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function decodeJwtPayload(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) {
    throw new Error('malformed JWT');
  }
  return JSON.parse(b64urlToBuf(parts[1]).toString('utf8'));
}

// 把 JWK（RSA）转成 Web Crypto 可用的 CryptoKey。只支持 RS256（最常见）。
async function importRsaPublicKey(jwk) {
  const modulus = b64urlToBuf(jwk.n);
  const exponent = b64urlToBuf(jwk.e);
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: jwk.kty,
      n: b64urlToBuf(jwk.n).toString('base64'),
      e: b64urlToBuf(jwk.e).toString('base64'),
      alg: 'RS256',
      ext: true,
    },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

async function verifySignature(token, jwk) {
  const [headerB64, payloadB64, signatureB64] = String(token).split('.');
  const key = await importRsaPublicKey(jwk);
  const data = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
  const signature = b64urlToBuf(signatureB64);
  return crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new Uint8Array(signature),
    new Uint8Array(data),
  );
}

export function createOidcVerifier(config = {}) {
  const issuer = config.issuer || process.env.AUTH_OIDC_ISSUER || '';
  const clientId = config.clientId || process.env.AUTH_OIDC_CLIENT_ID || '';
  const audience = config.audience || process.env.AUTH_OIDC_AUDIENCE || clientId;
  const jwksUri = config.jwksUri
    || process.env.AUTH_OIDC_JWKS_URI
    || (issuer ? `${issuer.replace(/\/$/, '')}/protocol/openid-connect/certs` : '');
  const enabled = Boolean(issuer && jwksUri);

  let jwksCache = { keys: [], fetchedAt: 0 };
  const JWKS_TTL_MS = 60 * 60 * 1000;

  async function fetchJwks() {
    if (jwksCache.keys.length && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
      return jwksCache;
    }
    const res = await fetch(jwksUri, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`JWKS 拉取失败：HTTP ${res.status}`);
    }
    const json = await res.json();
    jwksCache = { keys: json.keys ?? [], fetchedAt: Date.now() };
    return jwksCache;
  }

  async function verify(token) {
    if (!enabled) {
      return null; // no-op：回落既有鉴权
    }
    if (!token) {
      throw Object.assign(new Error('missing bearer token'), { statusCode: 401 });
    }
    let payload;
    try {
      payload = decodeJwtPayload(token);
    } catch (error) {
      throw Object.assign(new Error(`JWT 解析失败：${error.message}`), { statusCode: 401 });
    }
    if (!payload.exp || payload.exp * 1000 < Date.now()) {
      throw Object.assign(new Error('OIDC token 已过期'), { statusCode: 401 });
    }
    if (issuer && payload.iss !== issuer) {
      throw Object.assign(new Error('OIDC issuer 不匹配'), { statusCode: 401 });
    }
    if (audience && payload.aud !== audience && !(Array.isArray(payload.aud) && payload.aud.includes(audience))) {
      throw Object.assign(new Error('OIDC audience 不匹配'), { statusCode: 401 });
    }
    const jwks = await fetchJwks();
    const jwk = jwks.keys.find((key) => key.kid === payload.kid);
    if (!jwk) {
      throw Object.assign(new Error('JWKS 中找不到匹配的密钥'), { statusCode: 401 });
    }
    const ok = await verifySignature(token, jwk);
    if (!ok) {
      throw Object.assign(new Error('OIDC 签名校验失败'), { statusCode: 401 });
    }
    return {
      sub: payload.sub,
      email: payload.email || payload.preferred_username || '',
      name: payload.name || payload.preferred_username || '',
    };
  }

  return { enabled, issuer, verify };
}

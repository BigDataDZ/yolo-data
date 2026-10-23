// MCP 配置读写：存入平台设置表（key='mcp'），5 秒缓存，管理员后台修改后最多 5 秒生效。
// 默认拒绝原则：配置无效时回退到只读模式（disabled 关闭 / read 最小可见）。

export const DEFAULT_MCP_CONFIG = {
  enabled: false,
  mode: 'read',
  toolOverrides: {},
  tenantScope: [],
  rateLimit: { rpm: 60, burst: 10 },
  audit: { enabled: true, level: 'full' },
  sessionMode: 'stateful',
};

const VALID_MODES = ['disabled', 'read', 'standard', 'full'];
const CACHE_TTL = 5000;

let cache = { value: null, at: 0 };

export function getDefaultMcpConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_MCP_CONFIG));
}

function coerce(raw) {
  const cfg = getDefaultMcpConfig();
  if (!raw || typeof raw !== 'object') {
    return cfg;
  }
  if (typeof raw.enabled === 'boolean') cfg.enabled = raw.enabled;
  if (VALID_MODES.includes(raw.mode)) cfg.mode = raw.mode;
  if (raw.toolOverrides && typeof raw.toolOverrides === 'object') {
    cfg.toolOverrides = { ...raw.toolOverrides };
  }
  if (Array.isArray(raw.tenantScope)) cfg.tenantScope = raw.tenantScope.map(String);
  if (raw.rateLimit && typeof raw.rateLimit === 'object') {
    const rpm = Number(raw.rateLimit.rpm);
    const burst = Number(raw.rateLimit.burst);
    if (Number.isFinite(rpm) && rpm > 0) cfg.rateLimit.rpm = rpm;
    if (Number.isFinite(burst) && burst > 0) cfg.rateLimit.burst = burst;
  }
  if (raw.audit && typeof raw.audit === 'object') {
    if (typeof raw.audit.enabled === 'boolean') cfg.audit.enabled = raw.audit.enabled;
    if (['full', 'summary', 'off'].includes(raw.audit.level)) cfg.audit.level = raw.audit.level;
  }
  if (raw.sessionMode === 'stateless' || raw.sessionMode === 'stateful') {
    cfg.sessionMode = raw.sessionMode;
  }
  return cfg;
}

export function getMcpConfig(database) {
  const now = Date.now();
  if (cache.value && now - cache.at < CACHE_TTL) {
    return cache.value;
  }
  const record = database.getPlatformSetting('mcp', null);
  const raw = record && record.value && typeof record.value === 'object' ? record.value : null;
  const cfg = coerce(raw);
  cache = { value: cfg, at: now };
  return cfg;
}

export function setMcpConfig(database, patch) {
  const next = coerce(patch && typeof patch === 'object' ? patch : {});
  database.savePlatformSetting('mcp', next);
  cache = { value: next, at: Date.now() };
  return next;
}

export async function getMcpConfigAsync(database) {
  if (typeof database.getPlatformSettingAsync !== 'function') return getMcpConfig(database);
  const now = Date.now();
  if (cache.value && now - cache.at < CACHE_TTL) return cache.value;
  const record = await database.getPlatformSettingAsync('mcp', null);
  const cfg = coerce(record?.value);
  cache = { value: cfg, at: now };
  return cfg;
}

export async function setMcpConfigAsync(database, patch) {
  if (typeof database.savePlatformSettingAsync !== 'function') return setMcpConfig(database, patch);
  const next = coerce(patch && typeof patch === 'object' ? patch : {});
  await database.savePlatformSettingAsync('mcp', next);
  cache = { value: next, at: Date.now() };
  return next;
}

// 仅用于测试或进程内重置，避免缓存陈旧。
export function _resetMcpConfigCache() {
  cache = { value: null, at: 0 };
}

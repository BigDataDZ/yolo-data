export const DEFAULT_MCP_CONFIG = {
  enabled: false,
  mode: 'read',
  toolOverrides: {},
  tenantScope: [],
  rateLimit: { rpm: 60, burst: 10 },
  audit: { enabled: true, level: 'full' },
  sessionMode: 'stateful',
  allowedOrigins: [],
};

export function getDefaultMcpConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_MCP_CONFIG));
}

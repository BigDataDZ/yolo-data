// 层级权限模式门控：工具按模式选择性注册。
// 权限不足的工具对 AI 客户端完全不可见（注册阶段即跳过），而非仅被阻止。

export const McpMode = {
  DISABLED: 'disabled',
  READ: 'read',
  STANDARD: 'standard',
  FULL: 'full',
};

// 每个工具所需的最低模式。
export const TOOL_MODE_MAP = {
  list_metrics: McpMode.READ,
  get_policy: McpMode.READ,
  get_snapshot: McpMode.STANDARD,
  resolve_query: McpMode.STANDARD,
  execute_query: McpMode.STANDARD,
};

const ORDER = [McpMode.DISABLED, McpMode.READ, McpMode.STANDARD, McpMode.FULL];

export function normalizeMode(value) {
  const upper = String(value ?? '').toUpperCase();
  return McpMode[upper] ?? McpMode.READ;
}

export function createModeGate(config) {
  const mode = normalizeMode(config?.mode);
  const overrides = (config?.toolOverrides && typeof config.toolOverrides === 'object')
    ? config.toolOverrides
    : {};
  return {
    mode,
    canUse(toolName) {
      // 单工具显式关闭优先。
      if (overrides[toolName] === false) return false;
      const required = TOOL_MODE_MAP[toolName];
      if (!required) return false;
      return ORDER.indexOf(mode) >= ORDER.indexOf(required);
    },
    listEnabled(toolNames) {
      return (toolNames ?? Object.keys(TOOL_MODE_MAP)).filter((tool) => this.canUse(tool));
    },
  };
}

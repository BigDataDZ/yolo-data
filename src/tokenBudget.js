// 按用户 / 主题的 Token 成本预算闸门（P0-4）。
//
// 现状：LlmAuditService 只把每次调用的 tokenUsage 落库（记录），并不拦截。
// 多租户 / 按量计费场景下，需要"先预算后调用"的硬闸门，避免单个用户或主题
// 耗尽平台配额。
//
// 设计：
//   - 预算来源（按优先级）：主题配置 theme.budgetTokens → 环境变量全局默认。
//   - 统计窗口：滚动自然日（daily）。如需月度可扩展 WINDOW。
//   - 超限行为：默认硬拦截（429）；可通过 mode='warn' 降级为仅返回告警，不抛错。
//   - 依赖 database.sumTokenUsage（见 database.js），与现有审计表共用同一数据源。

const WINDOW_MS = 24 * 60 * 60 * 1000;

function readInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export class TokenBudgetService {
  constructor(database, { env = process.env, now = () => Date.now() } = {}) {
    this.database = database;
    this.env = env;
    this.now = now;
    this.defaultUserLimit = readInt(env.TOKEN_BUDGET_USER_DAILY, 0);
    this.defaultThemeLimit = readInt(env.TOKEN_BUDGET_THEME_DAILY, 0);
  }

  // 解析本次请求适用的限额（0 表示不限制）。
  resolveLimit({ userLimit = 0, themeLimit = 0 } = {}) {
    // 主题级限额优先；都没有则看全局默认。
    const limit = themeLimit
      || userLimit
      || this.defaultThemeLimit
      || this.defaultUserLimit;
    return limit > 0 ? limit : 0;
  }

  // 兼容旧嵌入调用；生产 Agent 使用 checkAsync。
  check({ userId, themeId = null, userLimit = 0, themeLimit = 0 } = {}) {
    const limit = this.resolveLimit({ userLimit, themeLimit });
    if (!limit) {
      return { ok: true, limit: 0, used: 0, remaining: Infinity, enforced: false };
    }
    const sinceIso = new Date(this.now() - WINDOW_MS).toISOString();
    const used = this.database.sumTokenUsage({
      userId: userId ?? null,
      themeId: themeId ?? null,
      sinceIso,
    });
    const remaining = limit - used;
    return {
      ok: remaining > 0,
      limit,
      used,
      remaining: Math.max(0, remaining),
      enforced: true,
      window: 'daily',
    };
  }

  async checkAsync({ userId, themeId = null, userLimit = 0, themeLimit = 0 } = {}) {
    const limit = this.resolveLimit({ userLimit, themeLimit });
    if (!limit) {
      return { ok: true, limit: 0, used: 0, remaining: Infinity, enforced: false };
    }
    const sinceIso = new Date(this.now() - WINDOW_MS).toISOString();
    const used = await this.database.sumTokenUsageAsync({
      userId: userId ?? null,
      themeId: themeId ?? null,
      sinceIso,
    });
    const remaining = limit - used;
    return {
      ok: remaining > 0,
      limit,
      used,
      remaining: Math.max(0, remaining),
      enforced: true,
      window: 'daily',
    };
  }
}

export function tokenBudgetError(used, limit) {
  const error = new Error(
    `当前账户/主题的 Token 预算已用尽（已用 ${used} / 限额 ${limit}，按日滚动）。`
    + '请联系管理员调整预算，或等待周期重置。',
  );
  error.statusCode = 429;
  error.code = 'TOKEN_BUDGET_EXCEEDED';
  return error;
}

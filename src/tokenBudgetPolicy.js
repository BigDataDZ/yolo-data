// Pure budget scope, result and error construction shared by both storage paths.
export function readInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function budgetUsageQuery(userId, themeId, now, windowMs) {
  return {
    userId: userId ?? null,
    themeId: themeId ?? null,
    sinceIso: new Date(now - windowMs).toISOString(),
  };
}

export function summarizeBudget(limit, used) {
  if (!limit) return { ok: true, limit: 0, used: 0, remaining: Infinity, enforced: false };
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

export function tokenBudgetError(used, limit) {
  const error = new Error(
    `当前账户/主题的 Token 预算已用尽（已用 ${used} / 限额 ${limit}，按日滚动）。`
    + '请联系管理员调整预算，或等待周期重置。',
  );
  error.statusCode = 429;
  error.code = 'TOKEN_BUDGET_EXCEEDED';
  return error;
}

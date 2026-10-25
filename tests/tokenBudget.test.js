import assert from 'node:assert/strict';
import test from 'node:test';
import { TokenBudgetService, tokenBudgetError } from '../src/tokenBudget.js';

function fakeDb(used) {
  return { sumTokenUsage: () => used };
}

test('未配置预算时放行（enforced=false）', () => {
  const svc = new TokenBudgetService(fakeDb(0), { env: {} });
  const result = svc.check({ userId: 1, themeId: 2 });
  assert.equal(result.enforced, false);
  assert.equal(result.ok, true);
});

test('环境变量设置全局默认预算并能拦截', () => {
  const svc = new TokenBudgetService(fakeDb(9500), {
    env: { TOKEN_BUDGET_USER_DAILY: '10000' },
  });
  const result = svc.check({ userId: 1, themeId: 2 });
  assert.equal(result.enforced, true);
  assert.equal(result.limit, 10000);
  assert.equal(result.used, 9500);
  assert.equal(result.ok, true); // 未超
});

test('已超预算时 ok=false', () => {
  const svc = new TokenBudgetService(fakeDb(12000), {
    env: { TOKEN_BUDGET_THEME_DAILY: '10000' },
  });
  const result = svc.check({ userId: 1, themeId: 2 });
  assert.equal(result.ok, false);
  assert.equal(result.remaining, 0);
});

test('主题级预算优先于用户默认', () => {
  const svc = new TokenBudgetService(fakeDb(500), {
    env: { TOKEN_BUDGET_USER_DAILY: '1000' },
  });
  // themeLimit 显式更高，应取主题级
  const result = svc.check({ userId: 1, themeId: 2, themeLimit: 8000 });
  assert.equal(result.limit, 8000);
  assert.equal(result.ok, true);
});

test('tokenBudgetError 携带 429 状态码', () => {
  const error = tokenBudgetError(12000, 10000);
  assert.equal(error.statusCode, 429);
  assert.equal(error.code, 'TOKEN_BUDGET_EXCEEDED');
  assert.match(error.message, /12000/);
});

test('sync and async budgets agree at, below and above the limit with the same scope', async () => {
  for (const used of [0, 99, 100, 101]) {
    const scopes = [];
    const service = new TokenBudgetService({
      sumTokenUsage(scope) { scopes.push(scope); return used; },
      async sumTokenUsageAsync(scope) { scopes.push(scope); return used; },
    }, { env: {}, now: () => Date.parse('2026-10-26T00:00:00Z') });
    const input = { userId: 7, themeId: 8, userLimit: 50, themeLimit: 100 };
    const sync = service.check(input);
    assert.deepEqual(await service.checkAsync(input), sync);
    assert.equal(sync.ok, used < 100);
    assert.equal(sync.remaining, Math.max(0, 100 - used));
    assert.deepEqual(scopes, Array(2).fill({
      userId: 7, themeId: 8, sinceIso: '2026-10-25T00:00:00.000Z',
    }));
  }
});

test('unlimited budgets do not query storage on either path', async () => {
  const service = new TokenBudgetService({
    sumTokenUsage() { throw new Error('unexpected storage read'); },
    sumTokenUsageAsync() { throw new Error('unexpected storage read'); },
  }, { env: {} });
  assert.deepEqual(await service.checkAsync(), service.check());
  assert.equal(service.check().remaining, Infinity);
});

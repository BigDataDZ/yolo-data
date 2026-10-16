import assert from 'node:assert/strict';
import test from 'node:test';
import { runAllLevels } from '../scripts/run-eval.mjs';
import { TEST_PASSWORD, withSkillServer } from './fixtures/skillServer.js';

test('browser: eval shows degraded judges as pending and only valid judgments as completed', {
  skip: !process.env.YOLO_EVAL_BROWSER_TEST, timeout: 90000,
}, async () => {
  const { chromium, expect } = await import('@playwright/test');
  await withSkillServer(async ({ baseUrl }) => {
    const browser = await chromium.launch({ headless: true, channel: process.env.YOLO_BROWSER_CHANNEL });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let report = await runAllLevels({ judge: async () => 'not-json' });
      await page.route('**/api/eval', (route) => route.fulfill({ json: report }));
      await page.goto(`${baseUrl}/eval`);
      await page.locator('#loginUsername').fill('admin');
      await page.locator('#loginPassword').fill(TEST_PASSWORD);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      const pending = page.locator('.tag-amber', { hasText: 'Judge 待有效判定' });
      const completed = page.locator('.tag-teal', { hasText: 'Judge 已完成判定' });
      await expect(pending).toHaveText('Judge 待有效判定 2');
      await expect(completed).toHaveCount(0);
      await expect(page.getByText('总体用例通过率', { exact: true })).toBeVisible();

      let calls = 0;
      report = await runAllLevels({ judge: async () => ++calls === 1
        ? JSON.stringify({ answersQuestion: true, consistentWithData: true, needsReplan: false, reason: 'ok', hint: '' })
        : 'not-json' });
      await page.locator('[data-eval-refresh]').click();
      await expect(pending).toHaveText('Judge 待有效判定 1');
      await expect(completed).toHaveText('Judge 已完成判定 1');

      report = await runAllLevels({ judge: async () => JSON.stringify({
        answersQuestion: true, consistentWithData: true, needsReplan: false, reason: 'ok', hint: '',
      }) });
      await page.locator('[data-eval-refresh]').click();
      await expect(pending).toHaveCount(0);
      await expect(completed).toHaveText('Judge 已完成判定 2');
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
});

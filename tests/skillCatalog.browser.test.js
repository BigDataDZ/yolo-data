import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { TEST_PASSWORD, skillDocument, withSkillServer } from './fixtures/skillServer.js';

test('browser: Skill upload/update/toggle/delete, HTML escaping and analyst boundary', {
  skip: !process.env.YOLO_SKILL_BROWSER_TEST, timeout: 90000,
}, async () => {
  const { chromium, expect } = await import('@playwright/test');
  await withSkillServer(async ({ application, baseUrl, directory }) => {
    const artifacts = process.env.YOLO_SKILL_BROWSER_ARTIFACT_DIR ?? path.join(directory, 'screenshots');
    fs.mkdirSync(artifacts, { recursive: true });
    const browser = await chromium.launch({ headless: true, ...(process.env.YOLO_BROWSER_CHANNEL ? { channel: process.env.YOLO_BROWSER_CHANNEL } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => { window.skillHtmlExecuted = false; });
    const code = 'upload:browser-html-probe';
    const row = page.locator(`tr:has([data-skill-toggle="${code}"])`);
    const name = '<img src=x onerror=window.skillHtmlExecuted=true>';
    const description = '<script>window.skillHtmlExecuted=true</script>';
    const content = `---\ncode: browser-html-probe\nname: ${name}\ndescription: ${description}\nphases: [PLAN]\n---\n\n## Workflow\n按授权数据分析。`;
    const chooseFile = (filename, text) => page.locator('#skillUploadFile').setInputFiles({ name: filename, mimeType: 'text/markdown', buffer: Buffer.from(text) });
    const upload = async (text) => {
      await chooseFile('probe<img src=x onerror=window.skillHtmlExecuted=true>.md', text);
      const saved = page.waitForResponse((response) => response.url().endsWith('/api/skill-catalog/upload'));
      await page.locator('#skillUploadBtn').click();
      assert.equal((await saved).status(), 200);
      await expect(row).toBeVisible();
    };
    const toggle = async () => {
      const changed = page.waitForResponse((response) => response.url().endsWith('/api/skill-catalog/status'));
      await row.locator('[data-skill-toggle]').click();
      assert.equal((await changed).status(), 200);
    };
    try {
      await page.goto(`${baseUrl}/skills`);
      await page.locator('#loginUsername').fill('admin');
      await page.locator('#loginPassword').fill(TEST_PASSWORD);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.locator('#skillUploadBtn')).toBeDisabled();
      await expect(page.locator('#skillUploadSelected')).toBeHidden();
      const transfer = await page.evaluateHandle(() => {
        const value = new DataTransfer();
        value.items.add(new File(['# Workflow\n拖拽上传测试'], 'dragged.md', { type: 'text/markdown' }));
        return value;
      });
      await page.locator('#skillUploadDropzone').dispatchEvent('drop', { dataTransfer: transfer });
      await transfer.dispose();
      await expect(page.locator('#skillUploadSelected')).toContainText('dragged.md');
      await expect(page.locator('#skillUploadBtn')).toBeEnabled();
      await page.locator('#skillUploadFile').setInputFiles([]);
      await expect(page.locator('#skillUploadSelected')).toBeHidden();
      await expect(page.locator('#skillUploadBtn')).toBeDisabled();
      await chooseFile('wrong.exe', skillDocument());
      await expect(page.locator('#skillUploadSelected')).toContainText('仅支持 .md / .markdown');
      await expect(page.locator('#skillUploadBtn')).toBeDisabled();
      await chooseFile('too-big.md', 'x'.repeat(201 * 1024));
      await expect(page.locator('#skillUploadSelected')).toContainText('200KB');
      await expect(page.locator('#skillUploadBtn')).toBeDisabled();
      await upload(content);
      await expect(row).toContainText(name);
      await expect(row).toContainText(description);
      await expect(page.locator('img[src="x"]')).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.skillHtmlExecuted), false);
      await page.screenshot({ path: path.join(artifacts, 'skill-html-escaped.png'), fullPage: true, animations: 'disabled' });

      const theme = application.database.listThemes()[0];
      const bound = await page.request.put(`${baseUrl}/api/themes/${theme.id}`, { data: { ...application.database.getTheme(theme.id), skillCodes: [code] } });
      assert.equal(bound.status(), 200);
      await page.reload();
      await expect(row).toContainText('1 个智能体');
      await toggle();
      await expect(row).toContainText('已停用');
      assert.equal(application.skillRegistry.listForTheme(application.database.getTheme(theme.id)).some((skill) => skill.code === code), false);
      await upload(`${content}\n新版步骤`);
      await expect(row).toContainText('已停用');
      assert.equal(application.skillCatalog.list().skills.filter((skill) => skill.code === code).length, 1);
      await toggle();
      await expect(row).toContainText('已启用');
      const active = application.skillRegistry.listForTheme(application.database.getTheme(theme.id));
      assert.ok(application.skillRegistry.buildPhaseInstructions(active, 'PLAN').some((entry) => entry.code === code && entry.guidance.includes('新版步骤')));

      // Cancel first, so the confirmation cannot silently delete a referenced Skill.
      const canceled = page.waitForEvent('dialog');
      const cancelClick = row.locator('[data-skill-delete]').click();
      const cancelDialog = await canceled;
      assert.ok(cancelDialog.message().includes(theme.name));
      await cancelDialog.dismiss(); await cancelClick;
      await expect(row).toBeVisible();
      const confirmation = page.waitForEvent('dialog');
      const deleted = page.waitForResponse((response) => response.url().endsWith('/api/skill-catalog/delete'));
      const deleteClick = row.locator('[data-skill-delete]').click();
      const dialog = await confirmation;
      assert.ok(dialog.message().includes('引用'));
      await dialog.accept(); await deleteClick;
      assert.equal((await deleted).status(), 200);
      await expect(row).toHaveCount(0);
      assert.equal(application.database.getSkill(code), null);
      assert.equal(application.database.listThemeSkillCodes(theme.id).includes(code), false);
      await expect(page.locator('tr:has([data-skill-toggle="trend_analysis"]) [data-skill-delete]')).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.skillHtmlExecuted), false);
      await page.screenshot({ path: path.join(artifacts, 'skill-lifecycle-complete.png'), fullPage: true, animations: 'disabled' });

      await page.request.post(`${baseUrl}/api/auth/logout`);
      await page.goto(`${baseUrl}/skills`);
      await page.locator('#loginUsername').fill('east_manager');
      await page.locator('#loginPassword').fill(TEST_PASSWORD);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByText('Skills仅对平台管理员开放', { exact: true })).toBeVisible();
      await expect(page.locator('#skillUploadFile')).toHaveCount(0);
      const refused = await page.request.post(`${baseUrl}/api/skill-catalog/upload`, { data: { content: skillDocument('forbidden') } });
      assert.equal(refused.status(), 403);
      assert.equal(application.database.getSkill('upload:forbidden'), null);
      assert.deepEqual(errors, []);
    } catch (error) {
      await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {});
      throw error;
    } finally { await browser.close(); }
  });
});

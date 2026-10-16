import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { setUserPassword } from '../src/auth.js';

test('browser: PostgreSQL datasource form, API persistence, connection test and dataset creation', {
  skip: !process.env.YOLO_BROWSER_TEST, timeout: 90000,
}, async (t) => {
  const { chromium, expect } = await import('@playwright/test');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yolo-pg-browser-'));
  const artifactDirectory = process.env.YOLO_BROWSER_ARTIFACT_DIR ?? path.join(directory, 'screenshots');
  fs.mkdirSync(artifactDirectory, { recursive: true });
  const config = { ...loadConfig({}), port: 0, authMode: 'session',
    dbPath: path.join(directory, 'platform.db'), datasourceSecretKeyPath: path.join(directory, '.key'),
    codeExecutionRoot: path.join(directory, 'code-runs'), userMemory: { maintenanceIntervalMs: 0 },
  };
  const { server, application } = await startServer(config);
  setUserPassword(application.database, application.database.getUserByUsername('admin').id, 'browser-test-password');
  const browser = await chromium.launch({ headless: true, ...(process.env.YOLO_BROWSER_CHANNEL ? { channel: process.env.YOLO_BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let setup;
  const schema = `yolo_browser_${process.pid}_${Date.now()}`;
  const live = Boolean(process.env.YOLO_PG_TEST_DATABASE);
  if (!live) t.diagnostic('No test PostgreSQL configured: validating form, persistence and connection failure UI only.');
  try {
    if (live) {
      const { default: pg } = await import('pg');
      setup = new pg.Pool({ database: process.env.YOLO_PG_TEST_DATABASE });
      await setup.query(`CREATE SCHEMA "${schema}"`);
      await setup.query(`CREATE TABLE "${schema}".sales(sale_date date, region text, amount numeric(12,2))`);
      await setup.query(`INSERT INTO "${schema}".sales VALUES ('2026-01-01','east',10),('2026-02-01','west',20)`);
    }
    await page.goto(`http://127.0.0.1:${server.address().port}/datasets`);
    await page.locator('#loginUsername').fill('admin');
    await page.locator('#loginPassword').fill('browser-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.locator('[data-dataset-tab="sources"]').click();
    await page.locator('#addDatasourceBtn').click();
    await expect(page.locator('#sourcePostgresOptions')).toBeHidden();
    await page.locator('[data-source-type="POSTGRESQL"]').click();
    await expect(page.locator('#sourcePort')).toHaveValue('5432');
    await expect(page.locator('#sourcePostgresOptions')).toBeVisible();
    await page.locator('#sourceName').fill('Browser PostgreSQL');
    await page.locator('#sourceHost').fill(process.env.PGHOST ?? '127.0.0.1');
    await page.locator('#sourcePort').fill(process.env.PGPORT ?? '1');
    await page.locator('#sourceUsername').fill(process.env.PGUSER ?? 'test');
    await page.locator('#sourcePassword').fill(process.env.PGPASSWORD ?? 'test-password');
    await page.locator('#saveDatasourceBtn').click();
    await expect(page.getByText('请填写 PostgreSQL 连接数据库', { exact: true })).toBeVisible();
    await page.locator('#sourceDatabase').fill(process.env.YOLO_PG_TEST_DATABASE ?? 'browser_test');
    // Exercise the visible custom select, rather than programmatically setting its hidden select.
    await page.locator('.ui-select:has(#sourceSsl) .ui-select-trigger').click();
    await page.locator('button.ui-select-option[data-value="verify"]').click();
    const ca = process.env.YOLO_PG_TEST_CA ? fs.readFileSync(process.env.YOLO_PG_TEST_CA, 'utf8') : 'TEST CA\n';
    await page.locator('#sourceCa').fill(ca);
    await page.screenshot({ path: path.join(artifactDirectory, 'postgresql-form.png'), fullPage: true, animations: 'disabled' });
    const savedResponse = page.waitForResponse((response) => response.url().endsWith('/api/data-sources') && response.request().method() === 'POST');
    await page.locator('#saveDatasourceBtn').click();
    const response = await savedResponse;
    assert.equal(response.status(), 200);
    const saved = await response.json();
    assert.equal(saved.dbType, 'POSTGRESQL');
    assert.equal(saved.options.ssl.ca, ca.trim());
    const stored = application.database.getDataSource(saved.id);
    assert.notEqual(stored.encryptedPassword, process.env.PGPASSWORD ?? 'test-password');
    assert.equal(application.businessDatasets.crypto.decrypt(stored.encryptedPassword), process.env.PGPASSWORD ?? 'test-password');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const sourceRow = page.locator('tr').filter({ hasText: 'Browser PostgreSQL' });
    const testedResponse = page.waitForResponse((result) => result.url().endsWith(`/api/data-sources/${saved.id}/test`));
    await sourceRow.getByRole('button', { name: '测试连接' }).click();
    const tested = await (await testedResponse).json();
    assert.equal(tested.lastTestOk, live);
    await expect(sourceRow).toContainText(live ? '成功' : '失败');
    const edit = sourceRow.getByRole('button', { name: '编辑', exact: true });
    await expect(edit).toBeVisible({ timeout: 5000 });
    await edit.click();
    await expect(page.getByRole('dialog')).toContainText('编辑数据源');
    await expect(page.locator('#sourceName')).toHaveValue('Browser PostgreSQL');
    await expect(page.locator('#sourceDatabase')).toHaveValue(process.env.YOLO_PG_TEST_DATABASE ?? 'browser_test');
    await expect(page.locator('#sourcePassword')).toHaveValue('');
    await expect(page.locator('#sourcePassword')).toHaveAttribute('placeholder', '留空保留原密码');
    await expect(page.locator('#sourceCa')).toHaveValue(ca.trim());
    await expect(page.locator('#sourceSsl')).toHaveValue('verify');
    for (const tile of await page.locator('.datasource-type-tile').all()) await expect(tile).toBeDisabled();
    const originalPort = await page.locator('#sourcePort').inputValue();
    await page.locator('#sourceName').fill('<Edited PostgreSQL>');
    await page.locator('#sourcePort').fill(originalPort === '1' ? '2' : '1');
    const editResponse = () => page.waitForResponse(result => result.url().endsWith(`/api/data-sources/${saved.id}`) && result.request().method() === 'PUT');
    let saving = editResponse();
    await page.locator('#saveDatasourceBtn').click();
    const edited = await (await saving).json();
    assert.equal(edited.lastTestOk, null);
    assert.equal(Object.hasOwn(edited, 'encryptedPassword'), false);
    assert.equal(application.database.getDataSource(saved.id).encryptedPassword, stored.encryptedPassword);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const editedRow = page.locator('tr').filter({ hasText: '<Edited PostgreSQL>' });
    await expect(editedRow).toContainText('未测试');
    let testing = page.waitForResponse(result => result.url().endsWith(`/api/data-sources/${saved.id}/test`));
    await editedRow.getByRole('button', { name: '测试连接' }).click();
    assert.equal((await (await testing).json()).lastTestOk, false);
    await expect(editedRow).toContainText('失败');
    await editedRow.getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator('#sourcePort').fill(originalPort);
    saving = editResponse();
    await page.locator('#saveDatasourceBtn').click();
    assert.equal((await saving).status(), 200);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    testing = page.waitForResponse(result => result.url().endsWith(`/api/data-sources/${saved.id}/test`));
    await editedRow.getByRole('button', { name: '测试连接' }).click();
    assert.equal((await (await testing).json()).lastTestOk, live);
    await expect(editedRow).toContainText(live ? '成功' : '失败');
    assert.equal(application.database.getDataSource(saved.id).encryptedPassword, stored.encryptedPassword);
    if (live) {
      await page.locator('[data-dataset-tab="datasets"]').click();
      await page.locator('#addDatasetBtn').click();
      await expect(page.locator('#datasetSchema')).toHaveValue('public');
      await page.locator('#datasetCode').fill('browser_pg_sales');
      await page.locator('#datasetName').fill('Browser sales dataset');
      await page.locator('#datasetSchema').fill(schema);
      await page.locator('#datasetTable').fill('sales');
      const datasetResponse = page.waitForResponse((result) => result.url().endsWith('/api/business-datasets') && result.request().method() === 'POST');
      await page.locator('#saveDatasetBtn').click();
      const created = await datasetResponse;
      assert.equal(created.status(), 200);
      const dataset = await created.json();
      assert.equal(application.database.listDatasetFields(dataset.id).length, 3);
      assert.equal(application.database.getBusinessDataset(dataset.id).schemaName, schema);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const row = page.locator('tr').filter({ hasText: 'Browser sales dataset' });
      await row.getByRole('button', { name: '抽样', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('east');
      await expect(page.getByRole('dialog')).toContainText('west');
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).first().click();
      const cachedPool = application.businessDatasets.getPoolById(saved.id);
      const sourceUrl = `http://127.0.0.1:${server.address().port}/api/data-sources/${saved.id}`;
      const sampleUrl = `http://127.0.0.1:${server.address().port}/api/business-datasets/${dataset.id}/sample`;
      assert.equal((await page.request.put(sourceUrl, { data: { port: 1, password: '' } })).status(), 200);
      assert.equal((await page.request.get(sampleUrl)).status(), 500, 'queries must use the changed connection, not a stale cached pool');
      assert.equal((await page.request.put(sourceUrl, { data: { port: Number(originalPort) } })).status(), 200);
      const reconnected = await page.request.get(sampleUrl);
      assert.equal(reconnected.status(), 200);
      assert.deepEqual((await reconnected.json()).rows.map(row => row.region).sort(), ['east', 'west']);
      assert.notEqual(application.businessDatasets.getPoolById(saved.id), cachedPool);
      assert.equal(application.database.getBusinessDataset(dataset.id).datasourceId, saved.id);
      assert.equal(application.database.listDatasetFields(dataset.id).length, 3);
    }
    await page.screenshot({ path: path.join(artifactDirectory, 'postgresql-result.png'), fullPage: true, animations: 'disabled' });
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: path.join(artifactDirectory, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    await Promise.all([...application.businessDatasets.pools.values()].map((pool) => pool.end()));
    application.businessDatasets.pools.clear();
    application.memoryMaintenance.stop();
    await new Promise((resolve) => server.close(resolve));
    application.database.close();
    if (setup) { await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await setup.end(); }
  }
});

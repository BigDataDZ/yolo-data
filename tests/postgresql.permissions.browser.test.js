import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { TEST_PASSWORD, withSkillServer } from './fixtures/skillServer.js';

const QUESTION = '2026年1月1日至2026年3月31日 按月 west amount';

// Only the model's tool selection is fixed. Tools, auth, contracts and SQL remain real.
function acceptanceAgent(application, datasetId) {
  let attempts = 0;
  application.agent.harnessFactory = { forTheme: () => ({
    mode: 'local-rule', model: 'browser-permission-acceptance', capabilities: {},
    run: async ({ executeTool }) => {
      attempts++;
      const listing = await executeTool('list_business_datasets', {});
      if (!listing.datasets.some(dataset => dataset.id === datasetId)) {
        await assert.rejects(executeTool('get_business_dataset_definition', { datasetId }), /permission denied/);
        await assert.rejects(executeTool('query_business_dataset', {
          datasetId, metrics: [{ field: 'amount', aggregator: 'SUM' }],
        }), /permission denied/);
        await assert.rejects(executeTool('compile_query_contract', {
          sourceType: 'BUSINESS_DATASET', datasetId,
        }), /必须先确认|permission denied/);
        return { content: '数据集权限不足，请联系管理员。', trace: [] };
      }
      await executeTool('get_business_dataset_definition', { datasetId });
      const compiled = await executeTool('compile_query_contract', {
        sourceType: 'BUSINESS_DATASET', datasetId,
        conditions: [
          { id: 'time', sourceText: '2026年1月1日至2026年3月31日', kind: 'TIME', status: 'RESOLVED' },
          { id: 'grain', sourceText: '按月', kind: 'DIMENSION', status: 'RESOLVED' },
          { id: 'region', sourceText: 'west', kind: 'FILTER', status: 'RESOLVED' },
          { id: 'metric', sourceText: 'amount', kind: 'METRIC', status: 'RESOLVED' },
        ],
        metricFields: [{ field: 'amount', sourceText: 'amount', aggregator: 'SUM', conditionIds: ['metric'] }],
        dimensionFields: [{ field: 'day', sourceText: '按月', timeGrain: 'MONTH', conditionIds: ['grain'] }],
        timeGrain: 'MONTH',
        filterFields: [{ field: 'region', operator: 'IN', value: ['west'], sourceText: 'west', conditionIds: ['region'] }],
        timeWindows: [{ sourceText: '2026年1月1日至2026年3月31日', dateMode: 'BETWEEN',
          startDate: '2026-01-01', endDate: '2026-03-31', conditionIds: ['time'] }],
        limit: 20,
      });
      assert.equal(compiled.valid, true, JSON.stringify(compiled.issues));
      const executed = await executeTool('execute_query_contract', { contractId: compiled.contractId });
      assert.equal(executed.locked, true);
      return { content: '受控查询已完成。', trace: [] };
    },
  }) };
  return () => attempts;
}

test('live PostgreSQL browser: admin setup, analyst chart and same-session permission revocation', {
  skip: process.env.YOLO_PERMISSION_BROWSER_TEST !== '1' || !process.env.YOLO_PG_TEST_DATABASE,
  timeout: 180_000,
}, async t => {
  const { chromium, expect } = await import('@playwright/test');
  const { default: pg } = await import('pg');
  const setup = new pg.Pool({ database: process.env.YOLO_PG_TEST_DATABASE });
  const schema = `yolo_permission_browser_${process.pid}_${Date.now()}`;
  try {
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.query(`CREATE TABLE "${schema}".sales(day date, region text, amount numeric(12,2))`);
    await setup.query(`INSERT INTO "${schema}".sales VALUES
      ('2026-01-01','east',4),('2026-01-15','east',6),
      ('2026-02-01','east',30),('2026-02-01','west',1000)`);
    await withSkillServer(async ({ application, baseUrl, directory }) => {
      const artifacts = process.env.YOLO_PERMISSION_BROWSER_ARTIFACT_DIR ?? path.join(directory, 'screenshots');
      fs.mkdirSync(artifacts, { recursive: true });
      const browser = await chromium.launch({ headless: true,
        ...(process.env.YOLO_BROWSER_CHANNEL ? { channel: process.env.YOLO_BROWSER_CHANNEL } : {}),
      });
      const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const analystContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const admin = await adminContext.newPage();
      const analyst = await analystContext.newPage();
      const errors = [];
      for (const page of [admin, analyst]) page.on('pageerror', error => errors.push(error.message));
      const responseFor = (page, route, method) => page.waitForResponse(response =>
        response.url().endsWith(route) && response.request().method() === method);
      async function login(page, username, route) {
        await page.goto(`${baseUrl}${route}`);
        await page.locator('#loginUsername').fill(username);
        await page.locator('#loginPassword').fill(TEST_PASSWORD);
        await page.getByRole('button', { name: '登录', exact: true }).click();
        await expect(page.locator('#loginUsername')).toHaveCount(0);
      }
      async function pick(page, selector, value) {
        await page.locator(`.ui-select:has(${selector}) .ui-select-trigger`).click();
        await page.locator(`button.ui-select-option[data-value="${value}"]`).click();
      }
      try {
        await login(admin, 'admin', '/datasets');
        await admin.locator('[data-dataset-tab="sources"]').click();
        await admin.locator('#addDatasourceBtn').click();
        await admin.locator('[data-source-type="POSTGRESQL"]').click();
        await admin.locator('#sourceName').fill('Permission acceptance PostgreSQL');
        await admin.locator('#sourceHost').fill(process.env.PGHOST ?? '127.0.0.1');
        await admin.locator('#sourcePort').fill(process.env.PGPORT ?? '5432');
        await admin.locator('#sourceDatabase').fill(process.env.YOLO_PG_TEST_DATABASE);
        await admin.locator('#sourceUsername').fill(process.env.PGUSER ?? 'postgres');
        await admin.locator('#sourcePassword').fill(process.env.PGPASSWORD ?? '');
        if (process.env.YOLO_PG_TEST_CA) {
          await pick(admin, '#sourceSsl', 'verify');
          await admin.locator('#sourceCa').fill(fs.readFileSync(process.env.YOLO_PG_TEST_CA, 'utf8'));
        }
        let saving = responseFor(admin, '/api/data-sources', 'POST');
        await admin.locator('#saveDatasourceBtn').click();
        let response = await saving;
        assert.equal(response.status(), 200);
        const source = await response.json();
        await expect(admin.getByRole('dialog')).toHaveCount(0);
        await admin.locator('[data-dataset-tab="datasets"]').click();
        await admin.locator('#addDatasetBtn').click();
        await admin.locator('#datasetCode').fill('browser_permission_sales');
        await admin.locator('#datasetName').fill('Permission sales');
        await admin.locator('#datasetSchema').fill(schema);
        await admin.locator('#datasetTable').fill('sales');
        saving = responseFor(admin, '/api/business-datasets', 'POST');
        await admin.locator('#saveDatasetBtn').click();
        response = await saving;
        assert.equal(response.status(), 200);
        const dataset = await response.json();
        await expect(admin.getByRole('dialog')).toHaveCount(0);

        await admin.goto(`${baseUrl}/themes/new`);
        await admin.locator('#themeName').fill('Browser permission theme');
        await admin.locator('#themePrompt').fill('amount 为销售额，使用 SUM；day 为日期，region 为区域。');
        await admin.locator('#themeDimensions').fill('day, region');
        await admin.locator(`[name="themeBusinessDataset"][value="${dataset.id}"]`).check();
        await pick(admin, '#themeDefaultChart', 'line');
        saving = responseFor(admin, '/api/themes', 'POST');
        await admin.locator('#saveThemeBtn').click();
        response = await saving;
        assert.equal(response.status(), 200, await response.text());
        const theme = await response.json();
        const user = application.database.getUserByUsername('east_manager');
        await admin.goto(`${baseUrl}/permissions`);
        await admin.locator(`[data-permission-user="${user.id}"]`).click();
        await expect(admin.locator(`[name="themeGrant"][value="${theme.id}"]`)).toBeVisible();
        for (const checkbox of await admin.locator('[name="themeGrant"]').all()) await checkbox.uncheck();
        await admin.locator(`[name="themeGrant"][value="${theme.id}"]`).check();
        await admin.locator(`[name="datasetGrant"][value="${dataset.id}"]`).check();
        const removePolicy = admin.locator('#rowPolicyTable [data-remove-policy], #columnPolicyTable [data-remove-policy]');
        while (await removePolicy.count()) await removePolicy.first().click();
        await admin.locator('#addRowPolicyBtn').click();
        const policy = admin.locator('#rowPolicyTable tbody tr').last();
        await policy.locator('[data-policy-dimension]').fill('region');
        await policy.locator('[data-policy-values]').fill('east');
        async function savePermissions() {
          const saved = responseFor(admin, `/api/users/${user.id}/permissions`, 'PUT');
          await admin.locator('#savePermissionsBtn').click();
          assert.equal((await saved).status(), 200);
          await expect(admin.locator('#savePermissionsBtn')).toBeEnabled();
        }
        await savePermissions();
        assert.ok(application.database.getPermissionProfile(user.id).datasetGrants.some(grant => grant.datasetId === dataset.id));

        const attempts = acceptanceAgent(application, dataset.id);
        const statements = [];
        const pool = application.businessDatasets.getPoolById(source.id);
        const query = pool.query.bind(pool);
        pool.query = (config, ...args) => {
          statements.push(typeof config === 'string' ? { sql: config, values: [] }
            : { sql: config.sql, values: structuredClone(config.values ?? []) });
          return query(config, ...args);
        };
        const logs = () => application.database.listDatasetQueryLogs(100).filter(log => log.datasetId === dataset.id);
        await login(analyst, 'east_manager', '/query');
        await expect(analyst.locator('#questionInput')).toBeVisible();
        await analyst.locator('[data-onb-skip]').click();
        await expect(analyst.locator('[data-onb-skip]')).toHaveCount(0);
        async function ask(question) {
          await analyst.locator('#questionInput').fill(question);
          const [streamed] = await Promise.all([
            responseFor(analyst, '/api/chat/query/stream', 'POST'),
            analyst.locator('#runQueryBtn').click(),
          ]);
          const body = await streamed.text();
          await expect(analyst.locator('#runQueryBtn')).toBeVisible();
          return { response: streamed, body };
        }
        function finalAnswer(body) {
          const events = body.trim().split('\n').map(line => JSON.parse(line));
          assert.equal(events.some(event => event.type === 'stream_error'), false, body);
          const answer = events.find(event => event.type === 'final')?.answer;
          assert.ok(answer, body);
          return answer;
        }
        const successful = await ask(QUESTION);
        assert.equal(successful.response.status(), 200);
        const answer = finalAnswer(successful.body);
        assert.deepEqual(answer.data.rows.map(row => [row.day, Number(row.amount)]).sort(), [['2026-01-01', 10], ['2026-02-01', 30]]);
        assert.equal(answer.semanticParse.timeGrain, 'MONTH');
        assert.equal(answer.runtime.executionAdapter, 'postgresql-dataset');
        const chart = analyst.locator('.chat-chart-canvas').last();
        await expect(chart.locator('canvas')).toBeVisible();
        const plotted = await chart.evaluate(element => window.echarts.getInstanceByDom(element).getOption().series[0].data);
        assert.deepEqual(plotted.map(Number), [10, 30]);
        await analyst.screenshot({ path: path.join(artifacts, 'authorized-chart.png'), fullPage: true });
        const audit = logs();
        assert.equal(audit.length, 1);
        assert.equal(audit[0].userId, user.id);
        const executed = statements.find(statement => statement.sql === audit[0].sqlText);
        assert.ok(executed);
        assert.ok(executed.values.flat(Infinity).includes('east'));
        assert.equal(executed.values.flat(Infinity).includes('west'), false);
        const statementCount = statements.length;

        await admin.locator(`[name="datasetGrant"][value="${dataset.id}"]`).uncheck();
        await savePermissions();
        const denied = await ask(`重新查询：${QUESTION}`);
        assert.equal(denied.response.status(), 200);
        assert.equal(denied.response.request().postDataJSON().sessionId, answer.sessionId);
        const rejected = finalAnswer(denied.body);
        assert.deepEqual(rejected.data.rows, []);
        assert.deepEqual(rejected.executionResults, []);
        assert.equal(rejected.queryFingerprint, null);
        const lastAnswer = analyst.locator('.chat-message.is-assistant').last();
        await expect(lastAnswer).toContainText('权限不足');
        await expect(lastAnswer.locator('.chat-chart-panel, .chat-data-details')).toHaveCount(0);
        assert.deepEqual(logs(), audit);
        assert.equal(statements.length, statementCount);
        assert.equal(attempts(), 2);
        await analyst.screenshot({ path: path.join(artifacts, 'dataset-revoked.png'), fullPage: true });

        await admin.locator(`[name="themeGrant"][value="${theme.id}"]`).uncheck();
        await savePermissions();
        const forbidden = await ask(`重新查询：${QUESTION}`);
        assert.equal(forbidden.response.status(), 403);
        assert.equal(forbidden.response.request().postDataJSON().sessionId, answer.sessionId);
        assert.equal(attempts(), 2, 'theme revocation must block before invoking the model');
        assert.deepEqual(logs(), audit);
        assert.equal(statements.length, statementCount);
        await expect(analyst.locator('.chat-message.is-assistant').last()).toContainText('本次查询失败');
        assert.deepEqual(errors, []);
        t.diagnostic('Real browser/session/SQLite/PostgreSQL; fixed model tool selection, no external LLM.');
      } catch (error) {
        await Promise.all([admin, analyst].map((page, index) => page.screenshot({
          path: path.join(artifacts, `failure-${index}.png`), fullPage: true,
        }).catch(() => {})));
        throw error;
      } finally { await browser.close(); }
    });
  } finally {
    try { await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await setup.end(); }
  }
});

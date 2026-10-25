import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { withSkillServer } from './fixtures/skillServer.js';

test('live PostgreSQL: authenticated Agent contract, row policy, audit and same-session revocation', {
  skip: !process.env.YOLO_PG_TEST_DATABASE, timeout: 90000,
}, async (t) => {
  const { default: pg } = await import('pg');
  const setup = new pg.Pool({ database: process.env.YOLO_PG_TEST_DATABASE });
  const schema = `yolo_query_${process.pid}_${Date.now()}`;
  const platformDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'yolo-pg-query-'));
  try {
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.query(`CREATE TABLE "${schema}".sales(day date, region text, amount numeric(12,2))`);
    await setup.query(`INSERT INTO "${schema}".sales VALUES
      ('2026-01-01','east',10),('2026-02-01','east',30),('2026-02-01','west',1000)`);
    await withSkillServer(async ({ application, request, login, baseUrl }) => {
      try {
        const admin = await login('admin');
        const analyst = await login('east_manager');
        const user = application.database.getUserByUsername('east_manager');
        const post = async (route, body) => {
          const result = await request(route, { cookie: admin, method: 'POST', body });
          assert.equal(result.response.status, 200, JSON.stringify(result.data));
          return result.data;
        };
        application.database.savePlatformSetting('本地指标目录.enabled', false);
        const source = await post('/api/data-sources', {
          name: 'Acceptance PostgreSQL', dbType: 'POSTGRESQL',
          host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 5432),
          databaseName: process.env.YOLO_PG_TEST_DATABASE,
          username: process.env.PGUSER ?? 'postgres', password: process.env.PGPASSWORD ?? '',
          options: process.env.YOLO_PG_TEST_CA
            ? { ssl: { rejectUnauthorized: true, ca: fs.readFileSync(process.env.YOLO_PG_TEST_CA, 'utf8') } } : {},
        });
        const dataset = await post('/api/business-datasets', {
          code: 'acceptance_sales', name: 'Acceptance sales', datasourceId: source.id,
          schemaName: schema, primaryTable: 'sales',
          config: { autoLatestDateRange: false, policyFieldMap: { region: 'region' } },
        });
        const fields = await request(`/api/business-datasets/${dataset.id}/fields`, { cookie: admin });
        assert.equal(fields.response.status, 200);
        assert.equal(fields.data.find((field) => field.fieldName === 'amount').role, 'METRIC');
        // Observe actual bound values while delegating every call unchanged to the real driver.
        const statements = [];
        const pool = application.businessDatasets.getPoolById(source.id);
        const realQuery = pool.query.bind(pool);
        pool.query = (config, ...args) => {
          statements.push(typeof config === 'string' ? { sql: config, values: [] }
            : { sql: config.sql, values: structuredClone(config.values ?? []) });
          return realQuery(config, ...args);
        };
        const theme = application.database.getTheme(1);
        assert.equal((await request('/api/themes/1', { cookie: admin, method: 'PUT', body: {
          ...theme, indicatorIds: [], businessDatasetIds: [dataset.id], primaryBusinessDatasetId: dataset.id,
          semanticPolicy: {}, systemPrompt: 'amount 为销售额，使用 SUM；day 为日期，region 为区域。',
        } })).response.status, 200);
        const profile = { ...application.database.getPermissionProfile(user.id),
          themeGrants: [{ themeId: 1, canQuery: true, canManage: false }],
          datasetGrants: [], rowPolicies: [{ themeId: 1, dimension: 'region', operator: 'IN',
            valueSource: 'STATIC', values: ['east'], enabled: true }],
        };
        const setPermissions = async (body) => {
          assert.equal((await request(`/api/users/${user.id}/permissions`, {
            cookie: admin, method: 'PUT', body,
          })).response.status, 200);
        };
        const question = '2026年1月1日至2026年3月31日 west amount';
        let attempts = 0;
        application.agent.harnessFactory = { forTheme: () => ({
          mode: 'local-rule', model: 'deterministic-acceptance', capabilities: {},
          run: async ({ executeTool }) => {
            attempts += 1;
            const listing = await executeTool('list_business_datasets', {});
            if (!listing.datasets.some((item) => item.id === dataset.id)) {
              await assert.rejects(executeTool('get_business_dataset_definition', { datasetId: dataset.id }), /permission denied/);
              await assert.rejects(executeTool('query_business_dataset', { datasetId: dataset.id,
                metrics: [{ field: 'amount', aggregator: 'SUM' }],
              }), /permission denied/);
              await assert.rejects(executeTool('compile_query_contract', {
                sourceType: 'BUSINESS_DATASET', datasetId: dataset.id,
              }), /必须先确认|permission denied/);
              return { content: '数据集权限不足。', trace: [] };
            }
            await executeTool('get_business_dataset_definition', { datasetId: dataset.id });
            const compiled = await executeTool('compile_query_contract', {
              sourceType: 'BUSINESS_DATASET', datasetId: dataset.id,
              conditions: [
                { id: 'time', sourceText: '2026年1月1日至2026年3月31日', kind: 'TIME', status: 'RESOLVED' },
                { id: 'region', sourceText: 'west', kind: 'FILTER', status: 'RESOLVED' },
                { id: 'metric', sourceText: 'amount', kind: 'METRIC', status: 'RESOLVED' },
              ],
              metricFields: [{ field: 'amount', sourceText: 'amount', aggregator: 'SUM', conditionIds: ['metric'] }],
              dimensionFields: [],
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
        const query = (body) => request('/api/chat/query', { cookie: analyst, method: 'POST', body });
        const logs = () => application.database.listDatasetQueryLogs(100)
          .filter((log) => Number(log.datasetId) === Number(dataset.id));
        const denied = await query({ themeId: 1, question });
        assert.equal(denied.response.status, 200, JSON.stringify(denied.data));
        assert.deepEqual(denied.data.executionResults, []);
        assert.deepEqual(denied.data.data.rows, []);
        assert.deepEqual(logs(), []);
        const granted = { ...profile, datasetGrants: [{ datasetId: dataset.id, canQuery: true }] };
        await setPermissions(granted);
        const streamed = await fetch(`${baseUrl}/api/chat/query/stream`, {
          method: 'POST', headers: { Cookie: analyst, 'Content-Type': 'application/json' },
          body: JSON.stringify({ themeId: 1, question }),
        });
        assert.equal(streamed.status, 200);
        const events = (await streamed.text()).trim().split('\n').map((line) => JSON.parse(line));
        assert.deepEqual(events.filter((event) => event.type === 'stream_error'), []);
        const success = { response: streamed, data: events.find((event) => event.type === 'final')?.answer };
        assert.equal(success.response.status, 200, JSON.stringify(success.data));
        assert.ok(success.data);
        assert.equal(events.find((event) => event.type === 'execution_selected').source.mode, 'postgresql-dataset');
        assert.equal(success.data.runtime.executionAdapter, 'postgresql-dataset');
        assert.equal(success.data.semanticParse.execution.adapter, 'postgresql-dataset');
        assert.equal(success.data.semanticParse.execution.endpoint, 'PostgreSQL SQL SELECT');
        const executionStage = success.data.workflow.stages.find((stage) => stage.code === 'EXECUTE');
        assert.match(executionStage.summary, /PostgreSQL/);
        assert.ok(executionStage.evidence.some((item) => item.adapter === 'postgresql-dataset'));
        const resultArtifact = application.workspace.getArtifact({
          artifactId: success.data.executionResults[0].artifactId, userId: user.id,
        });
        assert.equal(resultArtifact.metadata.source.adapter, 'postgresql-dataset');
        const plan = application.database.getQueryPlan(success.data.semanticParse.planId, user.id);
        assert.equal(plan.evidence.execution.adapter, 'postgresql-dataset');
        assert.equal(success.data.deterministic, true);
        assert.equal(success.data.data.rows.length, 1);
        assert.equal(Number(success.data.data.rows[0].amount), 40);
        assert.ok(success.data.executionResults.length > 0);
        const audit = logs();
        assert.equal(audit.length, 1);
        assert.equal(Number(audit[0].userId), user.id);
        assert.equal(Number(audit[0].success), 1);
        assert.match(audit[0].sqlText, new RegExp(`"${schema}"\\."sales"`));
        assert.match(audit[0].sqlText, /"region"\s+IN\s*\(/);
        const executedStatement = statements.find((statement) => statement.sql === audit[0].sqlText);
        assert.ok(executedStatement, 'successful audit must match an observed real driver call');
        assert.ok(executedStatement.values.flat(Infinity).includes('east'));
        assert.ok(!executedStatement.values.flat(Infinity).includes('west'));
        const statementCount = statements.length;
        const sessionId = success.data.sessionId;
        assert.ok(sessionId);
        await setPermissions(profile);
        const revoked = await query({ sessionId, question: '重新查询：2026年1月1日至2026年3月31日 west amount' });
        assert.equal(revoked.response.status, 200, JSON.stringify(revoked.data));
        assert.deepEqual(revoked.data.executionResults, []);
        assert.deepEqual(revoked.data.data.rows, []);
        assert.equal(revoked.data.queryFingerprint, null);
        assert.equal(revoked.data.dataHash, null);
        assert.equal(revoked.data.deterministic, false);
        assert.deepEqual(logs(), audit);
        assert.equal(statements.length, statementCount);
        await setPermissions({ ...granted, themeGrants: [] });
        const forbidden = await query({ sessionId, question: '重新查询销售额' });
        assert.equal(forbidden.response.status, 403);
        assert.deepEqual(logs(), audit);
        assert.equal(statements.length, statementCount);
        assert.ok(attempts >= 3);
        t.diagnostic('Real HTTP/session/SQLite/PostgreSQL execution; deterministic model tools, no external LLM.');
      } finally {
        await application.businessDatasets.close();
      }
    }, { directory: platformDirectory });
  } finally {
    try { await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally {
      await setup.end();
      if (platformDirectory) fs.rmSync(platformDirectory, { recursive: true, force: true });
    }
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { withSkillServer } from './fixtures/skillServer.js';

test('authenticated streaming contracts keep explicit date ranges intact and apply row policy', async () => {
  await withSkillServer(async ({ application, login, baseUrl }) => {
    const cookie = await login('east_manager');
    const user = application.database.getUserByUsername('east_manager');
    const source = application.database.saveDataSource({
      code: 'range_pg', name: 'Range PostgreSQL', dbType: 'POSTGRESQL',
      host: 'localhost', port: 5432, databaseName: 'test', username: 'test',
      encryptedPassword: '', options: {},
    });
    const dataset = application.database.saveBusinessDataset({
      code: 'range_sales', name: 'Range sales', datasourceId: source.id,
      schemaName: 'public', primaryTable: 'sales',
      config: { autoLatestDateRange: false, policyFieldMap: { region: 'region' } },
    });
    application.database.replaceDatasetFields(dataset.id, [
      { fieldName: 'day', dataType: 'date', semanticType: 'DATE', role: 'TIME',
        aggregator: 'NONE', allowedOperators: ['BETWEEN'] },
      { fieldName: 'region', dataType: 'text', semanticType: 'STRING', role: 'DIMENSION',
        aggregator: 'NONE', allowedOperators: ['IN'] },
      { fieldName: 'amount', dataType: 'numeric', semanticType: 'NUMBER', role: 'METRIC',
        aggregator: 'SUM', allowedOperators: ['>', 'BETWEEN'] },
    ]);
    application.database.grantDatasetAccess(user.id, dataset.id, true);
    application.database.saveTheme({ ...application.database.getTheme(1), indicatorIds: [],
      businessDatasetIds: [dataset.id], primaryBusinessDatasetId: dataset.id,
      semanticPolicy: {}, systemPrompt: 'amount 为销售额，使用 SUM；day 为日期，region 为区域。',
    }, 1);
    application.database.savePlatformSetting('本地指标目录.enabled', false);
    const statements = [];
    // Keep auth, context, compiler, SQL generation and audit real; replace only database I/O.
    application.businessDatasets.getPoolById = () => ({ query: async (config) => {
      statements.push(config);
      return [[{ amount: 40 }], [{ name: 'amount' }]];
    } });
    application.agent.harnessFactory = { forTheme: () => ({
      mode: 'local-rule', model: 'range-acceptance', capabilities: {},
      run: async ({ executeTool }) => {
        await executeTool('list_business_datasets', {});
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
        await executeTool('execute_query_contract', { contractId: compiled.contractId });
        return { content: '受控查询已完成。', trace: [] };
      },
    }) };
    const response = await fetch(`${baseUrl}/api/chat/query/stream`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeId: 1, question: '2026年1月1日至2026年3月31日 west amount' }),
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(events.filter(event => event.type === 'stream_error'), []);
    const answer = events.find(event => event.type === 'final')?.answer;
    assert.ok(answer);
    assert.deepEqual(answer.data.rows, [{ amount: 40 }]);
    const plan = application.database.getQueryPlan(answer.semanticParse.planId, user.id);
    assert.equal(plan.status, 'EXECUTED');
    assert.equal(plan.plan.timeWindows[0].startDate, '2026-01-01');
    assert.equal(plan.plan.timeWindows[0].endDate, '2026-03-31');
    const audit = application.database.listDatasetQueryLogs(100).filter(log => log.datasetId === dataset.id);
    assert.equal(audit.length, 1);
    const statement = statements.find(item => item.sql === audit[0].sqlText);
    assert.ok(statement);
    assert.ok(statement.values.includes('2026-01-01'));
    assert.ok(statement.values.includes('2026-03-31'));
    assert.ok(statement.values.flat(Infinity).includes('华东'));
    assert.ok(!statement.values.flat(Infinity).includes('west'));
  });
});

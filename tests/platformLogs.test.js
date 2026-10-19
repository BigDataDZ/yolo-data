import assert from 'node:assert/strict';
import test from 'node:test';
import { PlatformDatabase } from '../src/database.js';
import { runWithTrace } from '../src/trace.js';

function fixture(t) {
  const database = new PlatformDatabase(':memory:');
  t.after(() => database.close());
  const user = database.getUserByUsername('admin');
  const source = database.saveDataSource({ code: 'log_source', name: 'Log source',
    dbType: 'MYSQL', host: 'never-connect.invalid', username: 'reader' });
  const dataset = database.saveBusinessDataset({ code: 'log_sales', name: 'Log sales',
    datasourceId: source.id, schemaName: 'analytics', primaryTable: 'sales' });
  const session = database.createChatSession({ userId: user.id, themeId: 1 });
  return { database, user, dataset, session };
}

test('platform logs preserve trace correlation, joined names and JSON return fields', t => {
  const { database, user, dataset, session } = fixture(t);
  const ids = runWithTrace('trace_log_contract', () => ({
    dataset: database.logDatasetQuery({ userId: user.id, sessionId: session.id,
      datasetId: dataset.id, sqlText: 'SELECT 1', rowCount: '3', latencyMs: '12', success: true }),
    audit: database.addAuditLog({ userId: user.id, themeId: 1,
      action: 'LOG_CONTRACT', detail: { datasetId: dataset.id, nested: ['a', 2] } }),
    llm: database.logLlmCall({ userId: user.id, sessionId: session.id, themeId: 1,
      callType: 'ANSWER', model: 'fixture', tokenUsage: { total_tokens: 10 }, success: true }),
  }));
  const [query] = database.listDatasetQueryLogs(100, { traceId: 'trace_log_contract' });
  assert.equal(query.id, ids.dataset);
  assert.equal(query.userName, user.displayName);
  assert.equal(query.datasetName, dataset.name);
  assert.equal(query.sessionId, session.id);
  assert.equal(query.sqlText, 'SELECT 1');
  assert.equal(query.rowCount, 3);
  assert.equal(query.latencyMs, 12);
  assert.equal(query.success, true);
  assert.match(query.createdAt, /^\d{4}-\d\d-\d\dT/);
  const [audit] = database.listAuditLogs(100, { traceId: 'trace_log_contract' });
  assert.equal(audit.id, ids.audit);
  assert.equal(audit.userName, user.displayName);
  assert.equal(audit.themeName, database.getTheme(1).name);
  assert.deepEqual(audit.detail, { datasetId: dataset.id, nested: ['a', 2] });
  assert.deepEqual(JSON.parse(audit.detailJson), audit.detail);
  const [llm] = database.listLlmLogs(200, { traceId: 'trace_log_contract' });
  assert.equal(llm.id, ids.llm);
  assert.equal(llm.userName, user.displayName);
  assert.equal(llm.themeName, audit.themeName);
  assert.deepEqual(llm.tokenUsage, { total_tokens: 10 });
  assert.equal(llm.success, true);
  for (const list of [database.listDatasetQueryLogs(), database.listAuditLogs(), database.listLlmLogs()]) {
    assert.equal(list[0].traceId, 'trace_log_contract');
  }
});

test('log listing keeps newest-first ordering, limits, failure fields and explicit trace filters', t => {
  const { database, dataset } = fixture(t);
  for (const traceId of ['trace_first', 'trace_first', 'trace_other']) {
    database.logDatasetQuery({ datasetId: dataset.id, traceId,
      sqlText: traceId, success: false, errorMessage: 'driver refused' });
    database.addAuditLog({ traceId, action: traceId });
  }
  const queries = database.listDatasetQueryLogs(1, { traceId: 'trace_first' });
  assert.equal(queries.length, 1);
  assert.equal(queries[0].id, 2);
  assert.equal(queries[0].success, false);
  assert.equal(queries[0].errorMessage, 'driver refused');
  assert.equal(queries[0].userName, null);
  assert.equal(database.listAuditLogs(1, { traceId: 'trace_first' })[0].id, 2);
  assert.deepEqual(database.listAuditLogs(10).map(row => row.id), [3, 2, 1]);
  assert.deepEqual(database.listDatasetQueryLogs(10, { traceId: 'trace_missing' }), []);
  assert.deepEqual(database.listAuditLogs(10, { traceId: 'trace_missing' }), []);
});

test('LLM log statistics, token budgets, digest bounds and damaged JSON remain compatible', t => {
  const { database, user } = fixture(t);
  const analyst = database.getUserByUsername('east_manager');
  const usage = [{ total_tokens: 10 }, { prompt_tokens: 3, completion_tokens: 4 }, { total_tokens: 5 }];
  const ids = usage.map((tokenUsage, index) => database.logLlmCall({
    userId: index === 1 ? analyst.id : user.id, themeId: index === 2 ? 2 : 1,
    traceId: index === 2 ? 'trace_other' : 'trace_usage', callType: 'ANSWER',
    promptDigest: 'p'.repeat(600), responseDigest: 'r'.repeat(600), tokenUsage,
    latencyMs: (index + 1) * 10, success: index !== 1,
  }));
  ids.forEach((id, index) => database.db.prepare('UPDATE llm_call_logs SET created_at = ? WHERE id = ?')
    .run(`2026-0${index + 1}-01T00:00:00.000Z`, id));
  const [latest] = database.listLlmLogs(1, { traceId: 'trace_usage' });
  assert.equal(latest.id, ids[1]);
  assert.equal(latest.success, false);
  assert.equal(latest.promptDigest.length, 500);
  assert.equal(latest.responseDigest.length, 500);
  assert.deepEqual(latest.tokenUsage, usage[1]);
  assert.deepEqual(database.llmLogStats(), { total: 3, successCount: 2, successRate: 67, avgLatencyMs: 20 });
  assert.equal(database.sumTokenUsage(), 22);
  assert.equal(database.sumTokenUsage({ userId: user.id }), 15);
  assert.equal(database.sumTokenUsage({ themeId: 1 }), 17);
  assert.equal(database.sumTokenUsage({ sinceIso: '2026-02-01T00:00:00.000Z' }), 12);
  assert.equal(database.sumTokenUsage({ userId: user.id, themeId: 2,
    sinceIso: '2026-02-01T00:00:00.000Z' }), 5);
  database.db.prepare('UPDATE llm_call_logs SET token_usage_json = ? WHERE id = ?').run('broken', ids[1]);
  assert.deepEqual(database.listLlmLogs(1, { traceId: 'trace_usage' })[0].tokenUsage, {});
  assert.equal(database.sumTokenUsage(), 15);
});

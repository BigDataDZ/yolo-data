import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PlatformDatabase } from '../src/database.js';
import { CodeExecutionService } from '../src/codeExecution.js';
import { getCounter } from '../src/metrics.js';

for (const fails of [false, true]) {
  test(`code gate awaits async audit ${fails ? 'failure' : 'persistence'} before rejecting`, async t => {
    const database = new PlatformDatabase(':memory:');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'code-gate-audit-'));
    t.after(async () => { await database.closeAsync(); fs.rmSync(directory, { recursive: true, force: true }); });
    const userId = database.getUserByUsername('admin').id;
    let release, started = false;
    const gate = new Promise(resolve => { release = resolve; });
    const failure = new Error('audit driver refused');
    const adapter = { isAsyncPlatformStore: true,
      async addAuditLogAsync(entry) {
        started = true; await gate;
        if (fails) throw failure;
        return database.addAuditLog(entry);
      },
      addAuditLog() { throw new Error('sync fallback forbidden'); },
    };
    const labels = { gateId: 'CODE-001', phase: 'EXECUTE', blocking: 'true' };
    const count = getCounter('gate_block_total', labels);
    const service = new CodeExecutionService({ database: adapter, workspace: {},
      config: { codeExecutionRoot: path.join(directory, 'runs'), pythonBin: '__must_not_start__' } });
    let completed = false;
    const outcome = service.run({ userId, sessionId: 7, workspaceId: 1, code: 'import sqlite3' })
      .then(value => { completed = true; return { value }; }, error => { completed = true; return { error }; });
    await new Promise(setImmediate);
    try { assert.equal(started, true); assert.equal(completed, false); }
    finally { release(); await outcome; }
    const { error } = await outcome;
    assert.equal(getCounter('gate_block_total', labels), count + 1);
    assert.equal(fs.existsSync(service.root), false);
    if (fails) {
      assert.equal(error, failure);
      assert.equal(database.listAuditLogs().length, 0);
    } else {
      assert.equal(error.code, 'CODE_DATASOURCE_ACCESS_FORBIDDEN');
      const [audit] = database.listAuditLogs();
      assert.equal(audit.action, 'CODE_GATE_BLOCK');
      assert.equal(audit.userId, userId);
      assert.equal(audit.detail.sessionId, 7);
      assert.equal(audit.detail.code, error.code);
    }
  });
}

test('code gate retains synchronous audit compatibility', async t => {
  const database = new PlatformDatabase(':memory:');
  t.after(() => database.closeAsync());
  const service = new CodeExecutionService({ database: { addAuditLog: entry => database.addAuditLog(entry) },
    workspace: {}, config: { pythonBin: '__must_not_start__' } });
  await assert.rejects(service.run({ userId: database.getUserByUsername('admin').id, code: 'import sqlite3' }),
    error => error.code === 'CODE_DATASOURCE_ACCESS_FORBIDDEN');
  assert.equal(database.listAuditLogs()[0].action, 'CODE_GATE_BLOCK');
});

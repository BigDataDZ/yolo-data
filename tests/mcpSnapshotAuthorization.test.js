import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PlatformDatabase } from '../src/database.js';
import { WorkspaceService } from '../src/workspace.js';
import { resolveAccessScope } from '../src/permissions.js';
import { createMcpServer } from '../src/mcp/server.js';
import { auditToolCall } from '../src/mcp/audit.js';

for (const asyncOnly of [false, true]) for (const denied of ['scope', 'grant']) {
  test(`MCP snapshot rejects ${denied} violations using ${asyncOnly ? 'async-only' : 'SQLite'} storage`, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-auth-'));
    const database = new PlatformDatabase(path.join(directory, 'test.db'));
    t.after(async () => { await database.closeAsync(); fs.rmSync(directory, { recursive: true, force: true }); });
    const service = new WorkspaceService(database);
    const user = database.getUserByUsername('east_manager');
    const theme = database.listThemes().find(item => item.name === '经营总览');
    const session = database.createChatSession({ userId: user.id, themeId: theme.id });
    const parent = service.ensureForSession({ userId: user.id, themeId: theme.id, sessionId: session.id });
    const artifact = database.createWorkspaceArtifact({ workspaceId: parent.id, userId: user.id,
      sessionId: session.id, artifactType: 'RESULT', title: 'Private sales',
      payload: { columns: Array.from({ length: 60 }, (_, i) => `col${i}`),
        rows: Array.from({ length: 25 }, (_, i) => ({ confidential: i })), text: 'x'.repeat(1200) } });
    if (denied === 'grant') database.db.prepare('UPDATE user_theme_grants SET can_query=0 WHERE user_id=? AND theme_id=?').run(user.id, theme.id);
    let missingParent = false;
    const getParent = (...args) => missingParent ? null : database.getWorkspace(...args);
    const resolve = (userId, themeId) => ({ scope: resolveAccessScope({ user: database.getUser(userId),
      theme: database.getTheme(themeId), permissionProfile: database.getPermissionProfile(userId) }) });
    const fail = () => { throw new Error('sync fallback forbidden'); };
    const deps = { requestContext: { tenantId: 'tenant-a', tenantScope: denied === 'scope' ? [-1] : [theme.id] },
      database: asyncOnly ? {
        async getWorkspaceAsync(...args) { return getParent(...args); },
        async addAuditLogAsync(entry) { return database.addAuditLog(entry); }, getWorkspace: fail,
      } : { getWorkspace: getParent, addAuditLog: entry => database.addAuditLog(entry) },
      workspace: asyncOnly ? { getArtifactAsync: input => service.getArtifactAsync(input), getArtifact: fail }
        : { getArtifact: input => service.getArtifact(input) },
      agent: asyncOnly ? { async resolveContextAsync(...args) { return resolve(...args); }, resolveContext: fail }
        : { resolveContext: resolve }, auditToolCall,
    };
    const server = createMcpServer({ config: { mode: 'full' }, deps });
    t.after(() => server.close());
    const read = (userId = user.id) => server._registeredTools.get_snapshot.handler({ artifactId: artifact.id, userId });
    const forbidden = await read();
    assert.equal(forbidden.isError, true);
    assert.equal(JSON.parse(forbidden.content[0].text).error.code, -32002);
    assert.equal(forbidden.content[0].text.includes('confidential'), false);
    deps.requestContext = { tenantId: 'tenant-a', tenantScope: [String(theme.id)] };
    database.db.prepare('UPDATE user_theme_grants SET can_query=1 WHERE user_id=? AND theme_id=?').run(user.id, theme.id);
    const allowed = await read();
    assert.equal(allowed.isError, undefined);
    const preview = JSON.parse(allowed.content[0].text);
    assert.equal(preview.rowCount, 25);
    assert.equal(preview.previewRows.length, 20);
    assert.equal(preview.columns.length, 50);
    assert.equal(preview.textExcerpt.length, 1000);
    assert.equal((await read(database.getUserByUsername('admin').id)).isError, true);
    assert.equal((await read(0)).isError, true);
    missingParent = true;
    assert.equal((await read()).isError, true);
    assert.equal(database.listAuditLogs()[0].detail.outcome, 'error');
  });
}

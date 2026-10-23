import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceService } from '../src/workspace.js';

test('workspace session listing uses async database APIs when available', async () => {
  const expected = { id: 12, userId: 3, sessionId: 8 };
  const database = {
    getWorkspaceBySessionAsync: async (sessionId, userId) => {
      assert.equal(sessionId, 8);
      assert.equal(userId, 3);
      return expected;
    },
    getWorkspaceBySession() { throw new Error('sync API must not be called'); },
  };
  const service = new WorkspaceService(database);
  assert.deepEqual(await service.listForUserAsync({ userId: 3, sessionId: 8 }), [expected]);
});

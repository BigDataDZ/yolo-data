import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { withSkillServer } from './fixtures/skillServer.js';

test('HTTP acceptance fixture closes resources when initialization fails before the test callback', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yolo-setup-failure-'));
  let captured;
  try {
    await assert.rejects(withSkillServer(() => assert.fail('callback must not run'), {
      directory,
      initialize: (resources) => { captured = resources; throw new Error('injected setup failure'); },
    }), /injected setup failure/);
    assert.equal(captured.server.listening, false);
    assert.throws(() => captured.application.database.db.prepare('SELECT 1'), /closed|not open/i);
    await assert.rejects(fetch(captured.baseUrl));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

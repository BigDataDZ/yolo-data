import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PlatformDatabase } from '../src/database.js';

test('user interface preferences persist in the platform database', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metric-preferences-'));
  const database = new PlatformDatabase(path.join(directory, 'test.db'));
  const user = database.getUserByUsername('admin');

  assert.deepEqual(database.getUserPreferences(user.id), {});
  const saved = database.saveUserPreferences(user.id, {
    selectedThemeId: 1,
    selectedModelId: 1,
    chatDensity: 'compact',
    datasetTab: 'sources',
    auditTab: 'datasets',
  });
  assert.deepEqual(database.getUserPreferences(user.id), saved);
  assert.equal(saved.chatDensity, 'compact');
  assert.equal(saved.datasetTab, 'sources');

  database.saveUserPreferences(user.id, { selectedThemeId: 2 });
  assert.equal(database.getUserPreferences(user.id).selectedThemeId, 2);
  assert.equal(database.getUserPreferences(user.id).chatDensity, 'compact');
  database.close();
});


import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveThemeBusinessDatasets, resolveThemeBusinessDatasetsAsync } from '../src/themeDatasets.js';

const datasets = [{ id: 3 }, { id: 1 }, { id: 2 }];

for (const [name, scope, theme, ids, primary] of [
  ['grants restrict an unbound theme', { allowedDatasetIds: [1, 3] }, {}, [1, 3], null],
  ['theme bindings further narrow grants', { allowedDatasetIds: [1, 3] }, { businessDatasetIds: [2, 3] }, [3], null],
  ['visible primary sorts first', { allowedDatasetIds: [1, 3] }, { primaryBusinessDatasetId: 3 }, [3, 1], 3],
  ['inaccessible primary is not exposed', { allowedDatasetIds: [1] }, { primaryBusinessDatasetId: 3 }, [1], null],
  ['administrators still respect theme bindings', { isAdmin: true }, { businessDatasetIds: [2] }, [2], null],
]) {
  test(`sync and async dataset selection: ${name}`, async () => {
    const options = {
      user: { id: 7 }, theme: { id: 9, ...theme }, scope,
      database: { listBusinessDatasetsAsync: async () => datasets },
      businessDatasets: { listDatasets: () => datasets },
    };
    const sync = resolveThemeBusinessDatasets(options);
    assert.deepEqual(await resolveThemeBusinessDatasetsAsync(options), sync);
    assert.deepEqual(sync.businessDatasets.map(({ id }) => id), ids);
    assert.equal(sync.primaryBusinessDatasetId, primary);
    assert.deepEqual(datasets.map(({ id }) => id), [3, 1, 2]);
  });
}

test('missing user or theme returns no datasets without touching storage', async () => {
  for (const options of [{}, { user: { id: 7 } }, { theme: { id: 9 } }]) {
    const expected = { businessDatasets: [], primaryBusinessDatasetId: null };
    assert.deepEqual(resolveThemeBusinessDatasets(options), expected);
    assert.deepEqual(await resolveThemeBusinessDatasetsAsync(options), expected);
  }
});

test('async theme resolution loads permissions and datasets without sync APIs', async () => {
  const result = await resolveThemeBusinessDatasetsAsync({
    user: { id: 7 }, theme: { id: 9 },
    database: {
      getPermissionProfile() { throw new Error('sync permission lookup forbidden'); },
      permissionRepository: {
        async getProfile(id) {
          assert.equal(id, 7);
          return {
            themeGrants: [{ themeId: 9, canQuery: true }], indicatorGrants: [],
            datasetGrants: [{ datasetId: 2, canQuery: true }], rowPolicies: [], columnPolicies: [],
          };
        },
      },
      listBusinessDatasetsAsync: async () => datasets,
    },
    businessDatasets: { listDatasets() { throw new Error('sync dataset lookup forbidden'); } },
  });
  assert.deepEqual(result.businessDatasets, [{ id: 2 }]);
});

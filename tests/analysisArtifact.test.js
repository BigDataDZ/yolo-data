import assert from 'node:assert/strict';
import test from 'node:test';
import { ANALYSIS_RESULT_FILE } from '../src/analysisContract.js';
import { validateAnalysisOutputs } from '../src/analysisArtifact.js';

function fakeWorkspace(contents) {
  return {
    getArtifact({ artifactId }) {
      const content = contents[artifactId];
      if (content === undefined) {
        throw new Error(`unknown artifact: ${artifactId}`);
      }
      return { id: artifactId, payload: { content } };
    },
  };
}

const OUTPUTS = [{ fileName: ANALYSIS_RESULT_FILE, artifactId: 'a1' }];

const VALID_ANALYSIS = JSON.stringify({
  version: 1,
  kind: 'ATTRIBUTION',
  metric: { label: '含税销售金额', unit: '元', isRate: false },
  periods: { current: '本期', previous: '上期' },
  totals: { base: 150, current: 100, delta: -50 },
  rows: [
    { key: '华东', label: '华东', base: 100, current: 40, delta: -60, contribution: -60, share: 1.2 },
    { key: '华南', label: '华南', base: 50, current: 60, delta: 10, contribution: 10, share: -0.2 },
  ],
  claims: [{ code: 'ADDITIVE' }, { code: 'SHARE_SUM' }, { code: 'DELTA_CONSISTENT' }],
});

test('no contract artifact means nothing to validate', () => {
  assert.equal(validateAnalysisOutputs({
    workspace: fakeWorkspace({ a1: VALID_ANALYSIS }),
    outputs: [{ fileName: 'report.md', artifactId: 'a1' }],
  }), null);
  assert.equal(validateAnalysisOutputs({
    workspace: fakeWorkspace({ a1: VALID_ANALYSIS }),
    outputs: [],
  }), null);
});

test('a valid analysis artifact is summarised for the model', () => {
  const result = validateAnalysisOutputs({
    workspace: fakeWorkspace({ a1: VALID_ANALYSIS }),
    outputs: OUTPUTS,
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
  assert.match(result.summary, /总变化：-50/);
  assert.equal(result.claims.length, 3);
  assert.ok(result.claims.every((claim) => claim.verified));
});

test('an unreadable artifact reports ANALYSIS-UNREADABLE', () => {
  const result = validateAnalysisOutputs({
    workspace: fakeWorkspace({}),
    outputs: OUTPUTS,
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues.map((item) => item.code), ['ANALYSIS-UNREADABLE']);
});

test('malformed json reports ANALYSIS-INVALID-JSON', () => {
  const result = validateAnalysisOutputs({
    workspace: fakeWorkspace({ a1: '{ not json' }),
    outputs: OUTPUTS,
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues.map((item) => item.code), ['ANALYSIS-INVALID-JSON']);
});

test('an artifact that breaks its own claims is rejected instead of repaired', () => {
  const result = validateAnalysisOutputs({
    workspace: fakeWorkspace({
      a1: JSON.stringify({
        ...JSON.parse(VALID_ANALYSIS),
        rows: [
          { key: '华东', label: '华东', base: 100, current: 40, delta: -60, contribution: -60, share: 0.5 },
          { key: '华南', label: '华南', base: 50, current: 60, delta: 10, contribution: 10, share: 0.2 },
        ],
      }),
    }),
    outputs: OUTPUTS,
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((item) => item.code === 'ANALYSIS-SHARE-SUM'));
  assert.equal(result.summary, '');
});

test('file name matching is case insensitive', () => {
  const result = validateAnalysisOutputs({
    workspace: fakeWorkspace({ a1: VALID_ANALYSIS }),
    outputs: [{ fileName: 'ANALYSIS.JSON', artifactId: 'a1' }],
  });
  assert.equal(result.valid, true);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReplanCarryForward } from '../src/executionRecovery.js';

test('replan carry-forward preserves locked query evidence and result', () => {
  const carry = buildReplanCarryForward({
    message: '9月销售额为 100 万元。',
    data: { columns: [{ name: 'amount' }], rows: [{ amount: 100 }] },
    queryFingerprint: 'query-1',
    dataHash: 'data-1',
    semanticParse: { queryContract: { id: 'contract-1' } },
    chart: { type: 'bar' },
    dataset: { id: 2, name: 'dataset', tableName: 'sales' },
    executionResults: [{
      kind: 'dataset',
      artifactId: 'artifact-1',
      queryFingerprint: 'query-1',
      dataHash: 'data-1',
      rowCount: 1,
      summary: '9月销售额为 100 万元。',
    }],
  });

  assert.equal(carry.data.rows.length, 1);
  assert.equal(carry.semanticParse.queryContract.id, 'contract-1');
  assert.equal(carry.dataset.primaryTable, 'sales');
  assert.equal(carry.lockedExecution.queryArtifactId, 'artifact-1');
  assert.equal(carry.lastSummary, '9月销售额为 100 万元。');
  assert.equal(carry.executions.length, 1);
});

test('replan carry-forward refuses to invent grounding', () => {
  assert.equal(buildReplanCarryForward({
    data: { columns: [], rows: [] },
    queryFingerprint: 'query-1',
    dataHash: 'data-1',
    semanticParse: { queryContract: { id: 'contract-1' } },
  }), null);
  assert.equal(buildReplanCarryForward({
    data: { columns: [{ name: 'amount' }], rows: [{ amount: 1 }] },
    queryFingerprint: 'query-1',
    semanticParse: { queryContract: { id: 'contract-1' } },
  }), null);
});

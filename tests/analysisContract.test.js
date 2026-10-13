import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANALYSIS_CLAIMS,
  ANALYSIS_CONTRACT_VERSION,
  ANALYSIS_RESULT_FILE,
  MAX_ANALYSIS_ROWS,
  buildAnalysisContractPrompt,
  normalizeAnalysisResult,
  summarizeAnalysisResult,
  validateAnalysisResult,
} from '../src/analysisContract.js';

function attributionPayload(overrides = {}) {
  return {
    version: ANALYSIS_CONTRACT_VERSION,
    kind: 'ATTRIBUTION',
    metric: { label: '含税销售额', unit: '万元', isRate: false },
    periods: { current: '本期', previous: '上期' },
    totals: { base: 150, current: 160, delta: 10 },
    rows: [
      { key: 'A', label: '渠道A', base: 100, current: 120, delta: 20, contribution: 20, share: 2, direction: 'INCREASE' },
      { key: 'B', label: '渠道B', base: 50, current: 40, delta: -10, contribution: -10, share: -1, direction: 'DECREASE' },
    ],
    claims: [{ code: 'ADDITIVE', row: 'contribution', total: 'delta' }],
    ...overrides,
  };
}

test('analysis result file and claim registry are stable', () => {
  assert.equal(ANALYSIS_RESULT_FILE, 'analysis.json');
  assert.deepEqual(
    ANALYSIS_CLAIMS.map((claim) => claim.code),
    ['ADDITIVE', 'SHARE_SUM', 'DELTA_CONSISTENT'],
  );
});

test('normalizeAnalysisResult coerces values and caps rows', () => {
  const normalized = normalizeAnalysisResult({
    kind: 'ATTRIBUTION',
    rows: [...Array(MAX_ANALYSIS_ROWS + 20).keys()].map((index) => ({
      key: `k${index}`, label: `标签${index}`, delta: String(index),
    })),
    totals: { delta: '12.5' },
  });
  assert.equal(normalized.rows.length, MAX_ANALYSIS_ROWS);
  assert.equal(normalized.rows[1].delta, 1);
  assert.equal(normalized.totals.delta, 12.5);
  assert.equal(normalized.totals.base, null);
  assert.equal(normalized.kind, 'ATTRIBUTION');
});

test('validateAnalysisResult accepts a payload whose declared additivity holds', () => {
  const validation = validateAnalysisResult(attributionPayload());
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.issues, []);
  assert.equal(validation.claims.length, 1);
  assert.equal(validation.claims[0].verified, true);
});

test('validateAnalysisResult rejects a payload that violates declared additivity', () => {
  const validation = validateAnalysisResult(attributionPayload({
    rows: [
      { key: 'A', label: '渠道A', base: 100, current: 120, delta: 20, contribution: 20 },
      { key: 'B', label: '渠道B', base: 50, current: 40, delta: -10, contribution: -5 },
    ],
  }));
  assert.equal(validation.valid, false);
  const additivity = validation.issues.find((item) => item.code === 'ANALYSIS-ADDITIVITY');
  assert.ok(additivity);
  assert.equal(additivity.residual, 5);
  assert.equal(validation.claims[0].verified, false);
});

test('validateAnalysisResult verifies share normalisation and delta consistency', () => {
  // 带符号份额（占净变化）之和为 1 是合法语义：2 + (-1) = 1。
  const signedShares = validateAnalysisResult(attributionPayload({
    claims: [{ code: 'SHARE_SUM', scale: 1 }],
  }));
  assert.equal(signedShares.valid, true);

  const shareBroken = validateAnalysisResult(attributionPayload({
    rows: [
      { key: 'A', label: '渠道A', base: 100, current: 120, delta: 20, contribution: 20, share: 0.5 },
      { key: 'B', label: '渠道B', base: 50, current: 40, delta: -10, contribution: -10, share: 0.2 },
    ],
    claims: [{ code: 'SHARE_SUM', scale: 1 }],
  }));
  assert.equal(shareBroken.valid, false);
  assert.ok(shareBroken.issues.some((item) => item.code === 'ANALYSIS-SHARE-SUM'));

  const deltaBroken = validateAnalysisResult(attributionPayload({
    rows: [{ key: 'A', label: '渠道A', base: 100, current: 120, delta: 5 }],
    claims: [{ code: 'DELTA_CONSISTENT' }],
  }));
  assert.equal(deltaBroken.valid, false);
  assert.ok(deltaBroken.issues.some((item) => item.code === 'ANALYSIS-DELTA-CONSISTENT'));
});

test('validateAnalysisResult catches inconsistent totals and non-finite numbers', () => {
  const totalsBroken = validateAnalysisResult(attributionPayload({
    totals: { base: 150, current: 160, delta: 99 },
  }));
  assert.equal(totalsBroken.valid, false);
  assert.ok(totalsBroken.issues.some((item) => item.code === 'ANALYSIS-TOTALS'));

  const nonFinite = validateAnalysisResult(attributionPayload({
    rows: [{ key: 'A', label: '渠道A', base: 100, current: 120, delta: 20, contribution: Infinity }],
  }));
  assert.equal(nonFinite.valid, false);
  assert.ok(nonFinite.issues.some((item) => item.code === 'ANALYSIS-NON-FINITE'));
});

test('validateAnalysisResult warns on unknown claims without blocking', () => {
  const validation = validateAnalysisResult(attributionPayload({
    claims: [{ code: 'SHAPLEY_EXACT' }],
  }));
  assert.equal(validation.valid, true);
  const warning = validation.issues.find((item) => item.code === 'ANALYSIS-UNKNOWN-CLAIM');
  assert.equal(warning.level, 'warning');
});

test('validateAnalysisResult rejects empty results', () => {
  const validation = validateAnalysisResult({ kind: 'ATTRIBUTION', rows: [] });
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((item) => item.code === 'ANALYSIS-EMPTY'));
});

test('buildAnalysisContractPrompt describes the sandbox output contract', () => {
  const prompt = buildAnalysisContractPrompt();
  assert.match(prompt, /output\/analysis\.json/);
  assert.match(prompt, /ADDITIVE/);
  assert.match(prompt, /SHARE_SUM/);
  assert.match(prompt, /DELTA_CONSISTENT/);
  // 契约只描述结构与断言，不应教授任何具体分析方法。
  assert.doesNotMatch(prompt, /毛利率|日配|大区/);
});

test('summarizeAnalysisResult ranks rows by contribution without inventing numbers', () => {
  const validation = validateAnalysisResult(attributionPayload({
    rows: [
      { key: 'A', label: '渠道A', delta: 20, contribution: 20, share: 2 },
      { key: 'B', label: '渠道B', delta: -10, contribution: -10, share: -1 },
      { key: 'C', label: '渠道C', delta: 60, contribution: 60, share: 6 },
    ],
    totals: { base: 150, current: 240, delta: 90 },
    claims: [],
  }));
  const text = summarizeAnalysisResult(validation);
  assert.match(text, /分析类型：ATTRIBUTION/);
  assert.match(text, /总变化：90/);
  const lines = text.split('\n');
  assert.match(lines[2], /渠道C/);
});

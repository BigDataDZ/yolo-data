import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSemanticTermRegistry,
  resolveSemanticTerm,
} from '../src/semanticTermRegistry.js';
import { buildSemanticCoverageReport } from '../src/semanticCoverage.js';

const fields = [
  {
    fieldName: 'sale_amt',
    displayName: '含税销售额',
    role: 'METRIC',
    semanticType: 'NUMBER',
  },
  {
    fieldName: 'goods_purchase_level',
    displayName: '商品采购级别',
    role: 'DIMENSION',
    semanticType: 'STRING',
    valueDomain: {
      values: ['03'],
      aliases: { '03': ['OEM', 'oem商品'] },
    },
  },
];

test('semantic registry resolves configured field aliases and value aliases', () => {
  const registry = buildSemanticTermRegistry({ fields });
  const metric = resolveSemanticTerm('销售额', registry);
  const value = resolveSemanticTerm('OEM', registry);

  assert.equal(metric[0].field, 'sale_amt');
  assert.equal(metric[0].mode, 'SUBSTRING');
  assert.equal(value[0].field, 'goods_purchase_level');
  assert.equal(value[0].value, '03');
  assert.equal(value[0].mode, 'ALIAS');
});

test('semantic coverage reports unresolved spans instead of raw residual strings', () => {
  const registry = buildSemanticTermRegistry({ fields });
  const report = buildSemanticCoverageReport({
    question: '本月OEM的销售额是多少',
    sources: ['销售额', '本月'],
    registry,
    isResultActionClause: () => false,
  });

  assert.equal(report.unresolvedSpans.length, 1);
  assert.equal(report.unresolvedSpans[0].status, 'INDEXED_UNBOUND');
  assert.equal(report.issues[0].code, 'SEMANTIC_SPAN_NOT_BOUND');
  assert.equal(report.issues[0].candidates[0].value, '03');

  const unknown = buildSemanticCoverageReport({
    question: '本月XYZ渠道的销售额是多少',
    sources: ['销售额', '本月'],
    registry,
    isResultActionClause: () => false,
  });
  assert.equal(unknown.issues[0].code, 'UNRESOLVED_SEMANTIC_SPAN');
  assert.equal(unknown.issues[0].classification, 'UNKNOWN_SEMANTIC_TERM');
  assert.equal(unknown.issues[0].disposition, 'BLOCK');
  assert.equal(unknown.issues[0].spanText, 'xyz渠道');
  assert.equal(unknown.unresolvedSpans[0].status, 'UNRESOLVED');
});

test('generic analysis wrappers do not become unresolved semantic spans', () => {
  const report = buildSemanticCoverageReport({
    question: '按照客户结构、品类等相关维度帮我分析下降或上升的主要因素',
    sources: ['客户结构', '品类'],
    registry: null,
  });

  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.unresolvedSpans, []);
});

test('generic analysis prose is stripped before semantic coverage is evaluated', () => {
  const report = buildSemanticCoverageReport({
    question: [
      '26年9月份的业绩对比上月有什么变化？',
      '按照客户结构、品类等相关维度帮我分析下降或上升的主要因素',
    ].join(''),
    sources: ['业绩', '26年9月份', '上月', '客户结构', '品类', '变化', '主要因素'],
    registry: null,
  });

  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.unresolvedSpans, []);
});

test('question text is not treated as its own semantic answer', () => {
  const registry = buildSemanticTermRegistry({
    fields,
    sourceContext: '本月XYZ渠道的销售额是多少',
  });
  const matches = resolveSemanticTerm('XYZ渠道', registry);

  assert.equal(matches.length, 0);
});

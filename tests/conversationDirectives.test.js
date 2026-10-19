import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyConversationDirectivesToPresentationContract,
  mergeSessionDirectives,
  parseConversationDirective,
} from '../src/conversationDirectives.js';

test('parses a persistent unit instruction', () => {
  const directive = parseConversationDirective('默认要带上单位万元');

  assert.equal(directive.kind, 'DISPLAY_UNIT');
  assert.equal(directive.unit, '万元');
  assert.equal(directive.scope, 'SESSION');
  assert.match(directive.confirmation, /万元/);
});

test('parses decimal precision as a session display instruction', () => {
  const directive = parseConversationDirective('保留两位小数');

  assert.equal(directive.kind, 'DISPLAY_DECIMALS');
  assert.equal(directive.decimals, 2);
  assert.equal(directive.scope, 'SESSION');
  assert.match(directive.confirmation, /保留2位小数/);
  assert.match(directive.confirmation, /不重新取数/);
});

test('display directives can set unit and decimal precision together', () => {
  const directive = parseConversationDirective('按万元保留两位小数');

  assert.equal(directive.unit, '万元');
  assert.equal(directive.decimals, 2);
  assert.equal(directive.displayScale, 0.0001);
});

test('a persistent display sentence with 展示 is still an instruction', () => {
  const directive = parseConversationDirective('默认金额按万元、2位小数展示');

  assert.equal(directive.unit, '万元');
  assert.equal(directive.decimals, 2);
  assert.equal(directive.scope, 'SESSION');
});

test('unit phrases inside data questions are not directives', () => {
  assert.equal(parseConversationDirective('2026年9月销售额按万元展示'), null);
  assert.equal(parseConversationDirective('近7天销售额是多少'), null);
  assert.equal(parseConversationDirective('2026年9月销售额保留两位小数'), null);
});

test('session directives replace the previous value of the same kind', () => {
  const first = parseConversationDirective('默认按万元展示');
  const second = parseConversationDirective('以后统一按元展示');
  const merged = mergeSessionDirectives([first], second);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].unit, '元');
  assert.equal(merged[0].scope, 'SESSION');
});

test('unit and decimal directives coexist and combined instructions replace both', () => {
  const unit = parseConversationDirective('默认按万元展示');
  const decimals = parseConversationDirective('保留两位小数');
  const separate = mergeSessionDirectives([unit], decimals);

  assert.equal(separate.length, 2);

  const combined = parseConversationDirective('按元保留三位小数');
  const replaced = mergeSessionDirectives(separate, combined);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].unit, '元');
  assert.equal(replaced[0].decimals, 3);
});

test('presentation override applies only to amount fields', () => {
  const directive = parseConversationDirective('默认按万元展示');
  const contract = {
    fields: {
      amount: { type: 'amount', unit: '元', displayScale: 1 },
      rate: { type: 'percent', unit: '%', displayScale: 100 },
    },
  };

  const result = applyConversationDirectivesToPresentationContract(contract, [directive]);

  assert.equal(result.fields.amount.unit, '万元');
  assert.equal(result.fields.amount.displayScale, 0.0001);
  assert.equal(result.fields.rate.unit, '%');
  assert.equal(result.fields.rate.displayScale, 100);
});

test('decimal directive applies to every numeric presentation type', () => {
  const directive = parseConversationDirective('保留两位小数');
  const contract = {
    fields: {
      amount: { type: 'amount', unit: '万元', displayScale: 0.0001, decimals: 0 },
      rate: { type: 'percent', unit: '%', displayScale: 100, decimals: 1 },
      label: { type: 'category' },
    },
  };

  const result = applyConversationDirectivesToPresentationContract(contract, [directive]);

  assert.equal(result.fields.amount.decimals, 2);
  assert.equal(result.fields.amount.numberFormat, '#,##0.00');
  assert.equal(result.fields.amount.basis, 'SESSION_DIRECTIVE');
  assert.equal(result.fields.rate.decimals, 2);
  assert.equal(result.fields.rate.numberFormat, '0.00%');
  assert.deepEqual(result.fields.label, contract.fields.label);
});

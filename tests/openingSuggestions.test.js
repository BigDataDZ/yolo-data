import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOpeningSuggestions,
  classifySuggestion,
  SUGGESTION_CARD_LIMIT,
} from '../src/openingSuggestions.js';

test('configured examples win and are only tagged with a capability group', () => {
  const result = buildOpeningSuggestions({
    examples: ['近 7 天销售额趋势', '按大区看销售额排行', '客户维度明细'],
    metricNames: ['含税销售额'],
    dimensionNames: ['销售大区'],
  });

  assert.equal(result.source, 'THEME_EXAMPLES');
  assert.deepEqual(
    result.cards.map((card) => card.group),
    ['趋势', '排行', '示例'],
  );
  assert.deepEqual(
    result.cards.map((card) => card.question),
    ['近 7 天销售额趋势', '按大区看销售额排行', '客户维度明细'],
  );
});

test('capability classification covers the five opening groups', () => {
  assert.equal(classifySuggestion('近30天走势'), '趋势');
  assert.equal(classifySuggestion('本月与上月对比'), '对比');
  assert.equal(classifySuggestion('为什么毛利变化了'), '归因');
  assert.equal(classifySuggestion('按渠道拆开'), '拆分');
  assert.equal(classifySuggestion('销售额 TOP 10'), '排行');
  assert.equal(classifySuggestion('随便问问'), '示例');
});

test('without configured examples the cards are composed from metrics and dimensions', () => {
  const result = buildOpeningSuggestions({
    examples: [],
    metricNames: ['含税销售额', '未税销售额'],
    dimensionNames: ['销售大区名称'],
  });

  assert.equal(result.source, 'AUTO_SEMANTIC');
  assert.ok(result.cards.length <= SUGGESTION_CARD_LIMIT);
  assert.ok(result.cards.every((card) => card.question.includes('销售额')));
  // 第一个卡片用第一个指标，第二个指标也会出现，避免全部堆在同一指标上。
  assert.ok(result.cards.some((card) => card.question.includes('未税销售额')));
  assert.ok(result.cards.some((card) => card.question.includes('销售大区名称')));
  assert.equal(new Set(result.cards.map((card) => card.question)).size, result.cards.length);
});

test('cards degrade to generic platform examples when the theme has no metadata', () => {
  const result = buildOpeningSuggestions({});
  assert.equal(result.source, 'GENERIC');
  assert.ok(result.cards.length >= 3);
  assert.ok(result.cards.every((card) => card.group && card.question));
});

test('dimension cards are dropped when no dimension is available', () => {
  const result = buildOpeningSuggestions({ metricNames: ['含税销售额'] });
  assert.equal(result.source, 'AUTO_SEMANTIC');
  assert.ok(result.cards.length >= 2);
  assert.ok(!result.cards.some((card) => card.question.startsWith('按')));
});

test('duplicate and blank names never produce duplicate cards', () => {
  const result = buildOpeningSuggestions({
    examples: [' 近 7 天趋势 ', '', '近 7 天趋势'],
    metricNames: [],
    dimensionNames: [],
  });
  assert.deepEqual(result.cards.map((card) => card.question), ['近 7 天趋势']);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectChartRestyle,
  detectRequestedChartType,
  resolveChartPreference,
  selectReusableSnapshot,
} from '../src/chartIntent.js';

test('chart type words are detected in user questions', () => {
  assert.equal(detectRequestedChartType('近7天整体趋势用柱状图展示'), 'bar');
  assert.equal(detectRequestedChartType('换成折线图看看'), 'line');
  assert.equal(detectRequestedChartType('改成饼图'), 'pie');
  assert.equal(detectRequestedChartType('结果用表格呈现'), 'table');
  assert.equal(detectRequestedChartType('近7天整体趋势'), null);
});

test('negated chart types are skipped in favor of the requested one', () => {
  assert.equal(detectRequestedChartType('不要饼图，用柱状图'), 'bar');
  assert.equal(detectRequestedChartType('不用折线图'), null);
});

test('chart preference priority is explicit > question > theme default > auto', () => {
  assert.equal(
    resolveChartPreference({ preferredChart: 'line', question: '用柱状图', themeDefault: 'pie' }),
    'line',
  );
  assert.equal(
    resolveChartPreference({ preferredChart: 'auto', question: '用柱状图', themeDefault: 'pie' }),
    'bar',
  );
  assert.equal(
    resolveChartPreference({ preferredChart: 'auto', question: '近7天趋势', themeDefault: 'pie' }),
    'pie',
  );
  assert.equal(
    resolveChartPreference({ preferredChart: 'auto', question: '近7天趋势', themeDefault: 'auto' }),
    'auto',
  );
});

test('reusable snapshot picks the newest result artifact with tabular data', () => {
  const artifacts = [
    { id: 'p1', artifactType: 'PROCESS_STEP', metadata: { columnCount: 2 } },
    { id: 'r2', artifactType: 'QUERY_RESULT', metadata: { columnCount: 0 } },
    { id: 'r1', artifactType: 'QUERY_RESULT', metadata: { columnCount: 2 } },
  ];
  assert.equal(selectReusableSnapshot(artifacts)?.id, 'r1');
  assert.equal(selectReusableSnapshot([]), null);
});

test('only pure chart-type switches are treated as display restyles', () => {
  assert.equal(detectChartRestyle('趋势用柱状图展示'), 'bar');
  assert.equal(detectChartRestyle('换成折线图'), 'line');
  assert.equal(detectChartRestyle('不要饼图用柱状图'), 'bar');
  assert.equal(detectChartRestyle('按渠道拆开用柱状图展示'), null);
  assert.equal(detectChartRestyle('近7天整体趋势用柱状图展示'), null);
  assert.equal(detectChartRestyle('本月数据用饼图'), null);
});

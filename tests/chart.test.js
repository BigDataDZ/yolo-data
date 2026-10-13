import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestChart, toEChartsOption } from '../src/chart.js';

const columns = [
  { name: '日期', bizName: 'date', showType: 'CATEGORY', type: 'STRING' },
  { name: '销售额', bizName: 'sales_amount', showType: 'NUMBER', type: 'DECIMAL' },
];

test('time dimensions are rendered as a line chart', () => {
  const rows = [
    { date: '2026-09-18', sales_amount: 100 },
    { date: '2026-09-19', sales_amount: 120 },
    { date: '2026-09-20', sales_amount: 140 },
  ];
  const chart = suggestChart({ columns, rows, question: '近7天销售额趋势' });
  assert.equal(chart.type, 'line');
  const option = toEChartsOption(chart, columns, rows);
  assert.equal(option.series[0].type, 'line');
  assert.deepEqual(option.xAxis.data, ['2026-09-18', '2026-09-19', '2026-09-20']);
});

test('composition questions use pie charts for a small category count', () => {
  const chart = suggestChart({
    columns: [
      { name: '渠道', bizName: 'channel', showType: 'CATEGORY', type: 'STRING' },
      columns[1],
    ],
    rows: [
      { channel: '线上', sales_amount: 100 },
      { channel: '门店', sales_amount: 80 },
    ],
    question: '线上和门店销售额占比',
  });
  assert.equal(chart.type, 'pie');
});

test('time plus channel dimensions become one series per channel', () => {
  const multiColumns = [
    { name: '日期', bizName: 'date', showType: 'CATEGORY', type: 'STRING' },
    { name: '渠道', bizName: 'channel', showType: 'CATEGORY', type: 'STRING' },
    { name: '销售额', bizName: 'sales_amount', showType: 'NUMBER', type: 'DECIMAL' },
  ];
  const rows = [
    { date: '2026-09-19', channel: '线上', sales_amount: 100 },
    { date: '2026-09-19', channel: '门店', sales_amount: 80 },
    { date: '2026-09-20', channel: '线上', sales_amount: 120 },
    { date: '2026-09-20', channel: '门店', sales_amount: 90 },
  ];
  const chart = suggestChart({
    columns: multiColumns,
    rows,
    question: '近7天华东销售额趋势，那按渠道拆开呢',
  });
  assert.equal(chart.type, 'line');
  assert.equal(chart.seriesField, 'channel');
  const option = toEChartsOption(chart, multiColumns, rows);
  assert.deepEqual(option.series.map((item) => item.name), ['线上', '门店']);
  assert.deepEqual(option.xAxis.data, ['2026-09-19', '2026-09-20']);
});

test('degraded column metadata still produces a trend line', () => {
  const degradedColumns = [
    { name: 'order_date', bizName: 'order_date', showType: 'CATEGORY', type: 'STRING' },
    { name: 'sales_amt', bizName: 'sales_amt_total', showType: 'CATEGORY', type: '246' },
  ];
  const rows = [
    { order_date: '2026-09-18', sales_amt_total: '100.5' },
    { order_date: '2026-09-19', sales_amt_total: '120.25' },
    { order_date: '2026-09-20', sales_amt_total: '140.75' },
  ];
  const chart = suggestChart({ columns: degradedColumns, rows, question: '近7天整体趋势' });
  assert.equal(chart.type, 'line');
  assert.equal(chart.xField, 'order_date');
  assert.deepEqual(chart.yFields, ['sales_amt_total']);
});

test('metric role and semantic type drive column classification', () => {
  const typedColumns = [
    {
      name: 'order_date',
      bizName: 'order_date',
      showType: 'CATEGORY',
      type: 'STRING',
      role: 'TIME',
      semanticType: 'DATE',
    },
    {
      name: 'sales_amt',
      bizName: 'sales_amt',
      showType: 'CATEGORY',
      type: '246',
      role: 'METRIC',
      semanticType: 'NUMBER',
    },
  ];
  const rows = [
    { order_date: '2026-09-18', sales_amt: 100 },
    { order_date: '2026-09-19', sales_amt: 120 },
  ];
  const chart = suggestChart({ columns: typedColumns, rows, question: '近7天趋势' });
  assert.equal(chart.type, 'line');
});

test('trend intent keeps a chart instead of collapsing a single row into a kpi', () => {
  const columns = [
    { name: 'order_date', bizName: 'order_date', showType: 'CATEGORY', type: 'STRING' },
    { name: 'sales_amt', bizName: 'sales_amt', showType: 'NUMBER', type: 'DECIMAL' },
  ];
  const rows = [{ order_date: '2026-09-20', sales_amt: 140 }];
  assert.equal(
    suggestChart({ columns, rows, question: '近7天整体趋势' }).type,
    'line',
  );
  assert.equal(
    suggestChart({ columns, rows, question: '本月销售额' }).type,
    'kpi',
  );
});

test('numeric identifier dimensions stay categorical', () => {
  const columns = [
    { name: 'sku_code', bizName: 'sku_code', showType: 'CATEGORY', type: 'varchar(32)' },
    { name: 'sales_amt', bizName: 'sales_amt', showType: 'NUMBER', type: 'DECIMAL' },
  ];
  const rows = [
    { sku_code: '123456', sales_amt: 10 },
    { sku_code: '654321', sales_amt: 20 },
  ];
  const chart = suggestChart({ columns, rows, question: '按商品编码看销售额' });
  assert.equal(chart.type, 'bar');
  assert.equal(chart.xField, 'sku_code');
});

test('preferred chart type falls back when there is no axis dimension', () => {
  const columns = [
    { name: 'sales_amt', bizName: 'sales_amt', showType: 'NUMBER', type: 'DECIMAL' },
    { name: 'cost_amt', bizName: 'cost_amt', showType: 'NUMBER', type: 'DECIMAL' },
  ];
  const rows = [{ sales_amt: 10, cost_amt: 4 }];
  const chart = suggestChart({ columns, rows, question: '销售额与成本', preferred: 'line' });
  assert.notEqual(chart.type, 'line');
  assert.equal(chart.type, 'kpi');
});

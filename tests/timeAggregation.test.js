import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateRowsByTimeGrain } from '../src/timeAggregation.js';
import { inferTimeGrain } from '../src/queryIntent.js';

test('weekly grouping language is parsed as a structured time grain', () => {
  assert.equal(
    inferTimeGrain('本月重点客户组业务的销售额，按照每周分组'),
    'WEEK',
  );
  assert.equal(
    inferTimeGrain('最近90天销售额，按月分组'),
    'MONTH',
  );
  assert.equal(
    inferTimeGrain('最近7天每天的销售额'),
    'DAY',
  );
});

test('daily metric rows are aggregated into Monday-based weekly buckets', () => {
  const result = aggregateRowsByTimeGrain({
    columns: [
      { name: '销售日期', bizName: 'sdt', showType: 'DATE' },
      { name: '含税销售金额', bizName: 'sale_amt', showType: 'NUMBER' },
    ],
    rows: [
      { sdt: '2026-09-01', sale_amt: 10 },
      { sdt: '2026-09-06', sale_amt: 20 },
      { sdt: '2026-09-07', sale_amt: 30 },
      { sdt: '2026-09-08', sale_amt: 40 },
    ],
    dateKey: 'sdt',
    grain: 'WEEK',
  });

  assert.equal(result.columns[0].name, '周起始日');
  assert.deepEqual(result.rows, [
    { sdt: '2026-08-31', sale_amt: 30 },
    { sdt: '2026-09-07', sale_amt: 70 },
  ]);
});

test('aggregation keeps metric columns when only column semantics are available', () => {
  const result = aggregateRowsByTimeGrain({
    columns: [
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
        bizName: 'sales_amt_total',
        showType: 'CATEGORY',
        type: '246',
        role: 'METRIC',
        semanticType: 'NUMBER',
      },
    ],
    rows: [
      { order_date: '2026-09-01', sales_amt_total: '10.5' },
      { order_date: '2026-09-06', sales_amt_total: '20.25' },
      { order_date: '2026-09-07', sales_amt_total: '30' },
    ],
    dateKey: 'order_date',
    grain: 'WEEK',
  });

  assert.deepEqual(result.rows, [
    { order_date: '2026-08-31', sales_amt_total: 30.75 },
    { order_date: '2026-09-07', sales_amt_total: 30 },
  ]);
});

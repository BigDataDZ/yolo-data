import assert from 'node:assert/strict';
import test from 'node:test';
import { createXlsxBuffer } from '../src/xlsx.js';
import { openZipArchive, readXlsxSheet } from '../src/xlsxReader.js';

test('xlsx writer creates a two-level workbook buffer', () => {
  const buffer = createXlsxBuffer({
    sheetName: '行业同比',
    columns: [
      {
        name: 'sales_region_name',
        bizName: 'performance_province_name',
        showType: 'CATEGORY',
      },
      {
        name: 'Government·含税销售额',
        bizName: 'Government__sale_amt',
        parentName: 'Government',
        childName: '含税销售额',
        showType: 'NUMBER',
      },
      {
        name: 'Government·同比',
        bizName: 'Government__sale_amt_yoy',
        parentName: 'Government',
        childName: '同比',
        showType: 'NUMBER',
        unit: '%',
      },
    ],
    rows: [{
      performance_province_name: '上海',
      Government__sale_amt: 100,
      Government__sale_amt_yoy: 0.25,
    }],
  });

  assert.equal(buffer.subarray(0, 2).toString('ascii'), 'PK');
  assert.ok(buffer.includes(Buffer.from('xl/worksheets/sheet1.xml')));
  assert.ok(buffer.includes(Buffer.from('Government')));
  assert.ok(buffer.includes(Buffer.from('A1:A2')));
  assert.ok(buffer.includes(Buffer.from('B1:C1')));
});

test('xlsx writer writes projected display magnitude and percentage ratios', () => {
  const buffer = createXlsxBuffer({
    columns: [
      {
        name: '销售额（万元）',
        bizName: 'sale_amt',
        showType: 'NUMBER',
        presentationType: 'amount',
        displayScale: 0.0001,
        xlsxScale: 0.0001,
        unit: '万元',
        numberFormat: '#,##0.00',
      },
      {
        name: '毛利率（%）',
        bizName: 'gross_margin_rate',
        showType: 'NUMBER',
        presentationType: 'percent',
        displayScale: 100,
        xlsxScale: 0.01,
        unit: '%',
        numberFormat: '0.00%',
      },
    ],
    rows: [{
      sale_amt: 470_000,
      gross_margin_rate: 8.4,
    }],
  });

  assert.ok(buffer.includes(Buffer.from('<v>47</v>')));
  assert.ok(buffer.includes(Buffer.from('<v>0.084</v>')));
  assert.ok(buffer.includes(Buffer.from('formatCode="#,##0.00"')));
  assert.ok(buffer.includes(Buffer.from('formatCode="0.00%"')));
});

test('xlsx writer does not infer a format from a field name without a contract', () => {
  const buffer = createXlsxBuffer({
    columns: [
      {
        name: '增长率',
        bizName: 'growth_rate',
        showType: 'NUMBER',
      },
    ],
    rows: [{ growth_rate: 8.4 }],
  });

  assert.equal(buffer.includes(Buffer.from('formatCode=')), false);
  assert.ok(buffer.includes(Buffer.from('<v>8.4</v>')));
});


test('xlsx writer preserves text identifiers and omits blank numeric cells', () => {
  const buffer = createXlsxBuffer({
    columns: [
      { name: 'code', bizName: 'code', showType: 'STRING', type: 'STRING' },
      { name: 'amount', bizName: 'amount', showType: 'NUMBER' },
      { name: 'label', bizName: 'label', showType: 'CATEGORY' },
    ],
    rows: [
      { code: '00123', amount: '', label: '00123' },
      { code: '9007199254740993', amount: null, label: 'A-1' },
      { code: 'A-1', label: 'tail' },
      { code: '0', amount: 0, label: 'zero' },
    ],
  });
  assert.deepEqual(readXlsxSheet(buffer).rows.map((row) => row[0]),
    ['code', '00123', '9007199254740993', 'A-1', '0']);
  const xml = openZipArchive(buffer).get('xl/worksheets/sheet1.xml').toString();
  for (const reference of ['B2', 'B3', 'B4']) {
    assert.equal(xml.includes('r="' + reference + '"'), false);
  }
  assert.match(xml, new RegExp('<c r="B5"[^>]*><v>0</v></c>'));
  assert.match(xml, new RegExp('<c r="C2"[^>]*t="inlineStr"[^>]*><is><t>00123</t>'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { isNumericColumn, isTemporalDimension } from '../src/columnSemantics.js';

test('numeric detection covers driver type spellings without flagging text types', () => {
  for (const type of ['decimalv3(20, 6)', 'DECIMAL', 'INT8', 'UNSIGNED BIGINT', 'float', 'DOUBLE']) {
    assert.equal(isNumericColumn({ showType: 'CATEGORY', type }), true, type);
  }
  for (const type of ['varchar(64)', 'STRING', 'TEXT', 'date', 'datetime']) {
    assert.equal(isNumericColumn({ showType: 'CATEGORY', type }), false, type);
  }
});

test('numeric detection uses values when the driver only returns a bare type code', () => {
  const rows = [
    { amount: '10.5' },
    { amount: '20' },
    { amount: '30.25' },
  ];
  assert.equal(
    isNumericColumn({ showType: 'CATEGORY', type: '246', bizName: 'amount' }, rows),
    true,
  );
  assert.equal(
    isNumericColumn({ showType: 'CATEGORY', type: '246', bizName: 'amount' }, [
      { amount: '华东' },
      { amount: '华南' },
    ]),
    false,
  );
});

test('numeric detection tolerates array filter callbacks', () => {
  const columns = [
    { showType: 'CATEGORY', type: 'STRING' },
    { showType: 'NUMBER', type: 'DECIMAL' },
  ];
  assert.equal(columns.filter(isNumericColumn).length, 1);
});

test('temporal detection prefers explicit semantics over column names', () => {
  assert.equal(
    isTemporalDimension({ name: 'biz_key', bizName: 'biz_key', role: 'TIME', type: 'STRING' }, []),
    true,
  );
  assert.equal(
    isTemporalDimension({ name: 'biz_key', bizName: 'biz_key', semanticType: 'DATE', type: 'date' }, []),
    true,
  );
  assert.equal(
    isTemporalDimension({ name: 'sku_code', bizName: 'sku_code', type: 'varchar(32)' }, [
      { sku_code: '123456' },
      { sku_code: '654321' },
    ]),
    false,
  );
});

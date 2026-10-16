import assert from 'node:assert/strict';
import test from 'node:test';
import { bindDatasetSource, bindDatasourceForm, DATASOURCE_TYPES } from '../public/js/components/datasourceForm.js';

function element(value = '', dataset = {}) {
  const listeners = {};
  return { value, dataset, hidden: true, classList: { toggle() {} }, setAttribute() {},
    addEventListener: (name, fn) => { listeners[name] = fn; }, trigger: (name) => listeners[name]?.(),
    click: () => listeners.click?.(), dispatchEvent: () => {},
  };
}

test('datasource picker changes PG defaults and saves TLS/CA without leaking options to MySQL', () => {
  const tiles = DATASOURCE_TYPES.map((source) => element('', { sourceType: source.type, sourcePort: String(source.port) }));
  const nodes = Object.fromEntries([
    'sourceName', 'sourceHost', 'sourcePort', 'sourceDatabase', 'sourceUsername',
    'sourcePassword', 'sourceSsl', 'sourceCa', 'sourcePostgresOptions',
  ].map((id) => [`#${id}`, element()]));
  nodes['label[for="sourceDatabase"]'] = element();
  nodes['#sourcePort'].value = '3306';
  const read = bindDatasourceForm({ querySelector: (selector) => nodes[selector], querySelectorAll: () => tiles });
  tiles[3].trigger('click');
  assert.equal(nodes['#sourcePort'].value, '5432');
  assert.equal(nodes['#sourcePostgresOptions'].hidden, false);
  assert.throws(read, /连接数据库/);
  nodes['#sourceDatabase'].value = 'analytics';
  nodes['#sourceSsl'].value = 'verify';
  nodes['#sourceCa'].value = 'PEM';
  assert.deepEqual(read().options, { ssl: { ca: 'PEM' } });
  assert.equal(read().dbType, 'POSTGRESQL');
  // Preserve a user-specified port when switching vendors.
  nodes['#sourcePort'].value = '15432';
  tiles[0].trigger('click');
  assert.equal(nodes['#sourcePort'].value, '15432');
  assert.equal(nodes['#sourcePostgresOptions'].hidden, true);
  assert.deepEqual(read().options, {});
});

test('datasource editing prefills PG settings, keeps custom options and leaves the password empty', () => {
  const tiles = DATASOURCE_TYPES.map(source => element('', { sourceType: source.type, sourcePort: String(source.port) }));
  const nodes = Object.fromEntries(['sourceName', 'sourceHost', 'sourcePort', 'sourceDatabase', 'sourceUsername',
    'sourcePassword', 'sourceSsl', 'sourceCa', 'sourcePostgresOptions'].map(id => [`#${id}`, element()]));
  nodes['label[for="sourceDatabase"]'] = element();
  const source = { name: '<PG>', host: 'localhost', port: 15432, dbType: 'POSTGRESQL',
    databaseName: 'analytics', username: 'reader', options: { readonly: true, ssl: { ca: 'CA' } } };
  const read = bindDatasourceForm({ querySelector: selector => nodes[selector], querySelectorAll: () => tiles }, source);
  assert.equal(nodes['#sourceName'].value, '<PG>');
  assert.equal(nodes['#sourcePort'].value, '15432');
  assert.equal(nodes['#sourcePassword'].value, '');
  assert.equal(nodes['#sourcePassword'].placeholder, '留空保留原密码');
  assert.equal(tiles.every(tile => tile.disabled), true);
  assert.equal(read().dbType, 'POSTGRESQL');
  assert.deepEqual(read().options, { readonly: true, ssl: { ca: 'CA' } });
  nodes['#sourceSsl'].value = 'off';
  assert.deepEqual(read().options, { readonly: true, ssl: false });
});

test('dataset source picker distinguishes PG database/schema and retains custom schemas', () => {
  const sources = [{ id: 1, dbType: 'MYSQL', databaseName: 'analytics' }, { id: 2, dbType: 'POSTGRESQL', databaseName: 'warehouse' }];
  const select = element('2');
  const input = element('analytics');
  const label = element();
  const nodes = { '#datasetSource': select, '#datasetSchema': input, 'label[for="datasetSchema"]': label };
  bindDatasetSource({ querySelector: (selector) => nodes[selector] }, sources);
  assert.equal(input.value, 'public');
  assert.equal(label.textContent, 'Schema（如 public）');
  select.value = '1'; select.trigger('change');
  assert.equal(input.value, 'analytics');
  input.value = 'custom_schema';
  select.value = '2'; select.trigger('change');
  assert.equal(input.value, 'custom_schema');
});

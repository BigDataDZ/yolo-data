export function initializeDatasourceEdit(modal, source) {
  const tiles = [...modal.querySelectorAll('.datasource-type-tile')];
  tiles.find(tile => tile.dataset.sourceType === source.dbType).click();
  for (const [id, field] of Object.entries({ sourceName: 'name', sourceHost: 'host', sourcePort: 'port',
    sourceDatabase: 'databaseName', sourceUsername: 'username' })) {
    modal.querySelector(`#${id}`).value = String(source[field] ?? '');
  }
  const password = modal.querySelector('#sourcePassword');
  password.value = '';
  password.placeholder = '留空保留原密码';
  const ssl = modal.querySelector('#sourceSsl');
  ssl.value = source.options?.ssl ? 'verify' : 'off';
  ssl.dispatchEvent(new Event('change', { bubbles: true }));
  modal.querySelector('#sourceCa').value = source.options?.ssl?.ca ?? '';
  tiles.forEach(tile => { tile.disabled = true; });
}

export function preserveDatasourceOptions(payload, source) {
  if (!source) return payload;
  return { ...payload, options: { ...source.options, ...payload.options,
    ...(source.dbType === 'POSTGRESQL' && !payload.options.ssl ? { ssl: false } : {}),
  } };
}

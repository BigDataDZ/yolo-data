import { isDeepStrictEqual } from 'node:util';

function connectionFields(source) {
  return [source.dbType, source.host, source.port, source.databaseName,
    source.username, source.encryptedPassword, source.options];
}

// Legacy synchronous facade; active request paths use the repository's async method.
export function saveDataSourceTest(database, id, { ok, message }, testedSource = null) {
  const current = database.getDataSource(id);
  if (!current || (testedSource && !isDeepStrictEqual(connectionFields(current), connectionFields(testedSource)))) return current;
  const timestamp = new Date().toISOString();
  database.db.prepare(`
    UPDATE data_sources
    SET last_test_at = ?, last_test_ok = ?, last_test_message = ?, updated_at = ?
    WHERE id = ? AND db_type = ? AND host = ? AND port = ? AND database_name = ?
      AND username = ? AND encrypted_password = ? AND options_json = ?
  `).run(timestamp, ok ? 1 : 0, String(message ?? ''), timestamp, Number(id),
    current.dbType, current.host, current.port, current.databaseName,
    current.username, current.encryptedPassword, current.optionsJson);
  return database.getDataSource(id);
}

export async function saveDataSourceTestAsync(database, id, result, testedSource = null) {
  const repository = database.dataSourceRepository;
  if (repository?.updateDataSourceTestAsync) {
    const current = await repository.getDataSourceAsync(id);
    if (!current || (testedSource && !isDeepStrictEqual(connectionFields(current), connectionFields(testedSource)))) return current;
    return repository.updateDataSourceTestAsync(id, result, current);
  }
  return saveDataSourceTest(database, id, result, testedSource);
}

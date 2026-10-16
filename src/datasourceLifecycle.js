import { isDeepStrictEqual } from 'node:util';

// Values are the normalized database fields: type, host, port, database,
// username, effective encrypted password, and serialized driver options.
export function dataSourceTestState(current, connectionValues) {
  const previous = [current.dbType, current.host, current.port, current.databaseName,
    current.username, current.encryptedPassword, current.options];
  const next = [...connectionValues];
  next[5] ||= current.encryptedPassword;
  next[6] = JSON.parse(next[6]);
  return isDeepStrictEqual(previous, next)
    ? [current.lastTestAt, current.lastTestOk === null ? null : Number(current.lastTestOk), current.lastTestMessage]
    : [null, null, ''];
}

// Keep asynchronous platform stores on their async API surface. Falling back to
// a SQLite-only synchronous method hides a broken store contract until a user
// reaches a particular screen or query branch.
export function callPlatformDatabase(database, asyncMethod, syncMethod, ...args) {
  if (typeof database?.[asyncMethod] === 'function') {
    return database[asyncMethod](...args);
  }
  if (database?.isAsyncPlatformStore) {
    throw new Error(`Async platform database is missing ${asyncMethod}()`);
  }
  if (typeof database?.[syncMethod] === 'function') {
    return database[syncMethod](...args);
  }
  throw new Error(`Platform database is missing ${asyncMethod}() and ${syncMethod}()`);
}

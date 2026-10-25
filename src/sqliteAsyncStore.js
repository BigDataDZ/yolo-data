// Async storage facade used while SQLite's legacy synchronous API is migrated
// repository by repository. Its shape matches MysqlPlatformStore.
export function attachSqliteAsyncStore(target, db) {
  target.query = async (sql, values = []) => db.prepare(sql).all(...values);
  target.execute = async (sql, values = []) => {
    const result = db.prepare(sql).run(...values);
    return {
      affectedRows: result.changes,
      insertId: Number(result.lastInsertRowid ?? 0),
    };
  };
  target.transaction = async (callback) => {
    db.exec('BEGIN');
    try {
      const result = await callback({
        query: (sql, values = []) => target.query(sql, values),
        execute: (sql, values = []) => target.execute(sql, values),
      });
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  return target;
}

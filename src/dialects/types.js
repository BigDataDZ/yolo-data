/**
 * @typedef {Object} Dialect
 * @property {string} code
 * @property {(name: string) => string} quoteIdentifier Validates the shared identifier whitelist.
 * @property {(column: string, grain: string) => string} timeGrainExpr
 * @property {(expression: string) => string} countDistinct
 * @property {() => string} limitClause Parameterized LIMIT template.
 * @property {(sql: string) => string} prepareSql Converts template parameters to native SQL.
 * @property {(kind: 'schemas'|'tables'|'columns') => string} metadataSql
 * @property {(type: string) => 'DATE'|'NUMBER'|'BOOLEAN'|'STRING'} classifyColumnType
 * @property {(source: Object, password: string) => Object} createPool
 * Pool exposes query(string | {sql, values?, timeout?}) -> [rows, fields] and end().
 * Drivers are loaded only when their corresponding datasource creates a pool.
 */
export {};

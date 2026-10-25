// Hyphens are common in MySQL/Doris database names (for example `yolo-data`).
// They remain safe because identifiers are quoted before being used in SQL.
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function quoteIdentifier(value, quote = '`') {
  const name = String(value ?? '');
  if (!IDENTIFIER.test(name)) throw new Error(`invalid SQL identifier: ${name}`);
  return `${quote}${name}${quote}`;
}

export function classifyColumnType(value) {
  const type = String(value ?? '').toLowerCase();
  if (/date|time/.test(type)) return 'DATE';
  if (/bool/.test(type)) return 'BOOLEAN';
  if (/int|decimal|numeric|double|float|real|number/.test(type)) return 'NUMBER';
  return 'STRING';
}

// Only generated SELECT templates reach this adapter. Preserve quoted literals
// and identifiers while numbering parameters; already-native SQL is unchanged.
export function postgresParameters(sql) {
  let index = 0;
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, (token) => (
    token === '?' ? `$${++index}` : token
  ));
}

export function isNumericColumn(column) {
  return String(column?.showType ?? '').toUpperCase() === 'NUMBER'
    || ['NUMBER', 'DECIMAL', 'DOUBLE', 'FLOAT', 'INTEGER', 'BIGINT']
      .includes(String(column?.type ?? '').toUpperCase());
}

export function presentationValueForColumn(value, column) {
  if (value === '' || value == null || (!isNumericColumn(column) && !column?.presentationType)) {
    return value;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return value;
  }
  const scale = Number(column?.xlsxScale) || 1;
  return number * scale;
}

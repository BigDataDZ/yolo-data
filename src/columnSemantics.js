// 结果列的语义分类：优先使用列自身携带的 role / semanticType / showType，
// 元数据降级（例如驱动只回传裸类型码）时再用样本值兜底。
// 这里不包含任何具体业务字段，规则对指标链路、数据集链路和本地文件通用。
// chart 判定、时间粒度再聚合、结果加工共用同一套判定，避免展示逻辑各处漂移。
const TEMPORAL_NAME_PATTERN = /date|time|day|week|month|quarter|year|日期|时间|日|月|周|季度|年/;
const EXPLICIT_TEXT_TYPE_PATTERN = /^(char|varchar|nchar|nvarchar|string|text|tinytext|mediumtext|longtext|clob|json|enum|set|uuid|bool|boolean|date|datetime|timestamp|time|year)\b/i;

function sampleValues(column, rows) {
  // 兼容 Array.prototype.filter 直接传入回调的调用方式（此时第二个参数是下标）。
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.slice(0, 24)
    .map((row) => row?.[column?.bizName] ?? row?.[column?.name])
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== '');
}

// 驱动返回的裸类型码（如 mysql2 的 246）本身不携带可读语义，
// 此时只能回到样本值判断，否则会把聚合后的指标列误判成维度。
function isDegradedType(type) {
  const text = String(type ?? '').trim();
  return text === '' || /^\d{1,4}$/.test(text);
}

const NUMERIC_TYPE_PATTERN = /(^|[^a-z])(u?(tiny|small|medium|big)?int|integer|decimal|numeric|double|float|real|number|money)/i;

function isNumericTypeName(type) {
  const text = String(type ?? '').trim();
  return text !== '' && !isDegradedType(text) && NUMERIC_TYPE_PATTERN.test(text);
}

function looksNumericValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  const text = String(value).trim().replaceAll(',', '');
  return text !== '' && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(text)
    && Number.isFinite(Number(text));
}

function looksTemporalValue(value) {
  const text = String(value ?? '').trim();
  if (text === '') {
    return false;
  }
  // 只认同真正像日期的样本，避免把编号类的数字维度误当成时间轴。
  return /^\d{4}[-/.]\d{1,2}([-/.]\d{1,2})?/.test(text)
    || /^\d{4}年\d{1,2}月(\d{1,2}日)?/.test(text)
    || /^\d{4}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])?$/.test(text)
    || /^\d{4}Q[1-4]$/i.test(text);
}

export function isTemporalDimension(column, rows = []) {
  const role = String(column?.role ?? '').toUpperCase();
  const semanticType = String(column?.semanticType ?? '').toUpperCase();
  if (role === 'TIME' || ['DATE', 'TIME', 'DATETIME', 'TIMESTAMP'].includes(semanticType)) {
    return true;
  }
  const text = `${column?.name ?? ''} ${column?.bizName ?? ''}`.toLowerCase();
  if (TEMPORAL_NAME_PATTERN.test(text)) {
    return true;
  }
  return matchesSample(column, rows, looksTemporalValue, 0.6);
}

function matchesSample(column, rows, predicate, threshold) {
  const values = sampleValues(column, rows);
  if (values.length === 0) {
    return false;
  }
  return values.filter(predicate).length >= Math.ceil(values.length * threshold);
}

export function isNumericColumn(column, rows = []) {
  if (String(column?.showType ?? '').toUpperCase() === 'NUMBER') {
    return true;
  }
  if (String(column?.role ?? '').toUpperCase() === 'METRIC') {
    return true;
  }
  if (String(column?.semanticType ?? '').toUpperCase() === 'NUMBER') {
    return true;
  }
  if (isNumericTypeName(column?.type)) {
    return true;
  }
  if (!isDegradedType(column?.type) && EXPLICIT_TEXT_TYPE_PATTERN.test(String(column?.type ?? '').trim())) {
    return false;
  }
  // 元数据不足以判定（例如仅有裸类型码）时，用样本值兜底，避免趋势/对比
  // 因列语义丢失而退化成纯表格。
  return matchesSample(column, rows, looksNumericValue, 0.8);
}


import { formatPresentationCell } from './resultPresentation.js';
import {
  summarizeAnalysisResult,
  validateAnalysisResult,
} from './analysisContract.js';
import {
  getPlatformLexicon,
  lexiconPattern,
} from './businessLexicon.js';

const PERIOD_KEY = '__period';
const MOVEMENT_TOP_LIMIT = 5;

const DATE_DIMENSION_PATTERN =
  /(^|_)(date|time|day|week|month|quarter|year)($|_)|sdt|日期|时间|账期/i;
const RANKING_PATTERN = /排名|排行|榜单|对比|top\s*\d*|前\s*\d+|最高|最大|最多/i;

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeValue).sort(compareSerialized);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeValue(value[key])]),
    );
  }
  return value ?? null;
}

function normalizeValuePreservingArrayOrder(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeValuePreservingArrayOrder);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeValuePreservingArrayOrder(value[key])]),
    );
  }
  return value ?? null;
}

function stableSerialize(value) {
  return JSON.stringify(normalizeValue(value));
}

function compareText(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''), 'zh-CN', {
    numeric: true,
    sensitivity: 'base',
  });
}

function compareSerialized(left, right) {
  return compareText(stableSerialize(left), stableSerialize(right));
}

function uniqueStrings(values) {
  return [...new Set((values ?? []).map(String).filter(Boolean))];
}

export function normalizeFilters(filters) {
  return (filters ?? [])
    .map((filter) => {
      const operator = String(filter?.operator ?? 'IN').trim().toUpperCase();
      return {
        bizName: String(
          filter?.bizName ?? filter?.dimension ?? filter?.field ?? '',
        ).trim(),
        operator,
        value: ['IN', 'NOT_IN'].includes(operator)
          ? normalizeValue(filter?.value)
          : normalizeValuePreservingArrayOrder(filter?.value),
        scope: String(filter?.scope ?? 'ROW').toUpperCase() === 'AGGREGATE'
          ? 'AGGREGATE'
          : 'ROW',
      };
    })
    .filter((filter) => filter.bizName)
    .sort((left, right) => (
      compareText(left.bizName, right.bizName)
      || compareText(left.operator, right.operator)
      || compareSerialized(left.value, right.value)
    ));
}

function columnKey(column) {
  return String(column?.bizName ?? column?.nameEn ?? column?.name ?? '').trim();
}

function isNumericColumn(column) {
  return String(column?.showType ?? column?.type ?? '').toUpperCase() === 'NUMBER'
    || String(column?.type ?? '').toUpperCase() === 'DECIMAL';
}

function isDateColumn(column) {
  return DATE_DIMENSION_PATTERN.test(columnKey(column));
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value ?? '');
  }
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2,
  }).format(number);
}

function formatColumnValue(value, column) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value ?? '');
  }
  return column?.presentationType
    ? formatPresentationCell(value, column)
    : formatNumber(value);
}

function columnLabel(column) {
  return String(column?.name ?? column?.bizName ?? '').trim();
}

function findColumn(columns, key) {
  return (columns ?? []).find((column) => columnKey(column) === key) ?? null;
}

function filterSummary(filters, columns, filterLabels = {}, lexicon = null) {
  const identifierPattern = lexiconPattern(
    (lexicon ?? getPlatformLexicon()).identifierPatterns,
    { raw: true },
  );
  return normalizeFilters(filters).map((filter) => {
    const label = filterLabels[filter.bizName]
      || columnLabel(findColumn(columns, filter.bizName))
      || filter.bizName;
    const identifier = identifierPattern?.test(
      `${filter.bizName} ${label}`,
    ) ?? false;
    const renderValue = (item) => (
      identifier ? String(item ?? '') : formatNumber(item)
    );
    const value = Array.isArray(filter.value)
      ? filter.value.map(renderValue).join('、')
      : renderValue(filter.value);
    return `${label} ${filter.operator} ${value}`;
  });
}

export function dateRangeText(dateInfo) {
  if (!dateInfo || dateInfo.dateMode === 'ALL') {
    return '全部时间';
  }
  if (dateInfo.startDate && dateInfo.endDate) {
    return dateInfo.startDate === dateInfo.endDate
      ? dateInfo.startDate
      : `${dateInfo.startDate} 至 ${dateInfo.endDate}`;
  }
  return '全部时间';
}

export function contractTimeText(contract) {
  const windows = contract?.timeWindows ?? [];
  if (windows.length > 1) {
    return windows.map((window, index) => (
      window.label || window.expression || `期间${index + 1}`
    )).join(' vs ');
  }
  return dateRangeText(windows[0] ?? contract?.dateInfo);
}

function formatTemporalDisplay(value, timeGrain) {
  const text = String(value ?? '');
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (!match) {
    return text;
  }
  const [, year, month] = match;
  switch (String(timeGrain ?? '').toUpperCase()) {
    case 'MONTH':
      return `${year}-${month}`;
    case 'QUARTER':
      return `${year}-Q${Math.floor((Number(month) - 1) / 3) + 1}`;
    case 'YEAR':
      return year;
    default:
      return text;
  }
}

function metricTotals(columns, rows, contract, metricDefinitions = [], lexicon = null) {
  const ratePattern = lexiconPattern((lexicon ?? getPlatformLexicon()).rateTerms);
  const definitions = new Map(
    (metricDefinitions ?? []).map((definition) => [
      String(definition.key ?? definition.field ?? ''),
      definition,
    ]),
  );
  const keys = (contract?.metrics ?? []).length > 0
    ? contract.metrics
    : columns.filter(isNumericColumn).map(columnKey).filter(Boolean);
  const periodKeys = (contract?.timeWindows ?? [])
    .map((window, index) => window.label || window.expression || `期间${index + 1}`)
    .filter(Boolean);
  return keys.map((key) => {
    const column = findColumn(columns, key);
    if (!column) {
      return null;
    }
    const definition = definitions.get(key) ?? {};
    const label = columnLabel(column) || definition.label || key;
    const aggregation = String(
      definition.aggregation ?? definition.aggregator ?? '',
    ).toUpperCase();
    const rate = ratePattern?.test(label) ?? false;
    const render = (values) => {
      const numeric = values.map(Number).filter(Number.isFinite);
      if (numeric.length === 0) {
        return null;
      }
      const value = rate || aggregation === 'AVG'
        ? numeric.reduce((sum, item) => sum + item, 0) / numeric.length
        : numeric.reduce((sum, item) => sum + item, 0);
      const suffix = rate || aggregation === 'AVG'
        ? '均值'
        : ['COUNT', 'COUNT_DISTINCT'].includes(aggregation)
          ? ''
          : '合计';
      return `${label}${suffix} ${formatColumnValue(value, column)}`;
    };
    if (periodKeys.length > 1 && columns.some((item) => columnKey(item) === '__period')) {
      return periodKeys.map((period) => {
        const periodRows = rows.filter((row) => row.__period === period);
        const rendered = render(periodRows.map((row) => row?.[key]));
        return rendered ? `${period}：${rendered}` : null;
      }).filter(Boolean).join('，');
    }
    return render(rows.map((row) => row?.[key]));
  }).filter(Boolean);
}

function numericTotal(rows, key, period) {
  return (rows ?? [])
    .filter((row) => (
      !period
      || String(row?.[PERIOD_KEY] ?? '') === String(period)
    ))
    .reduce((sum, row) => {
      const value = Number(row?.[key]);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
}

// 解析"本期 / 上期"。只在契约显式给出期间顺序或时间窗标签时才成立；
// 不按行的出现顺序猜测期间——没有依据就不做对比，避免把随机的行序当成时间序。
function resolveComparisonPeriods(columns, rows, contract) {
  if (!columns.some((column) => columnKey(column) === PERIOD_KEY)) {
    return null;
  }
  const availablePeriods = [...new Set(
    (rows ?? []).map((row) => String(row?.[PERIOD_KEY] ?? '')).filter(Boolean),
  )];
  const periodOrder = (contract?.periodOrder ?? []).length > 0
    ? contract.periodOrder
    : (contract?.timeWindows ?? []).map((window, index) => (
      window.label || window.expression || `期间${index + 1}`
    ));
  const baseIndex = Number.isInteger(contract?.calculation?.baseWindowIndex)
    ? contract.calculation.baseWindowIndex
    : 0;
  const compareIndex = Number.isInteger(contract?.calculation?.compareWindowIndex)
    ? contract.calculation.compareWindowIndex
    : 1;
  const currentPeriod = periodOrder[baseIndex] ?? availablePeriods[0];
  const previousPeriod = periodOrder[compareIndex] ?? availablePeriods[1];
  if (!currentPeriod || !previousPeriod) {
    return null;
  }
  return { currentPeriod, previousPeriod };
}

function periodComparisonFindings(
  columns,
  rows,
  contract,
  metricDefinitions = [],
) {
  const periods = resolveComparisonPeriods(columns, rows, contract);
  if (!periods) {
    return [];
  }
  const { currentPeriod, previousPeriod } = periods;

  const definitions = new Map(
    (metricDefinitions ?? []).map((definition) => [
      String(definition.key ?? definition.field ?? ''),
      definition,
    ]),
  );
  const metricColumns = (contract?.metrics ?? [])
    .map((key) => findColumn(columns, key))
    .filter((column) => column && isNumericColumn(column));
  const dimensionColumn = (contract?.dimensions ?? [])
    .map((key) => findColumn(columns, key))
    .find((column) => (
      column
      && columnKey(column) !== PERIOD_KEY
      && !isNumericColumn(column)
      && !isDateColumn(column)
    ));

  return metricColumns.map((metricColumn) => {
    const metricKey = columnKey(metricColumn);
    const definition = definitions.get(metricKey) ?? {};
    const metricLabel = columnLabel(metricColumn)
      || definition.label
      || metricKey;
    const currentTotal = numericTotal(rows, metricKey, currentPeriod);
    const previousTotal = numericTotal(rows, metricKey, previousPeriod);
    const delta = currentTotal - previousTotal;
    const rate = previousTotal !== 0
      ? delta / Math.abs(previousTotal)
      : null;
    const direction = delta > 0
      ? '增长'
      : delta < 0
        ? '下降'
        : '持平';
    const directionPrefix = delta > 0 ? '+' : '';
    // Put the comparison result into a natural, conclusion-first sentence.
    // Keep the signed rate only for growth; a decline is expressed with a
    // negative percentage so the sentence reads naturally in Chinese.
    const rateText = rate === null
      ? ''
      : `同比${direction} ${directionPrefix}${(Math.abs(rate) * 100).toFixed(1)}%`;
    const currentText = formatColumnValue(currentTotal, metricColumn);
    const previousText = formatColumnValue(previousTotal, metricColumn);
    const statement = `${currentPeriod}${metricLabel}为 ${currentText}，较${
      previousPeriod
    }${delta > 0 ? '增加' : delta < 0 ? '减少' : '变动'} ${
      formatColumnValue(Math.abs(delta), metricColumn)}（${
      rateText || '同比持平'
    }；上期 ${previousText}）`;

    const detail = [];
    if (dimensionColumn) {
      const dimensionKey = columnKey(dimensionColumn);
      const dimensionLabel = columnLabel(dimensionColumn) || dimensionKey;
      const grouped = new Map();
      for (const row of rows ?? []) {
        const period = String(row?.[PERIOD_KEY] ?? '');
        if (![currentPeriod, previousPeriod].includes(period)) {
          continue;
        }
        const value = Number(row?.[metricKey]);
        if (!Number.isFinite(value)) {
          continue;
        }
        const name = String(row?.[dimensionKey] ?? '').trim();
        if (!name) {
          continue;
        }
        const item = grouped.get(name) ?? { current: 0, previous: 0 };
        if (period === currentPeriod) {
          item.current += value;
        } else {
          item.previous += value;
        }
        grouped.set(name, item);
      }
      const changes = [...grouped.entries()]
        .map(([name, item]) => ({
          name,
          delta: item.current - item.previous,
        }))
        .filter((item) => Number.isFinite(item.delta))
        .sort((left, right) => right.delta - left.delta);
      const topGrowth = changes
        .filter((item) => item.delta > 0)
        .slice(0, 3);
      const topDeclines = changes
        .filter((item) => item.delta < 0)
        .sort((left, right) => left.delta - right.delta)
        .slice(0, 3);
      if (topGrowth.length > 0) {
        detail.push(`增长最多的${dimensionLabel}主要是：${
          topGrowth.map((item) => (
            `${item.name}（+${formatColumnValue(item.delta, metricColumn)}）`
          )).join('、')
        }`);
        if (topDeclines.length > 0) {
          detail.push(`${dimensionLabel}中有所回落的有：${
            topDeclines.map((item) => (
              `${item.name}（${formatColumnValue(item.delta, metricColumn)}）`
            )).join('、')
          }`);
        }
      } else {
        const largest = changes.slice(0, 3);
        if (largest.length > 0) {
          detail.push(`当前没有${dimensionLabel}实现增长，变化靠前的为：${
            largest.map((item) => (
              `${item.name}（${formatColumnValue(item.delta, metricColumn)}）`
            )).join('、')
          }`);
        }
      }
    }
    return {
      statement,
      details: detail,
      metricKey,
      metricLabel,
      currentPeriod,
      previousPeriod,
      currentTotal,
      previousTotal,
      delta,
      rate,
    };
  });
}

function trendFinding(columns, rows, contract) {
  if (contract?.analysisMode === 'ATTRIBUTION' || rows.length < 2) {
    return '';
  }
  const dateKey = (contract?.dimensions ?? []).find((key) => (
    isDateColumn(findColumn(columns, key))
  )) ?? columns.filter(isDateColumn).map(columnKey)[0];
  const metricKey = (contract?.metrics ?? []).find((key) => findColumn(columns, key));
  if (!dateKey || !metricKey) {
    return '';
  }
  const firstValue = Number(rows[0]?.[metricKey]);
  const lastValue = Number(rows.at(-1)?.[metricKey]);
  if (!Number.isFinite(firstValue) || !Number.isFinite(lastValue)) {
    return '';
  }
  const metricColumn = findColumn(columns, metricKey);
  const metricLabel = columnLabel(metricColumn) || metricKey;
  const base = `${formatTemporalDisplay(rows[0]?.[dateKey], contract?.timeGrain)}：${
    formatColumnValue(firstValue, metricColumn)}，${formatTemporalDisplay(
    rows.at(-1)?.[dateKey],
    contract?.timeGrain,
  )}：${formatColumnValue(lastValue, metricColumn)}`;
  const lastPeriod = String(rows.at(-1)?.[dateKey] ?? '');
  const rangeEnd = String(contract?.dateInfo?.endDate ?? '');
  const incompletePeriod = String(contract?.timeGrain ?? '').toUpperCase() === 'MONTH'
    && lastPeriod.slice(0, 7) === rangeEnd.slice(0, 7)
    && rangeEnd > lastPeriod
    ? `（最后一个月截至 ${rangeEnd}，为未完整月）`
    : '';
  if (firstValue === 0) {
    return `${metricLabel}从 ${base}${incompletePeriod}`;
  }
  const change = ((lastValue - firstValue) / Math.abs(firstValue)) * 100;
  return `${metricLabel}从 ${base}，区间变化 ${change >= 0 ? '+' : ''}${
    change.toFixed(1)}%${incompletePeriod}`;
}

// 可用于"变动拆分"的维度：排除期间列、日期列与数值列。
// 与旧实现不同的是这里保留**全部**候选维度，不再只取第一个——
// 平台不替用户判断该看哪个维度，判断权在查询契约与生成的代码里。
function movementDimensions(columns, contract) {
  const keys = (contract?.dimensions ?? []).length > 0
    ? contract.dimensions
    : columns.map(columnKey);
  return [...new Set(keys)]
    .map((key) => findColumn(columns, key))
    .filter((column) => (
      column
      && columnKey(column) !== PERIOD_KEY
      && !isDateColumn(column)
      && !isNumericColumn(column)
    ));
}

function movementGroups(rows, dimensionKey, metricKey, { currentPeriod, previousPeriod }) {
  const grouped = new Map();
  for (const row of rows ?? []) {
    const name = String(row?.[dimensionKey] ?? '').trim();
    if (!name) {
      continue;
    }
    const period = String(row?.[PERIOD_KEY] ?? '');
    if (![currentPeriod, previousPeriod].includes(period)) {
      continue;
    }
    const value = Number(row?.[metricKey]);
    if (!Number.isFinite(value)) {
      continue;
    }
    const bucket = grouped.get(name) ?? { current: 0, previous: 0 };
    if (period === currentPeriod) {
      bucket.current += value;
    } else {
      bucket.previous += value;
    }
    grouped.set(name, bucket);
  }
  return [...grouped.entries()]
    .map(([name, item]) => ({ name, ...item, delta: item.current - item.previous }))
    .filter((item) => item.current !== 0 || item.previous !== 0)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
}

// 平台侧只输出**确定性事实**：每个维度取值的本期−上期变动，以及该变动
// 占整体变动的比例（可加恒等式，可被契约复算）。这里不做任何方法选择，
// 因此不出现"贡献 / 拉动 / 归因"这类措辞——那是沙箱分析产物的职责。
// Top N 之外的取值合并为"其他"，保证比例之和闭合，不再出现截断后的缺口。
function movementFindings(columns, rows, contract, lexicon = null) {
  if (contract?.analysisMode !== 'ATTRIBUTION' || (rows ?? []).length < 2) {
    return [];
  }
  const periods = resolveComparisonPeriods(columns, rows, contract);
  const metricKey = (contract?.metrics ?? []).find((key) => findColumn(columns, key));
  if (!periods || !metricKey) {
    return [];
  }
  const ratePattern = lexiconPattern((lexicon ?? getPlatformLexicon()).rateTerms);
  const metricColumn = findColumn(columns, metricKey);
  const metricLabel = columnLabel(metricColumn) || metricKey;
  // 比率型指标不可加，只讲变动、不讲占比，避免把毛利率当成可加量。
  const isRate = ratePattern?.test(metricLabel) ?? false;

  return movementDimensions(columns, contract).flatMap((dimensionColumn) => {
    const changes = movementGroups(rows, columnKey(dimensionColumn), metricKey, periods);
    if (changes.length === 0) {
      return [];
    }
    const dimensionLabel = columnLabel(dimensionColumn) || columnKey(dimensionColumn);
    const totalDelta = changes.reduce((sum, item) => sum + item.delta, 0);
    const showShare = !isRate && Math.abs(totalDelta) > Number.EPSILON;
    const render = (delta) => `${delta >= 0 ? '+' : ''}${formatColumnValue(delta, metricColumn)}`;
    const renderItem = (label, delta) => (showShare
      ? `${label}（${render(delta)}，占整体变动 ${(delta / totalDelta * 100).toFixed(1)}%）`
      : `${label}（${render(delta)}）`);
    const parts = changes.slice(0, MOVEMENT_TOP_LIMIT).map((item) => (
      renderItem(item.name, item.delta)
    ));
    const rest = changes.slice(MOVEMENT_TOP_LIMIT);
    if (rest.length > 0) {
      const restDelta = rest.reduce((sum, item) => sum + item.delta, 0);
      parts.push(renderItem(`其他 ${rest.length} 个${dimensionLabel}`, restDelta));
    }
    return [`${dimensionLabel}按${metricLabel}的变动拆分：${parts.join('、')}`];
  });
}

// 沙箱分析产物（ANALYSIS_CODE 阶段产出、已过契约校验）优先呈现。
// 平台在这里**只做校验与转述**：不合法就当作没有，绝不替模型补一个结论。
function analysisFindings(analysis) {
  if (!analysis) {
    return [];
  }
  const { valid, normalized } = validateAnalysisResult(analysis);
  if (!valid) {
    return [];
  }
  const text = summarizeAnalysisResult({ normalized }, { topN: MOVEMENT_TOP_LIMIT });
  return text ? [text] : [];
}

function rankingFinding(question, columns, rows, contract) {
  if (!RANKING_PATTERN.test(String(question ?? '')) || rows.length === 0) {
    return '';
  }
  const metricKey = (contract?.metrics ?? []).find((key) => findColumn(columns, key));
  if (!metricKey) {
    return '';
  }
  const dimensionKey = (contract?.dimensions ?? [])
    .map((key) => findColumn(columns, key))
    .find((column) => column && !isNumericColumn(column) && !isDateColumn(column))
    ?.bizName;
  const metricColumn = findColumn(columns, metricKey);
  const metricLabel = columnLabel(metricColumn) || metricKey;
  if (!dimensionKey) {
    return `最高/最低值为 ${formatColumnValue(rows[0]?.[metricKey], metricColumn)}`;
  }
  const dimensionLabel = columnLabel(findColumn(columns, dimensionKey)) || dimensionKey;
  return `${dimensionLabel}首位为 ${formatNumber(rows[0]?.[dimensionKey])}，${
    metricLabel} ${formatColumnValue(rows[0]?.[metricKey], metricColumn)}`;
}

export function buildDeterministicSummary({
  subjectName,
  columns = [],
  rows = [],
  contract,
  question = '',
  metricDefinitions = [],
  filterLabels = {},
  lexicon = null,
  // ANALYSIS_CODE 阶段沙箱产出的分析结果（analysis.json 内容）。
  // 平台只校验并转述，不参与计算；缺失或校验不通过时回落到确定性事实。
  analysis = null,
}) {
  const totals = metricTotals(columns, rows, contract, metricDefinitions, lexicon);
  const comparisons = periodComparisonFindings(columns, rows, contract, metricDefinitions);
  const comparisonStatements = comparisons.map((item) => item.statement);
  const conclusion = rows.length === 0
    ? `在当前查询条件下未返回数据；平台没有自动调整时间范围、指标或维度。`
    : comparisonStatements.length > 0
      ? `${comparisonStatements.join('；')}。`
      : `${totals.length > 0 ? `${totals.join('，')}。` : `本次查询返回 ${rows.length} 行数据。`}`;
  // 沙箱分析产物优先：有它就转述代码算出来的结论，平台不再自己拆一遍。
  const analysisLines = analysisFindings(analysis);
  const fallback = analysisLines.length > 0
    ? []
    : movementFindings(columns, rows, contract, lexicon);
  const findings = [
    comparisons.length === 0 ? rankingFinding(question, columns, rows, contract) : '',
    trendFinding(columns, rows, contract),
    ...comparisons.flatMap((item) => item.details),
    ...analysisLines,
    ...fallback,
  ].filter(Boolean);

  if (comparisons.length > 0) {
    return [
      conclusion,
      ...(findings.length > 0 ? ['', findings.join('；') + '。'] : []),
    ].join('\n');
  }
  return [
    conclusion,
    ...(findings.length > 0 ? ['', '**关键结果**', ...findings.map((item) => `- ${item}`)] : []),
  ].join('\n');
}

export function buildQueryScopeSummary({
  subjectName,
  columns = [],
  contract = null,
  filterLabels = {},
  lexicon = null,
}) {
  const normalizedFilters = normalizeFilters(contract?.filters);
  const dimensions = (contract?.dimensions ?? [])
    .map((key) => findColumn(columns, key))
    .filter((column) => column && columnKey(column) !== PERIOD_KEY)
    .map((column) => columnLabel(column) || columnKey(column));
  const filterLines = filterSummary(normalizedFilters, columns, filterLabels, lexicon);
  return [
    `指标：${subjectName || contract?.indicatorId || '-'}`,
    `时间：${contractTimeText(contract)}`,
    `维度：${dimensions.join('、') || '汇总'}`,
    `过滤：${filterLines.join('；') || '无额外过滤条件'}`,
  ].join('\n');
}

export function buildResultSummaryBundle(options) {
  return {
    summary: buildDeterministicSummary(options),
    queryScope: buildQueryScopeSummary(options),
  };
}

export function appendQueryScopeProcessStep({
  appendProcessStep,
  processSteps = [],
  queryScope,
  skillCode,
  skillName,
}) {
  appendProcessStep({
    id: `step-${processSteps.length + 1}`,
    type: 'analysis',
    stageCode: 'ANALYZE',
    status: 'success',
    name: 'query_scope_summary',
    skillCode,
    skillName,
    title: '查询范围与口径',
    detail: queryScope,
  });
}

export {
  formatNumber,
  stableSerialize,
  normalizeValue,
};

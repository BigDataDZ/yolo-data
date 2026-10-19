import { formatPresentationCell } from './resultPresentation.js';
import { summarizeAnalysisResult, validateAnalysisResult } from './analysisContract.js';
import {
  getPlatformLexicon,
  lexiconPattern,
} from './businessLexicon.js';
import { composeNaturalAnswer } from './naturalAnswer.js';

const PERIOD_KEY = '__period';
const MOVEMENT_TOP_LIMIT = 5;

const DATE_DIMENSION_PATTERN =
  /(^|_)(date|time|day|week|month|quarter|year)($|_)|sdt|日期|时间|账期/i;

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

function dateParts(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match
    ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
    : null;
}

function comparisonBasis(contract) {
  const windows = contract?.timeWindows ?? [];
  const baseIndex = Number.isInteger(contract?.calculation?.baseWindowIndex)
    ? contract.calculation.baseWindowIndex
    : 0;
  const compareIndex = Number.isInteger(contract?.calculation?.compareWindowIndex)
    ? contract.calculation.compareWindowIndex
    : 1;
  const current = dateParts(windows[baseIndex]?.startDate);
  const previous = dateParts(windows[compareIndex]?.startDate);
  if (!current || !previous) {
    return '较上期';
  }
  if (current.month === previous.month && current.year === previous.year + 1) {
    return '同比';
  }
  if (
    current.year === previous.year
    && current.month === previous.month + 1
  ) {
    return '环比';
  }
  return '较上期';
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
  const basis = comparisonBasis(contract);

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
      : `${basis}${direction} ${directionPrefix}${(Math.abs(rate) * 100).toFixed(1)}%`;
    const currentText = formatColumnValue(currentTotal, metricColumn);
    const previousText = formatColumnValue(previousTotal, metricColumn);
    const statement = `${currentPeriod}${metricLabel}为 ${currentText}，较${
      previousPeriod
    }${delta > 0 ? '增加' : delta < 0 ? '减少' : '变动'} ${
      formatColumnValue(Math.abs(delta), metricColumn)}（${
      rateText || `${basis}持平`
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
        detail.push(`${dimensionLabel}里增长最多的是${
          topGrowth.map((item) => (
            `${item.name}（+${formatColumnValue(item.delta, metricColumn)}）`
          )).join('、')
        }`);
        if (topDeclines.length > 0) {
          detail.push(`${dimensionLabel}中回落较多的是${
            topDeclines.map((item) => (
              `${item.name}（${formatColumnValue(item.delta, metricColumn)}）`
            )).join('、')
          }`);
        }
      } else {
        const largest = changes.slice(0, 3);
        if (largest.length > 0) {
          detail.push(`${dimensionLabel}整体没有增长，变化靠前的是${
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

function parseDateValue(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return null;
  }
  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ));
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(start, end) {
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function periodCoverageDays(period, grain, rangeStart, rangeEnd) {
  const start = parseDateValue(period);
  if (!start) {
    return null;
  }
  const normalizedGrain = String(grain ?? '').toUpperCase();
  let end;
  if (normalizedGrain === 'WEEK') {
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
  } else if (normalizedGrain === 'MONTH') {
    end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  } else if (normalizedGrain === 'QUARTER') {
    end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0));
  } else if (normalizedGrain === 'YEAR') {
    end = new Date(Date.UTC(start.getUTCFullYear() + 1, 0, 0));
  } else {
    end = new Date(start);
  }
  const clippedStart = rangeStart && rangeStart > start ? rangeStart : start;
  const clippedEnd = rangeEnd && rangeEnd < end ? rangeEnd : end;
  const days = daysBetween(clippedStart, clippedEnd);
  return days > 0 ? days : null;
}

function nominalPeriodDays(grain, start) {
  const normalizedGrain = String(grain ?? '').toUpperCase();
  if (normalizedGrain === 'WEEK') return 7;
  if (normalizedGrain === 'MONTH') {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  }
  if (normalizedGrain === 'QUARTER') return 92;
  if (normalizedGrain === 'YEAR') return 366;
  return 1;
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
  const grouped = new Map();
  for (const row of rows) {
    const period = String(row?.[dateKey] ?? '');
    const value = Number(row?.[metricKey]);
    if (!period || !Number.isFinite(value)) {
      continue;
    }
    grouped.set(period, (grouped.get(period) ?? 0) + value);
  }
  const points = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([period, value]) => ({ period, value }));
  if (points.length < 2) {
    return '';
  }
  const first = points[0];
  const last = points[points.length - 1];
  const firstValue = first.value;
  const lastValue = last.value;
  if (!Number.isFinite(firstValue) || !Number.isFinite(lastValue)) {
    return '';
  }
  const metricColumn = findColumn(columns, metricKey);
  const metricLabel = columnLabel(metricColumn) || metricKey;
  const firstPeriod = formatTemporalDisplay(first.period, contract?.timeGrain);
  const lastPeriodText = formatTemporalDisplay(last.period, contract?.timeGrain);
  const base = `从 ${firstPeriod} 的 ${formatColumnValue(firstValue, metricColumn)} 变化到 ${
    lastPeriodText} 的 ${formatColumnValue(lastValue, metricColumn)}`;
  const rangeStart = parseDateValue(
    contract?.dateInfo?.startDate ?? contract?.timeWindows?.[0]?.startDate,
  );
  const rangeEnd = parseDateValue(
    contract?.dateInfo?.endDate ?? contract?.timeWindows?.[0]?.endDate,
  );
  const firstDays = periodCoverageDays(first.period, contract?.timeGrain, rangeStart, rangeEnd);
  const lastDays = periodCoverageDays(last.period, contract?.timeGrain, rangeStart, rangeEnd);
  const firstStart = parseDateValue(first.period);
  const lastStart = parseDateValue(last.period);
  const firstIncomplete = Boolean(
    firstStart
    && firstDays
    && firstDays < nominalPeriodDays(contract?.timeGrain, firstStart),
  );
  const lastIncomplete = Boolean(
    lastStart
    && lastDays
    && lastDays < nominalPeriodDays(contract?.timeGrain, lastStart),
  );
  const incompletePeriod = lastIncomplete && rangeEnd
    ? String(contract?.timeGrain ?? '').toUpperCase() === 'MONTH'
      ? `（最后一个月截至 ${rangeEnd.toISOString().slice(0, 10)}，为未完整月）`
      : `（最后一周仅覆盖 ${last.period} 至 ${rangeEnd.toISOString().slice(0, 10)}，共 ${lastDays} 天）`
    : '';
  if ((firstIncomplete || lastIncomplete) && firstDays && lastDays) {
    const firstDaily = firstValue / firstDays;
    const lastDaily = lastValue / lastDays;
    const dailyChange = firstDaily === 0
      ? null
      : ((lastDaily - firstDaily) / Math.abs(firstDaily)) * 100;
    return `${metricLabel}${base}${incompletePeriod}；按日均口径看，从 ${
      formatColumnValue(firstDaily, metricColumn)} 变化到 ${formatColumnValue(lastDaily, metricColumn)}${
      dailyChange === null ? '' : `，日均${dailyChange >= 0 ? '增长' : '下降'} ${Math.abs(dailyChange).toFixed(1)}%`
    }`;
  }
  if (firstValue === 0) {
    return `${metricLabel}${base}${incompletePeriod}`;
  }
  const change = ((lastValue - firstValue) / Math.abs(firstValue)) * 100;
  return `${metricLabel}${base}，整体${change >= 0 ? '增长' : '下降'} ${Math.abs(change).toFixed(1)}%${
    incompletePeriod}`;
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
  // 比率型指标不可加，只讲变动、不讲占比，避免把比率当成可加量。
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
  resultQuality = null,
}) {
  if (resultQuality?.truncated) {
    return [
      `本轮查询达到结果上限${resultQuality.limit ? `（${resultQuality.limit} 行）` : ''}，数据未完整读取。`,
      '为避免把部分数据误当成整体，我不会据此给出合计或归因结论。',
      '请缩小时间范围或业务范围后重试。',
    ].join('');
  }
  const totals = metricTotals(columns, rows, contract, metricDefinitions, lexicon);
  const comparisons = periodComparisonFindings(columns, rows, contract, metricDefinitions);
  // 沙箱分析产物优先：有它就转述代码算出来的结论，平台不再自己拆一遍。
  const analysisLines = analysisFindings(analysis);
  const fallback = analysisLines.length > 0
    ? []
    : movementFindings(columns, rows, contract, lexicon);
  return composeNaturalAnswer({
    question,
    columns,
    rows,
    contract,
    totals,
    comparisons,
    analysisLines,
    movementLines: fallback,
    trend: trendFinding(columns, rows, contract),
  });
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

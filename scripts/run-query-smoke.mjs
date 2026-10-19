#!/usr/bin/env node

// End-to-end query smoke runner.
//
// Replays eval/smoke/questions.mjs against the streaming chat endpoint and
// records contract, workflow, quality and latency evidence for every case.
//
//   node scripts/run-query-smoke.mjs \
//     --base-url http://127.0.0.1:8088 \
//     --concurrency 3 \
//     --output /tmp/yolo-query-smoke.json

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { SMOKE_QUESTIONS } from '../eval/smoke/questions.mjs';

const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:8088',
  themeId: 193,
  concurrency: 3,
  timeoutMs: 300_000,
  latencyWarnMs: 120_000,
  output: '/tmp/yolo-query-smoke.json',
  userId: null,
};

const INTERNAL_ERROR_PATTERNS = [
  /ANALYSIS_RESULT_FILE is not defined/i,
  /\b(?:TypeError|ReferenceError|SyntaxError|RangeError)\b/,
  /(?:\b\w+ is not defined\b|\bCannot read propert(?:y|ies)\b)/i,
  /\n\s+at\s+\S+\s+\(/,
  /\[object Object\]/,
];

function parseArgs(argv) {
  const options = { ...DEFAULTS, categories: [], ids: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`missing value for ${arg}`);
      }
      return argv[index];
    };
    if (arg === '--base-url') options.baseUrl = next();
    else if (arg === '--theme-id') options.themeId = Number(next());
    else if (arg === '--concurrency') options.concurrency = Number(next());
    else if (arg === '--timeout-ms') options.timeoutMs = Number(next());
    else if (arg === '--latency-warn-ms') options.latencyWarnMs = Number(next());
    else if (arg === '--output') options.output = next();
    else if (arg === '--user-id') options.userId = next();
    else if (arg === '--category') options.categories.push(next());
    else if (arg === '--ids') {
      options.ids.push(...next().split(',').map((value) => value.trim()).filter(Boolean));
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/run-query-smoke.mjs [options]

Options:
  --base-url <url>        Service base URL (default ${DEFAULTS.baseUrl})
  --theme-id <id>         Theme id (default ${DEFAULTS.themeId})
  --concurrency <n>       Parallel requests (default ${DEFAULTS.concurrency})
  --timeout-ms <ms>       Per-request timeout (default ${DEFAULTS.timeoutMs})
  --latency-warn-ms <ms>  Latency warning threshold (default ${DEFAULTS.latencyWarnMs})
  --output <file>         JSON report path (default ${DEFAULTS.output})
  --user-id <id>          Optional x-user-id header
  --category <name>       Repeatable category filter
  --ids <id,id>           Comma-separated case ids
`);
      process.exit(0);
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  options.baseUrl = options.baseUrl.replace(/\/$/, '');
  options.themeId = positiveInteger(options.themeId, 'theme-id');
  options.concurrency = positiveInteger(options.concurrency, 'concurrency');
  options.timeoutMs = positiveInteger(options.timeoutMs, 'timeout-ms');
  options.latencyWarnMs = positiveInteger(options.latencyWarnMs, 'latency-warn-ms');
  return options;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function selectedCases(options) {
  const ids = new Set(options.ids);
  const categories = new Set(options.categories);
  return SMOKE_QUESTIONS.filter((item) => (
    (ids.size === 0 || ids.has(item.id))
    && (categories.size === 0 || categories.has(item.category))
  ));
}

function check(name, ok, { severity = 'error', expected, actual, detail } = {}) {
  return { name, ok: Boolean(ok), severity, expected, actual, detail };
}

function dimensionName(dimension) {
  if (typeof dimension === 'string') return dimension;
  if (!dimension || typeof dimension !== 'object') return String(dimension ?? '');
  return String(
    dimension.field
    ?? dimension.fieldName
    ?? dimension.column
    ?? dimension.name
    ?? dimension.id
    ?? '',
  );
}

function windowRange(window) {
  if (Array.isArray(window)) {
    return { start: window[0] ?? null, end: window[1] ?? null, label: null };
  }
  if (!window || typeof window !== 'object') {
    return { start: null, end: null, label: null };
  }
  return {
    start: window.startDate ?? window.start ?? window.from ?? null,
    end: window.endDate ?? window.end ?? window.to ?? null,
    label: window.label ?? null,
  };
}

function isTimeDimension(name) {
  const normalized = String(name).toLowerCase();
  if (!normalized) return false;
  if (['__period', 'period', 'month', 'year', 'quarter', 'date', 'day', 'week', 'sdt'].includes(normalized)) {
    return true;
  }
  return /(^|_)(date|time|month|year|quarter|period|day|week)(_|$)/.test(normalized);
}

function answerSummary(answer = {}) {
  const semanticParse = answer.semanticParse ?? {};
  const contract = semanticParse.queryContract ?? semanticParse.contract ?? {};
  const dimensions = (contract.dimensions ?? []).map(dimensionName).filter(Boolean);
  const metrics = (contract.metrics ?? []).map((metric) => (
    typeof metric === 'string' ? metric : metric?.field ?? metric?.name ?? ''
  )).filter(Boolean);
  const timeWindows = (contract.timeWindows ?? []).map(windowRange);
  const rows = Array.isArray(answer.data?.rows) ? answer.data.rows : [];
  const failedStages = (answer.workflow?.stages ?? [])
    .filter((stage) => stage.status === 'FAILED')
    .map((stage) => ({
      code: stage.code,
      name: stage.name,
      summary: stage.summary,
      detail: stage.detail,
    }));
  return {
    mode: answer.analysisMode?.mode ?? contract.analysisMode ?? semanticParse.analysisMode ?? null,
    semanticStatus: semanticParse.status ?? null,
    workflowStatus: answer.workflow?.status ?? null,
    resolvedQuestion: answer.resolvedQuestion ?? null,
    contextMode: answer.contextMode ?? null,
    turnType: answer.turnType ?? null,
    rowCount: rows.length,
    columnCount: Array.isArray(answer.data?.columns) ? answer.data.columns.length : 0,
    columns: (answer.data?.columns ?? []).slice(0, 20),
    dimensions,
    businessDimensions: dimensions.filter((name) => !isTimeDimension(name)),
    metrics,
    timeWindows,
    comparison: contract.calculation?.type ?? null,
    periodOrder: contract.periodOrder ?? [],
    clarification: answer.clarification?.prompt ?? answer.clarification?.message ?? null,
    failedStages,
    answerEvidence: answer.answerEvidence ?? null,
    resultQuality: semanticParse.resultQuality ?? null,
    reflection: answer.reflection ? {
      passed: answer.reflection.passed,
      needsReplan: answer.reflection.needsReplan,
      checks: (answer.reflection.checks ?? []).map((item) => ({
        name: item.name,
        pass: item.pass,
        detail: item.detail,
      })),
    } : null,
    resultValidationStatus: answer.resultValidation?.status ?? null,
  };
}

function explicitCalendarMonth(question) {
  const match = String(question ?? '').match(/(\d{2,4})年(\d{1,2})月/);
  if (!match) {
    return null;
  }
  const rawYear = Number(match[1]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (value) => String(value).padStart(2, '0');
  return {
    year,
    month,
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

function calendarWindowIssue(question, windows) {
  const expected = explicitCalendarMonth(question);
  if (!expected) {
    return null;
  }
  const ranges = (windows ?? []).map(windowRange);
  if (ranges.length === 0) {
    return '显式年月问题没有生成任何时间窗口';
  }
  const matched = ranges.some((range) => (
    range.start === expected.start && range.end === expected.end
  ));
  return matched
    ? null
    : `未找到完整自然月 ${expected.start} 至 ${expected.end}`;
}

function containsMarkdownTable(message) {
  return /(?:^|\n)\s*\|[^\n]*\|[^\n]*\n\s*\|?\s*:?-{2,}/.test(String(message ?? ''));
}

function includesInternalError(message) {
  return INTERNAL_ERROR_PATTERNS.some((pattern) => pattern.test(String(message ?? '')));
}

function comparisonWordingIssue(question, message) {
  const prompt = String(question ?? '');
  const answer = String(message ?? '');
  const asksMonthOverMonth = /上月|环比|相比8月|比7月/.test(prompt);
  const asksYearOverYear = /同比|去年/.test(prompt);
  if (asksMonthOverMonth && !asksYearOverYear && /同比/.test(answer)) {
    return '问题为环比/上月对比，回答却使用了“同比”表述';
  }
  if (asksYearOverYear && !asksMonthOverMonth && /环比|上月/.test(answer)) {
    return '问题为同比/去年对比，回答却使用了“环比/上月”表述';
  }
  return null;
}

function evaluateCase(item, collected, options) {
  const { status, events, finalAnswer, streamError, error, timings, eventCounts } = collected;
  const checks = [];
  const answer = finalAnswer ?? {};
  const summary = answerSummary(answer);
  const message = String(answer.message ?? '');
  const robust = item.category === 'robustness';

  checks.push(check('http_200', status === 200, {
    expected: 200,
    actual: status,
  }));
  checks.push(check('stream_final_event', Boolean(finalAnswer), {
    expected: 'final event with answer',
    actual: finalAnswer ? 'present' : 'missing',
  }));
  checks.push(check('stream_done_event', events.some((event) => event.type === 'stream_done'), {
    severity: 'warning',
    expected: 'stream_done',
    actual: events.some((event) => event.type === 'stream_done') ? 'present' : 'missing',
  }));
  checks.push(check('no_stream_error', !streamError, {
    expected: 'no stream_error',
    actual: streamError ?? null,
  }));
  checks.push(check('no_transport_error', !error, {
    expected: 'request completed',
    actual: error ?? null,
  }));
  checks.push(check('no_internal_error_in_answer', !includesInternalError(message), {
    expected: 'no internal exception text',
    actual: includesInternalError(message) ? message.slice(0, 1_000) : null,
  }));

  if (!robust) {
    checks.push(check('semantic_validated', summary.semanticStatus === 'VALIDATED', {
      expected: 'VALIDATED',
      actual: summary.semanticStatus,
    }));
    checks.push(check('result_has_rows', summary.rowCount > 0, {
      expected: '>0 rows',
      actual: summary.rowCount,
    }));
    checks.push(check('grounded_answer', summary.answerEvidence?.grounded === true, {
      expected: 'contract + rows + queryFingerprint + dataHash',
      actual: summary.answerEvidence,
    }));
    checks.push(check('answer_evidence_matches_result', (
      summary.answerEvidence?.rowCount === summary.rowCount
      && summary.answerEvidence?.columnCount === summary.columnCount
    ), {
      expected: 'evidence counts equal result counts',
      actual: {
        evidence: summary.answerEvidence,
        rowCount: summary.rowCount,
        columnCount: summary.columnCount,
      },
    }));
    checks.push(check('result_not_truncated', summary.resultQuality?.truncated !== true, {
      expected: 'complete result set',
      actual: summary.resultQuality,
    }));
    checks.push(check('calendar_window_correct', !calendarWindowIssue(item.question, summary.timeWindows), {
      expected: 'complete natural calendar month',
      actual: summary.timeWindows,
      detail: calendarWindowIssue(item.question, summary.timeWindows),
    }));
  }

  checks.push(check('workflow_completed', String(summary.workflowStatus ?? '').startsWith('COMPLETED'), {
    severity: 'warning',
    expected: 'COMPLETED or COMPLETED_WITH_WARNINGS',
    actual: summary.workflowStatus,
    detail: summary.failedStages,
  }));
  checks.push(check('workflow_without_warnings', summary.workflowStatus === 'COMPLETED', {
    severity: 'warning',
    expected: 'COMPLETED',
    actual: summary.workflowStatus,
    detail: answer.workflow?.warnings ?? [],
  }));

  if (item.expect?.mode) {
    checks.push(check('analysis_mode', summary.mode === item.expect.mode, {
      expected: item.expect.mode,
      actual: summary.mode,
    }));
  }

  if (item.category === 'attribution') {
    checks.push(check('attribution_mode', summary.mode === 'ATTRIBUTION', {
      expected: 'ATTRIBUTION',
      actual: summary.mode,
    }));
    if (item.expect?.requireBreakdown) {
      checks.push(check('business_breakdown', summary.businessDimensions.length > 0, {
        expected: 'at least one non-time dimension',
        actual: summary.dimensions,
      }));
    }
    if (item.expect?.requirePeriodComparison) {
      checks.push(check('period_comparison', summary.comparison === 'PERIOD_COMPARISON', {
        expected: 'PERIOD_COMPARISON',
        actual: summary.comparison,
        detail: { timeWindows: summary.timeWindows },
      }));
      checks.push(check('two_time_windows', summary.timeWindows.length >= 2, {
        expected: '>=2',
        actual: summary.timeWindows.length,
        detail: summary.timeWindows,
      }));
      checks.push(check('period_dimension', summary.dimensions.some((name) => isTimeDimension(name)), {
        severity: 'warning',
        expected: 'period/time dimension',
        actual: summary.dimensions,
      }));
    }
  }

  if (robust) {
    const handled = summary.rowCount > 0 || Boolean(summary.clarification) || status !== 200;
    checks.push(check('robustness_handled', handled, {
      severity: 'warning',
      expected: 'data, clarification, or structured error',
      actual: {
        rows: summary.rowCount,
        clarification: summary.clarification,
        workflow: summary.workflowStatus,
      },
    }));
  }

  const wordingIssue = comparisonWordingIssue(item.question, message);
  checks.push(check('comparison_wording', !wordingIssue, {
    severity: 'warning',
    expected: 'comparison wording matches question',
    actual: wordingIssue,
  }));

  const reflectionNumeric = summary.reflection?.checks?.find((entry) => entry.name === 'numeric_consistency');
  checks.push(check('reflection_numeric_consistency', reflectionNumeric?.pass !== false, {
    severity: 'warning',
    expected: 'numeric_consistency pass',
    actual: reflectionNumeric ?? null,
  }));
  checks.push(check('result_validation_passed', summary.resultValidationStatus !== 'FAILED', {
    severity: 'warning',
    expected: 'not FAILED',
    actual: summary.resultValidationStatus,
  }));
  checks.push(check('latency_budget', timings.totalMs <= options.latencyWarnMs, {
    severity: 'warning',
    expected: `<=${options.latencyWarnMs}ms`,
    actual: timings.totalMs,
  }));
  checks.push(check('first_useful_content', (
    Boolean(finalAnswer)
    && Number.isFinite(timings.firstDeltaMs)
    && timings.firstDeltaMs <= options.latencyWarnMs
  ), {
    severity: 'warning',
    expected: `stream content within ${options.latencyWarnMs}ms`,
    actual: timings.firstDeltaMs ?? null,
  }));
  checks.push(check('progressive_answer_before_final', (
    !finalAnswer
    || !Number.isFinite(timings.finalMs)
    || !Number.isFinite(timings.firstDeltaMs)
    || timings.firstDeltaMs <= timings.finalMs
  ), {
    severity: 'warning',
    expected: 'first content no later than final event',
    actual: {
      firstDeltaMs: timings.firstDeltaMs ?? null,
      finalMs: timings.finalMs ?? null,
    },
  }));
  checks.push(check('no_ungrounded_table', !(
    containsMarkdownTable(message)
    && summary.answerEvidence?.grounded !== true
  ), {
    expected: 'tables only with grounded evidence',
    actual: {
      table: containsMarkdownTable(message),
      grounded: summary.answerEvidence?.grounded ?? null,
    },
  }));

  const errors = checks.filter((entry) => !entry.ok && entry.severity === 'error');
  const warnings = checks.filter((entry) => !entry.ok && entry.severity === 'warning');
  return {
    id: item.id,
    category: item.category,
    question: item.question,
    status: errors.length > 0 ? 'FAIL' : warnings.length > 0 ? 'PARTIAL' : 'PASS',
    functionalPassed: errors.length === 0,
    strictPassed: errors.length === 0 && warnings.length === 0,
    failureCodes: errors.map((entry) => entry.name),
    warningCodes: warnings.map((entry) => entry.name),
    checks,
    latencyMs: timings.totalMs,
    timings,
    eventCounts,
    answerPreview: message.replace(/\s+/g, ' ').trim().slice(0, 500),
    answer: message,
    summary,
    streamError,
    transportError: error,
  };
}

async function readNdjson(response, startedAt) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  let firstEventMs = null;
  let firstDeltaMs = null;
  let firstProgressMs = null;
  let finalMs = null;
  let answerStartMs = null;
  let answerDoneMs = null;
  let deltaChars = 0;

  const consumeLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch (parseError) {
      throw new Error(`invalid NDJSON event: ${parseError.message}: ${trimmed.slice(0, 240)}`);
    }
    const now = performance.now();
    const elapsed = Math.round(now - startedAt);
    if (firstEventMs === null) firstEventMs = elapsed;
    if (event.type === 'assistant_progress' && firstProgressMs === null) firstProgressMs = elapsed;
    if (event.type === 'assistant_answer_start') answerStartMs = elapsed;
    if (event.type === 'assistant_delta') {
      if (firstDeltaMs === null) firstDeltaMs = elapsed;
      deltaChars += String(event.text ?? '').length;
    }
    if (event.type === 'assistant_answer_done') answerDoneMs = elapsed;
    if (event.type === 'final') finalMs = elapsed;
    events.push(event);
  };

  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      consumeLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  consumeLine(buffer);

  return {
    events,
    timings: {
      firstEventMs,
      firstProgressMs,
      answerStartMs,
      firstDeltaMs,
      answerDoneMs,
      finalMs,
      streamDoneMs: events.some((event) => event.type === 'stream_done')
        ? Math.round(performance.now() - startedAt)
        : null,
    },
    deltaChars,
  };
}

async function runCase(item, options) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`request timeout after ${options.timeoutMs}ms`)), options.timeoutMs);
  const headers = { 'content-type': 'application/json' };
  if (options.userId) headers['x-user-id'] = options.userId;
  try {
    const response = await fetch(`${options.baseUrl}/api/chat/query/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        themeId: options.themeId,
        question: item.question,
        forceNewTask: true,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      return evaluateCase(item, {
        status: response.status,
        events: [],
        finalAnswer: null,
        streamError: body.slice(0, 2_000),
        error: `HTTP ${response.status}`,
        timings: { totalMs: Math.round(performance.now() - startedAt) },
        eventCounts: {},
      }, options);
    }
    const parsed = await readNdjson(response, startedAt);
    const finalEvent = parsed.events.find((event) => event.type === 'final');
    const errorEvent = parsed.events.find((event) => event.type === 'stream_error');
    const eventCounts = {};
    let progressUpdates = 0;
    for (const event of parsed.events) {
      eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
      if (event.type === 'assistant_progress') progressUpdates += 1;
    }
    return evaluateCase(item, {
      status: response.status,
      events: parsed.events,
      finalAnswer: finalEvent?.answer ?? null,
      streamError: errorEvent?.message ?? null,
      error: null,
      timings: {
        ...parsed.timings,
        totalMs: Math.round(performance.now() - startedAt),
        deltaChars: parsed.deltaChars,
        progressUpdates,
      },
      eventCounts,
    }, options);
  } catch (error) {
    return evaluateCase(item, {
      status: 0,
      events: [],
      finalAnswer: null,
      streamError: null,
      error: error?.message ?? String(error),
      timings: { totalMs: Math.round(performance.now() - startedAt) },
      eventCounts: {},
    }, options);
  } finally {
    clearTimeout(timeout);
  }
}

function percentile(values, ratio) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]));
}

function buildReport(results, options, startedAt) {
  const latency = results.map((item) => item.latencyMs).filter(Number.isFinite);
  const successfulLatency = results
    .filter((item) => item.functionalPassed)
    .map((item) => item.latencyMs)
    .filter(Number.isFinite);
  const categories = {};
  for (const category of [...new Set(results.map((item) => item.category))]) {
    const cases = results.filter((item) => item.category === category);
    categories[category] = {
      total: cases.length,
      pass: cases.filter((item) => item.status === 'PASS').length,
      partial: cases.filter((item) => item.status === 'PARTIAL').length,
      fail: cases.filter((item) => item.status === 'FAIL').length,
      functionalPassed: cases.filter((item) => item.functionalPassed).length,
      strictPassed: cases.filter((item) => item.strictPassed).length,
    };
  }
  return {
    generatedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAt),
    options,
    totals: {
      total: results.length,
      pass: results.filter((item) => item.status === 'PASS').length,
      partial: results.filter((item) => item.status === 'PARTIAL').length,
      fail: results.filter((item) => item.status === 'FAIL').length,
      functionalPassed: results.filter((item) => item.functionalPassed).length,
      strictPassed: results.filter((item) => item.strictPassed).length,
      error: results.filter((item) => !item.functionalPassed).length,
    },
    categories,
    latency: {
      p50: percentile(latency, 0.5),
      p95: percentile(latency, 0.95),
      max: latency.length > 0 ? Math.max(...latency) : null,
      functionalP50: percentile(successfulLatency, 0.5),
      functionalP95: percentile(successfulLatency, 0.95),
    },
    failureCodes: countBy(
      results.flatMap((item) => item.failureCodes.map((code) => ({ code, id: item.id }))),
      (entry) => entry.code,
    ),
    warningCodes: countBy(
      results.flatMap((item) => item.warningCodes.map((code) => ({ code, id: item.id }))),
      (entry) => entry.code,
    ),
    results,
  };
}

function printSummary(report) {
  const { totals, latency, categories } = report;
  console.log('\n=== Query smoke summary ===');
  console.log(`Cases: ${totals.total} | PASS ${totals.pass} | PARTIAL ${totals.partial} | FAIL ${totals.fail}`);
  console.log(`Functional pass: ${totals.functionalPassed}/${totals.total} (${percent(totals.functionalPassed, totals.total)})`);
  console.log(`Strict pass:     ${totals.strictPassed}/${totals.total} (${percent(totals.strictPassed, totals.total)})`);
  console.log(`Latency: p50 ${latency.p50 ?? '-'}ms | p95 ${latency.p95 ?? '-'}ms | max ${latency.max ?? '-'}ms`);
  console.log(`Wall time: ${(report.durationMs / 1000).toFixed(1)}s`);
  console.log('\nBy category:');
  for (const [name, item] of Object.entries(categories)) {
    console.log(`  ${name}: ${item.functionalPassed}/${item.total} functional, ${item.strictPassed}/${item.total} strict, ${item.fail} fail`);
  }
  console.log('\nFailure codes:', JSON.stringify(report.failureCodes));
  console.log('Warning codes:', JSON.stringify(report.warningCodes));

  const problems = report.results.filter((item) => item.status !== 'PASS');
  if (problems.length > 0) {
    console.log('\nProblems (first 15):');
    for (const item of problems.slice(0, 15)) {
      const reasons = [...item.failureCodes, ...item.warningCodes.map((code) => `warn:${code}`)].join(', ');
      console.log(`  ${item.id} [${item.status}] ${item.latencyMs}ms | ${reasons}`);
      console.log(`    ${item.question}`);
      console.log(`    ${item.answerPreview || item.streamError || item.transportError || '(no answer)'}`);
      if (item.summary.failedStages.length > 0) {
        console.log(`    failed stages: ${item.summary.failedStages.map((stage) => stage.code).join(', ')}`);
      }
    }
    if (problems.length > 15) console.log(`  ... ${problems.length - 15} more in JSON report`);
  }
  console.log(`\nJSON report: ${report.options.output}`);
}

function percent(numerator, denominator) {
  return denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : '0.0%';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cases = selectedCases(options);
  if (cases.length === 0) {
    throw new Error('no smoke cases matched the filters');
  }
  const startedAt = performance.now();
  const results = new Array(cases.length);
  let nextIndex = 0;
  let completed = 0;

  console.log(`Running ${cases.length} query smoke cases against ${options.baseUrl} (concurrency ${options.concurrency})`);
  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= cases.length) return;
      const item = cases[index];
      // eslint-disable-next-line no-await-in-loop
      const result = await runCase(item, options);
      results[index] = result;
      completed += 1;
      console.log(`[${completed}/${cases.length}] ${result.id} ${result.status} ${result.latencyMs}ms ${result.answerPreview.slice(0, 100)}`);
    }
  };
  const workers = Array.from(
    { length: Math.min(options.concurrency, cases.length) },
    () => worker(),
  );
  await Promise.all(workers);

  const report = buildReport(results, options, startedAt);
  const outputPath = path.resolve(options.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  printSummary(report);
  if (report.totals.functionalPassed !== report.totals.total) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});

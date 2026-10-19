import { GENERIC_QUERY_TOKENS } from './queryLanguage.js';
import { collectResidualSpans } from './semanticResidual.js';

export const QUESTION_FILLER_PATTERN = GENERIC_QUERY_TOKENS.join('|');

function compact(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s，,。；;：:！!？?、"'“”‘’（）()【】[\]{}]/g, '');
}

export function splitQuestionClauses(question) {
  return String(question ?? '')
    .split(/[，,。；;！!？?\n]+|(?=(?:并且|同时|另外|然后|以及|再按|再计算))/)
    .map((clause) => clause.trim())
    .filter((clause) => compact(clause).length >= 2)
    .filter((clause) => !/^(?:并|然后|再|还有|以及|说明|展示|输出)$/.test(clause));
}

export function validateBindingSources(question, {
  metricFields = [],
  dimensionFields = [],
  filterFields = [],
  scopeModifiers = [],
  timeWindows = [],
}) {
  const issues = [];
  const bindingItems = [
    ...metricFields,
    ...dimensionFields,
    ...filterFields,
    ...scopeModifiers,
    ...timeWindows,
  ];
  const questionText = compact(question);
  for (const item of bindingItems) {
    if (!String(item.sourceText ?? '').trim()) {
      issues.push({
        level: 'ERROR',
        code: 'BINDING_SOURCE_REQUIRED',
        message: `查询元素缺少问题原文绑定: ${item.field || item.id || '-'}`,
      });
    }
  }
  for (const item of bindingItems) {
    const source = compact(item.sourceText);
    if (source && !questionText.includes(source)) {
      issues.push({
        level: 'ERROR',
        code: 'BINDING_SOURCE_NOT_IN_QUESTION',
        message: `查询元素引用了问题中不存在的原文: ${item.sourceText}`,
      });
    }
  }
  return issues;
}

export function buildSemanticCoverageReport({
  question,
  sources = [],
  structuralSources = [],
  nonQuerySources = [],
  registry = null,
  skipResidual = false,
  isResultActionClause = () => false,
}) {
  const issues = [];
  const unresolvedSpans = [];
  const coverage = splitQuestionClauses(question).map((clause) => {
    if (isResultActionClause(clause) || skipResidual) {
      return {
        clause,
        ratio: 1,
        spans: [],
      };
    }
    const allSources = [
      ...sources,
      ...structuralSources.filter((source) => (
        compact(clause).includes(compact(source))
      )),
      ...nonQuerySources.filter((source) => (
        compact(clause).includes(compact(source))
      )),
    ];
    const spans = collectResidualSpans({ clause, sources: allSources, registry });
    if (spans.length === 0) {
      return { clause, ratio: 1, spans };
    }
    for (const span of spans) {
      const issue = span.status === 'INDEXED_UNBOUND'
        ? {
          level: 'ERROR',
          code: 'SEMANTIC_SPAN_NOT_BOUND',
          phase: 'PLAN',
          classification: span.classification,
          disposition: span.disposition,
          spanText: span.text,
          candidates: span.candidates,
          message: `问题片段「${span.text}」已在语义索引中命中，但尚未绑定到查询元素；候选：${
            span.candidates.map((candidate) => candidate.term).join('、')
          }。`,
        }
        : {
          level: 'ERROR',
          code: 'UNRESOLVED_SEMANTIC_SPAN',
          phase: 'PLAN',
          classification: span.classification,
          disposition: span.disposition,
          spanText: span.text,
          candidates: [],
          message: `问题片段「${span.text}」未在字段、指标、值域或主题语义包中找到可追溯口径。`,
        };
      issues.push(issue);
      unresolvedSpans.push({
        clause,
        ...span,
        issueCode: issue.code,
      });
    }
    const coveredLength = Math.max(
      0,
      compact(clause).length - spans.reduce(
        (sum, span) => sum + compact(span.text).length,
        0,
      ),
    );
    return {
      clause,
      ratio: Math.min(1, coveredLength / Math.max(1, compact(clause).length)),
      spans,
    };
  });
  return {
    coverage,
    issues,
    unresolvedSpans,
  };
}

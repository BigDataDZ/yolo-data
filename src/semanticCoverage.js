import { resolveSemanticTerm, compactTerm } from './semanticTermRegistry.js';

export const QUESTION_FILLER_PATTERN =
  '请帮我给出|请给出|请提供|帮我给出|请列出|请输出|请计算|请求出|给出|提供|麻烦|帮我|给我|查询|查一下|看看|看一下|查看|请问|的|了|呢|吗|多少|是多少|有哪些|哪些|哪个|什么|分别|以及|并且|然后|同时|另外|并|按照|分组|展示|输出|统计|分析|排名|对比|和|与|vs|数据|具体原因|原因|为何|为什么|归因|上升还是下滑|上升或下滑|上升|下滑|下降|增长';

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

function matchingSources(clause, sources) {
  const target = compact(clause);
  return [...new Set(
    (sources ?? [])
      .map(String)
      .filter((source) => {
        const normalized = compact(source);
        return normalized.length >= 2 && target.includes(normalized);
      }),
  )].sort((left, right) => compact(right).length - compact(left).length);
}

function removeMatchedSources(clause, sources) {
  let residual = compact(clause);
  for (const source of matchingSources(clause, sources)) {
    residual = residual.split(compact(source)).join('');
  }
  return residual.replace(
    new RegExp(QUESTION_FILLER_PATTERN, 'gi'),
    '',
  );
}

function residualCandidates(residual) {
  if (!residual || residual.length < 2) {
    return [];
  }
  return residual
    .split(/[，,。；;：:、/|\-~—\s]+|(?=(?:并且|同时|另外|然后|以及|再按|再计算))/)
    .map((item) => item.trim())
    .filter((item) => compact(item).length >= 2)
    .filter((item) => !new RegExp(`^(?:${QUESTION_FILLER_PATTERN})$`, 'i').test(item));
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
    const residual = removeMatchedSources(clause, allSources);
    if (!residual) {
      return {
        clause,
        ratio: 1,
        spans: [],
      };
    }
    const spans = residualCandidates(residual).map((text) => {
      const candidates = resolveSemanticTerm(text, registry);
      return {
        text,
        normalized: compactTerm(text),
        status: candidates.length > 0 ? 'INDEXED_UNBOUND' : 'UNRESOLVED',
        candidates: candidates.slice(0, 5).map((candidate) => ({
          term: candidate.term,
          kind: candidate.kind,
          field: candidate.field || null,
          value: candidate.value,
          source: candidate.source,
          confidence: candidate.score,
          mode: candidate.mode,
        })),
      };
    });
    for (const span of spans) {
      const issue = span.status === 'INDEXED_UNBOUND'
        ? {
          level: 'ERROR',
          code: 'SEMANTIC_SPAN_NOT_BOUND',
          spanText: span.text,
          candidates: span.candidates,
          message: `问题片段「${span.text}」已在语义索引中命中，但尚未绑定到查询元素；候选：${
            span.candidates.map((candidate) => candidate.term).join('、')
          }。`,
        }
        : {
          level: 'ERROR',
          code: 'UNRESOLVED_SEMANTIC_SPAN',
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

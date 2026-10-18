import { resolveSemanticTerm, compactTerm } from './semanticTermRegistry.js';
import {
  cleanGenericQueryPhrase,
  isGenericQueryResidual,
  trimGenericQueryAffixes,
} from './queryLanguage.js';

function compact(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s，,。；;：:！!？?、"'“”‘’（）()【】[\]{}]/g, '');
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
  return trimGenericQueryAffixes(residual);
}

function residualCandidates(residual) {
  if (!residual || residual.length < 2) {
    return [];
  }
  const candidates = residual
    .split(/[，,。；;：:、/|\-~—\s]+|(?=(?:并且|同时|另外|然后|以及|再按|再计算))/)
    .map((item) => cleanGenericQueryPhrase(item))
    .filter((item) => compact(item).length >= 2)
    .filter((item) => !isGenericQueryResidual(item));
  const seen = new Set();
  return candidates.filter((item) => {
    const key = compact(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function collectResidualSpans({ clause, sources = [], registry = null }) {
  return residualCandidates(removeMatchedSources(clause, sources)).map((text) => {
    const candidates = resolveSemanticTerm(text, registry);
    const indexed = candidates.length > 0;
    return {
      text,
      normalized: compactTerm(text),
      status: indexed ? 'INDEXED_UNBOUND' : 'UNRESOLVED',
      classification: indexed
        ? 'SEMANTIC_TERM_NEEDS_BINDING'
        : 'UNKNOWN_SEMANTIC_TERM',
      disposition: indexed ? 'CONFIRM' : 'BLOCK',
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
}

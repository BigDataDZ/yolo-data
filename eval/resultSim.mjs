// Deterministic, dependency-free result simulator for the L2 (result-level)
// eval. Given a query-contract draft and a small fixture table, it produces
// the grouped/aggregated result the platform *would* return, so result-level
// regression checks can run in CI without a real datasource.

function applyFilter(row, filter) {
  const op = String(filter.operator || '=').toUpperCase();
  const cell = row[filter.field];
  const value = filter.value;
  if (op === 'IN') {
    const set = Array.isArray(value) ? value : [value];
    return set.map(String).includes(String(cell));
  }
  if (op === 'NOT_IN') {
    const set = Array.isArray(value) ? value : [value];
    return !set.map(String).includes(String(cell));
  }
  if (op === '=') {
    return String(cell) === String(value);
  }
  if (op === '!=') {
    return String(cell) !== String(value);
  }
  return true;
}

function aggregate(rows, field, aggregator = 'SUM') {
  const agg = String(aggregator || 'SUM').toUpperCase();
  if (agg === 'COUNT_DISTINCT') {
    return new Set(
      rows.map((row) => row[field]).filter((v) => v !== null && v !== undefined),
    ).size;
  }
  if (agg === 'COUNT') {
    return rows.filter((row) => row[field] !== null && row[field] !== undefined).length;
  }
  if (agg === 'AVG') {
    const vals = rows.map((row) => Number(row[field])).filter((v) => Number.isFinite(v));
    return vals.length ? vals.reduce((sum, v) => sum + v, 0) / vals.length : 0;
  }
  // SUM / default
  return rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
}

export function simulateContractResult({ draft, fixtureRows = [] }) {
  const rows = Array.isArray(fixtureRows) ? fixtureRows : [];
  const filters = draft?.filterFields ?? [];
  const filtered = rows.filter((row) => filters.every((filter) => applyFilter(row, filter)));
  const dims = (draft?.dimensionFields ?? []).map((d) => d.field).filter(Boolean);
  const metrics = draft?.metricFields ?? [];

  const groups = [];
  if (dims.length === 0) {
    groups.push({ key: '__total__', dimValues: {}, rows: filtered });
  } else {
    const map = new Map();
    for (const row of filtered) {
      const dimValues = {};
      for (const d of dims) {
        dimValues[d] = row[d];
      }
      const key = dims.map((d) => String(row[d])).join('|');
      if (!map.has(key)) {
        map.set(key, { key, dimValues, rows: [] });
      }
      map.get(key).rows.push(row);
    }
    groups.push(...map.values());
  }

  const aggregateGroup = (groupRows) => {
    const out = {};
    for (const m of metrics) {
      out[m.field] = aggregate(groupRows, m.field, m.aggregator);
    }
    return out;
  };

  const resultRows = groups.map((group) => ({ ...group.dimValues, ...aggregateGroup(group.rows) }));

  const order = (draft?.order && draft.order.length)
    ? draft.order
    : (metrics.length ? [{ field: metrics[0].field, dir: 'DESC' }] : []);
  resultRows.sort((a, b) => {
    for (const o of order) {
      const av = Number(a[o.field]);
      const bv = Number(b[o.field]);
      if (bv !== av) {
        return o.dir === 'ASC' ? av - bv : bv - av;
      }
    }
    return 0;
  });

  const limit = draft?.limit ?? resultRows.length;
  const limited = resultRows.slice(0, limit);
  const totals = aggregateGroup(filtered);
  const columns = [...dims, ...metrics.map((m) => m.field)];

  return {
    columns,
    rows: limited,
    totals,
    totalRowCount: resultRows.length,
  };
}

export function checkL2Result(expectResult = {}, simulated) {
  const checks = [];
  if (expectResult.rowCount !== undefined) {
    checks.push({
      assertion: 'rowCount',
      ok: simulated.rows.length === expectResult.rowCount,
      expected: expectResult.rowCount,
      actual: simulated.rows.length,
    });
  }
  if (expectResult.totalRowCount !== undefined) {
    checks.push({
      assertion: 'totalRowCount',
      ok: simulated.totalRowCount === expectResult.totalRowCount,
      expected: expectResult.totalRowCount,
      actual: simulated.totalRowCount,
    });
  }
  if (expectResult.columns) {
    const ok = JSON.stringify(simulated.columns) === JSON.stringify(expectResult.columns);
    checks.push({
      assertion: 'columns',
      ok,
      expected: expectResult.columns,
      actual: simulated.columns,
    });
  }
  if (expectResult.totals) {
    for (const [key, value] of Object.entries(expectResult.totals)) {
      const actual = simulated.totals[key];
      const tolerance = Math.max(0.01, Math.abs(Number(value)) * 1e-4);
      const ok = Math.abs(Number(actual) - Number(value)) <= tolerance;
      checks.push({
        assertion: `totals.${key}`,
        ok,
        expected: value,
        actual,
      });
    }
  }
  return checks;
}

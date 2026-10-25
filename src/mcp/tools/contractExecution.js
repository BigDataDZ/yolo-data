export function buildDatasetRequest(contract, fields = []) {
  const fieldByName = new Map(fields.map((f) => [String(f.fieldName), f]));
  const fieldByBiz = new Map(fields.map((f) => [String(f.bizName ?? f.name), f]));
  const resolveField = (name) => {
    const direct = fieldByName.get(String(name)) ?? fieldByBiz.get(String(name));
    return direct?.fieldName ?? name;
  };
  const window = (contract.timeWindows && contract.timeWindows[0]) || contract.dateInfo || null;
  const timeField = fields.find((f) => f.role === 'TIME');
  const dateRange = (timeField && window)
    ? { field: timeField.fieldName, startDate: window.startDate ?? null, endDate: window.endDate ?? null }
    : undefined;
  return {
    metrics: (contract.metrics ?? []).map((m) => ({ field: resolveField(m) })),
    dimensions: (contract.dimensions ?? []).map((d) => resolveField(d)),
    filters: (contract.filters ?? []).map((f) => ({
      field: resolveField(f.bizName ?? f.field),
      operator: f.operator,
      value: f.value,
      scope: f.scope ?? 'ROW',
    })),
    dateRange,
    order: contract.order ?? [],
    limit: contract.limit ?? 200,
    timeGrain: contract.timeGrain ?? null,
    analysisPipeline: Boolean(contract.analysisPipeline),
  };
}

export function parseContract(record) {
  if (!record) return null;
  if (record.contractJson && typeof record.contractJson === 'object') return record.contractJson;
  try {
    return JSON.parse(record.contractJson);
  } catch {
    return null;
  }
}

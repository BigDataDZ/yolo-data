function invalid(message) {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateLocalIndicator(payload) {
  if (!isRecord(payload)) invalid('本地指标请求必须是 JSON 对象');
  for (const key of ['name', 'bizName']) {
    if (typeof payload[key] !== 'string' || !payload[key].trim()) {
      invalid('指标名称和指标标识必须是非空文本');
    }
  }
  for (const key of ['typeName', 'indicatorLevel', 'businessCaliber', 'description', 'owner', 'department']) {
    if (payload[key] !== undefined && typeof payload[key] !== 'string') {
      invalid(`${key} 必须是文本`);
    }
  }
  if (payload.typeId !== undefined && typeof payload.typeId !== 'string'
    && !(typeof payload.typeId === 'number' && Number.isFinite(payload.typeId))) {
    invalid('typeId 必须是文本或数字');
  }
  const level = (payload.indicatorLevel ?? 'ATOMIC').trim().toUpperCase();
  if (!['ATOMIC', 'DERIVED'].includes(level)) invalid('indicatorLevel 必须是 ATOMIC 或 DERIVED');
  const status = payload.status === undefined ? 1 : payload.status;
  if (![0, 1, '0', '1'].includes(status)) invalid('status 必须是 0 或 1');
  for (const key of ['metrics', 'dimensions', 'models']) {
    if (payload[key] !== undefined
      && (!Array.isArray(payload[key]) || !payload[key].every(isRecord))) {
      invalid(`${key} 必须是对象数组`);
    }
  }
  if (payload.raw !== undefined && !isRecord(payload.raw)) invalid('raw 必须是 JSON 对象');
  return { ...payload, status: Number(status), indicatorLevel: level };
}

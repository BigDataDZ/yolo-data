const EDITABLE = new Set(['name', 'host', 'port', 'databaseName', 'username', 'password', 'options']);
const badRequest = message => Object.assign(new Error(message), { statusCode: 400 });

export function publicDataSource(record) {
  const { encryptedPassword, optionsJson, ...source } = record;
  return source;
}

export function dataSourceUpdate(current, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('数据源更新必须是对象');
  if (!Object.keys(body).some(key => EDITABLE.has(key))) throw badRequest('请提供需要修改的连接参数');
  for (const [key, value] of Object.entries(body)) {
    if (key === 'code' || key === 'dbType') {
      if (value !== current[key]) throw badRequest('编辑时不能修改数据源标识或类型');
    } else if (!EDITABLE.has(key)) throw badRequest(`不支持的数据源字段：${key}`);
    else if (key === 'options') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('连接选项必须是对象');
      const ssl = value.ssl;
      if (ssl !== undefined && typeof ssl !== 'boolean') {
        if (!ssl || typeof ssl !== 'object' || Array.isArray(ssl)
          || Object.keys(ssl).some(field => field !== 'ca')
          || (ssl.ca !== undefined && typeof ssl.ca !== 'string')) throw badRequest('SSL 选项或 CA 证书无效');
      }
    } else if (key === 'port') {
      if (!['number', 'string'].includes(typeof value)) throw badRequest('数据源端口无效');
    } else if (typeof value !== 'string' || (['name', 'host'].includes(key) && !value.trim())) {
      throw badRequest(`数据源字段 ${key} 无效`);
    }
  }
  return { ...current, ...body };
}

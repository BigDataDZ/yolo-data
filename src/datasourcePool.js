export function getActivePool(service, source) {
  // Re-read persisted status before consulting the cache, including for stale callers.
  source = source && service.database.getDataSource(source.id);
  if (!source) {
    throw new Error('data source not found');
  }
  if (Number(source.status) !== 1) {
    throw Object.assign(new Error('data source is disabled'), {
      code: 'DATASOURCE_DISABLED', statusCode: 403,
    });
  }
  if (!service.pools.has(source.code)) {
    service.pools.set(source.code, service.createPool(source));
  }
  return service.pools.get(source.code);
}

export async function getActivePoolAsync(service, source) {
  source = source && (service.database.dataSourceRepository?.getDataSourceAsync
    ? await service.database.dataSourceRepository.getDataSourceAsync(source.id)
    : service.database.getDataSource(source.id));
  if (!source) throw new Error('data source not found');
  if (Number(source.status) !== 1) {
    throw Object.assign(new Error('data source is disabled'), { code: 'DATASOURCE_DISABLED', statusCode: 403 });
  }
  if (!service.pools.has(source.code)) service.pools.set(source.code, service.createPool(source));
  return service.pools.get(source.code);
}

export function fallbackUnlessDisabled(error, fallback) {
  if (error.code === 'DATASOURCE_DISABLED') {
    throw error;
  }
  return fallback;
}

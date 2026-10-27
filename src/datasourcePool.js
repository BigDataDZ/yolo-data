import { configuredPool } from './datasourcePoolCache.js';

export function getActivePool(service, source) {
  // Re-read persisted status before consulting the cache, including for stale callers.
  source = source && service.database.getDataSource(source.id);
  return configuredPool(service, source);
}

export async function getActivePoolAsync(service, source) {
  source = source && (service.database.dataSourceRepository?.getDataSourceAsync
    ? await service.database.dataSourceRepository.getDataSourceAsync(source.id)
    : service.database.getDataSource(source.id));
  return configuredPool(service, source);
}

export function fallbackUnlessDisabled(error, fallback) {
  if (error.code === 'DATASOURCE_DISABLED') {
    throw error;
  }
  return fallback;
}

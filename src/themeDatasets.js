// 主题可见数据集解析：先按权限范围，再按主题绑定收窄（未绑定等于全部可见），
// 主数据集排在第一位。问数链路与开场建议共用这一份实现，避免两处口径漂移。

import { resolveAccessScope } from './permissions.js';

export function resolveThemeBusinessDatasets({
  database,
  businessDatasets = null,
  user = null,
  theme = null,
  scope = null,
} = {}) {
  if (!user || !theme) {
    return { businessDatasets: [], primaryBusinessDatasetId: null };
  }
  const resolvedScope = scope ?? resolveAccessScope({
    user,
    theme,
    permissionProfile: database.getPermissionProfile(user.id),
  });
  const grantedDatasetIds = new Set(
    (resolvedScope.allowedDatasetIds ?? []).map((id) => Number(id)),
  );
  const configuredDatasetIds = new Set(
    (theme.businessDatasetIds ?? []).map((id) => Number(id)),
  );
  const primaryBusinessDatasetId = Number(theme.primaryBusinessDatasetId) || null;
  const datasets = (businessDatasets?.listDatasets({ userId: user.id }) ?? [])
    .filter((dataset) => resolvedScope.isAdmin || grantedDatasetIds.has(Number(dataset.id)))
    .filter((dataset) => (
      configuredDatasetIds.size === 0 || configuredDatasetIds.has(Number(dataset.id))
    ))
    .sort((left, right) => {
      if (Number(left.id) === primaryBusinessDatasetId) {
        return -1;
      }
      if (Number(right.id) === primaryBusinessDatasetId) {
        return 1;
      }
      return Number(left.id) - Number(right.id);
    });
  const activePrimaryBusinessDatasetId = datasets.some(
    (dataset) => Number(dataset.id) === primaryBusinessDatasetId,
  )
    ? primaryBusinessDatasetId
    : null;
  return {
    businessDatasets: datasets,
    primaryBusinessDatasetId: activePrimaryBusinessDatasetId,
  };
}

export async function resolveThemeBusinessDatasetsAsync(options = {}) {
  const { database, user, theme, scope, businessDatasets = null } = options;
  if (!user || !theme) return { businessDatasets: [], primaryBusinessDatasetId: null };
  const resolvedScope = scope ?? resolveAccessScope({
    user,
    theme,
    permissionProfile: database.permissionRepository?.getProfile
      ? await database.permissionRepository.getProfile(user.id)
      : database.getPermissionProfile?.(user.id),
  });
  const grantedDatasetIds = new Set((resolvedScope.allowedDatasetIds ?? []).map(Number));
  const configuredDatasetIds = new Set((theme.businessDatasetIds ?? []).map(Number));
  const primaryBusinessDatasetId = Number(theme.primaryBusinessDatasetId) || null;
  const availableDatasets = database.listBusinessDatasetsAsync
    ? await database.listBusinessDatasetsAsync({ userId: user.id })
    : businessDatasets?.listDatasets({ userId: user.id }) ?? [];
  const datasets = availableDatasets
    .filter((dataset) => resolvedScope.isAdmin || grantedDatasetIds.has(Number(dataset.id)))
    .filter((dataset) => configuredDatasetIds.size === 0 || configuredDatasetIds.has(Number(dataset.id)))
    .sort((left, right) => Number(left.id) === primaryBusinessDatasetId ? -1
      : Number(right.id) === primaryBusinessDatasetId ? 1 : Number(left.id) - Number(right.id));
  return {
    businessDatasets: datasets,
    primaryBusinessDatasetId: datasets.some((item) => Number(item.id) === primaryBusinessDatasetId)
      ? primaryBusinessDatasetId : null,
  };
}

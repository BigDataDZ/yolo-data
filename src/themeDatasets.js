import { selectThemeDatasets } from './themeDatasetSelection.js';
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
  const availableDatasets = businessDatasets?.listDatasets({ userId: user.id }) ?? [];
  return selectThemeDatasets(availableDatasets, theme, resolvedScope);
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
  const availableDatasets = database.listBusinessDatasetsAsync
    ? await database.listBusinessDatasetsAsync({ userId: user.id })
    : businessDatasets?.listDatasets({ userId: user.id }) ?? [];
  return selectThemeDatasets(availableDatasets, theme, resolvedScope);
}

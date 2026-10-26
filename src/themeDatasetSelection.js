// Shared selection policy for sync and async dataset discovery.
export function selectThemeDatasets(availableDatasets, theme, resolvedScope) {
  const grantedDatasetIds = new Set(
    (resolvedScope.allowedDatasetIds ?? []).map((id) => Number(id)),
  );
  const configuredDatasetIds = new Set(
    (theme.businessDatasetIds ?? []).map((id) => Number(id)),
  );
  const primaryBusinessDatasetId = Number(theme.primaryBusinessDatasetId) || null;
  const datasets = availableDatasets
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

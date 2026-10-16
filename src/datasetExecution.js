import { normalizeDbType } from './dialects/index.js';

const LABELS = { MYSQL: 'MySQL', TIDB: 'TiDB', DORIS: 'Doris', POSTGRESQL: 'PostgreSQL' };

export function datasetExecution(dataset) {
  const dbType = normalizeDbType(dataset?.dbType);
  return { dbType, adapter: `${dbType.toLowerCase()}-dataset`, label: LABELS[dbType] };
}

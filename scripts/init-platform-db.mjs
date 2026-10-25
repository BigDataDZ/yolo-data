import { loadConfig } from '../src/config.js';
import { initializePlatformDatabase } from '../src/platformDatabase.js';

const config = loadConfig();
const initialized = await initializePlatformDatabase(config.platformDatabase);
try {
  const detail = initialized.backend === 'mysql'
    ? `已连接 MySQL 平台库并执行初始化/兼容迁移（${initialized.statementCount} 条语句）`
    : 'SQLite 平台库初始化/兼容迁移完成';
  console.log(detail);
} finally {
  await initialized.close();
}

// 演示数据启动钩子：被 BusinessDatasetService.bootstrap() 调用，
// 复用 init 里「把 bootstrapped 数据集绑定到所有主题 + 授予分析员」的既有逻辑。
// 演示数据是加分项，任何失败都只记日志，不影响服务启动。

import { seedDemoSales } from './demoSeeder.js';

export async function bootstrapDemoDatasets({
  demo = {},
  businessDatasets,
  database,
  logger = console,
} = {}) {
  try {
    const result = await seedDemoSales({ demo, businessDatasets, database, logger });
    if (!result?.ok) {
      logger.warn?.(`[demo] 演示数据未初始化：${result?.reason ?? '未知原因'}`);
      return null;
    }
    const detail = result.inserted
      ? `新写入 ${result.inserted} 行`
      : `复用已有 ${result.rowCount ?? 0} 行`;
    logger.log?.(`[demo] 演示数据集就绪：${result.dataset?.code}（${detail}）`);
    return [result.dataset];
  } catch (error) {
    logger.warn?.(`[demo] 演示数据初始化失败（已跳过，不影响启动）：${error.message}`);
    return null;
  }
}

export default bootstrapDemoDatasets;

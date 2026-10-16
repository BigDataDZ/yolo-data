// 评测看板路由：运行 L1(契约级)/L2(结果级)/L3(答案级 LLM-as-Judge) 评测，
// 返回可量化准确率与基线回归 diff。仅管理员可用。
// L3 的 Judge 需要模型：未配置时确定性①/②仍运行，Judge 部分标记为 judgePending（不造假）。
import { runAllLevels } from '../../../scripts/run-eval.mjs';

export function registerEvalRoutes(table) {
  table.add({
    id: 'eval.report',
    method: 'GET',
    path: '/api/eval',
    tags: ['eval'],
    summary: '运行 L1/L2/L3 评测，返回可量化准确率、门禁分布与回归 diff',
    middleware: ['admin'],
    handler: async (ctx) => {
      const { response, sendJson } = ctx;
      try {
        const report = await runAllLevels({ judge: null });
        sendJson(response, 200, report);
      } catch (error) {
        sendJson(response, 500, { error: error.message });
      }
    },
  });
}

// 工具 execute_query：凭 contractId 执行冻结的查询契约，返回列定义与结果行。
// 结果确定性由契约保证，不触发 LLM 推理；执行前复检一次门禁。
import { z } from 'zod';
import { buildDatasetRequest, parseContract } from './contractExecution.js';
import {
  wrapToolHandler, buildMeta, assertTenantScope, MCP_ERROR, fail, normalizeResult,
} from './shared.js';

export function registerExecuteQuery(server, ctx) {
  server.registerTool('execute_query', {
    title: '执行查询契约',
    description: '凭 resolve_query 返回的 contractId 执行冻结的查询契约，'
      + '返回列定义与结果行。结果确定性由契约保证，不触发 LLM 推理。',
    inputSchema: {
      contractId: z.string().describe('resolve_query 返回的契约 ID'),
    },
  }, wrapToolHandler(async (args) => {
    const { agent, database, requestContext, auditToolCall } = ctx;
    return auditToolCall(database, buildMeta('execute_query', requestContext, args), async () => {
      const record = database.getMcpQueryContractAsync
        ? await database.getMcpQueryContractAsync(args.contractId)
        : database.getMcpQueryContract(args.contractId);
      if (!record) throw fail(MCP_ERROR.CONTRACT_NOT_FOUND, '查询契约不存在，请重新执行 resolve_query');
      if (String(record.tenantId ?? 'default') !== String(requestContext?.tenantId ?? 'default')) {
        throw fail(MCP_ERROR.FORBIDDEN, '无权限执行此查询契约');
      }
      assertTenantScope(ctx, record.themeId);
      if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) {
        throw fail(MCP_ERROR.CONTRACT_EXPIRED, '查询契约已过期，请重新编译契约');
      }
      const contract = parseContract(record);
      if (!contract) throw fail(MCP_ERROR.INTERNAL, '查询契约内容损坏');

      let resolved;
      try {
        resolved = agent.resolveContextAsync
          ? await agent.resolveContextAsync(record.userId, record.themeId)
          : agent.resolveContext(record.userId, record.themeId);
      } catch (error) {
        throw fail(-32002, error?.message ?? '解析上下文失败');
      }
      const { theme, scope } = resolved;
      if (!scope || scope.allowed === false) {
        throw fail(-32002, scope?.reason ?? '无查询权限');
      }
      let indicator = null;
      let dataset = null;
      if (record.sourceType === 'INDICATOR') {
        indicator = record.indicatorId
          ? await agent.indicatorService.getIndicator(record.indicatorId).catch(() => null)
          : null;
      } else {
        dataset = database.getBusinessDatasetAsync
          ? await database.getBusinessDatasetAsync(record.datasetId)
          : database.getBusinessDataset(record.datasetId);
      }
      const review = agent.queryContractCompiler.review(contract, { indicator, dataset, theme, scope });
      if (!review || review.valid === false) {
        throw fail(MCP_ERROR.EXECUTION_FAILED, '契约复检未通过，可能已超出授权范围');
      }

      let result;
      if (record.sourceType === 'INDICATOR') {
        const window = (contract.timeWindows && contract.timeWindows[0]) || contract.dateInfo;
        result = await agent.indicatorService.queryIndicator({
          metricNames: contract.metrics ?? [],
          dimensionNames: contract.dimensions ?? [],
          filters: (contract.filters ?? []).map((f) => ({
            bizName: f.bizName ?? f.field,
            operator: f.operator,
            value: f.value,
          })),
          dateInfo: window,
          limit: contract.limit ?? 200,
        });
      } else {
        const fields = agent.businessDatasets.getDatasetFieldsAsync
          ? await agent.businessDatasets.getDatasetFieldsAsync(record.datasetId, true)
          : agent.businessDatasets.getDatasetFields(record.datasetId, true);
        const request = buildDatasetRequest(contract, fields);
        result = await agent.businessDatasets.executeQuery({
          datasetId: record.datasetId,
          request,
          userId: record.userId,
          sessionId: `mcp-${record.contractId}`,
        });
      }
      const payload = normalizeResult(result);
      return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
    });
  }));
}

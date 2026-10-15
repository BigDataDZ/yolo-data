// 工具 list_metrics：列出指定用户/主题下可见指标（只读）。
import { z } from 'zod';
import { wrapToolHandler, buildMeta, assertTenantScope, MCP_ERROR } from './shared.js';
import { fail } from './shared.js';

export function registerListMetrics(server, ctx) {
  server.registerTool('list_metrics', {
    title: '列出指标',
    description: '返回指定用户与主题下可见的指标清单（含指标名、业务名、类型、单位与适用范围）。'
      + '只读，用于让 AI 客户端先发现可问的指标，再发起查询。',
    inputSchema: {
      userId: z.number().int().describe('用户 ID'),
      themeId: z.number().int().describe('主题 ID'),
      keyword: z.string().optional().describe('按名称/业务名模糊搜索'),
      typeId: z.string().optional().describe('按指标类型过滤'),
      limit: z.number().int().optional().describe('最多返回条数，默认 500'),
    },
  }, wrapToolHandler(async (args) => {
    const { agent, database, requestContext, auditToolCall } = ctx;
    assertTenantScope(ctx, args.themeId);
    return auditToolCall(database, buildMeta('list_metrics', requestContext, args), async () => {
      const result = await agent.getIndicatorsForUser(args.userId, args.themeId, {
        keyword: args.keyword ?? '',
        typeId: args.typeId ?? '',
        limit: args.limit ?? 500,
      });
      const indicators = (result.indicators ?? []).map((ind) => ({
        id: ind.id,
        name: ind.name,
        bizName: ind.bizName,
        type: ind.type,
        description: ind.description ?? '',
        unit: ind.unit ?? null,
        applicable: ind.applicable ?? true,
      }));
      const payload = {
        total: result.total ?? indicators.length,
        source: result.source,
        indicators,
      };
      return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
    });
  }));
}

// 工具 get_snapshot：读取工作区已落库的分析产物（只读）。
import { z } from 'zod';
import { buildAuthorizedSnapshot } from './snapshotAccess.js';
import {
  wrapToolHandler, buildMeta, MCP_ERROR, fail,
} from './shared.js';

export function registerGetSnapshot(server, ctx) {
  server.registerTool('get_snapshot', {
    title: '获取工作区产物',
    description: '按 artifactId 读取工作区中已落库的分析产物（问数结果 / 图表 / 报告）的'
      + '元数据与预览。只读。',
    inputSchema: {
      artifactId: z.string().describe('工作区产物 ID'),
      userId: z.number().int().positive().describe('用户 ID（用于鉴权隔离）'),
    },
  }, wrapToolHandler(async (args) => {
    const { workspace, database, requestContext, auditToolCall } = ctx;
    return auditToolCall(database, buildMeta('get_snapshot', requestContext, args), async () => {
      let artifact;
      try {
        artifact = workspace.getArtifactAsync
          ? await workspace.getArtifactAsync({ artifactId: args.artifactId, userId: args.userId })
          : await workspace.getArtifact({ artifactId: args.artifactId, userId: args.userId });
      } catch (error) {
        throw fail(MCP_ERROR.CONTRACT_NOT_FOUND, '产物不存在或无权限访问');
      }
      if (!artifact) throw fail(MCP_ERROR.CONTRACT_NOT_FOUND, '产物不存在');
      return { content: [{ type: 'text', text: JSON.stringify(await buildAuthorizedSnapshot(ctx, artifact, args.userId), null, 2) }] };
    });
  }));
}

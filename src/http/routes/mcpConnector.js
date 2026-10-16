// MCP 连接器下载路由：把 mcp-connector/ 目录打包成 zip 供前端/帮助中心下载。
// 连接器描述包不含任何密钥，任意登录用户即可下载（受 auth 中间件保护）。
import { buildConnectorPackage } from '../../mcp/connectorPackage.js';

export function registerMcpConnectorRoutes(table) {
  table.add({
    id: 'mcp-connector-download',
    method: 'GET',
    path: '/api/mcp/connector/download',
    middleware: ['auth'],
    summary: '下载 MCP 连接器包（zip）',
    description: '打包 mcp-connector/ 目录为 zip，供外部 MCP 客户端接入使用',
    handler: async (ctx) => {
      let zip;
      try {
        zip = buildConnectorPackage(ctx.config.projectRoot);
      } catch (error) {
        return ctx.sendError(ctx.response, error);
      }
      ctx.response.writeHead(200, {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="yolo-data-mcp-connector.zip"',
        'content-length': zip.length,
      });
      ctx.response.end(zip);
    },
  });
}

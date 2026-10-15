# YOLO Data · MCP 连接器

将 YOLO Data 智能问数平台的能力以 [Model Context Protocol](https://modelcontextprotocol.io)（Streamable HTTP）暴露给任意 MCP 客户端。

## 包含文件
| 文件 | 作用 |
| :--- | :--- |
| `connector-meta.json` | 连接器元数据（传输方式、端点、鉴权、模式说明） |
| `mcp.json` | MCP 服务描述（5 个工具、入参、错误码约定） |
| `token-schema.json` | API Key 凭证的 JSON Schema |
| `icon.svg` | 连接器图标 |
| `skills/yolo-query/SKILL.md` | 客户端 Agent 的调用工作流 |

## 快速上手
1. **平台侧开启**（管理员）：`PUT /admin/mcp/settings`，例如
   ```json
   { "enabled": true, "mode": "full", "sessionMode": "stateless" }
   ```
2. **创建 API Key**（管理员）：`POST /admin/mcp/keys`，返回体中的 `rawKey`（形如 `mcp_xxxx`）**仅此一次可见**，请妥善保存。
3. **客户端连接**：以 `Authorization: Bearer <rawKey>` 请求 `POST /mcp`，完成 `initialize` → `tools/list` → `tools/call` 握手。

## 工具速查
- `list_metrics` / `get_policy`：只读，`read` 模式即可见。
- `get_snapshot` / `resolve_query` / `execute_query`：`standard` 及以上可见。
- 查询必先 `resolve_query` 拿 `contractId`，再 `execute_query` 执行；同一契约结果确定性一致（不触发 LLM）。

## 错误码
`401` 未授权 / `403` 未启用或 Origin 受限 / `429` 限流；工具内错误见 `mcp.json` 的 `notes` 与 `-320xx` 码（契约不存在 `-32010`、契约过期 `-32011`）。

## 状态
- 已在 `src/mcp/`、`src/http/routes/mcpAdmin.js`、`src/server.js`、`src/database.js` 落地，`tests/mcp.test.js` 全绿，`npm run lint` 0 错误。

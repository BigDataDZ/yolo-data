# MCP 连接器与外部接入

通过 [Model Context Protocol](https://modelcontextprotocol.io)（MCP，Streamable HTTP）把 YOLO Data 的问数能力开放给任意 MCP 客户端，例如 Claude Desktop、Cursor，或你自己集成的 Agent。连接器描述包可用本页顶部按钮 **下载连接器包（.zip）** 获取。

## 你会得到什么

连接器包内包含接入所需的全部描述文件（`connector-meta.json`、`mcp.json`、`token-schema.json`、`icon.svg`，以及一份客户端技能说明 `skills/yolo-query/SKILL.md`）。包内**不含任何密钥**，可安全分发。

## 接入四步

1. **开启服务**：管理员进入「MCP 令牌」页，打开启用开关并选择模式（`read` / `standard` / `full`）。关闭时 `/mcp` 对所有客户端返回 403。
2. **创建访问令牌**：在「MCP 令牌」页填写名称与租户，点击创建。返回的 API Key 形如 `mcp_xxxx`，**明文仅显示一次**，请立即保存。
3. **下载连接器包**：点击本页顶部「下载连接器包（.zip）」。
4. **配置客户端**：在你的 MCP 客户端中指向平台的 `/mcp` 端点，并在请求头带上令牌：

   ```http
   Authorization: Bearer mcp_xxxx
   Accept: application/json, text/event-stream
   ```

   完成 `initialize` → `tools/list` → `tools/call` 握手后即可调用。

## 五个工具

| 工具 | 最低模式 | 作用 |
| :--- | :--- | :--- |
| `list_metrics` | read | 列出某用户/主题下可见指标 |
| `get_policy` | read | 查询访问策略（可问范围、行/列策略） |
| `get_snapshot` | standard | 读取工作区已落库的分析产物 |
| `resolve_query` | standard | 编译并冻结确定性查询契约，返回 `contractId` |
| `execute_query` | standard | 凭 `contractId` 执行契约，返回结果行 |

## 推荐的查询方式

为保证「同一问题 → 同一结果」，查询请走 **先编译、后执行** 两步：

1. 调用 `list_metrics` 发现可问指标与其 `bizName`。
2. 调用 `resolve_query` 传入 `sourceType`、指标/维度/过滤/时间，得到 `contractId`（默认 24 小时有效）。
3. 调用 `execute_query` 凭 `contractId` 取结果。同一 `contractId` 多次执行结果一致，且**不触发大模型推理**。

## 常见错误

| 现象 | 原因 | 处理 |
| :--- | :--- | :--- |
| `401` | API Key 缺失或无效 | 确认 `mcp_` 前缀、是否被吊销 |
| `403` | 服务未启用，或 Origin 不在白名单 | 让管理员开启 / 放行来源 |
| `429` | 触发限流 | 稍后重试，或由管理员调高 `rpm`/`burst` |
| 工具返回 `-32010` | 契约不存在 | 先执行 `resolve_query` 再 `execute_query` |
| 工具返回 `-32011` | 契约已过期 | 重新 `resolve_query` 编译契约 |

## 安全说明

- API Key 只存 SHA-256 哈希，明文仅在创建时返回一次；吊销后使用该 Key 的客户端立即失效。
- 所有 MCP 调用都会写入审计日志（动作前缀 `MCP_`），管理员可在「MCP 令牌」页「最近调用」查看，或在「运行审计」中检索。
- 模式门控是**可见性**控制：权限不足的工具对客户端完全不出现，而非仅被阻止。

---
name: yolo-query
description: 通过 YOLO Data 的 MCP 服务查询主题指标与数据集。当用户想「查询某主题下的指标」「问数平台有哪些指标」「按指标出数」「拉取问数结果」且已配置 mcp_ 开头的 API Key 与 /mcp 端点时使用。触发词：YOLO Data、问数平台、指标查询、MCP 查询。
---

# YOLO Data 问数技能（MCP 客户端侧）

经由 MCP `streamable-http` 端点 `/mcp` 调用 YOLO Data 智能问数平台的 5 个工具。
鉴权为 Bearer API Key（形如 `mcp_xxxx`），由平台管理员在后台 `POST /admin/mcp/keys` 创建。

## 前置条件
- 已拿到 `mcp_` 开头的 API Key。
- 已知目标 `userId` 与 `themeId`（主题名称与可用范围由平台配置提供）。
- 端点通常为 `https://<host>/mcp`，客户端 transport 头带 `Authorization: Bearer <key>`。

## 标准工作流
1. **发现指标**：调用 `list_metrics({ userId, themeId, keyword? })`，确认有哪些可问指标及其 `bizName`。
2. **确认权限**（可选）：调用 `get_policy({ userId, themeId })` 查看可问范围与行/列策略。
3. **编译契约**：调用 `resolve_query`，传入 `sourceType`（`INDICATOR` 用 `indicatorId`；`BUSINESS_DATASET` 用 `datasetId`）、`metrics`、`dimensions?`、`filters?`、`dateInfo?`、`timeGrain?`。返回 `contractId`（24h 有效）。
4. **执行契约**：调用 `execute_query({ contractId })` 取结果。同一 `contractId` 多次执行结果一致（确定性，不触发 LLM）。
5. **取历史产物**（可选）：调用 `get_snapshot({ artifactId, userId })` 读取已落库的分析产物预览。

## 关键约束
- `resolve_query` 必须先于 `execute_query`：未先编译则 `execute_query` 报 `CONTRACT_NOT_FOUND(-32010)`。
- 契约过期（默认 24h）报 `CONTRACT_EXPIRED(-32011)`，需重新 `resolve_query`。
- 平台门禁（review）未通过的指标/维度组合会直接报错，按错误信息调整参数。
- 字段口径：指标的 `metrics`/`dimensions` 用 `list_metrics` 返回的 `bizName`；数据集同理用数据集字段业务名。

## 错误处理
- `401`：API Key 缺失/无效 → 检查 `mcp_` 前缀与是否过期吊销。
- `403`：MCP 未启用或 Origin 不被允许 → 联系管理员开启。
- 工具返回 `isError:true` 且 `error.code` 为负数：按 `message` 修正入参后重试。

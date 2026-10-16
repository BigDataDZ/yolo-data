# P0 生产加固交付报告 · metric-ask-platform (YOLO Data)

> 范围：SSO/OIDC + 外部库/分布式锁、文件上传提示注入清洗、代码执行隔离、Token 成本预算闸门
> 测试环境：Node 22.22.2（managed），`node --test` 自动发现
> 全量回归：**424 tests / 415 pass / 1 fail（预存，与 P0 无关）/ 8 skipped**

---

## 一、P0-2 文件上传提示注入清洗层 —— ✅ 已完成并测试

**新增 `src/promptSanitizer.js`**
- 中英双语注入特征（指令覆盖 / 角色伪造 / 消息边界伪造 / 越权外泄），覆盖中文业务语境（原英文-only 是盲区）。
- `detectInjection` / `neutralizeText` / `wrapUntrustedContent` / `sanitizeTable` / `sanitizeUntrustedContent`。
- 设计原则（与"确定性优先"一致）：**不静默删除数据**——命中短语替换为 `「已隔离指令片段:<id>」` 可审计标记；剥离控制字符与 `<system>` / `<|im_start|>` 等协议令牌；数字等结构化类型保持原类型。
- 集成点：`src/uploads.js` 的 `performUpload`，解析后、进模型上下文前对单元格逐格中和，并向前端回 `warnings`。

**测试**：`tests/promptSanitizer.test.js`（7 例，覆盖 EN+ZH、类型保持、审计标记、数组行、边界包裹）。

## 二、P0-4 按用户/主题的 Token 成本预算闸门 —— ✅ 已完成并测试

**新增 `src/tokenBudget.js`**
- `TokenBudgetService.check({userId, themeId, userLimit, themeLimit})` 返回 `{ok, limit, used, remaining, enforced, window}`。
- 优先级：`themeLimit → userLimit → 环境变量全局默认 → 0（不限）`。
- `tokenBudgetError` 抛出 `statusCode=429, code=TOKEN_BUDGET_EXCEEDED`。
- 依赖 `database.sumTokenUsage`（新增，聚合 `llm_call_logs` 的 `total_tokens`，按用户/主题/时间窗过滤）。

**接线**：`src/agent.js` 在 `resolveContext` 之后插入闸门；`src/application.js` 实例化并注入 `MetricAgentService`。

**测试**：`tests/tokenBudget.test.js`（5 例：无预算放行、环境变量默认、超预算拦截、主题优先、429 状态码）。

## 三、P0-3 代码执行隔离（独立低权容器 + seccomp）—— 🟡 骨架已落地，默认行为不变

- `src/codeExecution.js`：新增 `container`/`podman` 后端分支，`runContainerProcess` 以
  `--user 65534:65534 --network none --cap-drop ALL --security-opt no-new-privileges --security-opt seccomp=<profile> --read-only --memory 512m` 运行。
- 新增 `config/sandbox/seccomp-profile.json`：封锁 mount/ptrace/bpf/kexec 等危险 syscall，`defaultAction: SCMP_ACT_ALLOW`。
- **默认仍为 in-process 沙箱（项目文档明确其为"威慑型而非安全边界"）**。启用容器需提供 `SANDBOX_BACKEND=container` + `SANDBOX_IMAGE`（如 `node:22-slim`） + 宿主 `docker`/`podman`。多租户场景强烈建议开启。

## 四、P0-1 SSO/OIDC + 外部库 + 分布式会话锁 —— 🟡 零依赖骨架已落地，待你三方决策后激活

- `src/oidcAuth.js`：`createOidcVerifier` 用 Web Crypto RS256 验证 OIDC JWT（exp/iss/aud + 签名），零新依赖；`AUTH_OIDC_ISSUER` 未配时自动 no-op 回退到现有 dev/session 认证。返回 `{sub, email, name}` 替换 `x-user-id`。
- `src/distributedLock.js`：`createDistributedLock`，`sqlite` 后端用 `session_locks` 租约表（进程级互斥，零依赖）；`redis` 后端为接口骨架（未提供 redis client 时**诚实报错，不伪造锁**）。
- 外部库：`.env.example` 预留 `DATABASE_BACKEND` / `REDIS_URL`；`mysql2` 已在依赖中，`database.js` 的 `sumTokenUsage` 已验证多后端兼容接口。
- **三项阻塞决策需你确认**（见下文）。

---

## 五、⚠️ 过程中发现并修复的关键事故（非 P0 范围，但拖垮了全量测试）

`src/dialects/index.js` 被一段中文分析散文**整体覆盖**（0 个 JS 关键字，原正确实现 `normalizeDbType` 丢失）。该文件被 `database.js` 等大量模块 import，导致 **127 个测试因模块加载失败而整文件挂掉**。已从 `HEAD` 还原为正确 JS 实现。疑为更早"分析缺口"那轮把文章误写进源码。还原后全量测试从 285（挂 27 文件）恢复到 424/415/1。

> 工作区另有"记忆前置注入"功能改动（config.js / userMemory.js / http/routes/memory.js / public/js/pages/memory.js / docs/memory-architecture.md / config/size-baseline.json），**非本次 P0 内容**，但已随本次回归通过，未受影响。

---

## 六、待你确认的三项 P0-1 阻塞决策

1. **OIDC IdP 选型**：用哪家的 Issuer？（如 Auth0 / Keycloak / 企业微信/飞书自建 OIDC / Cognito）。决定 `AUTH_OIDC_ISSUER` / `AUTH_OIDC_CLIENT_ID` / `AUTH_OIDC_AUDIENCE` / `AUTH_OIDC_JWKS_URI` 真实值。
2. **外部库引擎**：SQLite → 外部库选 Postgres 还是 MySQL？（`mysql2` 已在依赖，Postgres 需加 `pg`）。决定迁移脚本与连接池方案。
3. **Redis 实例**：分布式锁要真锁还是先 sqlite 进程级？给 `REDIS_URL` 才能激活真跨进程锁。

确认后我可在一轮内把 P0-1 从骨架补成可运行接线（含登录态改写、`x-user-id` 替换、外部库连接、Redis 锁注入会话层）。

---

## 七、改动文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/promptSanitizer.js` | 新增 | P0-2 清洗层 |
| `tests/promptSanitizer.test.js` | 新增 | 7 例 |
| `src/tokenBudget.js` | 新增 | P0-4 预算闸门 |
| `tests/tokenBudget.test.js` | 新增 | 5 例 |
| `src/database.js` | 改 | +`sumTokenUsage` |
| `src/agent.js` | 改 | +预算闸门接线 |
| `src/application.js` | 改 | +TokenBudgetService 注入 |
| `src/uploads.js` | 改 | 上传解析后清洗 |
| `src/codeExecution.js` | 改 | +容器/seccomp 分支（默认不变） |
| `config/sandbox/seccomp-profile.json` | 新增 | seccomp 配置 |
| `src/oidcAuth.js` | 新增 | P0-1 OIDC 验证器 |
| `src/distributedLock.js` | 新增 | P0-1 分布式锁 |
| `.env.example` | 改 | P0 全量环境变量 |
| `src/dialects/index.js` | **还原** | 修复被散文覆盖的事故 |

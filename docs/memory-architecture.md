# 记忆能力分层架构设计（Memory Architecture）

> 文档定位：对 `yolo-data` 指标问数平台的「记忆能力」做标准化分层重构设计。
> 背景：用户反馈当前记忆模块「架构有些简单，而且不能很好地融入智能体的上下文中」。
> 目标：对照业界标准记忆分层（系统提示词 / 对话滑动窗口 / 临时工作记忆 / 长期记忆 / 共享组织记忆 / 元记忆检索），把现有散落模块归位、补齐缺口、给出分期迁移路径与配置项，**便于后续调整**。
> 范围：**本文档只定设计与契约，不改动任何业务代码。** 涉及实现时以本文件为蓝图，落到 `src/` 对应模块。
> 关联文档：`docs/architecture.md`（总体架构，第 11 节「多轮会话与上下文决策」）、`src/userMemory.js`、`src/memory.js`、`src/agent.js`、`src/queryIntent.js`、`src/feedback.js`。

---

## 0. 核心结论（先讲结论）

平台**已经具备**记忆能力的雏形，但呈「多模块各自为政、未形成分层」的状态：

- 系统提示词（`buildSystemPrompt`）、组织记忆（指标/行策略/技能/工作区产物）、长期用户记忆（`userMemory`）、纠错记忆（`feedbackHints`）、滑动窗口（`SessionMemoryStore`）、指代解析（`resolveConversationContext`）**六类记忆混在一个单体 system prompt 与一段固定 20 条窗口里**，没有分层预算、没有统一的读写/注入契约。
- 长期记忆「只注入摘要 + 被动工具检索」，无法保证取数所需口径在推理时一定可见，这是「不能很好融入上下文」的**主因**。
- 没有结构化「工作记忆/草稿区」，指代消解靠「把历史用户消息拼进 question 字符串」的取巧做法，无法承载中间态（半成契约、子目标、澄清槽位）。

**建议目标态**：把记忆明确拆成 **L0 系统提示词层 → L1 共享组织记忆层 → L2 长期用户记忆层 → L3 对话滑动窗口层 → L4 临时工作记忆层 → L5 元记忆与检索层** 六层，并由一组**横切治理**（捕获/整合/压缩遗忘/检索/注入/度量）统一调度。详见 §2–§4，迁移路径见 §6。

---

## 1. 现状盘点（事实基线，附证据）

| 关注点 | 现有模块 / 文件 | 关键事实（含行号证据） |
| --- | --- | --- |
| 系统提示词（单体） | `src/agent.js` `buildSystemPrompt()` | 1386 起组装；把**主题提示词、指标行、行级策略、技能指令、feedbackHints、业务数据集、workspaceArtifacts** 全部拼进一个 system message |
| 消息最终组装 | `src/agent.js` harness 调用 | 5178–5203：`[{role:'system',content:systemPrompt}, ...history, {role:'user',content:normalizedQuestion}]` |
| 纠错记忆注入 | `src/agent.js:2370` + `src/feedback.js` | `feedbackHints = this.feedback?.promptHints(theme.id, 8)`；取最近 8 条 `correct:false` 反馈，作为文本塞进 system prompt（`feedback.js:65` `promptHints`） |
| 会话滑动窗口 | `src/memory.js` `SessionMemoryStore` | `contextLimit=20`（来自 `chatMemoryMessageLimit`）固定窗口；`buildModelContext()`（66 行）返回 `[memoryMessage, ...history]` |
| 长期用户记忆存储 | `src/userMemory.js` `UserMemoryStore`（208） | 三表：`user_memory_documents`（摘要+正文、版本化、可回滚）、`user_memory_notes`（追加式、去重、PENDING/MERGED/ARCHIVED）、`user_memory_versions`（版本快照） |
| 长期记忆注入 | `src/userMemory.js` `buildContextMessage()`（632） | **只注入 summary** 作为 system 消息；正文经 `search_user_memory` 工具按需检索 |
| 预算常量 | `src/userMemory.js` | `SUMMARY_BUDGET=1200` / `CONTENT_BUDGET=8000` / `MAX_PENDING_NOTES=400`；`MEMORY_KINDS = BUSINESS_KNOWLEDGE/CALIBER/TERM/TIME_RANGE/PREFERENCE` |
| 写入-合并-压缩 | `src/userMemoryDistiller.js` | 三通道：抽取（append-only 笔记）、合并（整体重写文档+版本+1）、压缩（超长正文去重）；`ingest()` 由 `memory.js` `distillAfterTurn()`（78 行）每轮后置触发；阈值 `autoConsolidateAt=8`、`compactRatio=0.8`、冷却 10min |
| 按需检索工具 | `src/userMemoryTools.js` | `search_user_memory`：无 query 返回索引，有 query 关键词行检索；`scope ∈ {all,global,theme}` |
| 指代/上下文解析 | `src/queryIntent.js` `resolveConversationContext()`（147） | 判定 `NEW_TOPIC / FOLLOW_UP / INDEPENDENT`；遇到指代/结果加工，把最近 1–3 条用户消息**拼进 question 字符串**（203、213 行） |
| 组织记忆-工作区产物 | `src/agent.js` `workspaceArtifacts`（1435） | 历史查询结果的 artifact（列、样例、能力、指纹）拼进 system prompt |
| 组织记忆-指标/技能 | `src/agent.js` `buildSystemPrompt` | 指标行、行级策略、技能指令均来自主题与作用域配置 |

**事实归纳**：平台已有「长期语义记忆 + 滑动窗口 + 指代解析 + 纠错记忆 + 工作区产物」，但：
1. 它们**没有一个统一的层划分与预算账本**；
2. 长期记忆**可见性得不到保证**（摘要常驻但可能漏口径，正文靠模型主动调工具）；
3. 指代/工作态被**临时塞进 question 文本**，无法承载结构化中间态。

---

## 2. 标准分层模型（目标态）

对照 MemGPT / Mem0 / Zep 等业界分层，结合本平台「确定性优先、口径治理」的硬约束，定义**六层 + 横切治理**：

```
┌──────────────────────────────────────────────────────────────┐
│ L0  系统提示词层 (Foundation / System Prompt)                  │  ← 静态基座：人格、全局铁律、不可协商规则
│     · 平台契约 10 条、派生指标规则、语义分类法（buildSemantic…）│
├──────────────────────────────────────────────────────────────┤
│ L1  共享组织记忆层 (Shared Org Memory)                         │  ← 跨用户/跨会话可复用
│     · 指标定义与业务口径、行级策略、技能目录、工作区产物(artifact)│
├──────────────────────────────────────────────────────────────┤
│ L2  长期用户记忆层 (Long-term User Memory)                     │  ← 语义记忆 + 程序记忆
│     · 用户手册(摘要+正文, 版本化)、feedbackHints(纠错/程序记忆)  │
├──────────────────────────────────────────────────────────────┤
│ L3  对话滑动窗口层 (Conversation Sliding Window)               │  ← 本会话最近 K 轮
│     · SessionMemoryStore, contextLimit=20, 分级淘汰/递归压缩    │
├──────────────────────────────────────────────────────────────┤
│ L4  临时工作记忆层 (Working / Temporary Memory)                │  ← 本轮/当前子任务存活
│     · 指代消解结果、澄清槽位、当前子目标、半成契约、scratchpad   │
├──────────────────────────────────────────────────────────────┤
│ L5  元记忆与检索层 (Meta-memory & Retrieval)                   │  ← 不持有内容，只负责"何时取哪层"
│     · 检索编排(前置注入 vs 按需工具)、索引、命中账本            │
└──────────────────────────────────────────────────────────────┘
        横切治理(贯穿 L1–L5)：捕获 → 整合 → 压缩遗忘 → 检索 → 注入 → 度量
```

**分层原则（务必遵守，避免破坏平台命根「确定性」）**：
- **L0–L2 是常驻/半常驻上下文，必须受 token 预算约束**；超出预算按优先级淘汰，绝不靠模型「自己记得调工具」。
- **L3 是本会话窗口**，可丢弃旧轮；L4 是本轮瞬态，回合结束即清。
- **L5 不存业务内容**，只做检索决策与账本，且**检索一律走确定性精确/关键词匹配**（与总体架构一致，不引入向量近似，避免稀释口径治理）。
- **任何记忆内容都当数据不当指令**（现有治理已贯彻，长期记忆提示词反复强调）。

---

## 3. 分层映射表（现状 → 目标）

| 现有模块 | 当前归属（隐含） | 目标层 | 缺口 / 动作 |
| --- | --- | --- | --- |
| `buildSystemPrompt` 平台契约 10 条 + 派生规则 + 语义分类法 | 混在单体 prompt | **L0** | 抽离为「不可协商基座」，与 L1/L2 解耦，独立 token 预算 |
| 指标行 / 行级策略 / 技能指令 | 混在单体 prompt | **L1** | 标记为「组织记忆」，与用户记忆隔离；增加检索入口 |
| `workspaceArtifacts` | 混在单体 prompt | **L1** | 已属组织记忆；补「artifact 检索/复用策略」到 L5 |
| `userMemory` 文档（摘要+正文） | 摘要注入 + 工具检索 | **L2（语义）** | 见 §5.1：摘要→前置注入保证；正文检索编排归 L5 |
| `feedbackHints`（纠错） | 文本塞进 prompt | **L2（程序记忆）** | 与用户手册分离但同层；可进版本化「程序记忆区」 |
| `SessionMemoryStore` 20 条窗口 | 独立 | **L3** | 见 §5.4：分级淘汰 + 窗口递归压缩（summary of older turns） |
| `resolveConversationContext` 指代拼接 | 改 question 字符串 | **L4** | 见 §5.2：改为结构化 working memory，不污染 question |
| `search_user_memory` 工具 | 独立 | **L5** | 升级为「检索编排」：前置注入(取数前) + 按需工具(推理中) 双通道 |
| `UserMemoryDistiller` 抽取/合并/压缩 | 独立 | **横切（捕获/整合/压缩遗忘）** | 保留；补「全局记忆预算」触发点 |
| 指标/口径知识库（语义治理） | 散落 | **L1（可检索）** | 已有 `semantic-domain-governance`，接入 L5 检索 |

---

## 4. 每层详细规格

### L0 系统提示词层（Foundation）
- **职责**：人格设定、全局铁律（查询契约 10 条、派生指标规则、语义分类法）、安全边界。**不可协商、不随用户/会话变化**。
- **存储**：代码常量 + 主题提示词模板（`buildSystemPrompt` 头部）。
- **读写时机**：每次问数重建（便宜、纯拼接）；不落库。
- **注入位置**：消息数组第 0 位 `{role:'system'}`（agent.js:5180）。
- **当前实现**：与 L1/L2 混编在 `buildSystemPrompt`。
- **缺口/调整**：将 L0 与 L1/L2 切分，给 L0 固定 token 配额，禁止被其它层挤占。

### L1 共享组织记忆层（Shared Org Memory）
- **职责**：跨用户、跨会话可复用的「组织资产」——指标定义与业务口径、行级策略、技能目录、历史工作区产物（artifact）。
- **存储**：指标/口径来自主题与作用域配置（DB）；artifact 来自 `workspace_artifacts` 表。
- **读写时机**：问数前按主题/作用域加载；artifact 随会话工作区注入。
- **注入位置**：L0 之后、L2 之前的 system prompt 段（当前 `indicatorLines/rowPolicyLines/skillLines/workspaceLines`）。
- **当前实现**：已存在但无分层预算，也无「检索入口」——全部常驻。
- **缺口/调整**：① 给 L1 独立 token 预算，指标多时按相关性截断；② artifact 接入 L5 检索（同口径问题优先复用既有 artifact，呼应 `resolveArtifactReusePolicy`）。

### L2 长期用户记忆层（Long-term User Memory）
- **职责**：用户级稳定事实与偏好（语义记忆）+ 已验证的纠错/用法（程序记忆）。
- **存储**：`user_memory_documents`（摘要+正文、版本、可回滚）、`user_memory_notes`、`user_memory_versions`；纠错来自 `qa_feedback` 经 `FeedbackService.promptHints`。
- **读写时机**：
  - **读**：每轮问数前置（摘要）+ 推理中（正文检索）；
  - **写**：每轮后置 `distillAfterTurn` → `UserMemoryDistiller.ingest` → 抽取→合并→压缩。
- **注入位置**：当前摘要作为 `buildModelContext` 首条 system 消息（memory.js:73-74）；feedbackHints 进 L0 段。
- **当前实现**：见 §1。
- **缺口/调整**：见 §5.1（可见性保证）+ §5.5（预算治理）；程序记忆（feedback）建议独立成「程序记忆子区」，与语义手册分离但同层管理。

### L3 对话滑动窗口层（Conversation Sliding Window）
- **职责**：本会话近期上下文，供理解称呼、指代、偏好、前序澄清。
- **存储**：`chat_sessions` / `chat_messages`。
- **读写时机**：每次问数由 `buildModelContext` 取最近 `contextLimit=20` 条。
- **注入位置**：system 消息之后、当前 user 消息之前（agent.js:5181 `...history`）。
- **当前实现**：固定 20 条，旧轮直接丢弃，无递归压缩。
- **缺口/调整**：见 §5.4（分级淘汰 + 老轮摘要化）。

### L4 临时工作记忆层（Working / Temporary Memory）
- **职责**：本轮/当前子任务的瞬态——指代消解结果、澄清槽位、当前子目标、半成契约、scratchpad。
- **存储**：**不落库**（或仅落会话级临时结构）；回合结束即清。
- **读写时机**：问数开始时由 `resolveConversationContext` 填充；推理中由工具/子步骤更新。
- **注入位置**：作为结构化「工作上下文」段，置于 L3 之后、当前 user 消息之前；**不污染 question 文本**。
- **当前实现**：指代靠把历史拼进 `question` 字符串（queryIntent.js:203/213），无结构化承载。
- **缺口/调整**：见 §5.2。

### L5 元记忆与检索层（Meta-memory & Retrieval）
- **职责**：不持有业务内容；决定「哪层记忆、何时、以何种方式进入上下文」，并记录命中账本。
- **存储**：索引/账本（如 `mcp_query_contracts` 式的检索缓存可参考）；检索本身走确定性匹配。
- **读写时机**：问数前（前置注入编排）+ 推理中（按需工具）。
- **注入位置**：调度 L1/L2 的注入内容与顺序。
- **当前实现**：仅 `search_user_memory` 单一按需工具。
- **缺口/调整**：见 §5.1、§5.3——升级为「前置注入 + 按需工具」双通道编排器。

### 横切治理（贯穿 L1–L5）
- **捕获 Capture**：`UserMemoryDistiller.extractNotes` / `extractExplicitNotes`（显式「记住…」确定性落笔记）。
- **整合 Consolidate**：`consolidate()` 整体重写 + 版本+1；无变化不产版本。
- **压缩遗忘 Compact/Forget**：`compact()` 超长正文去重；`minKeepRatio=0.35` 防误删；冷却 10min。
- **检索 Retrieve**：L5 编排（目标态）。
- **注入 Inject**：各层注入位置见上；需受**全局记忆预算**约束。
- **度量 Measure**：新增命中率/召回/占比 KPI（§7）。

---

## 5. 「不能很好融入上下文」的五大问题与对策

### 5.1 长期记忆可见性无保证（最关键）
- **问题**：`buildContextMessage` 只注入摘要（~1200 字预算），正文靠模型**主动调用** `search_user_memory`。取数所需的具体口径若只在正文、且模型没调工具，就会「记了但用不上」。
- **对策（目标态）**：引入 **L5 前置注入**——问数前用本轮 `normalizedQuestion` 对用户记忆做确定性检索（同 `store.search` 关键词匹配），把 Top-N 命中片段**直接前置注入** L2 段；`search_user_memory` 工具保留为推理中补充检索。检索仍走确定性匹配，不破坏口径治理。

### 5.2 无结构化工作记忆，指代靠拼接 question
- **问题**：`resolveConversationContext` 把历史用户消息拼进 `question` 字符串（203/213 行）。这污染了「用户原始问题」，也承载不了中间态（半成契约、子目标、澄清槽位）。
- **对策**：建 **L4 结构化 working memory**：把 `mode / inheritedUserMessages / 澄清槽位 / 当前子目标` 作为独立上下文段注入，question 保持用户原话。`resolveConversationContext` 输出继续作为 L4 的填充源，但不再改写 question。

### 5.3 系统提示词单体，无分层预算
- **问题**：L0/L1/L2 全拼进一个 system prompt，谁占多少 token 无管控；指标/artifact 多时互相挤占，反而可能把关键口径挤出。
- **对策**：拆层 + **全局记忆预算账本**（§5.5），每层有配额与淘汰优先级；超预算时按 L0>L2>L1>L3 之外的顺序裁剪。

### 5.4 滑动窗口固定 20，旧轮直接丢弃
- **问题**：`contextLimit=20` 写死，无递归压缩；长会话早期指代/澄清一旦滑出窗口即丢失，且 §5.2 的拼接法在窗口边界更脆弱。
- **对策**：L3 分级淘汰——最近 N 条原文 + 更早轮次做**滚动摘要**（summary of summaries），摘要段随窗口注入；淘汰阈值可配置。

### 5.5 缺统一记忆预算与度量治理
- **问题**：仅用户记忆有 `SUMMARY_BUDGET/CONTENT_BUDGET`；L0/L1/L3/L4 无预算，也无「记忆命中率/召回」度量，无法判断投入产出。
- **对策**：新增**全局记忆预算配置**与 **L5 命中账本**（记录每次前置注入/工具检索是否命中、命中片段被引用情况），输出 KPI（§7）。

---

## 6. 分期迁移路径

> 原则：**Phase 0 不改行为、只定契约与命名**；后续逐步增强，每期可独立回退。

| 阶段 | 目标 | 主要动作 | 风险/回退 |
| --- | --- | --- | --- |
| **Phase 0** | 分层归位、命名收敛 | 在 `buildSystemPrompt`/`buildModelContext` 增加「层」注释与分段常量；配置项集中到 `config`；本文档落地为契约 | 零行为变化，纯重构可秒回退 |
| **Phase 1** | 全局记忆预算 + L5 前置注入 | 新增记忆预算账本；`search_user_memory` 升级为「前置注入 + 按需工具」双通道（确定性检索，不引入向量） | 若命中率下降，关前置注入开关回退到纯工具模式 |
| **Phase 2** | L4 工作记忆结构化 + L3 分级淘汰 | `resolveConversationContext` 输出注入 L4 段、不再拼接 question；L3 加滚动摘要 | question 拼接回退开关；窗口摘要可关闭 |
| **Phase 3** | 情节记忆 + L1 检索化 | 历史会话/查询作为 episodic 可检索；指标/artifact 接入 L5 检索，超量按相关性截断 | 不接入即维持现状全常驻 |

**建议落地顺序**：Phase 0 → Phase 1（性价比最高，直接解决「融入上下文」主因）→ Phase 2 → Phase 3。

---

## 7. 配置项与度量 KPI

### 7.1 现有配置项（沿用）
- `chatMemoryMessageLimit` → L3 `contextLimit`（当前 20）。
- `userMemory` 预算：`SUMMARY_BUDGET=1200` / `CONTENT_BUDGET=8000` / `MAX_PENDING_NOTES=400`。
- Distiller：`autoConsolidateAt=8`、`compactRatio=0.8`、`minKeepRatio=0.35`、冷却 10min。

### 7.2 建议新增配置项（Phase 1–2）
- `memory.layers.L0/L1/L2/L3/L4.budget`：每层 token 配额（默认 L0 固定、L2 摘要 1200、L1 按主题、L3 20 条、L4 小）。
- `memory.retrieval.preInject.enabled`：L5 前置注入开关（默认关，Phase 1 打开）。
- `memory.retrieval.preInject.topN`：前置注入命中条数（默认 6）。
- `memory.window.rollingSummary.enabled`：L3 滚动摘要开关（Phase 2）。
- `memory.window.recentKeep`：L3 原文保留条数（默认 8，其余摘要化）。

### 7.3 度量 KPI（接入 L5 账本）
- **记忆命中率**：前置注入/工具检索命中占比。
- **摘要召回**：用户手册摘要覆盖本轮所需口径的比例。
- **记忆 token 占比**：各层占上下文 token 比例（防膨胀）。
- **反馈修正收敛**：`feedbackHints` 命中后下一轮是否仍错（程序记忆有效性）。
- **确定性保护**：检索是否 100% 走精确/关键词匹配（禁止向量近似，写入架构门禁）。

---

## 8. 风险与回退

1. **确定性稀释风险（最高优先级）**：引入检索/分层时**严禁向量近似、动态图路由**，必须与总体架构「Contract-first + 结果锁 + 可复现」一致。缺口用确定性同义词扩展解决（呼应既有「BusinessLexicon 同义词」思路）。
2. **注入膨胀风险**：分层后若每层都常驻，上下文会膨胀。必须有 §5.5 全局预算，超预算按优先级裁剪。
3. **召回回归风险**：Phase 1 前置注入若检索词不匹配会漏口径。提供 `preInject.enabled` 开关，关掉即退回纯工具模式。
4. **question 拼接拆除风险**：Phase 2 去掉拼接后，旧指代逻辑需等价迁移到 L4。保留 `legacyQuestionFlatten` 开关，逐步切流。
5. **回退总策略**：每层改造均带独立配置开关；任一 Phase 出问题，关对应开关即回到上一稳定态，不影响其它层。

---

## 9. 开放问题 / 待确认

- [ ] L1 指标/口径在「全常驻」与「按需检索」之间，主题平均指标量是否已达需检索的阈值？（决定 Phase 3 是否提前）
- [ ] 程序记忆（feedback）是否独立成「程序记忆子区」，还是继续文本注入 L0 段？
- [ ] 情节记忆（episodic）的数据源是否复用 `chat_sessions`/`chat_messages`，还是新建 `qa_episodes` 表？
- [ ] 全局记忆预算的 token 计量口径（按字符估算还是 tokenizer）？平台已用 Node 内置，需确认轻量方案。
- [ ] 本设计文档是否要反向补充进 `docs/architecture.md` 第 11 节，保持总体架构与记忆设计的术语一致？

---

## 10. 实施状态（2026-10-16 已落地 Phase 1）

> 用户目标：记忆必须对提问**真正生效且正确**；冗余层可去。本次实现最小高杠杆改造，已落地并验证。

### 已落地改动
1. **问数前置注入（核心，解决「生效」主因）** — `src/agent.js`
   - 新增 `resolveMemoryPreInject({userId,themeId,question})`：问数前用**当前补全指代后的问题**调 `userMemories.search()`（确定性关键词匹配），取 Top-N 命中并按 `maxChars` 截断。
   - `buildSystemPrompt` 新增段落「本轮命中的用户长期记忆」，把命中片段直接前置注入 system prompt；附治理约束（记忆仅为默认口径参考，冲突以平台规则为准）。
   - 调用点：`run` 流程在 `feedbackHints` 之后计算，`buildSystemPrompt` 时传入。
2. **配置开关 + 预算** — `src/config.js` `userMemory.retrieval.preInject = { enabled, topN=6, maxChars=1200 }`，支持环境变量 `USER_MEMORY_PREINJECT_*` 覆盖；`application.js` 把 `config` 注入 agent。
3. **摘要注入文案对齐** — `src/userMemory.js` `buildContextMessage` 改为说明「相关细节已前置注入，search_user_memory 改为按需深挖工具」，消除重复提示。
4. **命中检索路由** — `src/http/routes/memory.js` 新增 `GET /api/memories/search`（鉴权+作用域收敛，admin 空 userId 跨全部用户检索）。
5. **记忆页命中预览** — `public/js/pages/memory.js` 新增「记忆命中预览」面板：输入问题即预览将被前置注入的命中片段，直接验证记忆是否生效。

### 关于「冗余层」的处置（用户授权可去，但经判断均非冗余，予以保留）
- **L2 摘要常驻注入（buildContextMessage）**：保留。它提供「用户存在这些偏好」的全局感知，与「本轮问题相关的针对性命中」互补，不是冗余。若 token 预算紧张，可调低 `summaryBudget`，而非删除。
- **`search_user_memory` 工具**：保留。前置注入覆盖常见情况，工具作为「超出 Top-N 的按需深挖」兜底，移除会降低鲁棒性。
- 结论：**未删任何层**，仅在最薄弱环节（长期记忆可见性）补上「确定性前置注入」这一保证层，使记忆从「可能生效」变为「必定生效」。

### 验证
- `node --check` 全过；`lint` 0 error（5 文件经 `--allow-growth` 显式承认：agent 5761→5809、memory 页 611→689、routes/memory 503→534、application 441→442、config 133→143）。
- 启动冒烟：`/api/health`=200，无启动报错。
- 端到端：dev 鉴权下播种记忆→合并成文档→`/api/memories/search?q=ZZZ_TEST_CALIBER` 返回精确命中片段（`excerpt:"- ZZZ_TEST_CALIBER 本部门默认按含税口径看销售额", score:3`）→清理后检索归零。证明 `search` 与将被注入的内容一致。

---

*设计基线：基于 `origin/v1.0.1` 分支源码实地核对（2026-10-16）。后续调整请以本文件 §2–§7 为契约，实现改动登记到对应 `src/` 模块并回写本节「待确认」清单。*

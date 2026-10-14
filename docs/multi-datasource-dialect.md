# 多类型数据源方言适配方案（多数据源支持 × Dialect 分层）

> 目标：让业务数据集通道支持多类型数据源（PostgreSQL 优先），把只读查询构建器里写死的 MySQL/Doris 方言抽象成可替换的 Dialect 层，并保持 Contract-first 主链、零依赖原则与架构棘轮约束不破。
> 本文记录设计方案。P0 实现与使用方式见 [PostgreSQL 接入](postgresql.md)；ClickHouse/StarRocks 属于 P1。

## 1. 结论先行

改造的实质是**三处方言化 + 一处驱动化**，核心链路（契约编译、权限、结果锁）零改动：

1. `quoteIdentifier` 的引号规则（`` ` `` vs `"`）
2. `buildTimeGrainExpression` 的时间分桶函数（`DATE_FORMAT` vs `to_char`/`date_trunc`）
3. 元数据发现 SQL（`information_schema` 各家实现差异）
4. 连接池工厂（mysql2 → pg 各自驱动，沿用现有 try-import 懒加载模式）

抽象形态采用**方言适配层（adapter/factory）模式**：每方言一个小模块 + 一个 factory，接口只覆盖查询构建真正有差异的点，不做大而全的 SQL 生成器。

## 2. 现有可复用资产（已核对源码）

| 能力 | 位置 | 复用方式 |
| --- | --- | --- |
| 标识符白名单 + 引号 | `src/businessDatasets.js` `IDENTIFIER` 正则（L33）+ `quoteIdentifier`（L50） | 白名单校验保留，**引号字符下沉到 Dialect** |
| 时间分桶表达式 | `src/businessDatasets.js` `buildTimeGrainExpression`（L51-65，DATE_FORMAT 五种粒度） | 整体迁入 Dialect 接口 `timeGrainExpr()`，MySQL/Doris 实现行为不变 |
| 只读查询构建 | `src/businessDatasets.js` `buildQuery`（SELECT/WHERE/GROUP BY/HAVING/LIMIT 拼装） | 结构不动，字符串拼接点换成 dialect 调用 |
| 驱动懒加载 | `src/businessDatasets.js` L17-33（`try import('mysql2/promise')` + `requireMysql()` 报错引导） | **如法炮制** `requirePg()` 等；报错信息同样写清"哪类数据源需要装什么" |
| 连接测试 | `testDataSource` 的 `SELECT 1` | PG/CK 同样支持，零改动 |
| dbType 字段 | `src/database.js` L227 `db_type TEXT DEFAULT 'DORIS'`、L2113 写入归一化 | 扩枚举值即可，**零迁移**（新列值走新代码路径） |
| 方言适配模式 | 成熟查询引擎方言适配层：每方言实现引号规则、时间分桶、元数据发现、类型分类 + Factory 注册；接口取 4 个与查询构建相关的最小能力点 | 接口形状直接对标 |

## 3. 前端管理页面适配（数据源创建/编辑）

数据源管理页（`public/js/components/datasourceEditor.js`）已有 `DATASOURCE_TYPES` 类型选择器，当前支持 MYSQL / TIDB / DORIS 三种，点击后自动填入默认端口。方言扩展需要在此基础上补充：

| 变更点 | 内容 |
| --- | --- |
| 类型列表新增 | `POSTGRESQL`（默认端口 5432）、`CLICKHOUSE`（默认端口 8123，HTTP 协议） |
| 类型图标 | PostgreSQL 复用 `database`、ClickHouse 复用 `workflow` 或新增 |
| 连接表单自适应 | SSL/CA 证书字段仅 PG 显示；PG 保留必填的连接数据库，创建数据集时单独填写 schema；ClickHouse 默认走 HTTP 端口 8123，列入 P1 |
| 前端 token | `dbType` 归一化为 `MYSQL | TIDB | DORIS | POSTGRESQL | CLICKHOUSE`，前端 `DATASOURCE_TYPES[].type` 与后端 `saveDataSource` 的 `dbType` 枚举对齐 |
| 连接测试适配 | `POST /api/data-sources/:id/test` 内部按 `dbType` 走对应 dialect 的 `createPool` + `SELECT 1`，返回格式不变 |
| P1 扩展 | 类型列表支持配置化（从后端接口读取支持的类型列表，前端不再硬编码）——但这需要先确认是否有动态扩展场景 |

前端改动量小（一个组件文件扩展 `DATASOURCE_TYPES` + 条件显示），但需要和后端 dialect 分层同步上线，避免用户看到 PostgreSQL 选项但实际连不上。

## 4. 必须先确认的冲突与前置阻塞

1. **零依赖原则 vs 新驱动**（package.json 目前仅 mysql2）
   - 与 mysql2 同级处理：pg/ClickHouse 驱动列为**可选依赖**，运行时 try-import，缺失时引导安装（现有 `requireMysql()` 模式已定调）。核心包依赖不变。
2. **dbType 枚举扩展**：现状只认 `'DORIS'` 默认值。建议归一为 `MYSQL | DORIS | POSTGRESQL | CLICKHOUSE`，未知值回退 `MYSQL` 方言（Doris 走 MySQL 方言实测已通，保持兼容）。
3. **架构棘轮**（`GROWTH_TOLERANCE = 0`）：新逻辑一律落**新模块** `src/dialects/`，`buildQuery` 等已登记文件只允许等价替换（如有增长显式 `--allow-growth`）。
4. **元数据发现差异**：`listTables/listColumns` 现走 `information_schema`（MySQL 语法）。PG 的 information_schema 兼容度高（小差异）；ClickHouse 需改 `system.tables/system.columns`——列入 Dialect 的 `metadataSql()`。
5. **上传文件通道的口径冲突**（沿用 local-file-analysis.md §3.2 结论）：方言化不改变"正式业务数值只来自在线指标/数据集"的口径原则。

## 5. 设计

### 5.1 Dialect 接口（每方言一个小模块，新目录 src/dialects/）

```js
// src/dialects/types.js —— 接口契约（JSDoc，不引入类型系统）
// { code: 'MYSQL' | 'POSTGRESQL' | ...
//   quoteIdentifier(name): string        // 引号字符与转义
//   timeGrainExpr(columnExpr, grain): string  // DAY/WEEK/MONTH/QUARTER/YEAR
//   countDistinct(expr): string          // COUNT(DISTINCT x) / uniq(x)
//   limitClause(n): string               // 三方言目前一致，留作方言点位
//   metadataSql(kind): {tables, columns} // 元数据发现 SQL 模板
//   classifyColumnType(typeName): 'TIME'|'NUMBER'|'STRING'|...
//   createPool(source): Pool }           // 驱动适配
```

### 5.2 方言差异表（P0 两个实现 + P1 预留）

| 语法点 | MySQL / Doris（现状） | PostgreSQL（P0） | ClickHouse（P1） |
| --- | --- | --- | --- |
| 标识符引号 | `` `name` `` | `"name"` | `` `name` `` |
| 分桶 DAY | `DATE_FORMAT(col,'%Y-%m-%d')` | `to_char(col,'YYYY-MM-DD')` | `toString(toDate(col))` |
| 分桶 WEEK | `DATE_SUB(...INTERVAL WEEKDAY...)` | `date_trunc('week', col)` | `toStartOfWeek(col)` |
| 分桶 MONTH | `DATE_FORMAT(col,'%Y-%m')` | `to_char(col,'YYYY-MM')` | `toString(toStartOfMonth(col))` |
| 分桶 QUARTER | `CONCAT(YEAR(col),'-Q',QUARTER(col))` | `to_char(col,'YYYY-"Q"Q')` | `toString(toStartOfQuarter(col))` |
| 分桶 YEAR | `DATE_FORMAT(col,'%Y')` | `to_char(col,'YYYY')` | `toString(toStartOfYear(col))` |
| COUNT_DISTINCT | `COUNT(DISTINCT x)` | `COUNT(DISTINCT x)` | `uniq(x)` |
| 元数据 | `information_schema.tables/columns` | 同左（schema 语义小差异） | `system.tables/columns` |
| 连接驱动 | `mysql2/promise` | `pg` | `@clickhouse/client` 或 mysql 协议端口 |

### 5.3 接入点（等价替换，不动主链）

```
buildQuery() ──拼接点──> dialect.quoteIdentifier / timeGrainExpr / countDistinct / limitClause
listTables/listColumns() ──> dialect.metadataSql + classifyColumnType
createPool() ──> dialect.createPool（懒加载驱动，缺失时与 requireMysql() 同款报错引导）
```

契约编译、行级权限注入、结果稳定化、审计**零改动**——方言只活在"契约 → 物理 SQL"的最后一步。

### 5.4 测试策略

- **方言语法单测**（P0 必做）：每 dialect 一组快照断言（timeGrain 五粒度 × quote/countDistinct），不连真实库
- **集成测试（可选）**：Testcontainers 拉 PG 容器跑 buildQuery 真实结果比对；不进默认 `npm test`，独立脚本按需跑——符合零常驻依赖原则
- 既有 `tests/businessDatasets.test.js`（15K）必须全绿——重构是行为不变的等价替换，这是验收线

## 6. 分期

- **P0（本方案落地）**：`src/dialects/` 目录 + Dialect 接口 + MYSQL/DORIS 实现（行为不变重构）+ POSTGRESQL 实现 + 语法单测 + 集成测试脚手架。预计 3 个文件新增（types/mysql/postgresql）+ `businessDatasets.js` 少量等价替换。
- **P1**：ClickHouse / StarRocks 方言；连接参数工厂（SSL、连接池参数按方言归一）；`dbType` 枚举迁移期兼容提示。
- **不做**：SQL 反向解析、方言互转、写操作——只读 SELECT Builder 的边界不动。

## 7. 与阶段演进的关系

对应 `docs/architecture.md` §20 之外的已知约束 #6（"接入其他方言需要独立 Builder"）：本方案即该 Builder 的分层形态；P0 完成后，README"后续规划"中的"多类型数据源支持"即可勾掉一条腿。

# PostgreSQL 数据源接入（P0）

## 安装与配置

核心依赖仍只有 mysql2。使用 PostgreSQL 时，在项目目录安装可选驱动：

```bash
npm install --no-save --package-lock=false pg
```

部署流程如果运行 `npm ci`，应在其后执行上述命令。未安装 pg 时平台仍可启动，PostgreSQL 连接测试会返回驱动安装提示。

Docker 部署请在构建时安装驱动：`docker build --build-arg INSTALL_PG=true -t yolo-data .`。
使用 Compose 时，在 POSIX shell 中执行 `INSTALL_PG=true docker compose up -d --build`；PowerShell 先执行 `$env:INSTALL_PG='true'`，再执行 `docker compose up -d --build`。仅给运行中的容器设置环境变量不会安装驱动。

在「数据源管理 → 新增数据源」选择 PostgreSQL，填写 Host、端口（默认 5432）、连接数据库、用户名和密码。连接数据库是 PostgreSQL database 名称，如 `analytics`，不能为空。

需要 TLS 时选择「启用并验证服务器证书」，可粘贴 PEM 格式 CA 内容；留空使用系统信任的证书。TLS 开启后始终验证服务器证书。

保存后执行连接测试，再新增业务数据集：选择该数据源，填写 Schema（默认 `public`）和物理表名。连接数据库与 Schema 是不同层级，例如数据库 `analytics` 中的 `public.sales`。当前标识符仍使用平台原有白名单：字母/下划线开头，仅含字母、数字和下划线；支持大小写标识符，查询时使用双引号保留大小写。

已有连接可在数据源列表点击「编辑」修改地址、端口、连接数据库、用户名、密码和 SSL/CA。密码留空保留原值，类型和标识不能修改。更改连接参数后请重新测试；编辑连接数据库时，应确认已有数据集的 schema 和表在目标数据库中仍然存在。

## 实现边界

- MySQL、TiDB、Doris 共用 MySQL 方言，保持原有时间分桶和连接配置。
- PostgreSQL 方言包含五种时间粒度、标识符、参数编号、条件聚合、元数据扫描和连接池。
- PostgreSQL 的周以周一为起点，时间分桶统一返回与 MySQL 一致的字符串键。
- 数据源「databases」发现接口对 PostgreSQL 返回当前连接数据库内的 schema 列表；tables/columns 在选定 schema 内扫描。
- 驱动将 PostgreSQL 结果适配为平台现有的 `[rows, fields]` 结构，日期/时间保留数据库本地字符串，bigint/numeric 使用 pg 的默认字符串解析，避免精度丢失。
- PostgreSQL 连接启用数据库会话只读模式、Asia/Shanghai 时区、20 秒服务端语句超时与客户端查询超时。SSL 开关/CA 保存在现有 options JSON，数据库密码仍走原有加密流程。
- ClickHouse 和 StarRocks 留在 P1，当前页面不提供尚未实现的类型。

Contract-first、权限绑定、结果锁和审计流程保持原有接口。参数值独立绑定，驱动不把值插入 SQL 文本。方言实现位于 `src/dialects/`，接口契约见 `types.js`。

驱动 API 参考：[node-postgres 参数化查询](https://node-postgres.com/features/queries)、[连接池](https://node-postgres.com/apis/pool)。

## 验证

默认 `npm test` 包含方言、SQL 构建、驱动适配、前端表单和既有查询回归；未配置专用 PostgreSQL 测试库时，真实数据库集成测试跳过。CI 单独启动 PostgreSQL 17 服务并执行该集成测试。

本地集成测试使用专用测试数据库，创建一个随机命名的 schema，验证结束后删除。连接用户需拥有该测试库的建表权限。

PowerShell：

```powershell
$env:YOLO_PG_TEST_DATABASE = 'yolo_test'
$env:PGHOST = '127.0.0.1'
$env:PGPORT = '5432'
$env:PGUSER = 'postgres'
$env:PGPASSWORD = '你的测试库密码'
node --test tests/postgresql.integration.test.js
```

覆盖元数据发现、条件聚合、HAVING、时间分桶、抽样、MIN/MAX、枚举取值和连接只读约束。无需安装 Testcontainers 或修改核心依赖。

## 边界与浏览器验收

CI 还通过独立任务生成一次性 CA/服务端证书，开启测试 PostgreSQL 的 TLS。`tests/postgresql.boundaries.test.js` 验证可信 CA 的真实加密连接、不可信证书拒绝、bigint/numeric 原始返回精度、错误凭据/数据库/端口、服务端及客户端超时、空闲连接断开后的恢复。精度验证覆盖驱动和数据集原始查询返回；不代表所有下游 JS 数值运算都支持任意精度。

浏览器验收使用 Chromium、真实平台 HTTP 服务、临时 SQLite 元数据和测试 PostgreSQL，完成管理员登录、选择 PostgreSQL、填写并保存 SSL/CA、测试连接、创建 schema 下的数据集及抽样。截图随 CI 保存为 `postgresql-browser` artifact。

本地执行浏览器验收时，先安装测试工具（不修改核心依赖）：

```bash
npm install --no-save --package-lock=false pg @playwright/test
npx playwright install chromium
```

PowerShell 中设置 `$env:YOLO_BROWSER_TEST = '1'` 后运行 `node --test tests/postgresql.browser.test.js`。未设置 `YOLO_PG_TEST_DATABASE` 时，只验证表单、持久化及连接失败提示；设置专用测试库后才验证连接成功、数据集创建和抽样。需要 TLS 成功路径时，再设置 `YOLO_PG_TEST_CA` 为测试 CA PEM 文件路径。

边界测试命令为 `node --test tests/postgresql.boundaries.test.js`，同样需要专用测试库。未配置 CA 时仅 TLS 用例跳过，其余网络与精度用例正常执行。

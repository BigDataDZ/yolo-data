# 演示数据（Demo）

给「装完就能问数」准备的一套生鲜 B2B 销售明细演示数据。

| 文件 | 说明 |
| --- | --- |
| `ads_sale_detail.schema.json` | 表结构唯一来源：表名、表注释、80 个字段（名称 / 类型 / 是否可空 / 中文注释） |
| `demo.json` | 数据集 / 数据源命名与描述（业务词集中在这里，`src/` 不放业务词表） |
| `salesDemoData.mjs` | 生成器：维度池 + 确定性随机数（放在 config 下，便于按租户替换 Demo 口径） |
| 建表与导出 | `src/demo/demoSql.js`（MySQL / Doris 两种 DDL、批量 INSERT、CSV） |
| 启动灌数 | `src/demo/demoSeeder.js` + `src/demo/demoBootstrap.js` |
| 导出命令 | `npm run demo:export`（产物写到 `data/demo/`，该目录不入库） |

## 数据画像

- **时间**：默认 `2024-11-01 ~ 2026-10-20`，按生鲜业务节律分布（周一备货高、周末团餐低，年初年末小高峰，整体缓慢增长）。
- **客户**：8 个虚拟客户，覆盖日配 / BBC / 商超 / 团餐四类业态，各带销售员、主管、经理、签约公司与履约 DC。
- **商品**：20 个 SKU，覆盖蔬菜、肉禽、水产、蛋奶、干货、加工品六个大类。
- **规模**：默认 5000 行；金额带闭合关系，平台的三检（数字自洽）能直接跑通。

## 口径保证

```
sale_amt        = sale_qty × sale_price            （含税销售额）
sale_cost       = sale_qty × cost_price            （含税销售成本）
profit          = sale_amt − sale_cost
sale_amt_no_tax = sale_amt / (1 + tax_rate)
tax_amt         = sale_amt − sale_amt_no_tax
profit_no_tax   = sale_amt_no_tax − sale_cost_no_tax
purchase_qty    ≥ sale_qty                         （差额作为门店损耗）
```

单测在 `tests/demoSeed.test.js`（生成口径）与 `tests/demoSeeder.test.js`（落库编排）。

## 开启方式

```yaml
# yolo-conf.yaml
bootstrapDatasource:
  demo:
    enabled: true
    # 可选：指定演示库（默认复用 platform_mysql）
    db:
      type: MYSQL            # MYSQL | DORIS
      host: 127.0.0.1
      port: 3306
      database: demo_sales
      user: demo
      password: ""           # 机密：建议用 DEMO_DB_PASSWORD 环境变量提供
```

启动时 `BusinessDatasetService.bootstrap()` 会走 demo 分支：解析数据源 → 建表（若不存在）→ 灌数 → 注册数据集
`ads_sale_detail_demo` → 同步字段语义（`TIME / METRIC / DIMENSION / IDENTIFIER` 由字段名与类型推断，显示名取列注释）。
随后 `application.init()` 里既有的逻辑会把该数据集绑定到所有主题，并授予分析员访问权。

## 调参

```yaml
bootstrapDatasource:
  demo:
    rows: 5000                 # 行数
    startDate: 2024-11-01      # 起始日期
    endDate: 2026-10-20        # 结束日期
    seed: 20261022             # 随机种子，同参数必得同一批数据
    loadData: false            # 只注册数据集，不灌数
```

想改客户 / 商品维度，改 `config/demo/salesDemoData.mjs` 顶部的 `CUSTOMERS`、`GOODS` 两个池子即可，
表结构变更则只改 `ads_sale_detail.schema.json`，DDL、CSV、字段语义会一起跟着变。

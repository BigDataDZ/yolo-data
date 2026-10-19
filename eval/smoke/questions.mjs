const attribution = (id, question, overrides = {}) => ({
  id,
  category: 'attribution',
  question,
  expect: {
    mode: 'ATTRIBUTION',
    requireData: true,
    requireBreakdown: true,
    requirePeriodComparison: true,
    ...overrides,
  },
});

const metric = (id, question, overrides = {}) => ({
  id,
  category: 'metric',
  question,
  expect: {
    requireData: true,
    ...overrides,
  },
});

const robustness = (id, question) => ({
  id,
  category: 'robustness',
  question,
  expect: {
    allowClarification: true,
    allowEmptyData: true,
  },
});

export const SMOKE_QUESTIONS = [
  attribution(
    'ATTR-001',
    '26年9月份的业绩对比上月有什么变化？按照客户结构、品类等相关维度帮我分析下降或上升的主要因素',
  ),
  attribution(
    'ATTR-002',
    '2026年9月含税销售额环比下降，客户结构和品类结构分别影响多少',
  ),
  attribution(
    'ATTR-003',
    '2026年9月销售变化主要来自哪些客户，为什么',
  ),
  attribution(
    'ATTR-004',
    '分析2026年9月销售业绩变化，要求拆到客户和品类，给出主因',
  ),
  attribution(
    'ATTR-005',
    '2026年9月销售额为什么下降，按品类、客户、省区、渠道拆分并给出影响金额',
  ),
  attribution(
    'ATTR-006',
    '2026年9月含税销售额相比8月增长的主要原因，重点看客户和品类',
  ),
  attribution(
    'ATTR-007',
    '2026年9月销售变化按经营管理分类拆解，哪些分类拉动最大',
  ),
  attribution(
    'ATTR-008',
    '2026年9月销售变化按客户一级履约行业拆解，主要增长和下降行业',
  ),
  attribution(
    'ATTR-009',
    '2026年9月哪个销售大区对销售变化贡献最大',
  ),
  attribution(
    'ATTR-010',
    '2026年9月哪些省区拖累了销售额，为什么',
  ),
  attribution(
    'ATTR-011',
    '2026年9月各销售城市组对销售变化的影响',
  ),
  attribution(
    'ATTR-012',
    '2026年9月销售额下降主要由哪些业务类型导致',
  ),
  attribution(
    'ATTR-013',
    '2026年9月不同下单渠道的销售变化及贡献',
  ),
  attribution(
    'ATTR-014',
    '2026年9月销售员中哪些人带来主要增长',
  ),
  attribution(
    'ATTR-015',
    '2026年9月客户结构变化对销售额下降的影响',
  ),
  attribution(
    'ATTR-016',
    '2026年9月品类结构变化对销售额上升的影响',
  ),
  attribution(
    'ATTR-017',
    '2026年8月含税销售额比7月变化的原因，按客户和品类拆解',
  ),
  attribution(
    'ATTR-018',
    '2026年三季度含税销售额相比二季度变化的主要原因',
  ),
  attribution(
    'ATTR-019',
    '2026年9月含税毛利率变化由哪些品类导致',
  ),
  attribution(
    'ATTR-020',
    '2026年9月含税毛利率变化主要由哪些客户结构导致',
  ),
  attribution(
    'ATTR-021',
    '2026年9月销售额变化中，各经营管理分类的贡献排名',
  ),
  attribution(
    'ATTR-022',
    '2026年9月销售额变化主要来自客户还是品类',
  ),
  attribution(
    'ATTR-023',
    '2026年9月销售额和上月对比，找出增长和拖累最大的客户',
  ),
  attribution(
    'ATTR-024',
    '2026年9月销售波动的关键驱动因素，按客户、品类、省区分析',
  ),
  attribution(
    'ATTR-025',
    '2026年9月销售额相比上月的变化由哪些因素造成，按客户和品类分析',
  ),

  metric('METRIC-001', '2026年9月含税销售额是多少'),
  metric('METRIC-002', '2026年9月含税销售额按客户结构拆分'),
  metric('METRIC-003', '2026年9月含税销售额按经营管理分类排名前10'),
  metric('METRIC-004', '2026年9月含税销售额按周趋势', { mode: 'TREND' }),
  metric('METRIC-005', '2026年9月含税销售额对比上月'),
  metric('METRIC-006', '2026年9月含税销售额按销售大区分布'),
  metric('METRIC-007', '2026年9月含税销售额按省区排名'),
  metric('METRIC-008', '2026年9月含税销售额前10客户'),
  metric('METRIC-009', '2026年9月含税定价毛利率按品类排名'),
  metric('METRIC-010', '2026年8月含税销售额是多少'),
  metric('METRIC-011', '2026年9月销售额按客户和品类交叉分析'),
  metric('METRIC-012', '2026年9月销售额按品类和月份趋势', { mode: 'TREND' }),

  robustness('ROBUST-001', '9月销售额按天气维度拆分'),
  robustness('ROBUST-002', '9月销售额为什么下降，按价格和销量拆解'),
  robustness('ROBUST-003', '9月销售额是多少'),
];

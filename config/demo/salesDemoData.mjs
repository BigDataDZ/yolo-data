// 演示数据生成器：根据固定的维度池 + 确定性随机数产出「生鲜 B2B 销售明细」。
// 同一 seed / 日期区间 / 行数一定得到同一批数据，便于重复初始化与回归。
// 金额口径自带闭合关系（供平台做数字自洽校验）：
//   sale_amt  = sale_qty × sale_price          （含税）
//   sale_cost = sale_qty × cost_price          （含税）
//   profit    = sale_amt − sale_cost
//   tax_amt   = sale_amt − sale_amt_no_tax     （sale_amt_no_tax = sale_amt / (1 + tax_rate)）
//   profit_no_tax = sale_amt_no_tax − sale_cost_no_tax

export const DEMO_SALES_SEED = 20261022;
export const DEMO_ROWS_DEFAULT = 5000;

// 买家画像：8 个虚拟客户，覆盖生鲜 B2B 常见业态（日配 / BBC / 商超 / 食堂）。
const CUSTOMERS = [
  {
    code: 'C1001', name: '鲜丰餐饮管理有限公司', sub: '鲜丰餐饮-华东一区',
    region: ['R01', '华东'], province: ['P01', '江苏'], city: ['CT01', '南京'],
    channel: ['CH01', '日配'], businessType: [101, '日配到家'],
    industry: ['F01', '餐饮', 'F0102', '连锁中式正餐'],
    bloc: '鲜丰集团', sale: ['S2001', '王磊'], supervisor: ['M3001', '陈敏'],
    manager: ['M4001', '周涛'], cityManager: ['M5001', '刘洋'],
    signCompany: ['SC01', '优络鲜供应链（江苏）有限公司'], agreementDc: ['DC01', '南京履约中心'],
    signDate: '2023-03-06',
  },
  {
    code: 'C1002', name: '悦食中央厨房供应链', sub: '悦食央厨-苏南',
    region: ['R01', '华东'], province: ['P01', '江苏'], city: ['CT02', '苏州'],
    channel: ['CH01', '日配'], businessType: [101, '日配到家'],
    industry: ['F01', '餐饮', 'F0101', '团餐'],
    bloc: '悦食集团', sale: ['S2002', '李静'], supervisor: ['M3001', '陈敏'],
    manager: ['M4001', '周涛'], cityManager: ['M5002', '孙倩'],
    signCompany: ['SC01', '优络鲜供应链（江苏）有限公司'], agreementDc: ['DC02', '苏州履约中心'],
    signDate: '2023-08-14',
  },
  {
    code: 'C2001', name: '邻家优选社区团购', sub: '邻家优选-BBC 事业部',
    region: ['R02', '华南'], province: ['P03', '广东'], city: ['CT04', '深圳'],
    channel: ['CH02', 'BBC'], businessType: [201, '社区团购'],
    industry: ['F02', '零售', 'F0203', '社区团购'],
    bloc: '邻家优选', sale: ['S2003', '赵鹏'], supervisor: ['M3002', '吴迪'],
    manager: ['M4002', '郑洁'], cityManager: ['M5003', '何明'],
    signCompany: ['SC02', '优络鲜供应链（华南）有限公司'], agreementDc: ['DC04', '深圳履约中心'],
    signDate: '2024-01-09',
  },
  {
    code: 'C2002', name: '好日子连锁超市', sub: '好日子-华南门店',
    region: ['R02', '华南'], province: ['P03', '广东'], city: ['CT03', '广州'],
    channel: ['CH03', '商超'], businessType: [301, '商超直供'],
    industry: ['F02', '零售', 'F0201', '商超'],
    bloc: '好日子控股', sale: ['S2004', '林芳'], supervisor: ['M3002', '吴迪'],
    manager: ['M4002', '郑洁'], cityManager: ['M5004', '许强'],
    signCompany: ['SC02', '优络鲜供应链（华南）有限公司'], agreementDc: ['DC03', '广州履约中心'],
    signDate: '2022-11-21',
  },
  {
    code: 'C3001', name: '康泰医院后勤服务中心', sub: '康泰医院-食堂',
    region: ['R03', '华北'], province: ['P05', '北京'], city: ['CT06', '北京'],
    channel: ['CH04', '团餐'], businessType: [401, '机构直供'],
    industry: ['F03', '机构', 'F0301', '医疗'],
    bloc: '康泰医疗', sale: ['S2005', '高翔'], supervisor: ['M3003', '马丽'],
    manager: ['M4003', '曹宇'], cityManager: ['M5005', '田野'],
    signCompany: ['SC03', '优络鲜供应链（华北）有限公司'], agreementDc: ['DC06', '北京履约中心'],
    signDate: '2023-05-18',
  },
  {
    code: 'C3002', name: '禾丰学校餐饮集团', sub: '禾丰-华北学区',
    region: ['R03', '华北'], province: ['P06', '天津'], city: ['CT07', '天津'],
    channel: ['CH04', '团餐'], businessType: [401, '机构直供'],
    industry: ['F03', '机构', 'F0302', '教育'],
    bloc: '禾丰教育', sale: ['S2006', '宋佳'], supervisor: ['M3003', '马丽'],
    manager: ['M4003', '曹宇'], cityManager: ['M5006', '葛亮'],
    signCompany: ['SC03', '优络鲜供应链（华北）有限公司'], agreementDc: ['DC07', '天津履约中心'],
    signDate: '2024-02-26',
  },
  {
    code: 'C4001', name: '蜀香火锅食材配送', sub: '蜀香-川渝',
    region: ['R04', '西南'], province: ['P07', '四川'], city: ['CT08', '成都'],
    channel: ['CH01', '日配'], businessType: [101, '日配到家'],
    industry: ['F01', '餐饮', 'F0103', '火锅'],
    bloc: '蜀香餐饮', sale: ['S2007', '罗鑫'], supervisor: ['M3004', '冯磊'],
    manager: ['M4004', '蒋雯'], cityManager: ['M5007', '邓超'],
    signCompany: ['SC04', '优络鲜供应链（西南）有限公司'], agreementDc: ['DC08', '成都履约中心'],
    signDate: '2024-06-03',
  },
  {
    code: 'C4002', name: '茶山集新式茶饮', sub: '茶山集-西南门店',
    region: ['R04', '西南'], province: ['P08', '重庆'], city: ['CT09', '重庆'],
    channel: ['CH02', 'BBC'], businessType: [201, '社区团购'],
    industry: ['F01', '餐饮', 'F0104', '茶饮'],
    bloc: '茶山集', sale: ['S2008', '何静'], supervisor: ['M3004', '冯磊'],
    manager: ['M4004', '蒋雯'], cityManager: ['M5008', '袁泉'],
    signCompany: ['SC04', '优络鲜供应链（西南）有限公司'], agreementDc: ['DC09', '重庆履约中心'],
    signDate: '2024-09-12',
  },
];

// 商品池：覆盖蔬果 / 肉禽 / 水产 / 蛋奶 / 干货 / 加工品六个大类。
const GOODS = [
  ['G10001', '本地小白菜', '蔬菜', '叶菜类', '500g/袋', '袋', 3.6, 4.9, 0.09, '绿源蔬菜'],
  ['G10002', '上海青', '蔬菜', '叶菜类', '500g/袋', '袋', 3.1, 4.3, 0.09, '绿源蔬菜'],
  ['G10003', '西兰花', '蔬菜', '花菜类', '1kg/颗', '颗', 6.8, 9.2, 0.09, '绿源蔬菜'],
  ['G10004', '土豆', '蔬菜', '根茎类', '10kg/袋', '袋', 26.0, 34.5, 0.09, '沃野农业'],
  ['G10005', '胡萝卜', '蔬菜', '根茎类', '10kg/袋', '袋', 22.5, 30.0, 0.09, '沃野农业'],
  ['G20001', '冷鲜五花肉', '肉禽', '猪肉', '5kg/箱', '箱', 168.0, 209.0, 0.09, '众益肉联'],
  ['G20002', '冷鲜猪里脊', '肉禽', '猪肉', '5kg/箱', '箱', 186.0, 232.0, 0.09, '众益肉联'],
  ['G20003', '白条鸡', '肉禽', '禽类', '8kg/箱', '箱', 132.0, 168.0, 0.09, '恒昌禽业'],
  ['G20004', '牛腩块', '肉禽', '牛肉', '5kg/箱', '箱', 335.0, 402.0, 0.09, '北牧食品'],
  ['G30001', '活鲜基围虾', '水产', '虾类', '2kg/箱', '箱', 148.0, 186.0, 0.09, '海之鲜'],
  ['G30002', '冰鲜鲈鱼', '水产', '鱼类', '5kg/箱', '箱', 128.0, 162.0, 0.09, '海之鲜'],
  ['G40001', '鲜鸡蛋', '蛋奶', '蛋品', '360枚/箱', '箱', 208.0, 248.0, 0.09, '晨鸣蛋业'],
  ['G40002', '巴氏鲜牛奶', '蛋奶', '乳品', '1L×12/箱', '箱', 96.0, 122.0, 0.13, '牧场直送'],
  ['G50001', '干香菇', '干货', '菌菇', '5kg/箱', '箱', 265.0, 328.0, 0.13, '山野干货'],
  ['G50002', '东北大米', '干货', '米面', '25kg/袋', '袋', 118.0, 142.0, 0.09, '丰谷粮油'],
  ['G60001', '净菜土豆丝', '加工品', '净菜', '2kg/袋', '袋', 12.6, 17.8, 0.13, '中央厨房'],
  ['G60002', '净菜西兰花块', '加工品', '净菜', '2kg/袋', '袋', 15.2, 21.0, 0.13, '中央厨房'],
  ['G60003', '调味鸡排', '加工品', '预制菜', '5kg/箱', '箱', 156.0, 198.0, 0.13, '中央厨房'],
  ['G60004', '手工小笼包', '加工品', '面点', '120只/箱', '箱', 88.0, 116.0, 0.13, '中央厨房'],
  ['G60005', '半成品宫保鸡丁', '加工品', '预制菜', '4kg/箱', '箱', 132.0, 168.0, 0.13, '中央厨房'],
];

const DC_POOL = [
  ['DC01', '南京履约中心', 'CO01', '优络鲜供应链（江苏）有限公司'],
  ['DC02', '苏州履约中心', 'CO01', '优络鲜供应链（江苏）有限公司'],
  ['DC03', '广州履约中心', 'CO02', '优络鲜供应链（华南）有限公司'],
  ['DC04', '深圳履约中心', 'CO02', '优络鲜供应链（华南）有限公司'],
  ['DC06', '北京履约中心', 'CO03', '优络鲜供应链（华北）有限公司'],
  ['DC07', '天津履约中心', 'CO03', '优络鲜供应链（华北）有限公司'],
  ['DC08', '成都履约中心', 'CO04', '优络鲜供应链（西南）有限公司'],
  ['DC09', '重庆履约中心', 'CO04', '优络鲜供应链（西南）有限公司'],
];

// mulberry32：小而稳的 32 位确定性 PRNG。
function createRandom(seed) {
  let state = (Number(seed) || DEMO_SALES_SEED) >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (value, digits) => Number(Number(value).toFixed(digits));
const pick = (random, list) => list[Math.floor(random() * list.length) % list.length];
const pad = (value, size = 2) => String(value).padStart(size, '0');

function formatDate(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function formatDateTime(date) {
  return `${formatDate(date)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function eachDay(start, end) {
  const days = [];
  const cursor = new Date(start.getTime());
  while (cursor <= end) {
    days.push(new Date(cursor.getTime()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

// 生鲜业务的日内/周内节律：周一备货高、周末团餐低，叠加年初年末小高峰。
function dayWeight(date, progress) {
  const weekday = date.getUTCDay();
  const weekdayFactor = weekday === 1 ? 1.18 : weekday === 0 ? 0.62 : weekday === 6 ? 0.74 : 1;
  const month = date.getUTCMonth() + 1;
  const seasonal = [1.14, 0.92, 1.0, 1.02, 1.0, 1.06, 1.1, 1.04, 1.0, 1.03, 1.08, 1.16][month - 1];
  const growth = 1 + 0.22 * progress;
  return weekdayFactor * seasonal * growth;
}

// 把总行数按天权重分配（最大余数法），保证总数精确等于 rows。
function distributeRows(days, rows) {
  const weights = days.map((day, index) => dayWeight(day, index / Math.max(1, days.length - 1)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const quotas = weights.map((weight) => (weight / total) * rows);
  const counts = quotas.map((quota) => Math.floor(quota));
  let remaining = rows - counts.reduce((sum, count) => sum + count, 0);
  const order = quotas
    .map((quota, index) => ({ index, fraction: quota - Math.floor(quota) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let cursor = 0; remaining > 0; cursor += 1, remaining -= 1) {
    counts[order[cursor % order.length].index] += 1;
  }
  return counts;
}

export function generateSalesRows({
  rows = DEMO_ROWS_DEFAULT,
  startDate = '2024-11-01',
  endDate = '2026-10-20',
  seed = DEMO_SALES_SEED,
} = {}) {
  const random = createRandom(seed);
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    throw new Error('demo 销售数据的日期区间不合法');
  }
  const days = eachDay(start, end);
  const counts = distributeRows(days, Math.max(1, Number(rows) || DEMO_ROWS_DEFAULT));
  const result = [];
  let orderSeq = 0;

  days.forEach((day, dayIndex) => {
    for (let n = 0; n < counts[dayIndex]; n += 1) {
      orderSeq += 1;
      const customer = pick(random, CUSTOMERS);
      const goods = pick(random, GOODS);
      const [goodsCode, goodsName, largeName, middleName, spec, unitName, costBase, saleBase, taxRate, supplierName] = goods;
      const dc = DC_POOL.find((item) => item[0] === customer.agreementDc[0]) ?? DC_POOL[0];

      // 售价在基准上下浮动 ±6%，促销日再让利 3%~8%。
      const promo = random() < 0.18;
      const priceFactor = (0.94 + random() * 0.12) * (promo ? 1 - (0.03 + random() * 0.05) : 1);
      const salePrice = round(saleBase * priceFactor, 6);
      const costPrice = round(costBase * (0.97 + random() * 0.06), 6);

      // 单行数量：盒装商品 1~12、箱装 1~8、散装按公斤走 5~60。
      const bulky = /kg/.test(spec);
      const saleQty = bulky
        ? round(5 + random() * 55, 3)
        : round(1 + Math.floor(random() * (unitName === '箱' ? 8 : 12)), 3);
      // 下单量略大于销售量，差额作为门店损耗/退货。
      const purchaseQty = round(saleQty * (1 + 0.005 + random() * 0.025), 3);

      const saleAmt = round(saleQty * salePrice, 6);
      const saleCost = round(saleQty * costPrice, 6);
      const profit = round(saleAmt - saleCost, 6);
      const saleAmtNoTax = round(saleAmt / (1 + taxRate), 6);
      const saleCostNoTax = round(saleCost / (1 + taxRate), 6);

      const hour = 6 + Math.floor(random() * 12);
      const minute = Math.floor(random() * 60);
      const saleTime = new Date(day.getTime());
      saleTime.setUTCHours(hour, minute, Math.floor(random() * 60), 0);
      const deliveryTime = new Date(saleTime.getTime() + (4 + Math.floor(random() * 14)) * 3600 * 1000);
      const requireDelivery = new Date(day.getTime() + 86400000);

      const orderCode = `SO${formatDate(day).replace(/-/g, '')}${pad(orderSeq, 6)}`;
      const credentialNo = `CR${formatDate(day).replace(/-/g, '')}${pad(orderSeq, 6)}`;

      result.push({
        sales_date: formatDate(day),
        credential_no: credentialNo,
        goods_code: goodsCode,
        customer_code: customer.code,
        sale_time: formatDateTime(saleTime),
        require_delivery_date: formatDate(requireDelivery),
        delivery_time: formatDateTime(deliveryTime),
        original_order_code: '',
        order_code: orderCode,
        business_type_code: customer.businessType[0],
        business_type_name: customer.businessType[1],
        order_channel_detail_name: customer.channel[1],
        customer_name: customer.name,
        sub_customer_code: `${customer.code}-01`,
        sub_customer_name: customer.sub,
        performance_region_code: customer.region[0],
        performance_region_name: customer.region[1],
        performance_province_code: customer.province[0],
        performance_province_name: customer.province[1],
        performance_city_code: customer.city[0],
        performance_city_name: customer.city[1],
        sign_time: customer.signDate,
        sales_user_number: customer.sale[0],
        sales_user_name: customer.sale[1],
        supervisor_user_number: customer.supervisor[0],
        supervisor_user_name: customer.supervisor[1],
        sign_company_code: customer.signCompany[0],
        sign_company_name: customer.signCompany[1],
        agreement_dc_code: customer.agreementDc[0],
        agreement_dc_name: customer.agreementDc[1],
        company_code: dc[2],
        company_name: dc[3],
        inventory_dc_code: dc[0],
        inventory_dc_name: dc[1],
        goods_name: goodsName,
        goods_bar_code: `69${goodsCode.slice(1)}${pad(Math.floor(random() * 999), 3)}`,
        spec,
        unit_name: unitName,
        business_division_code: `BD${largeName === '加工品' ? '06' : '01'}`,
        business_division_name: largeName === '加工品' ? '加工部' : '生鲜部',
        is_factory_goods_flag: largeName === '加工品' ? '是' : '否',
        cost_price: costPrice,
        sale_price: salePrice,
        purchase_qty: purchaseQty,
        sale_qty: saleQty,
        sale_amt: saleAmt,
        sale_cost: saleCost,
        profit,
        sale_amt_no_tax: saleAmtNoTax,
        sale_cost_no_tax: saleCostNoTax,
        profit_no_tax: round(saleAmtNoTax - saleCostNoTax, 6),
        tax_rate: taxRate,
        tax_amt: round(saleAmt - saleAmtNoTax, 6),
        order_channel_code: customer.channel[0],
        credit_code: `XC${customer.code.slice(1)}`,
        purchase_order_code: `PO${formatDate(day).replace(/-/g, '')}${pad(orderSeq, 5)}`,
        wms_order_code: `WM${formatDate(day).replace(/-/g, '')}${pad(orderSeq, 5)}`,
        business_sign_date: `${customer.signDate} 00:00:00`,
        first_business_sign_date: `${customer.signDate} 00:00:00`,
        first_business_sale_date: `${formatDate(day)} 00:00:00`,
        last_business_sale_date: `${formatDate(end)} 00:00:00`,
        sale_price_explain: promo ? '促销价' : '标准售价',
        brand_name: supplierName.replace(/(蔬菜|农业|肉联|禽业|食品|蛋业|干货|粮油|鲜)$/, '') || goodsName,
        supplier_code: `SUP${String(GOODS.findIndex((item) => item[9] === supplierName) + 1).padStart(3, '0')}`,
        supplier_name: supplierName,
        classify_large_code: `CL${['01', '02', '03', '04', '05', '06'][['蔬菜', '肉禽', '水产', '蛋奶', '干货', '加工品'].indexOf(largeName)]}`,
        classify_large_name: largeName,
        classify_middle_code: `CM${pad(['叶菜类', '花菜类', '根茎类', '猪肉', '禽类', '牛肉', '虾类', '鱼类', '蛋品', '乳品', '菌菇', '米面', '净菜', '预制菜', '面点'].indexOf(middleName) + 1, 3)}`,
        classify_middle_name: middleName,
        classify_small_name: `${middleName}-散装`,
        classify_small_code: `CS${pad(['叶菜类', '花菜类', '根茎类', '猪肉', '禽类', '牛肉', '虾类', '鱼类', '蛋品', '乳品', '菌菇', '米面', '净菜', '预制菜', '面点'].indexOf(middleName) + 1, 3)}`,
        goods_purchase_level: bulky ? '统采' : '地采',
        sales_manager_user_number: customer.manager[0],
        sales_manager_user_name: customer.manager[1],
        city_manager_user_number: customer.cityManager[0],
        city_manager_user_name: customer.cityManager[1],
        bloc_name: customer.bloc,
        first_category_code: customer.industry[0],
        first_category_name: customer.industry[1],
        second_category_code: customer.industry[2],
      });
    }
  });
  return result;
}

export { CUSTOMERS, GOODS };
export default generateSalesRows;

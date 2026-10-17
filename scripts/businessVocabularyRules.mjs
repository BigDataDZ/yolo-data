import fs from 'node:fs';
import path from 'node:path';

// High-confidence domain vocabulary only. Generic analytical words such as
// "合计", "比例" and "趋势" remain allowed because they are platform language,
// not tenant-specific business semantics.
const BUSINESS_TERMS = [
  '销售大区', '销售经营', '销售金额', '销售额', '营业额',
  '订单量', '订单数', '毛利率', '毛利额', '客单价', '库存', '销量', '回款',
  '含税', '未税', '不含税', '业绩', '经营总览', '渠道分析员', '区域经理',
  '商品主数据', '大福利', '重点客户组', '企业客户', '客户类型', '客户数',
  '业务类型', '销售', '毛利', '利润', '大区', '省区',
  '渠道', '门店', '品类', '商品', '订单', '省份', '城市',
  '行业分组', '行业分类', '行业属性', '行业维度', '行业名称',
  '华东', '华南', '华北', '华中', '西南', '西北', '东北',
  'BBC', '商超', '日配',
].sort((left, right) => right.length - left.length);

const BUSINESS_PATTERN = new RegExp(
  BUSINESS_TERMS.map((term) => (/^[A-Za-z]+$/.test(term) ? `\\b${term}\\b` : term)).join('|'),
  'gi',
);

const PRODUCTION_ROOTS = ['src/', 'public/js/'];
const EXTRA_PRODUCTION_FILES = ['mcp-connector/skills/yolo-query/SKILL.md'];

export function findBusinessVocabulary(source) {
  const text = String(source ?? '');
  const findings = [];
  for (const match of text.matchAll(BUSINESS_PATTERN)) {
    const index = match.index ?? 0;
    findings.push({
      term: match[0],
      line: text.slice(0, index).split('\n').length,
    });
  }
  return findings;
}

export function checkBusinessVocabulary(projectRoot, files) {
  const issues = [];
  const targets = new Set(files.filter((file) => PRODUCTION_ROOTS.some((root) => file.startsWith(root))));
  for (const file of EXTRA_PRODUCTION_FILES) {
    if (fs.existsSync(path.join(projectRoot, file))) {
      targets.add(file);
    }
  }
  for (const file of targets) {
    const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    const findings = findBusinessVocabulary(source);
    if (findings.length === 0) {
      continue;
    }
    const samples = findings
      .slice(0, 5)
      .map((finding) => `"${finding.term}"@${finding.line}`)
      .join(', ');
    issues.push({
      level: 'error',
      file,
      rule: 'NO-BUSINESS-VOCAB',
      message: `hardcoded business vocabulary ${samples}; load it from businessLexicon/theme semantics, or keep fixtures in tests/ and eval/.`,
    });
  }
  return issues;
}

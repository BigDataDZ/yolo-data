const UNIT_SCALES = new Map([
  ['亿元', 1e-8],
  ['千元', 1e-3],
  ['万元', 1e-4],
  ['元', 1],
]);

const UNIT_ORDER = ['亿元', '千元', '万元', '元'];
const PERSISTENCE_PATTERN = /默认|以后|之后|后续|接下来|每次|统一|始终|一律|记住|长期/;
const UNIT_INTENT_PATTERN = /单位|带上|带|加上|加|用|按|以|改成|改为|换成|换为|显示|展示|输出|回答|保留/;
const DECIMAL_PLACES_PATTERN = /([0-9一二三四五六七八九十两]+)\s*位\s*小数/;
const QUERY_ACTION_PATTERN = /多少|查询|查一下|查看|统计|计算|列出|排名|趋势|走势|环比|同比|对比|分析|拆解|拆分|分布|明细/;
const QUERY_SCOPE_PATTERN = /\d{4}年|\d{1,2}月|\d{1,2}日|今天|昨天|本周|上周|本月|上月|今年|去年|近\s*\d+|最近\s*\d+|季度/;
const DECIMAL_TYPES = new Set(['amount', 'quantity', 'percent', 'number']);
const CHINESE_DIGITS = new Map([
  ['零', 0],
  ['一', 1],
  ['二', 2],
  ['两', 2],
  ['三', 3],
  ['四', 4],
  ['五', 5],
  ['六', 6],
  ['七', 7],
  ['八', 8],
  ['九', 9],
]);

function normalize(value) {
  return String(value ?? '').replace(/\s+/g, '').trim();
}

function findUnit(text) {
  return UNIT_ORDER.find((unit) => text.includes(unit)) ?? null;
}

function parseDecimalCount(text) {
  const match = text.match(DECIMAL_PLACES_PATTERN);
  if (!match) {
    return null;
  }
  const token = match[1];
  if (/^\d+$/.test(token)) {
    const numeric = Number(token);
    return numeric >= 0 && numeric <= 6 ? numeric : null;
  }
  if (token.length !== 1 || !CHINESE_DIGITS.has(token)) {
    return null;
  }
  const numeric = CHINESE_DIGITS.get(token);
  return numeric <= 6 ? numeric : null;
}

function directiveCapabilities(directive) {
  const capabilities = [];
  if (directive?.unit) {
    capabilities.push('unit');
  }
  if (Number.isInteger(directive?.decimals)) {
    capabilities.push('decimals');
  }
  return capabilities;
}

function numberFormatFor(type, decimals) {
  if (type === 'percent') {
    return decimals > 0 ? `0.${'0'.repeat(decimals)}%` : '0%';
  }
  return decimals > 0 ? `#,##0.${'0'.repeat(decimals)}` : '#,##0';
}

function directiveText({ unit, decimals }) {
  const parts = [];
  if (unit) {
    parts.push(`金额默认按${unit}展示`);
  }
  if (Number.isInteger(decimals)) {
    parts.push(`数值保留${decimals}位小数`);
  }
  return parts.join('，');
}

export function parseConversationDirective(question) {
  const source = normalize(question);
  if (!source || source.length > 80) {
    return null;
  }
  const unit = findUnit(source);
  const decimals = parseDecimalCount(source);
  if (!unit && decimals === null) {
    return null;
  }
  const persistent = PERSISTENCE_PATTERN.test(source);
  const displayIntent = UNIT_INTENT_PATTERN.test(source) || decimals !== null;
  if (!persistent && !displayIntent) {
    return null;
  }
  // A real data question stays in the query lane. The unit phrase may still be
  // used by the presentation contract, but it must not short-circuit the query.
  if (QUERY_ACTION_PATTERN.test(source) || QUERY_SCOPE_PATTERN.test(source)) {
    return null;
  }
  const scale = unit ? UNIT_SCALES.get(unit) ?? 1 : undefined;
  const description = directiveText({ unit, decimals });
  return {
    kind: unit ? 'DISPLAY_UNIT' : 'DISPLAY_DECIMALS',
    unit,
    displayScale: scale,
    decimals,
    scope: 'SESSION',
    sourceText: source,
    confirmation: `已记住：本会话后续${description}；本次不重新取数，表格和正文会统一按此展示。`,
  };
}

export function mergeSessionDirectives(directives = [], directive = null) {
  if (!directive) {
    return Array.isArray(directives) ? directives : [];
  }
  const current = Array.isArray(directives) ? directives : [];
  const incomingCapabilities = new Set(directiveCapabilities(directive));
  return [
    ...current.filter((item) => (
      !directiveCapabilities(item).some((capability) => incomingCapabilities.has(capability))
    )),
    { ...directive, scope: 'SESSION', updatedAt: new Date().toISOString() },
  ];
}

export function applyConversationDirectivesToPresentationContract(contract, directives = []) {
  const unitDirective = [...(directives ?? [])]
    .reverse()
    .find((item) => item?.kind === 'DISPLAY_UNIT' && item.unit);
  const decimalDirective = [...(directives ?? [])]
    .reverse()
    .find((item) => Number.isInteger(item?.decimals));
  if ((!unitDirective && !decimalDirective) || !contract?.fields) {
    return contract;
  }
  const fields = Object.fromEntries(
    Object.entries(contract.fields).map(([field, rule]) => {
      if (!rule) {
        return [field, rule];
      }
      const type = String(rule.type ?? '').toLowerCase();
      const next = { ...rule };
      const reasons = [];
      if (unitDirective && type === 'amount') {
        const scale = Number(unitDirective.displayScale);
        if (Number.isFinite(scale) && scale > 0) {
          next.unit = unitDirective.unit;
          next.displayScale = scale;
          next.xlsxScale = scale;
          reasons.push(`金额默认按${unitDirective.unit}展示`);
        }
      }
      if (decimalDirective && DECIMAL_TYPES.has(type)) {
        next.decimals = decimalDirective.decimals;
        next.numberFormat = numberFormatFor(type, decimalDirective.decimals);
        reasons.push(`数值保留${decimalDirective.decimals}位小数`);
      }
      if (reasons.length === 0) {
        return [field, rule];
      }
      next.basis = 'SESSION_DIRECTIVE';
      next.reason = `会话指令：${reasons.join('，')}`;
      return [field, next];
    }),
  );
  return {
    ...contract,
    fields,
    meta: {
      ...(contract.meta ?? {}),
      conversationDirective: decimalDirective ?? unitDirective,
      conversationDirectives: [unitDirective, decimalDirective].filter(Boolean),
    },
  };
}

export function describeConversationDirective(directive) {
  if (!directive) {
    return '';
  }
  if (directive.unit || Number.isInteger(directive.decimals)) {
    return `本会话${directiveText(directive)}`;
  }
  return directive.sourceText ?? '';
}

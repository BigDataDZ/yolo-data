// Time syntax used by task extraction and clarification classification.
const EXPLICIT_DATE_PATTERN = String.raw`(?:\d{4}年)?\d{1,2}月\d{1,2}[日号]|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}`;
// Match complete day ranges before their year/month prefixes so inheritance keeps day precision.
const EXPLICIT_DATE_RANGE_PATTERN = String.raw`(?:${EXPLICIT_DATE_PATTERN})(?:\s*(?:到|至|~|—|－|-)\s*(?:${EXPLICIT_DATE_PATTERN}|\d{1,2}[日号]))?`;
export const TIME_PATTERN = new RegExp(String.raw`${EXPLICIT_DATE_RANGE_PATTERN}|(?:近|最近|过去)\s*(?:\d+|[一二两三四五六七八九十]+)\s*个?(?:天|日|周|星期|月|季度|年)|(?:本|这|上|下)(?:个)?(?:周|星期|月|季度|年)|(?:今天|今日|昨天|昨日|前天|明天|后天|今年|去年|明年)|(?:第[一二三四1-4]季度|Q[1-4])|\d{4}年(?:\d{1,2}月)?|\d{1,2}月`, 'gi');
export const TIME_HINT_PATTERN = /(?:近|最近|过去)\s*(?:\d+|[一二两三四五六七八九十]+)\s*个?(?:天|日|周|星期|月|季度|年)|(?:本|这|上|下)(?:个)?(?:周|星期|月|季度|年)|今天|今日|昨天|昨日|前天|明天|后天|今年|去年|明年|第[一二三四1-4]季度|Q[1-4]|\d{4}年|\d{1,2}月/i;

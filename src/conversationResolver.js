import {
  TURN_TYPES,
  createTurnContext,
  extractExplicitSlots,
  previousTaskFromHistory,
} from './turnContext.js';
import { getPlatformLexicon, lexiconPattern } from './businessLexicon.js';

const CONTEXTUAL_QUESTION_PATTERN =
  /^(那|再|换|按|这个|上述|它|还有|呢|以及|和|同上|本月|这个月|上月|上个月|本周|这周|上周|今天|今日|昨天|今年|去年|本季度|上季度|近\s*\d+|最近\s*\d+)|在.{0,12}基础上|这个表|上述表|上表|以上|保留上文|现有基础/;
const EXPLICIT_REFERENCE_PATTERN =
  /上表|上述表|这个表|该表|上一轮|刚才|前面|上述结果|基于以上|在此基础上|保留上文|现有基础/;
const RESULT_OPERATION_PATTERN =
  /加入一行|新增一行|增加一行|加入一列|新增一列|增加一列|按单独列|修改列名|调整格式|保留.*数据|转换成\s*Excel|导出\s*Excel|改成.*图|坐标轴|排序/;
export const CLARIFICATION_PATTERN =
  /请补充|请确认|需要确认|请指定|请提供|还差|无法唯一确定|请明确|需要先明确|需要您|请选择|是否确认|需确认/;
const METRIC_INTENT_PATTERN =
  /多少|数值|[额量率数值]|合计|总计|平均|最大|最小|排名|对比|同比|环比|趋势|走势/;
const TIME_INTENT_PATTERN =
  /本月|这个月|上月|上个月|本周|这周|上周|今天|今日|昨天|今年|去年|本季度|上季度|近\s*\d+|最近\s*\d+|\d{4}年/;
const FILTER_INTENT_PATTERN =
  /按|各|分|维度|分组|筛选|过滤|展示/;
const NEW_TASK_PATTERN =
  /^(?:另外|换个问题|换一个话题|重新开始|新问题|独立问题|与此无关|不用管刚才|不要用刚才)/;
const REVISION_PATTERN =
  /(?:改成|改为|换成|换为|调整为|修正为|更正为|应该是|不是.{0,12}(?:改成|改为|换成)|写错了|不对，|重来)/;
const RESULT_REFERENCE_PATTERN =
  /(?:这个|该|上述|上一轮|刚才的?|前面的?)(?:结果|表|数据|查询|产物)/;
const QUERY_PREFIX_PATTERN =
  /^(?:请|帮我|查询|查一下|查看|统计|分析|计算|看一下|展示|列出|给我)/;

export function resolveConversationContext(question, history = [], options = {}) {
  const current = String(question ?? '').trim();
  if (!current) {
    return createTurnContext({
      question: current,
      history,
      turnType: TURN_TYPES.NEW_TASK,
      confidence: 1,
      reason: 'empty_question',
      forceNewTask: true,
    });
  }
  const previousUserMessages = (history ?? [])
    .filter((message) => message?.role === 'user')
    .map((message) => String(message.content ?? '').trim())
    .filter(Boolean)
    .slice(-3);
  const lastAssistant = [...(history ?? [])]
    .reverse()
    .find((message) => message?.role === 'assistant');
  const { task: previousTask } = previousTaskFromHistory(history);
  const hasPreviousTask = Boolean(previousTask);
  const explicitSlots = extractExplicitSlots(current);
  const lexicon = getPlatformLexicon();
  const metricLexiconPattern = lexiconPattern([...lexicon.metricTerms, ...lexicon.rateTerms]);
  const hasMetricIntent = explicitSlots.metric.length > 0
    || METRIC_INTENT_PATTERN.test(current)
    || Boolean(metricLexiconPattern?.test(current));
  const hasTimeIntent = explicitSlots.time.length > 0 || TIME_INTENT_PATTERN.test(current);
  const hasFilterIntent = explicitSlots.filters.length > 0
    || explicitSlots.dimensions.length > 0
    || FILTER_INTENT_PATTERN.test(current);
  const explicitReference = EXPLICIT_REFERENCE_PATTERN.test(current);
  const resultReference = RESULT_REFERENCE_PATTERN.test(current);
  const resultOperation = RESULT_OPERATION_PATTERN.test(current);
  const newTaskMarker = NEW_TASK_PATTERN.test(current);
  const revision = REVISION_PATTERN.test(current);
  const queryPrefix = QUERY_PREFIX_PATTERN.test(current);
  const anaphoric = CONTEXTUAL_QUESTION_PATTERN.test(current)
    && !(hasMetricIntent && (hasTimeIntent || hasFilterIntent));
  const awaitingClarification = CLARIFICATION_PATTERN.test(
    String(lastAssistant?.content ?? ''),
  );
  const slotAnswer = awaitingClarification
    && !hasMetricIntent
    && current.length <= 30;

  let turnType = TURN_TYPES.AMBIGUOUS;
  let confidence = 0.5;
  let reason = 'ambiguous_relation';
  let needsClassifier = true;
  if (options.forceNewTask) {
    turnType = TURN_TYPES.NEW_TASK;
    confidence = 1;
    reason = 'forced_new_task';
    needsClassifier = false;
  } else if (!previousTask) {
    turnType = TURN_TYPES.NEW_TASK;
    confidence = 1;
    reason = 'first_turn';
    needsClassifier = false;
  } else if (newTaskMarker) {
    turnType = TURN_TYPES.NEW_TASK;
    confidence = 0.96;
    reason = 'explicit_new_task';
    needsClassifier = false;
  } else if (resultOperation) {
    turnType = TURN_TYPES.RESULT_OPERATION;
    confidence = 0.96;
    reason = 'result_operation';
    needsClassifier = false;
  } else if (slotAnswer) {
    turnType = TURN_TYPES.CLARIFICATION_ANSWER;
    confidence = 0.9;
    reason = 'clarification_slot';
    needsClassifier = false;
  } else if (revision) {
    turnType = TURN_TYPES.REVISION;
    confidence = 0.9;
    reason = 'explicit_revision';
    needsClassifier = false;
  } else if (explicitReference || resultReference) {
    turnType = TURN_TYPES.CONTINUATION;
    confidence = 0.94;
    reason = resultReference ? 'result_reference' : 'explicit_reference';
    needsClassifier = false;
  } else if (anaphoric) {
    turnType = TURN_TYPES.CONTINUATION;
    confidence = 0.84;
    reason = 'anaphoric_follow_up';
    needsClassifier = false;
  } else if (hasMetricIntent && queryPrefix && !hasTimeIntent && !hasFilterIntent) {
    turnType = TURN_TYPES.NEW_TASK;
    confidence = 0.84;
    reason = 'standalone_query';
    needsClassifier = false;
  } else if (hasMetricIntent && (hasTimeIntent || hasFilterIntent)) {
    turnType = TURN_TYPES.NEW_TASK;
    confidence = 0.86;
    reason = 'standalone_question';
    needsClassifier = false;
  } else if (!hasMetricIntent && (hasTimeIntent || hasFilterIntent)) {
    turnType = TURN_TYPES.CONTINUATION;
    confidence = 0.8;
    reason = 'partial_slot_change';
    needsClassifier = false;
  } else if (hasMetricIntent) {
    turnType = TURN_TYPES.AMBIGUOUS;
    confidence = 0.54;
    reason = 'metric_relation_unclear';
  }

  const needsModelRouter = needsClassifier
    || (hasPreviousTask && !options.forceNewTask && confidence < 0.82);
  return createTurnContext({
    question: current,
    history,
    turnType,
    confidence,
    reason,
    source: 'rule',
    needsClassifier: needsModelRouter && options.classifier !== false,
    forceNewTask: Boolean(options.forceNewTask),
    memorySlots: options.memorySlots ?? {},
    referencesResult: resultOperation || explicitReference || resultReference,
    inheritedUserMessages: turnType === TURN_TYPES.NEW_TASK
      ? []
      : previousUserMessages.slice(-3),
    maxInheritTurns: options.maxInheritTurns,
    maxInheritedSlots: options.maxInheritedSlots,
  });
}

export function resolveConversationQuestion(question, history = [], options = {}) {
  return resolveConversationContext(question, history, options).question;
}

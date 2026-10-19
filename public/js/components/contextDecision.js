import { escapeAttr, escapeHtml } from '../core/runtime.js';

const TURN_LABELS = {
  NEW_TASK: '独立问题',
  INSTRUCTION: '会话指令',
  CONTINUATION: '连续追问',
  REVISION: '条件修正',
  RESULT_OPERATION: '结果加工',
  CLARIFICATION_ANSWER: '澄清回答',
  AMBIGUOUS: '关系待确认',
};

function groupedInheritedSlots(decision) {
  const groups = new Map();
  for (const slot of decision?.inheritedSlots ?? []) {
    const key = slot.key ?? slot.label ?? 'condition';
    const values = groups.get(key) ?? { label: slot.label ?? key, values: [] };
    if (slot.sourceText || slot.value) {
      values.values.push(slot.sourceText || slot.value);
    }
    groups.set(key, values);
  }
  return [...groups.values()].filter((group) => group.values.length > 0);
}

function directiveLabel(directive) {
  if (!directive) {
    return '';
  }
  const parts = [];
  if (directive.unit) {
    parts.push(`金额按${directive.unit}展示`);
  }
  if (Number.isInteger(directive.decimals)) {
    parts.push(`数值保留${directive.decimals}位小数`);
  }
  return parts.join('，') || String(directive.sourceText ?? '').trim();
}

export function renderContextDecision(decision, { messageId = '', live = false } = {}) {
  const inherited = groupedInheritedSlots(decision);
  const directive = directiveLabel(decision?.conversationDirective);
  if (inherited.length === 0 && !directive) {
    return '';
  }
  const turnLabel = TURN_LABELS[decision?.turnType] ?? decision?.turnType ?? '连续追问';
  const title = inherited.length > 0 ? '本轮继承条件' : '本轮指令';
  return `
    <div class="context-inheritance${live ? ' is-live' : ''}" role="note" aria-label="本轮继承条件">
      <div class="context-inheritance-head">
        <span class="context-inheritance-title">${title}</span>
        <span class="context-inheritance-mode">${escapeHtml(turnLabel)}</span>
      </div>
      <div class="context-inheritance-chips">
        ${inherited.map((group) => `
          <span class="context-inheritance-chip">
            <small>${escapeHtml(group.label)}</small>
            ${escapeHtml(group.values.join('、'))}
          </span>
        `).join('')}
        ${directive ? `
          <span class="context-inheritance-chip">
            <small>展示口径</small>
            ${escapeHtml(directive)}
          </span>
        ` : ''}
      </div>
      ${messageId ? `
        <button class="context-new-task" type="button"
          data-force-new-question="${escapeAttr(messageId)}"
          title="不继承上一轮条件，按原始问题重新执行">
          作为新问题
        </button>
      ` : ''}
    </div>
  `;
}

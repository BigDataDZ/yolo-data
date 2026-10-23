// 开始问数的开场：可点的示例卡 + 「继续上次」入口。
//
// 只负责渲染，问题和会话都来自主题开场建议接口；没有卡片时不留占位。

import * as core from '../core/runtime.js';

const { escapeAttr, escapeHtml, formatSessionTime } = core;

function cardsMarkup(cards) {
  if (!cards?.length) {
    return '';
  }
  return `
    <div class="welcome-cards">
      ${cards.map((card) => `
        <button class="welcome-card" type="button" data-question="${escapeAttr(card.question)}">
          <span class="welcome-card-tag">${escapeHtml(card.group)}</span>
          <span class="welcome-card-text">${escapeHtml(card.question)}</span>
        </button>
      `).join('')}
    </div>
  `;
}

function resumeMarkup(resume) {
  const questions = resume?.questions ?? [];
  if (!resume?.sessionId || questions.length === 0) {
    return '';
  }
  return `
    <div class="welcome-resume">
      <div class="welcome-resume-head">
        <span class="welcome-resume-label">继续上次</span>
        <button class="welcome-resume-session" type="button" data-select-session="${Number(resume.sessionId)}">
          ${escapeHtml(resume.title || '未命名会话')} · ${escapeHtml(formatSessionTime(resume.updatedAt))}
        </button>
      </div>
      <div class="welcome-resume-questions">
        ${questions.map((question) => `
          <button class="resume-chip" type="button" data-question="${escapeAttr(question)}">${escapeHtml(question)}</button>
        `).join('')}
      </div>
    </div>
  `;
}

export function renderChatOpening({
  themeName = '',
  themeDescription = '',
  datasetName = '',
  metricCount = 0,
  dimensionCount = 0,
  cards = [],
  resume = null,
} = {}) {
  const subtitle = [
    themeName,
    datasetName,
    metricCount > 0 ? `${metricCount} 个可查指标` : '',
    dimensionCount > 0 ? `${dimensionCount} 个可查维度` : '',
  ].filter(Boolean).map((part) => escapeHtml(part)).join(' · ');
  return `
    <div class="chat-welcome welcome-mini">
      <div class="welcome-mini-mark">
        <img src="/yolo-mark.svg" alt="YOLO" />
      </div>
      <h2 class="welcome-mini-title">${escapeHtml(themeDescription || '今天想问点什么？')}</h2>
      ${subtitle ? `<p class="welcome-mini-sub">${subtitle}</p>` : ''}
      ${resumeMarkup(resume)}
      ${cardsMarkup(cards)}
    </div>
  `;
}

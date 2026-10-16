// 评测看板页（管理员）：把「问题→契约→结果」语义评测变成可量化准确率看板。
// L1=契约级、L2=结果级、L3=答案级(LLM-as-Judge)；展示通过率、门禁分布与基线回归 diff。
import * as core from '../core/runtime.js';
import { ASSET_TABS, bindSectionTabs, sectionTabsMarkup } from '../components/sectionTabs.js';

const { icon, api, toast, emptyState, escapeHtml, escapeAttr, navigate, state } = core;

const LEVELS = ['L1', 'L2', 'L3'];
const LEVEL_HINT = {
  L1: '契约级：编译查询契约并校验门禁（确定性，CI 可跑）',
  L2: '结果级：在夹具表上模拟聚合，校验行数/列/总额（确定性）',
  L3: '答案级：LLM-as-Judge 反思回答；Judge 缺失、调用失败或返回无法解析时标记为「待有效判定」',
};

function pct(rate) {
  const n = Number(rate);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '—';
}

function tag(text, tone = 'blue') {
  return `<span class="tag tag-${tone}">${escapeHtml(text)}</span>`;
}

function levelCard(level, report) {
  const t = report?.totals ?? { cases: 0, passed: 0, failed: 0, passRate: 0 };
  const judgeTags = [];
  if (level === 'L3') {
    if (t.judgePending > 0) {
      judgeTags.push(tag(`Judge 待有效判定 ${t.judgePending}`, 'amber'));
    }
    if (t.judgeCompleted > 0) {
      judgeTags.push(tag(`Judge 已完成判定 ${t.judgeCompleted}`, 'teal'));
    }
  }
  const gateBlocks = Object.entries(report?.gateBlockDistribution ?? {})
    .map(([id, count]) => tag(`${id} ×${count}`, 'red'));
  return `
    <div class="kpi-item">
      <span>${escapeHtml(level)} 通过率</span>
      <strong>${pct(t.passRate)}</strong>
      <span class="muted">${t.passed}/${t.cases} 通过${t.failed ? `，${t.failed} 失败` : ''}</span>
      <span>${[...judgeTags, ...gateBlocks].join(' ') || tag('无阻断', 'teal')}</span>
    </div>`;
}

function failedList(level, report) {
  const failed = (report?.results ?? []).filter((item) => !item.passed);
  if (failed.length === 0) {
    return `<p class="muted">${escapeHtml(level)} 无失败用例。</p>`;
  }
  return failed.map((result) => {
    const badChecks = (result.checks ?? []).filter((check) => !check.ok);
    const lines = badChecks.map((check) => (
      `<li><code>${escapeHtml(check.assertion)}</code>：期望 ${escapeHtml(JSON.stringify(check.expected))}，实际 ${escapeHtml(JSON.stringify(check.actual))}</li>`
    )).join('');
    return `
      <div class="section-band">
        <strong>${escapeHtml(result.id)}</strong>
        <p class="muted">${escapeHtml(result.description ?? '')}</p>
        <ul class="eval-fail-list">${lines}</ul>
      </div>`;
  }).join('');
}

function diffSummary(report) {
  const d = report?.baselineDiff ?? {};
  const improved = (d.improved ?? []).map((id) => tag(`↑ ${id}`, 'teal')).join(' ');
  const regressed = (d.regressed ?? []).map((id) => tag(`↓ ${id}`, 'red')).join(' ');
  const fresh = (d.new_cases ?? []).map((id) => tag(`+ ${id}`, 'blue')).join(' ');
  if (!improved && !regressed && !fresh) {
    return `<p class="muted">与基线一致，无变化。</p>`;
  }
  return `<div class="eval-diff">${improved}${regressed}${fresh}</div>`;
}

function renderReport(report) {
  const overall = report?.overall ?? { accuracy: 0, passed: 0, cases: 0 };
  const generatedAt = report?.generatedAt ? new Date(report.generatedAt) : null;
  const levelBlocks = LEVELS.map((level) => {
    const levelReport = report?.levels?.[level];
    return `
      <section class="section-band">
        <div class="section-head">
          <div>
            <h3>${escapeHtml(level)} ${tag(levelReport?.totals?.judgePending ? '' : '', 'blue')}</h3>
            <p class="muted">${escapeHtml(LEVEL_HINT[level] ?? '')}</p>
          </div>
          <div class="eval-level-diff">${diffSummary(levelReport)}</div>
        </div>
        ${failedList(level, levelReport)}
      </section>`;
  }).join('');

  return `
    <div class="page-stack">
      ${sectionTabsMarkup(ASSET_TABS, 'eval', '智能体管理')}
      <div class="section-head">
        <div>
          <h2>评测看板</h2>
          <p>用例通过率衡量夹具断言是否符合预期；Judge 判定完成情况单独展示。L1 契约级 + L2 结果级 + L3 答案级（LLM-as-Judge）三层回归，随每次取数路径变更持续跟踪。</p>
        </div>
        <div class="page-toolbar">
          <button class="btn btn-quiet" type="button" data-eval-refresh>${icon('refresh', '重新评测')}重新评测</button>
        </div>
      </div>

      <div class="section-band">
        <div class="kpi-grid">
          <div class="kpi-item">
            <span>总体用例通过率</span>
            <strong>${pct(overall.accuracy)}</strong>
            <span class="muted">${overall.passed}/${overall.cases} 通过</span>
            <span>${generatedAt ? tag(`生成于 ${generatedAt.toLocaleString('zh-CN')}`, 'blue') : ''}</span>
          </div>
          ${LEVELS.map((level) => levelCard(level, report?.levels?.[level])).join('')}
        </div>
      </div>

      ${levelBlocks}
    </div>`;
}

function bindEvents(root) {
  bindSectionTabs(root, navigate);
  root.querySelector('[data-eval-refresh]')?.addEventListener('click', () => {
    renderEvalPage(root);
  });
}

export async function renderEvalPage(root) {
  if (state.currentUser?.role !== 'ADMIN') {
    root.innerHTML = `<div class="section-band">${emptyState('评测看板仅对平台管理员开放', 'shield-check')}</div>`;
    return;
  }
  root.innerHTML = '<div class="loading-state"><span class="spinner"></span>正在运行 L1/L2/L3 评测</div>';
  try {
    const report = await api('/api/eval');
    root.innerHTML = renderReport(report);
    bindEvents(root);
  } catch (error) {
    root.innerHTML = `<div class="section-band">${emptyState(`评测运行失败：${error.message}`, 'circle-alert')}</div>`;
  }
}

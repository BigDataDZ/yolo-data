import * as core from '../core/runtime.js';

const {
  state,
  icon,
  api,
  toast,
  setBusy,
  loadBootstrap,
  renderPage,
  emptyState,
  escapeHtml,
  navigate,
} = core;

async function renderSettingsPage(root) {
  if (state.currentUser?.role !== 'ADMIN') {
    root.innerHTML = `<div class="section-band">${emptyState('系统设置仅对平台管理员开放', 'settings')}</div>`;
    return;
  }
  root.innerHTML = '<div class="loading-state"><span class="spinner"></span>正在读取系统设置</div>';
  const settings = await api('/api/settings');
  root.innerHTML = `
    <div class="page-stack">
      <div class="section-head">
        <div>
          <h2>系统设置</h2>
          <p>调整平台级数据源和执行策略，保存后立即生效。</p>
        </div>
      </div>

      <section class="section-band">
        <div class="section-head compact">
          <div>
            <h3>记忆管理</h3>
            <p>长期记忆按「用户 × 智能体」隔离沉淀，问数时注入上下文补全默认口径。管理员可在这里查看全部用户的记忆并清理无效条目。</p>
          </div>
          <button class="btn" id="openMemoryBtn" type="button">${icon('library', '查看全部用户记忆')}查看全部用户记忆</button>
        </div>
      </section>
    </div>
  `;

  document.getElementById('openMemoryBtn').addEventListener('click', () => {
    state.memoryUserId = null;
    navigate('/memory/all');
  });

}

export {
  renderSettingsPage,
};

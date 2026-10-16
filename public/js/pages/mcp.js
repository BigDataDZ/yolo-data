// MCP 令牌管理页（管理员）：服务开关/模式、访问令牌创建/吊销、最近调用审计、连接器下载。
import * as core from '../core/runtime.js';
import { ASSET_TABS, bindSectionTabs, sectionTabsMarkup } from '../components/sectionTabs.js';

const {
  icon,
  api,
  toast,
  setBusy,
  renderPage,
  emptyState,
  escapeHtml,
  escapeAttr,
  navigate,
  state,
} = core;

const MODE_OPTIONS = [
  { value: 'disabled', label: '已关闭（disabled）' },
  { value: 'read', label: '只读（read）：列指标 + 查策略' },
  { value: 'standard', label: '标准（standard）：+ 产物 / 编译契约 / 执行契约' },
  { value: 'full', label: '完整（full）：全部能力' },
];

// 创建成功后的明文 Key 只在内存里保留一次，刷新/重渲染后回填到揭示框，离开页面即消失。
let revealedKey = null;

function statusTag(settings) {
  return settings.enabled
    ? `<span class="tag tag-teal">已开启 · ${escapeHtml(settings.mode)}</span>`
    : '<span class="tag tag-red">已关闭</span>';
}

function renderSettings(settings) {
  const rl = settings.rateLimit ?? {};
  return `
    <section class="section-band">
      <div class="section-head compact">
        <div>
          <h3>服务开关与模式</h3>
          <p>关闭后 <code>/mcp</code> 端点对所有客户端返回 403。模式决定哪些工具对客户端可见。</p>
        </div>
        <div>${statusTag(settings)}</div>
      </div>
      <div class="form-grid">
        <div class="form-field">
          <label for="mcpEnabled">启用 MCP 服务</label>
          <select class="select" id="mcpEnabled" data-mcp-field="enabled">
            <option value="1" ${settings.enabled ? 'selected' : ''}>启用</option>
            <option value="0" ${!settings.enabled ? 'selected' : ''}>关闭</option>
          </select>
        </div>
        <div class="form-field">
          <label for="mcpMode">模式</label>
          <select class="select" id="mcpMode" data-mcp-field="mode">
            ${MODE_OPTIONS.map((o) => `<option value="${o.value}" ${settings.mode === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label for="mcpSessionMode">会话模式</label>
          <select class="select" id="mcpSessionMode" data-mcp-field="sessionMode">
            <option value="stateless" ${settings.sessionMode === 'stateless' ? 'selected' : ''}>无状态（推荐，每请求独立）</option>
            <option value="stateful" ${settings.sessionMode === 'stateful' ? 'selected' : ''}>有状态（SSE 会话复用）</option>
          </select>
        </div>
        <div class="form-field">
          <label for="mcpRpm">限流（次 / 分钟）</label>
          <input class="field" id="mcpRpm" type="number" min="1" data-mcp-field="rpm" value="${escapeAttr(rl.rpm ?? 60)}" />
        </div>
        <div class="form-field">
          <label for="mcpTenantScope">租户作用域（tenantScope）</label>
          <input class="field" id="mcpTenantScope" type="text" data-mcp-field="tenantScope" value="${escapeAttr((settings.tenantScope ?? []).join(', '))}" placeholder="逗号分隔的主题 ID，如 1, 2, 3；留空 = 不限制" />
        </div>
        <div class="form-field">
          <label for="mcpBurst">突发配额（burst）</label>
          <input class="field" id="mcpBurst" type="number" min="1" data-mcp-field="burst" value="${escapeAttr(rl.burst ?? 10)}" />
        </div>
      </div>
      <div class="page-toolbar">
        <button class="btn btn-primary" id="mcpSaveSettings" type="button">${icon('settings', '保存')}保存设置</button>
      </div>
    </section>
  `;
}

function renderKeys(keys) {
  const rows = (keys ?? []).map((k) => `
    <tr>
      <td>
        <strong>${escapeHtml(k.name ?? 'mcp')}</strong><br />
        <small class="mono muted">${escapeHtml(k.keyId)}</small>
      </td>
      <td>${escapeHtml(k.tenantId ?? 'default')}</td>
      <td>${k.revoked ? '<span class="tag tag-red">已吊销</span>' : '<span class="tag tag-teal">有效</span>'}</td>
      <td class="muted">${escapeHtml(k.createdAt ?? '-')}</td>
      <td>
        ${k.revoked
          ? '<span class="muted">—</span>'
          : `<button class="btn btn-quiet" type="button" data-mcp-revoke="${escapeAttr(k.keyId)}" data-mcp-name="${escapeAttr(k.name ?? 'mcp')}">${icon('trash', '吊销')}吊销</button>`}
      </td>
    </tr>`).join('');
  return `
    <section class="section-band">
      <div class="section-head compact">
        <div>
          <h3>访问令牌</h3>
          <p>客户端以 <code>Authorization: Bearer &lt;mcp_key&gt;</code> 调用。明文仅在创建时显示一次，请妥善保存。</p>
        </div>
      </div>
      <div class="form-grid mcp-create-grid">
        <div class="form-field">
          <label for="mcpNewName">名称</label>
          <input class="field" id="mcpNewName" type="text" data-mcp-new="name" placeholder="例如：claude-desktop" />
        </div>
        <div class="form-field">
          <label for="mcpNewTenantId">租户</label>
          <input class="field" id="mcpNewTenantId" type="text" data-mcp-new="tenantId" placeholder="default" />
        </div>
        <div class="form-field mcp-create-action">
          <button class="btn btn-primary" id="mcpCreateKey" type="button">${icon('key', '创建')}创建令牌</button>
        </div>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr><th>名称 / Key ID</th><th>租户</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="muted">暂无令牌</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAudit(rows) {
  const items = (rows ?? []).map((r) => {
    const d = r.detail ?? {};
    const ok = d.outcome === 'success';
    return `<tr>
      <td class="muted">${escapeHtml(String(r.createdAt ?? '').replace('T', ' ').slice(0, 19))}</td>
      <td>${escapeHtml(d.toolName ?? r.action ?? '-')}</td>
      <td>${ok ? '<span class="tag tag-teal">成功</span>' : '<span class="tag tag-red">失败</span>'}</td>
      <td class="muted">${escapeHtml(d.tenantId ?? '-')}</td>
      <td class="muted">${escapeHtml(String(d.durationMs ?? '-'))}ms</td>
    </tr>`;
  }).join('');
  return `
    <section class="section-band">
      <div class="section-head compact">
        <div><h3>最近调用</h3><p>来自审计日志的 MCP_ 前缀记录。</p></div>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr><th>时间</th><th>工具</th><th>结果</th><th>租户</th><th>耗时</th></tr></thead>
          <tbody>${items || '<tr><td colspan="5" class="muted">暂无调用记录</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

function fillReveal(root) {
  const box = root.querySelector('#mcpKeyReveal');
  if (!box) {
    return;
  }
  if (!revealedKey) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const wasHidden = box.hidden;
  box.hidden = false;
  box.innerHTML = `
    <div class="section-head compact">
      <div>
        <h3>令牌已创建，明文仅此一次可见</h3>
        <p>关闭或刷新页面后无法再次查看，请立即复制并妥善保存。</p>
      </div>
      <div><span class="tag tag-red">仅一次</span></div>
    </div>
    <div class="form-grid">
      <div class="form-field span-2">
        <label for="mcpKeyValue">访问令牌</label>
        <input class="field mono" id="mcpKeyValue" type="text" readonly value="${escapeAttr(revealedKey)}" />
      </div>
    </div>
    <div class="page-toolbar">
      <button class="btn btn-primary" id="mcpKeyCopy" type="button">${icon('copy', '复制')}复制令牌</button>
      <button class="btn btn-quiet" id="mcpKeyDismiss" type="button">${icon('x', '关闭')}知道了</button>
    </div>`;
  if (wasHidden) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  box.querySelector('#mcpKeyCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(revealedKey);
      toast('已复制到剪贴板');
    } catch {
      toast('复制失败，请手动选择复制', 'error');
    }
  });
  box.querySelector('#mcpKeyDismiss').addEventListener('click', () => {
    revealedKey = null;
    fillReveal(root);
  });
}

function bindMcpEvents(root) {
  root.querySelector('#mcpSaveSettings').addEventListener('click', async (event) => {
    const field = (name) => root.querySelector(`[data-mcp-field="${name}"]`);
    const button = event.currentTarget;
    setBusy(button, true, '保存中');
    try {
      await api('/admin/mcp/settings', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: field('enabled').value === '1',
          mode: field('mode').value,
          sessionMode: field('sessionMode').value,
          rateLimit: {
            rpm: Math.max(1, Number(field('rpm').value) || 60),
            burst: Math.max(1, Number(field('burst').value) || 10),
          },
          tenantScope: field('tenantScope').value.split(',').map((v) => v.trim()).filter(Boolean),
        }),
      });
      toast('MCP 设置已保存');
      await renderPage();
    } catch (error) {
      toast(error.message, 'error');
      setBusy(button, false);
    }
  });

  root.querySelector('#mcpCreateKey').addEventListener('click', async (event) => {
    const field = (name) => root.querySelector(`[data-mcp-new="${name}"]`);
    const button = event.currentTarget;
    setBusy(button, true, '创建中');
    try {
      const result = await api('/admin/mcp/keys', {
        method: 'POST',
        body: JSON.stringify({
          name: field('name').value.trim() || 'mcp',
          tenantId: field('tenantId').value.trim() || 'default',
        }),
      });
      revealedKey = result.rawKey;
      toast('令牌已创建');
      await renderPage();
    } catch (error) {
      toast(error.message, 'error');
      setBusy(button, false);
    }
  });

  root.querySelectorAll('[data-mcp-revoke]').forEach((button) => {
    button.addEventListener('click', async () => {
      const { mcpRevoke: keyId, mcpName: name } = button.dataset;
      if (!window.confirm(`确认吊销令牌「${name}」？吊销后使用该令牌的客户端将立即失效。`)) {
        return;
      }
      setBusy(button, true, '吊销中');
      try {
        await api(`/admin/mcp/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' });
        toast('令牌已吊销');
        await renderPage();
      } catch (error) {
        toast(error.message, 'error');
        setBusy(button, false);
      }
    });
  });

  root.querySelector('[data-mcp-help]')?.addEventListener('click', () => navigate('/help'));
  fillReveal(root);
}

export async function renderMcpPage(root) {
  if (state.currentUser?.role !== 'ADMIN') {
    root.innerHTML = `<div class="section-band">${emptyState('MCP 令牌管理仅对平台管理员开放', 'key')}</div>`;
    return;
  }
  root.innerHTML = '<div class="loading-state"><span class="spinner"></span>正在读取 MCP 配置</div>';
  const [settings, keys, audit] = await Promise.all([
    api('/admin/mcp/settings'),
    api('/admin/mcp/keys'),
    api('/admin/mcp/audit?limit=20'),
  ]);
  root.innerHTML = `
    <div class="page-stack">
      ${sectionTabsMarkup(ASSET_TABS, 'mcp', '智能体管理')}
      <div class="section-head">
        <div>
          <h2>MCP 令牌与连接器</h2>
          <p>把平台能力通过 MCP 协议开放给外部客户端（Claude Desktop、Cursor 等）。在此管理开关与访问令牌，并下载连接器包。</p>
        </div>
        <div class="page-toolbar">
          <a class="btn btn-quiet" href="/api/mcp/connector/download" download>${icon('arrow-up-right', '下载')}下载连接器包</a>
          <button class="btn btn-quiet" type="button" data-mcp-help>${icon('life-buoy', '指南')}使用指南</button>
        </div>
      </div>
      <section class="section-band" id="mcpKeyReveal" hidden></section>
      ${renderSettings(settings)}
      ${renderKeys(keys)}
      ${renderAudit(audit.items ?? [])}
    </div>
  `;
  bindSectionTabs(root, core.navigate);
  bindMcpEvents(root);
}

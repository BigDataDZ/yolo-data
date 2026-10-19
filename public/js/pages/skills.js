import * as core from '../core/runtime.js';
import { bindSkillUploadForm } from '../components/skillUploadForm.js';
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
} = core;

// 来源决定「能不能删」：内置随平台发布只能停用；外部目录与手动上传可删。
const SOURCE_LABELS = {
  BUILTIN: ['平台内置', 'tag-blue', '随平台发布，不支持删除，只能停用'],
  SKILL_MD: ['外部目录', 'tag-teal', '从配置的Skill目录扫描得到，删除后再次同步会恢复'],
  UPLOAD: ['手动上传', 'tag-teal', '管理员在本页上传，删除后不可恢复'],
};

function sourceOf(skill) {
  return SOURCE_LABELS[skill.source] ?? [skill.source, 'tag', ''];
}

function usageLabel(skill) {
  if (skill.usage === 0) {
    return '<span class="muted">未被引用</span>';
  }
  const names = (skill.referencedBy ?? []).join('、');
  return `<span title="被以下智能体引用：${escapeAttr(names)}">${skill.usage} 个智能体</span>`;
}

function phaseLabel(skill) {
  const tags = skill.phaseTags ?? [];
  if (tags.length === 0) {
    return '<span class="muted">-</span>';
  }
  return escapeHtml(tags.join(' / '));
}

function renderCatalog(catalog) {
  const skillRows = (catalog.skills ?? []).map((skill) => {
    const [label, tagClass, hint] = sourceOf(skill);
    const active = skill.status !== 0;
    return `
      <tr>
        <td>
          <strong>${escapeHtml(skill.name)}</strong>
          <br /><small class="mono muted">${escapeHtml(skill.code)}</small>
          ${skill.description ? `<br /><small class="muted">${escapeHtml(skill.description)}</small>` : ''}
        </td>
        <td>${skill.kind === 'TOOL' ? '工具' : skill.kind === 'RESOLVER' ? '解析器' : '指令'}</td>
        <td><span class="tag ${tagClass}" title="${escapeAttr(hint)}">${escapeHtml(label)}</span></td>
        <td>${phaseLabel(skill)}</td>
        <td>${usageLabel(skill)}</td>
        <td>
          <button class="tag ${active ? 'tag-teal' : 'tag-red'} skill-status-btn" type="button"
            data-skill-toggle="${escapeAttr(skill.code)}" data-skill-next="${active ? 0 : 1}"
            title="${active ? '点击停用该公共 Skill' : '点击启用该公共 Skill'}">${active ? '已启用' : '已停用'}</button>
        </td>
        <td>
          ${skill.removable
            ? `<button class="btn btn-quiet" type="button"
                 data-skill-delete="${escapeAttr(skill.code)}"
                 data-skill-name="${escapeAttr(skill.name)}"
                 data-skill-usage="${skill.usage}"
                 data-skill-refs="${escapeAttr((skill.referencedBy ?? []).join('、'))}">${icon('trash', '删除')}删除</button>`
            : '<span class="muted">不可删除</span>'}
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="page-stack">
      ${sectionTabsMarkup(ASSET_TABS, 'skills', '智能体管理')}
      <div class="section-head">
        <div>
          <h2>Skills</h2>
          <p>平台级 Skill 资产池，与「某个智能体勾选了哪些 Skill」解耦：这里管资产本身，
             智能体侧只决定用哪些。停用会同时对所有智能体生效。</p>
        </div>
      </div>

      <section class="section-band">
        <div class="section-head compact">
          <div>
            <h3>Skill目录</h3>
            <p>共 ${(catalog.skills ?? []).length} 个公共Skill。停用的 Skill 对所有智能体立即失效，
               即使智能体侧已勾选也会被忽略。</p>
          </div>
        </div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Skill</th><th>类型</th><th>来源</th><th>生效阶段</th><th>引用</th><th>状态</th><th>操作</th>
              </tr>
            </thead>
            <tbody>${skillRows || '<tr><td colspan="7" class="muted">暂无公共 Skill</td></tr>'}</tbody>
          </table>
        </div>
      </section>

      <section class="section-band">
        <div class="section-head compact">
          <div>
            <h3>添加 Skill</h3>
            <p>选择一个 SKILL.md 文件上传到公共目录。上传的 Skill 默认不挂载到任何智能体，
               需到智能体编辑页勾选后才会生效。</p>
          </div>
        </div>
        <div class="skill-upload-card" id="skillUploadDropzone">
          <input class="skill-upload-input" type="file" id="skillUploadFile"
            accept=".md,.markdown,text/markdown,text/plain" />
          <label class="skill-upload-dropzone" for="skillUploadFile">
            <span class="skill-upload-icon">${icon('file-text', '上传 Skill')}</span>
            <span class="skill-upload-copy">
              <strong>选择 SKILL.md 文件</strong>
              <small>支持 .md / .markdown 文件，也可以将文件拖拽到这里</small>
            </span>
            <span class="btn btn-quiet skill-upload-select">选择文件</span>
          </label>
          <div class="skill-upload-selected" id="skillUploadSelected" hidden></div>
        </div>
        <div class="page-toolbar">
          <button class="btn btn-primary" id="skillUploadBtn" type="button" disabled>
            ${icon('file-text', '上传')}上传并加入公共目录
          </button>
        </div>
      </section>
    </div>
  `;
}

function bindCatalogEvents(root) {
  root.querySelectorAll('[data-skill-toggle]').forEach((button) => {
    button.addEventListener('click', async () => {
      const code = button.dataset.skillToggle;
      const next = Number(button.dataset.skillNext);
      setBusy(button, true, next === 0 ? '停用中' : '启用中');
      try {
        await api('/api/skill-catalog/status', {
          method: 'POST',
          body: JSON.stringify({ code, status: next }),
        });
        toast(next === 0 ? '公共 Skill 已停用' : '公共 Skill 已启用');
        await renderPage();
      } catch (error) {
        toast(error.message, 'error');
        setBusy(button, false);
      }
    });
  });

  root.querySelectorAll('[data-skill-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      const { skillDelete: code, skillName: name, skillUsage: usage, skillRefs: refs } = button.dataset;
      const refText = Number(usage) > 0
        ? `\n\n该 Skill 正被 ${usage} 个智能体引用（${refs}），删除后这些智能体会立即失去它。`
        : '';
      if (!window.confirm(`确认删除公共 Skill「${name}」？删除后不可恢复。${refText}`)) {
        return;
      }
      setBusy(button, true, '删除中');
      try {
        await api('/api/skill-catalog/delete', {
          method: 'POST',
          body: JSON.stringify({ code }),
        });
        toast('公共 Skill 已删除');
        await renderPage();
      } catch (error) {
        toast(error.message, 'error');
        setBusy(button, false);
      }
    });
  });

  bindSkillUploadForm(root, { icon, escapeHtml, toast, setBusy, api, renderPage });
}

async function renderSkillsPage(root) {
  if (core.state.currentUser?.role !== 'ADMIN') {
    root.innerHTML = `<div class="section-band">${emptyState('Skills仅对平台管理员开放', 'list-checks')}</div>`;
    return;
  }
  root.innerHTML = '<div class="loading-state"><span class="spinner"></span>正在读取Skill目录</div>';
  const catalog = await api('/api/skill-catalog');
  root.innerHTML = renderCatalog(catalog);
  bindSectionTabs(root, core.navigate);
  bindCatalogEvents(root);
}

export {
  renderSkillsPage,
};

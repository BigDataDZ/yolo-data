// 本地上传入口：把本地文件传给平台，作为当前会话的工作区产物参与问数算数。
// 组件保持零依赖，只负责选择/拖拽、base64 读取、调用上传接口与展示结果，
// 不猜测文件语义，也不参与业务口径。

import * as core from '../core/runtime.js';

const { icon, escapeHtml, escapeAttr, toast } = core;

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT_EXTENSIONS = ['csv', 'xls', 'xlsx'];

let uploads = [];

function chipsMarkup() {
  if (uploads.length === 0) {
    return '';
  }
  return uploads.map((item) => `
    <span class="attachment-chip${item.status === 'error' ? ' is-error' : ''}"
      title="${escapeAttr(item.message ?? item.label ?? '')}">
      ${icon(item.status === 'error' ? 'circle-alert' : 'file-spreadsheet', item.label)}
      <span>${escapeHtml(item.label)}</span>
    </span>
  `).join('');
}

// 触发按钮放进输入区，与发送按钮同一行、靠左；这样"上传入口"和"发送"处于同一操作带，
// 不再单独占一行。
export function fileUploadTriggerMarkup() {
  return `
    <button class="attachment-add attachment-trigger" id="attachmentAddBtn" type="button"
      title="上传本地 CSV / XLS / XLSX 参与问数" aria-label="上传本地文件">
      ${icon('plus', '上传本地文件')}<span>本地文件</span>
    </button>
    <input type="file" class="attachment-input" id="attachmentInput" hidden
      multiple accept="${ACCEPT_EXTENSIONS.map((item) => `.${item}`).join(',')}" />
  `;
}

// 已上传文件的 chips 单独一行；没有附件时整行隐藏，避免空行占位。
export function fileUploadChipsMarkup() {
  return `
    <div class="chat-attachment-bar" id="chatAttachmentBar"${uploads.length > 0 ? '' : ' hidden'}>
      <span class="attachment-chips" id="chatAttachmentChips">${chipsMarkup()}</span>
    </div>
  `;
}

export function clearLocalFileUploads() {
  uploads = [];
  const host = document.getElementById('chatAttachmentChips');
  if (host) {
    host.innerHTML = '';
  }
  const bar = document.getElementById('chatAttachmentBar');
  if (bar) {
    bar.hidden = true;
  }
}

// 当前待随提问提交的附件（已成功上传并取得产物 ID 的文件）。
export function pendingUploadAttachments() {
  return uploads
    .filter((item) => item.status === 'ok' && item.artifactId)
    .map((item) => ({
      artifactId: item.artifactId,
      name: item.name,
      label: item.label,
    }));
}

function extensionOf(name) {
  const match = String(name ?? '').match(/\.([A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : '';
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? '').split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('本地文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function describeUpload(result) {
  if (!result?.table) {
    const note = result?.warnings?.[0] ? ` · ${result.warnings[0]}` : ' · 已保存';
    return `${result.file.name}${note}`;
  }
  const sheet = result.table.sheetName ? `工作表「${result.table.sheetName}」· ` : '';
  return `${result.file.name} · ${sheet}${result.table.rowCount} 行 / ${result.table.columnCount} 列`;
}

async function uploadOne(file, { ensureSession, refresh }) {
  const extension = extensionOf(file.name);
  if (!ACCEPT_EXTENSIONS.includes(extension)) {
    return { ok: false, message: `暂不支持 .${extension || '未知'} 文件，请使用 CSV、XLS 或 XLSX` };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: `文件超过 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB 上限` };
  }
  const session = await ensureSession();
  const contentBase64 = await readAsBase64(file);
  const result = await core.api('/api/workspaces/files', {
    method: 'POST',
    body: JSON.stringify({ sessionId: session.id, name: file.name, contentBase64 }),
  });
  await refresh();
  return { ok: true, result };
}

export function bindFileUpload(root, { ensureSession, onUploaded } = {}) {
  const bar = root.querySelector('#chatAttachmentBar');
  const input = root.querySelector('#attachmentInput');
  const addButton = root.querySelector('#attachmentAddBtn');
  const chipHost = root.querySelector('#chatAttachmentChips');
  if (!input || !addButton || !chipHost) {
    return;
  }
  // chips 行在没有附件时是隐藏的，因此拖拽热区上移到整个 composer，
  // 保证"拖文件进来就能上传"在有无附件时都成立。
  const dropZone = root.querySelector('.chat-composer-inner') ?? bar;
  const repaint = () => {
    chipHost.innerHTML = chipsMarkup();
    if (bar) {
      bar.hidden = uploads.length === 0;
    }
  };
  let busy = false;
  const handleFiles = async (fileList) => {
    const files = [...(fileList ?? [])];
    if (busy || files.length === 0) {
      return;
    }
    busy = true;
    addButton.disabled = true;
    for (const file of files) {
      uploads.push({ label: `${file.name} 上传中…`, status: 'pending' });
      repaint();
      try {
        const outcome = await uploadOne(file, { ensureSession, refresh: onUploaded });
        uploads = uploads.filter((item) => item.status !== 'pending');
        if (outcome.ok) {
          uploads.push({
            label: describeUpload(outcome.result),
            status: 'ok',
            message: '已加入当前会话工作区，可直接在提问中引用',
            artifactId: outcome.result.file?.artifactId ?? null,
            name: outcome.result.file?.name ?? file.name,
          });
          toast(`已上传 ${file.name}`);
        } else {
          uploads.push({ label: `${file.name} 上传失败`, status: 'error', message: outcome.message });
          toast(outcome.message, 'error');
        }
      } catch (error) {
        uploads = uploads.filter((item) => item.status !== 'pending');
        uploads.push({ label: `${file.name} 上传失败`, status: 'error', message: error.message });
        toast(error.message, 'error');
      }
      repaint();
    }
    busy = false;
    addButton.disabled = false;
  };
  addButton.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    handleFiles(files);
  });
  if (!dropZone) {
    return;
  }
  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('is-dragging');
  });
  dropZone.addEventListener('dragleave', (event) => {
    // 拖过子元素时也会触发 dragleave，只有真正离开热区才撤销高亮。
    if (event.relatedTarget && dropZone.contains(event.relatedTarget)) {
      return;
    }
    dropZone.classList.remove('is-dragging');
  });
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragging');
    handleFiles(event.dataTransfer?.files);
  });
}

export { ACCEPT_EXTENSIONS, MAX_BYTES };

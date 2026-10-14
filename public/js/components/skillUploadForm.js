import { MAX_SKILL_UPLOAD_BYTES, SKILL_FILE_EXTENSION } from '../../skillUploadPolicy.js';

export function skillFileError(file) {
  if (!SKILL_FILE_EXTENSION.test(file.name)) return 'Skill 上传仅支持 .md / .markdown 文件';
  if (file.size > MAX_SKILL_UPLOAD_BYTES) return 'SKILL.md 超过 200KB 上限';
  return '';
}

export function bindSkillUploadForm(root, { icon, escapeHtml, toast, setBusy, api, renderPage }) {
  const fileInput = root.querySelector('#skillUploadFile');
  const dropzone = root.querySelector('#skillUploadDropzone');
  const selectedFile = root.querySelector('#skillUploadSelected');
  const uploadBtn = root.querySelector('#skillUploadBtn');
  let uploading = false;
  const updateSelectedFile = () => {
    const file = fileInput?.files?.[0];
    if (!file || !selectedFile || !uploadBtn) {
      if (uploadBtn) uploadBtn.disabled = true;
      if (selectedFile) selectedFile.hidden = true;
      return;
    }
    const error = skillFileError(file);
    selectedFile.hidden = false;
    selectedFile.innerHTML = `${icon(error ? 'circle-alert' : 'file-text', '已选择')}<span>${escapeHtml(file.name)}</span><small>${escapeHtml(error || `${Math.ceil(file.size / 1024)} KB`)}</small>`;
    uploadBtn.disabled = uploading || Boolean(error);
  };
  fileInput?.addEventListener('change', updateSelectedFile);
  if (dropzone) {
    for (const eventName of ['dragenter', 'dragover', 'dragleave', 'drop']) {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.toggle('is-dragging', ['dragenter', 'dragover'].includes(eventName));
      });
    }
    dropzone.addEventListener('drop', (event) => {
      const files = event.dataTransfer?.files;
      if (!files?.length || !fileInput) return;
      fileInput.files = files;
      updateSelectedFile();
    });
  }
  if (!uploadBtn || !fileInput) return;
  uploadBtn.addEventListener('click', async () => {
    const file = fileInput.files?.[0];
    if (!file || uploading) return;
    const error = skillFileError(file);
    if (error) { toast(error, 'error'); return; }
    uploading = true;
    setBusy(uploadBtn, true, '上传中');
    try {
      const content = await file.text();
      const result = await api('/api/skill-catalog/upload', {
        method: 'POST', body: JSON.stringify({ content, fileName: file.name }),
      });
      toast(`「${result.name}」已加入公共目录`);
      await renderPage();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      uploading = false;
      setBusy(uploadBtn, false);
      updateSelectedFile();
    }
  });
}

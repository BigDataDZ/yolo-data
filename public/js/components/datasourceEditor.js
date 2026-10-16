import { datasourceFormHtml, bindDatasourceForm } from './datasourceForm.js';

export function openDatasourceEditor({
  api,
  toast,
  openModal,
  closeModal,
  setBusy,
  hydrateIcons,
  loadBootstrap,
  renderPage,
  state, source = null,
}) {
  const modal = openModal({
    title: source ? '编辑数据源' : '新增数据源',
    editor: true,
    body: datasourceFormHtml(),
    footer: `
      <button class="btn" type="button" data-close-modal>取消</button>
      <button class="btn btn-primary" type="button" id="saveDatasourceBtn">保存数据源</button>
    `,
  });
  hydrateIcons(modal);
  const readSource = bindDatasourceForm(modal, source);
  modal.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', closeModal);
  });
  modal.querySelector('#saveDatasourceBtn').addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true, '保存中');
    try {
      await api(source ? `/api/data-sources/${source.id}` : '/api/data-sources', {
        method: source ? 'PUT' : 'POST',
        body: JSON.stringify(readSource()),
      });
      toast('数据源已保存，密码已加密');
      closeModal();
      await loadBootstrap(state.currentUser.id);
      renderPage();
    } catch (error) {
      toast(error.message, 'error');
      setBusy(event.currentTarget, false);
    }
  });
}


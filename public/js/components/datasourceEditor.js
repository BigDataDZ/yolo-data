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
  state,
}) {
  const modal = openModal({
    title: '新增数据源',
    editor: true,
    body: datasourceFormHtml(),
    footer: `
      <button class="btn" type="button" data-close-modal>取消</button>
      <button class="btn btn-primary" type="button" id="saveDatasourceBtn">保存数据源</button>
    `,
  });

  hydrateIcons(modal);
  const readSource = bindDatasourceForm(modal);
  modal.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', closeModal);
  });
  modal.querySelector('#saveDatasourceBtn').addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true, '保存中');
    try {
      await api('/api/data-sources', {
        method: 'POST',
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


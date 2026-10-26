const PAGE_SIZE = 10;

export function mountPermissionUserList(root, users, state, { escapeHtml, initials, formatDate, onSelectionChange }) {
  let search = '';
  let page = 1;
  const results = root.querySelector('#permissionUserResults');
  const count = root.querySelector('#permissionUserCount');

  function render() {
    const keyword = search.trim().toLocaleLowerCase();
    const filtered = users.filter((user) => (
      `${user.displayName ?? ''} ${user.username ?? ''} ${user.role ?? ''} ${Number(user.status) === 0 ? '停用 disabled' : '启用 active'}`
        .toLocaleLowerCase().includes(keyword)
    ));
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page = Math.max(1, Math.min(page, pageCount));
    const start = (page - 1) * PAGE_SIZE;
    const pageUsers = filtered.slice(start, start + PAGE_SIZE);
    if (!pageUsers.some((user) => Number(user.id) === Number(state.permissionUserId))) {
      state.permissionUserId = pageUsers[0]?.id ?? null;
    }

    count.textContent = keyword ? `${filtered.length}/${users.length}` : String(users.length);
    results.innerHTML = `
      <div class="permission-users-table-wrap">
        <table class="data-table permission-users-table">
          <thead><tr><th>ID</th><th>用户名</th><th>显示名称</th><th>角色</th><th>状态</th><th>创建时间</th><th>更新时间</th></tr></thead>
          <tbody>
            ${pageUsers.map((user) => `
              <tr class="permission-user-row${Number(user.id) === Number(state.permissionUserId) ? ' is-active' : ''}" data-permission-user="${user.id}" tabindex="0" aria-selected="${Number(user.id) === Number(state.permissionUserId)}">
                <td>${Number(user.id)}</td>
                <td class="mono">${escapeHtml(user.username)}</td>
                <td><span class="permission-user-name"><span class="user-avatar">${escapeHtml(initials(user.displayName))}</span><strong>${escapeHtml(user.displayName)}</strong></span></td>
                <td>${escapeHtml(user.role)}</td>
                <td><span class="tag ${Number(user.status) === 0 ? 'tag-amber' : 'tag-teal'}">${Number(user.status) === 0 ? '已停用' : '启用'}</span></td>
                <td>${escapeHtml(formatDate(user.createdAt) || '—')}</td>
                <td>${escapeHtml(formatDate(user.updatedAt) || '—')}</td>
              </tr>
            `).join('') || '<tr><td colspan="7" class="permission-users-empty">没有匹配的用户</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="permission-users-pagination">
        <span class="muted">${filtered.length ? `${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} / ${filtered.length}` : '0 位用户'}</span>
        <div class="list-pane-head-actions">
          <button class="btn btn-quiet btn-small" type="button" data-user-page="prev"${page <= 1 ? ' disabled' : ''}>上一页</button>
          <span class="muted">${page} / ${pageCount}</span>
          <button class="btn btn-quiet btn-small" type="button" data-user-page="next"${page >= pageCount ? ' disabled' : ''}>下一页</button>
        </div>
      </div>
    `;

    results.querySelectorAll('[data-user-page]').forEach((button) => button.addEventListener('click', async () => {
      const previousUserId = state.permissionUserId;
      page += button.dataset.userPage === 'next' ? 1 : -1;
      render();
      if (Number(previousUserId) !== Number(state.permissionUserId)) await onSelectionChange();
    }));
    const selectUser = async (row) => {
      state.permissionUserId = Number(row.dataset.permissionUser);
      render();
      await onSelectionChange();
    };
    results.querySelectorAll('[data-permission-user]').forEach((row) => {
      row.addEventListener('click', () => selectUser(row));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectUser(row);
        }
      });
    });
    return state.permissionUserId;
  }

  root.querySelector('#permissionUserSearch').addEventListener('input', async (event) => {
    const previousUserId = state.permissionUserId;
    search = event.target.value;
    page = 1;
    render();
    if (Number(previousUserId) !== Number(state.permissionUserId)) await onSelectionChange();
  });

  return render();
}

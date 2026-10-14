export const DATASOURCE_TYPES = [
  { type: 'MYSQL', label: 'MySQL', description: 'MySQL 或兼容协议', iconName: 'database', port: 3306 },
  { type: 'TIDB', label: 'TiDB', description: '分布式 HTAP 数据库', iconName: 'workflow', port: 4000 },
  { type: 'DORIS', label: 'Doris', description: '实时分析型数据库', iconName: 'library', port: 9030 },
  { type: 'POSTGRESQL', label: 'PostgreSQL', description: '关系型数据库', iconName: 'database', port: 5432 },
];

export function datasourceFormHtml() {
  return `
    <div class="form-field span-2"><label>数据库类型</label>
      <div class="datasource-type-grid" role="radiogroup" aria-label="数据库类型">
        ${DATASOURCE_TYPES.map((item, index) => `
          <button class="datasource-type-tile${index === 0 ? ' is-active' : ''}" data-source-type="${item.type}" data-source-port="${item.port}" type="button" role="radio" aria-checked="${index === 0}">
            <span class="icon" data-icon="${item.iconName}" aria-hidden="true"></span>
            <span><strong>${item.label}</strong><small>${item.description}</small></span>
          </button>`).join('')}
      </div>
    </div>
    <div class="form-grid">
      <div class="form-field"><label for="sourceName">数据源名称</label><input class="field" id="sourceName" placeholder="开发测试数据库" /></div>
      <div class="form-field"><label for="sourceHost">Host</label><input class="field" id="sourceHost" /></div>
      <div class="form-field"><label for="sourcePort">Port</label><input class="field" id="sourcePort" type="number" min="1" max="65535" value="3306" /></div>
      <div class="form-field"><label for="sourceDatabase">默认数据库</label><input class="field" id="sourceDatabase" /></div>
      <div class="form-field"><label for="sourceUsername">用户名</label><input class="field" id="sourceUsername" /></div>
      <div class="form-field"><label for="sourcePassword">密码</label><input class="field" id="sourcePassword" type="password" /></div>
    </div>
    <fieldset id="sourcePostgresOptions" class="datasource-postgres-options" hidden>
      <div class="form-field"><label for="sourceSsl">SSL 连接</label><select class="select" id="sourceSsl"><option value="off">不启用</option><option value="verify">启用并验证服务器证书</option></select></div>
      <div class="form-field"><label for="sourceCa">CA 证书（可选，PEM 内容）</label><textarea class="textarea" id="sourceCa" placeholder="留空使用系统信任的证书"></textarea></div>
      <p class="muted">数据库用于建立连接；创建数据集时另行填写 schema（通常为 public）。</p>
    </fieldset>`;
}

export function bindDatasourceForm(modal) {
  let type = 'MYSQL';
  let previousPort = '3306';
  modal.querySelectorAll('.datasource-type-tile').forEach((button) => {
    button.addEventListener('click', () => {
      type = button.dataset.sourceType;
      modal.querySelectorAll('.datasource-type-tile').forEach((item) => {
        item.classList.toggle('is-active', item === button);
        item.setAttribute('aria-checked', String(item === button));
      });
      const port = modal.querySelector('#sourcePort');
      if (!port.value || port.value === previousPort) port.value = button.dataset.sourcePort;
      previousPort = button.dataset.sourcePort;
      const postgres = type === 'POSTGRESQL';
      modal.querySelector('#sourcePostgresOptions').hidden = !postgres;
      modal.querySelector('label[for="sourceDatabase"]').textContent = postgres ? '连接数据库（必填）' : '默认数据库';
      modal.querySelector('#sourceDatabase').required = postgres;
    });
  });
  return () => {
    const value = (id) => modal.querySelector(`#${id}`).value.trim();
    const databaseName = value('sourceDatabase');
    if (type === 'POSTGRESQL' && !databaseName) throw new Error('请填写 PostgreSQL 连接数据库');
    return {
      name: value('sourceName'), dbType: type, host: value('sourceHost'),
      port: Number(value('sourcePort')), databaseName, username: value('sourceUsername'),
      password: modal.querySelector('#sourcePassword').value,
      options: type === 'POSTGRESQL' && value('sourceSsl') === 'verify'
        ? { ssl: { ca: value('sourceCa') || undefined } } : {},
    };
  };
}

// PG databases cannot be used as schema names. Keep the existing text field,
// but update its label/default when the selected source changes.
export function bindDatasetSource(modal, sources) {
  const select = modal.querySelector('#datasetSource');
  const input = modal.querySelector('#datasetSchema');
  let previousDefault = input.value;
  const update = () => {
    const source = sources.find((item) => String(item.id) === select.value) ?? sources[0];
    const postgres = source.dbType === 'POSTGRESQL';
    const defaultSchema = postgres ? 'public' : source.databaseName;
    if (!input.value || input.value === previousDefault) input.value = defaultSchema;
    input.placeholder = postgres ? 'public' : '数据库名称';
    modal.querySelector('label[for="datasetSchema"]').textContent = postgres ? 'Schema（如 public）' : '数据库';
    previousDefault = defaultSchema;
  };
  select.addEventListener('change', update);
  update();
}

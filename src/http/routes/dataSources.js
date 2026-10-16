import { dataSourceUpdate, publicDataSource } from '../dataSourcePayload.js';

export function registerDataSourceRoutes(table) {
  table.add({
    id: 'dataSources.list',
    method: 'GET',
    path: '/api/data-sources',
    tags: ['datasets'],
    summary: '列出数据源（管理员）',
    middleware: ['auth', 'admin'],
    adminOnly: true,
    handler: async (ctx) => {
      const { request, response, database, application, getRequestUser, sendJson } = ctx;
      const user = getRequestUser(request, database);
      if (user.role !== 'ADMIN') {
        throw Object.assign(new Error('admin permission required'), { statusCode: 403 });
      }
      sendJson(response, 200, application.businessDatasets.listDataSources());
    },
  });

  table.add({
    id: 'dataSources.create',
    method: 'POST',
    path: '/api/data-sources',
    tags: ['datasets'],
    summary: '创建数据源（管理员）',
    middleware: ['auth', 'admin'],
    adminOnly: true,
    handler: async (ctx) => {
      const { request, response, database, application, getRequestUser, readJson, sendJson } = ctx;
      const user = getRequestUser(request, database);
      if (user.role !== 'ADMIN') {
        throw Object.assign(new Error('admin permission required'), { statusCode: 403 });
      }
      const body = await readJson(request);
      const source = application.businessDatasets.saveDataSource(body);
      database.addAuditLog({
        userId: user.id,
        action: 'DATASOURCE_CREATE',
        detail: {
          datasourceId: source.id,
          code: source.code,
          host: source.host,
          databaseName: source.databaseName,
        },
      });
      sendJson(response, 200, publicDataSource(source));
    },
  });

  table.add({
    id: 'dataSources.test',
    method: 'POST',
    path: '/api/data-sources/:id(\\d+)/test',
    tags: ['datasets'],
    summary: '测试数据源连接（管理员）',
    middleware: ['auth', 'admin'],
    adminOnly: true,
    handler: async (ctx) => {
      const { request, response, database, application, params, getRequestUser, sendJson } = ctx;
      const user = getRequestUser(request, database);
      if (user.role !== 'ADMIN') {
        throw Object.assign(new Error('admin permission required'), { statusCode: 403 });
      }
      const source = await application.businessDatasets.testDataSource(Number(params[0]));
      sendJson(response, 200, publicDataSource(source));
    },
  });

  table.add({
    id: 'dataSources.update', method: 'PUT', path: '/api/data-sources/:id(\\d+)',
    tags: ['datasets'], summary: '编辑数据源连接参数（管理员）',
    middleware: ['auth', 'admin'], adminOnly: true,
    handler: async ({ request, response, database, application, params, user, readJson, sendJson }) => {
      const id = Number(params[0]);
      const body = await readJson(request);
      const current = database.getDataSource(id);
      if (!current) throw Object.assign(new Error('data source not found'), { statusCode: 404 });
      const payload = dataSourceUpdate(current, body);
      const source = application.businessDatasets.saveDataSource(payload, id);
      database.addAuditLog({ userId: user.id, action: 'DATASOURCE_UPDATE', detail: {
        datasourceId: id, code: source.code,
        changedFields: Object.keys(body).filter(key => key !== 'password'),
        passwordChanged: Boolean(body.password),
      } });
      sendJson(response, 200, publicDataSource(source));
    },
  });

  for (const action of ['databases', 'tables', 'columns']) {
    table.add({
      id: `dataSources.${action}`,
      method: 'GET',
      path: `/api/data-sources/:id(\\d+)/${action}`,
      tags: ['datasets'],
      summary: `读取数据源 ${action}（管理员）`,
      middleware: ['auth', 'admin'],
      adminOnly: true,
      handler: async (ctx) => {
        const { request, response, url, database, application, params, getRequestUser, sendJson } = ctx;
        const user = getRequestUser(request, database);
        if (user.role !== 'ADMIN') {
          throw Object.assign(new Error('admin permission required'), { statusCode: 403 });
        }
        const id = Number(params[0]);
        if (action === 'databases') {
          sendJson(response, 200, await application.businessDatasets.listDatabases(id));
        } else if (action === 'tables') {
          sendJson(response, 200, await application.businessDatasets.listTables(
            id,
            url.searchParams.get('schema'),
          ));
        } else {
          sendJson(response, 200, await application.businessDatasets.listColumns(
            id,
            url.searchParams.get('schema'),
            url.searchParams.get('table'),
          ));
        }
      },
    });
  }

}

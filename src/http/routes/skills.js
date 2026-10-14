// 公共 Skill 目录：与「某个智能体勾选了哪些 Skill」解耦，只管平台级资产本身。
// 写操作统一用 POST + body 传 code —— Skill code 形如 `external:xxx` / `upload:xxx`，
// 冒号放进 URL 路径段容易与路由参数解析打架，用 body 更稳。
export function registerSkillRoutes(table) {
  table.add({
    id: 'skillCatalog.read',
    method: 'GET',
    path: '/api/skill-catalog',
    tags: ['skills'],
    summary: '读取Skill目录（管理员）',
    middleware: ['auth', 'admin'],
    adminOnly: true,
    handler: async (ctx) => {
      const { request, response, database, application, getRequestUser, sendJson } = ctx;
      const user = getRequestUser(request, database);
      if (user.role !== 'ADMIN') {
        throw Object.assign(new Error('admin permission required'), { statusCode: 403 });
      }
      sendJson(response, 200, application.skillCatalog.list());
    },
  });

  table.add({
    id: 'skillCatalog.upload',
    method: 'POST',
    path: '/api/skill-catalog/upload',
    tags: ['skills'],
    summary: '上传 SKILL.md 加入公共目录（管理员）',
    middleware: ['auth', 'admin'],
    adminOnly: true,
    handler: async (ctx) => {
      const { request, response, database, application, getRequestUser, readJson, sendJson } = ctx;
      const user = getRequestUser(request, database);
      if (user.role !== 'ADMIN') {
        throw Object.assign(new Error('admin permission required'), { statusCode: 403 });
      }
      const body = await readJson(request);
      const skill = application.skillCatalog.saveUpload({
        content: body.content,
        fileName: body.fileName,
      });
      database.addAuditLog({
        userId: user.id,
        action: 'SKILL_UPLOAD',
        detail: { code: skill.code, name: skill.name },
      });
      sendJson(response, 200, { ...skill, catalog: application.skillCatalog.list() });
    },
  });

  table.add({
    id: 'skillCatalog.status',
    method: 'POST',
    path: '/api/skill-catalog/status',
    tags: ['skills'],
    summary: '启用或停用公共 Skill（管理员）',
    middleware: ['auth', 'admin'],
    adminOnly: true,
    handler: async (ctx) => {
      const { request, response, database, application, getRequestUser, readJson, sendJson } = ctx;
      const user = getRequestUser(request, database);
      if (user.role !== 'ADMIN') {
        throw Object.assign(new Error('admin permission required'), { statusCode: 403 });
      }
      const body = await readJson(request);
      const status = Number(body.status) === 0 ? 0 : 1;
      const result = application.skillCatalog.setStatus(body.code, status);
      database.addAuditLog({
        userId: user.id,
        action: 'SKILL_STATUS_UPDATE',
        detail: { code: result.code, status: result.status },
      });
      sendJson(response, 200, result);
    },
  });

  table.add({
    id: 'skillCatalog.delete',
    method: 'POST',
    path: '/api/skill-catalog/delete',
    tags: ['skills'],
    summary: '删除公共 Skill（管理员，仅限非内置来源）',
    middleware: ['auth', 'admin'],
    adminOnly: true,
    handler: async (ctx) => {
      const { request, response, database, application, getRequestUser, readJson, sendJson } = ctx;
      const user = getRequestUser(request, database);
      if (user.role !== 'ADMIN') {
        throw Object.assign(new Error('admin permission required'), { statusCode: 403 });
      }
      const body = await readJson(request);
      const result = application.skillCatalog.remove(body.code);
      database.addAuditLog({
        userId: user.id,
        action: 'SKILL_DELETE',
        detail: { code: result.code, referencedBy: result.referencedBy },
      });
      sendJson(response, 200, result);
    },
  });
}

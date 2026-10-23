import {
  assertPasswordUsable,
  checkUserPasswordAsync,
  clearSessionCookie,
  createSessionAsync,
  deleteSessionAsync,
  deleteUserSessionsAsync,
  readSessionToken,
  resolveAuthMode,
  resolveSessionAsync,
  sessionCookie,
  setUserPasswordAsync,
} from '../../auth.js';

export function registerAuthRoutes(table) {
  table.add({
    id: 'auth.me',
    method: 'GET',
    path: '/api/auth/me',
    tags: ['auth'],
    summary: '读取当前登录用户',
    handler: async (ctx) => {
      const { request, response, database, config, sendJson } = ctx;
      const token = readSessionToken(request);
      const user = token ? await resolveSessionAsync(database, token) : null;
      sendJson(response, 200, {
        authenticated: Boolean(user),
        user,
        authMode: resolveAuthMode(config),
        sessionTtlHours: Number(config.sessionTtlHours ?? 12),
      });
    },
  });

  table.add({
    id: 'auth.login',
    method: 'POST',
    path: '/api/auth/login',
    tags: ['auth'],
    summary: '账号密码登录',
    middleware: ['loginRateLimit'],
    handler: async (ctx) => {
      const { request, response, database, config, readJson, sendJson } = ctx;
      const body = await readJson(request);
      const username = String(body.username ?? '').trim();
      const password = String(body.password ?? '');
      if (!username || !password) {
        throw Object.assign(new Error('请输入用户名和密码'), { statusCode: 400 });
      }
      const user = await database.userRepository.getUserByUsernameAsync(username);
      if (!user || !await checkUserPasswordAsync(database, user, password)) {
        throw Object.assign(new Error('用户名或密码不正确'), { statusCode: 401 });
      }
      if (Number(user.status ?? 1) === 0) {
        throw Object.assign(new Error('账号已停用，请联系管理员'), { statusCode: 403 });
      }
      const session = await createSessionAsync(database, user.id, config.sessionTtlHours);
      response.setHeader('Set-Cookie', sessionCookie(session.token, {
        maxAgeSeconds: session.maxAgeSeconds,
        secure: Boolean(config.secureCookies),
      }));
      await database.addAuditLogAsync({
        userId: user.id,
        action: 'USER_LOGIN',
        detail: { username: user.username },
      });
      sendJson(response, 200, {
        user,
        expiresAt: session.expiresAt,
        authMode: resolveAuthMode(config),
      });
    },
  });

  table.add({
    id: 'auth.logout',
    method: 'POST',
    path: '/api/auth/logout',
    tags: ['auth'],
    summary: '退出登录',
    handler: async (ctx) => {
      const { request, response, database, config, sendJson } = ctx;
      const token = readSessionToken(request);
      const user = token ? await resolveSessionAsync(database, token) : null;
      await deleteSessionAsync(database, token);
      response.setHeader('Set-Cookie', clearSessionCookie({
        secure: Boolean(config.secureCookies),
      }));
      if (user) {
        await database.addAuditLogAsync({ userId: user.id, action: 'USER_LOGOUT', detail: {} });
      }
      sendJson(response, 200, { ok: true });
    },
  });

  table.add({
    id: 'auth.password',
    method: 'PUT',
    path: '/api/auth/password',
    tags: ['auth'],
    summary: '修改当前登录用户密码',
    middleware: ['auth'],
    handler: async (ctx) => {
      const { request, response, database, readJson, sendJson, user } = ctx;
      const body = await readJson(request);
      const newPassword = assertPasswordUsable(body.newPassword);
      if (!await checkUserPasswordAsync(database, user, body.currentPassword)) {
        throw Object.assign(new Error('当前密码不正确'), { statusCode: 400 });
      }
      await setUserPasswordAsync(database, user.id, newPassword);
      await deleteUserSessionsAsync(database, user.id, readSessionToken(request));
      await database.addAuditLogAsync({ userId: user.id, action: 'USER_PASSWORD_CHANGE', detail: {} });
      sendJson(response, 200, { ok: true });
    },
  });
}

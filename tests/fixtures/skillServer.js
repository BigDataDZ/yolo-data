import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../src/server.js';
import { loadConfig } from '../../src/config.js';
import { setUserPassword } from '../../src/auth.js';

export const TEST_PASSWORD = 'skill-acceptance-password';
export function skillDocument(name = 'acceptance-method', description = '验收分析方法') {
  return `---\nname: ${name}\ndescription: ${description}\nphases: [PLAN]\n---\n\n## Workflow\n按受控查询结果进行分析。`;
}

export async function withSkillServer(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yolo-skill-acceptance-'));
  const { server, application } = await startServer({
    ...loadConfig({}), port: 0, authMode: 'session',
    dbPath: path.join(directory, 'test.db'), datasourceSecretKeyPath: path.join(directory, '.key'),
    codeExecutionRoot: path.join(directory, 'code-runs'), userMemory: { maintenanceIntervalMs: 0 }, skillDirectories: [],
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const username of ['admin', 'east_manager']) {
    setUserPassword(application.database, application.database.getUserByUsername(username).id, TEST_PASSWORD);
  }
  const request = async (route, { cookie, method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(`${baseUrl}${route}`, { method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { response, data: await response.json() };
  };
  const login = async (username) => {
    const { response } = await request('/api/auth/login', { method: 'POST', body: { username, password: TEST_PASSWORD } });
    if (response.status !== 200) throw new Error(`test login failed: ${response.status}`);
    return response.headers.get('set-cookie').split(';')[0];
  };
  try { return await run({ application, baseUrl, directory, request, login }); }
  finally {
    application.memoryMaintenance.stop();
    await new Promise((resolve) => server.close(resolve));
    application.database.close();
  }
}

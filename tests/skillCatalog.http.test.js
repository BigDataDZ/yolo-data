import assert from 'node:assert/strict';
import test from 'node:test';
import { skillDocument, withSkillServer } from './fixtures/skillServer.js';

test('Skill HTTP management rejects anonymous, analysts and forged admin headers without mutations', async () => {
  await withSkillServer(async ({ application, request, login }) => {
    const admin = await login('admin');
    const analyst = await login('east_manager');
    const { data: uploaded } = await request('/api/skill-catalog/upload', { cookie: admin, method: 'POST', body: { content: skillDocument(), fileName: 'SKILL.md' } });
    const before = application.skillCatalog.list();
    const actions = [
      ['/api/skill-catalog', 'GET'],
      ['/api/skill-catalog/upload', 'POST', { content: skillDocument('unauthorized') }],
      ['/api/skill-catalog/status', 'POST', { code: uploaded.code, status: 0 }],
      ['/api/skill-catalog/delete', 'POST', { code: uploaded.code }],
    ];
    for (const [route, method, body] of actions) {
      for (const [cookie, expected] of [[undefined, 401], [analyst, 403]]) {
        const result = await request(route, { cookie, method, body, headers: { 'x-user-id': '1' } });
        assert.equal(result.response.status, expected, `${method} ${route}`);
      }
    }
    assert.deepEqual(application.skillCatalog.list(), before);
    assert.equal((await request('/api/skill-catalog', { cookie: admin })).response.status, 200);
  });
});

test('uploaded Skill is active in phase guidance, pause/resume preserves binding, deletion clears references', async () => {
  await withSkillServer(async ({ application, request, login }) => {
    const cookie = await login('admin');
    const { data: saved } = await request('/api/skill-catalog/upload', { cookie, method: 'POST', body: { content: skillDocument(), fileName: 'SKILL.md' } });
    const theme = application.database.listThemes()[0];
    const bound = await request(`/api/themes/${theme.id}`, { cookie, method: 'PUT', body: { ...application.database.getTheme(theme.id), skillCodes: [saved.code] } });
    assert.equal(bound.response.status, 200);
    const active = () => application.skillRegistry.listForTheme(application.database.getTheme(theme.id));
    assert.ok(active().some((skill) => skill.code === saved.code));
    const guidance = application.skillRegistry.buildPhaseInstructions(active(), 'PLAN');
    assert.ok(guidance.some((entry) => entry.code === saved.code && entry.guidance.includes('受控查询结果')));
    const disabled = await request('/api/skill-catalog/status', { cookie, method: 'POST', body: { code: saved.code, status: 0 } });
    assert.equal(disabled.response.status, 200);
    assert.equal(active().some((skill) => skill.code === saved.code), false);
    assert.ok(application.database.listThemeSkillCodes(theme.id).includes(saved.code));
    await request('/api/skill-catalog/status', { cookie, method: 'POST', body: { code: saved.code, status: 1 } });
    assert.ok(active().some((skill) => skill.code === saved.code));
    const deleted = await request('/api/skill-catalog/delete', { cookie, method: 'POST', body: { code: saved.code } });
    assert.equal(deleted.response.status, 200);
    assert.ok(deleted.data.referencedBy.includes(theme.name));
    assert.equal(application.database.getSkill(saved.code), null);
    assert.equal(application.database.listThemeSkillCodes(theme.id).includes(saved.code), false);
    assert.equal(active().some((skill) => skill.code === saved.code), false);
  });
});

test('invalid Skill uploads/status values are rejected with no partial catalog writes', async () => {
  await withSkillServer(async ({ application, request, login }) => {
    const cookie = await login('admin');
    const before = application.skillCatalog.list();
    const uploads = [
      { content: { name: 'object' } }, { content: 123 }, { content: ['array'] },
      { content: skillDocument(), fileName: 'payload.exe' },
      { content: skillDocument(), fileName: {} },
      { content: '---\nname: malformed\nmissing closing delimiter', fileName: 'SKILL.md' },
      { content: '---\nname: no-body\n---\n', fileName: 'SKILL.md' },
      { content: '---\nname: []\n---\nbody', fileName: 'SKILL.md' },
      { content: `text\0binary`, fileName: 'SKILL.md' },
      { content: '中'.repeat(70 * 1024), fileName: 'SKILL.md' },
    ];
    for (const body of uploads) {
      assert.equal((await request('/api/skill-catalog/upload', { cookie, method: 'POST', body })).response.status, 400);
      assert.deepEqual(application.skillCatalog.list(), before);
    }
    for (const status of [undefined, null, true, {}, '', 'bogus', 2, -1]) {
      assert.equal((await request('/api/skill-catalog/status', { cookie, method: 'POST', body: { code: 'trend_analysis', status } })).response.status, 400);
      assert.deepEqual(application.skillCatalog.list(), before);
    }
    for (const route of ['upload', 'status', 'delete']) {
      for (const body of [null, [], 'text', false, 123]) {
        assert.equal((await request(`/api/skill-catalog/${route}`, { cookie, method: 'POST', body })).response.status, 400);
        assert.deepEqual(application.skillCatalog.list(), before);
      }
    }
    for (const code of [null, {}, [], 123, '']) {
      assert.equal((await request('/api/skill-catalog/delete', { cookie, method: 'POST', body: { code } })).response.status, 400);
    }
  });
});

test('repeat uploads update content without duplicating, re-enabling or losing theme bindings', async () => {
  await withSkillServer(async ({ application, request, login }) => {
    const cookie = await login('admin');
    const first = await request('/api/skill-catalog/upload', { cookie, method: 'POST', body: { content: skillDocument('repeated-method') } });
    const theme = application.database.listThemes()[0];
    application.database.replaceThemeSkills(theme.id, [first.data.code]);
    await request('/api/skill-catalog/status', { cookie, method: 'POST', body: { code: first.data.code, status: 0 } });
    const updated = await request('/api/skill-catalog/upload', { cookie, method: 'POST', body: { content: `${skillDocument('repeated-method')}\n新版本步骤` } });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.data.code, first.data.code);
    assert.equal(application.skillCatalog.list().skills.filter((skill) => skill.code === first.data.code).length, 1);
    assert.equal(application.database.getSkill(first.data.code).status, 0);
    assert.match(application.database.getSkill(first.data.code).content, /新版本步骤/);
    assert.ok(application.database.listThemeSkillCodes(theme.id).includes(first.data.code));
    assert.equal((await request('/api/skill-catalog/delete', { cookie, method: 'POST', body: { code: 'trend_analysis' } })).response.status, 400);
  });
});

test('plain Markdown upload uses its filename instead of colliding under unnamed-skill', async () => {
  await withSkillServer(async ({ request, login }) => {
    const cookie = await login('admin');
    const first = await request('/api/skill-catalog/upload', { cookie, method: 'POST', body: { fileName: 'first.md', content: '# Workflow\nfirst instructions' } });
    const second = await request('/api/skill-catalog/upload', { cookie, method: 'POST', body: { fileName: 'second.markdown', content: '# Workflow\nsecond instructions' } });
    assert.equal(first.response.status, 200);
    assert.equal(second.response.status, 200);
    assert.equal(first.data.code, 'upload:first');
    assert.equal(second.data.code, 'upload:second');
  });
});

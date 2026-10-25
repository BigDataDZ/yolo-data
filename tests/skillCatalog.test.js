import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PlatformDatabase } from '../src/database.js';
import { SkillCatalog, missingCoreToolLabels } from '../src/skillCatalog.js';

function createDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metric-ask-catalog-'));
  return new PlatformDatabase(path.join(directory, 'test.db'));
}

function skillContent(name) {
  return [
    '---',
    `name: ${name}`,
    'description: 上传 Skill 的用途说明',
    '---',
    '',
    '## 工作流程',
    '1. 先确认口径',
    '2. 再执行分析',
  ].join('\n');
}

// REQUIRED_TOOLS 曾经与 skills 表严重脱节（9 个里只有 2 个有记录）。
// 这条断言守住「内核工具展示文案」不会重蹈覆辙。
test('core tool labels cover every required tool', () => {
  assert.deepEqual(missingCoreToolLabels(), []);
});

test('catalog lists core tools and public skills with usage', async () => {
  const database = createDatabase();
  const catalog = new SkillCatalog(database);
  const result = await catalog.list();
  assert.equal(result.core.length, 9);
  assert.ok(result.core.every((tool) => tool.name && tool.description));

  const theme = database.listThemes().find((item) => item.name === '经营总览');
  const search = result.skills.find((skill) => skill.code === 'indicator_search');
  assert.ok(search);
  assert.equal(search.source, 'BUILTIN');
  assert.equal(search.removable, false);
  assert.ok(search.usage >= 1, `期望有智能体引用，实际 ${search.usage}`);
  assert.ok(search.referencedBy.includes(theme.name));
});

test('disabling a public skill removes it from every theme', async () => {
  const database = createDatabase();
  const catalog = new SkillCatalog(database);
  await catalog.setStatus('trend_analysis', 0);
  assert.ok(
    !database.listSkills().some((skill) => skill.code === 'trend_analysis'),
    '停用后 listSkills 应过滤掉该 Skill',
  );
  assert.ok(
    (await catalog.list()).skills.some((skill) => skill.code === 'trend_analysis' && skill.status === 0),
    '管理目录仍应展示停用态',
  );
  await catalog.setStatus('trend_analysis', 1);
  assert.ok(database.listSkills().some((skill) => skill.code === 'trend_analysis'));
});

test('builtin skills can be disabled but not deleted', async () => {
  const database = createDatabase();
  const catalog = new SkillCatalog(database);
  await assert.rejects(
    catalog.remove('trend_analysis'),
    (error) => error.statusCode === 400,
  );
  assert.ok(database.getSkill('trend_analysis'));
});

test('external skills are removable and report their references', async () => {
  const database = createDatabase();
  const catalog = new SkillCatalog(database);
  const theme = database.listThemes()[0];
  await catalog.saveUpload({ content: skillContent('uploaded-method'), fileName: 'uploaded.md' });
  database.replaceThemeSkills(Number(theme.id), ['upload:uploaded-method']);

  const listed = (await catalog.list()).skills.find((skill) => skill.code === 'upload:uploaded-method');
  assert.equal(listed.removable, true);
  assert.equal(listed.usage, 1);

  const result = await catalog.remove('upload:uploaded-method');
  assert.equal(result.deleted, 1);
  assert.ok(result.referencedBy.includes(theme.name));
  assert.equal(database.getSkill('upload:uploaded-method'), null);
});

test('uploaded skills survive an external SKILL_MD sync', async () => {
  const database = createDatabase();
  const catalog = new SkillCatalog(database);
  await catalog.saveUpload({ content: skillContent('kept-method'), fileName: 'kept.md' });
  assert.ok(database.getSkill('upload:kept-method'));

  // 管理员点「同步外部 Skill」时若目录里扫不到任何东西，
  // syncExternalSkills 会按 source='SKILL_MD' 做差量删除。
  // 上传的 Skill 必须因为独立 source 而躲过这次清理。
  await database.syncExternalSkills([]);
  assert.ok(
    database.getSkill('upload:kept-method'),
    '上传的 Skill 不能被 SKILL_MD 差量删除误删',
  );
});

test('uploading the same skill twice updates instead of duplicating', async () => {
  const database = createDatabase();
  const catalog = new SkillCatalog(database);
  const first = await catalog.saveUpload({ content: skillContent('repeat-method') });
  const second = await catalog.saveUpload({
    content: `${skillContent('repeat-method')}\n3. 补一段新步骤`,
  });
  assert.equal(first.code, second.code);
  const rows = (await catalog.list()).skills.filter((skill) => skill.code === second.code);
  assert.equal(rows.length, 1);
  assert.match(database.getSkill(second.code).content, /补一段新步骤/);
});

test('upload rejects empty content and oversized documents', async () => {
  const database = createDatabase();
  const catalog = new SkillCatalog(database);
  await assert.rejects(catalog.saveUpload({ content: '  ' }), (error) => error.statusCode === 400);
  await assert.rejects(
    catalog.saveUpload({ content: `---\nname: big\n---\n${'x'.repeat(201 * 1024)}` }),
    (error) => error.statusCode === 400,
  );
});

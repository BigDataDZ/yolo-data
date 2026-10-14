import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSkillUpload, MAX_SKILL_UPLOAD_BYTES } from '../src/skillUpload.js';

test('Skill upload size boundary counts UTF-8 bytes and accepts exactly 200KiB', () => {
  const content = 'x'.repeat(MAX_SKILL_UPLOAD_BYTES);
  assert.equal(parseSkillUpload({ content, fileName: 'boundary.md' }).content.length, MAX_SKILL_UPLOAD_BYTES);
  assert.throws(() => parseSkillUpload({ content: `${content}x`, fileName: 'boundary.md' }), /200KB/);
  assert.throws(() => parseSkillUpload({ content: '中'.repeat(70 * 1024), fileName: 'wide.md' }), /200KB/);
});

test('Skill upload handles BOM/CRLF and normalizes explicit phases', () => {
  const parsed = parseSkillUpload({ fileName: 'SKILL.MD', content: '\uFEFF---\r\nname: bom-skill\r\nphases: [pre_plan, plan, post_execute]\r\n---\r\n## Workflow\r\n按照口径分析并核验结果。' });
  assert.equal(parsed.name, 'bom-skill');
  assert.deepEqual(parsed.phaseTags, ['PRE_PLAN', 'PLAN', 'POST_EXECUTE']);
  assert.match(parsed.content, /按照口径/);
  assert.throws(() => parseSkillUpload({ content: '---\nname: bad-phase\nphases: [UNKNOWN]\n---\nbody' }), /phases/);
});

test('Skill fallback identity strips directory components and uses the file basename', () => {
  const parsed = parseSkillUpload({ fileName: '../../safe-name.markdown', content: '# Workflow\n步骤' });
  assert.equal(parsed.code, 'external:safe-name');
  assert.equal(parsed.name, 'safe-name');
  for (const content of ['---\nname: {}\n---\nbody', '---\nname: valid\ndescription: []\n---\nbody', '---\nname: valid\ncode: []\n---\nbody']) {
    assert.throws(() => parseSkillUpload({ content }), /必须为文本/);
  }
});

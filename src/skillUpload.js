import crypto from 'node:crypto';
import path from 'node:path';
import { parseSkillDocument } from './skillAdapter.js';
import { MAX_SKILL_UPLOAD_BYTES, SKILL_FILE_EXTENSION } from '../public/skillUploadPolicy.js';

export { MAX_SKILL_UPLOAD_BYTES } from '../public/skillUploadPolicy.js';
const PHASES = new Set(['PRE_PLAN', 'PLAN', 'POST_EXECUTE']);
function fail(message) { return Object.assign(new Error(message), { statusCode: 400 }); }

export function skillCatalogPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Skill 请求必须为 JSON 对象');
  return value;
}

export function normalizeSkillCode(value) {
  if (typeof value !== 'string' || !value.trim()) throw fail('skill code must be a nonempty string');
  return value.trim();
}

export function normalizeSkillStatus(value) {
  if (![0, 1, '0', '1'].includes(value)) throw fail('Skill 状态必须为 0（停用）或 1（启用）');
  return Number(value);
}

// Uploads are text documents, never executable files. Keep scanner fallback
// behavior in skillAdapter unchanged; an upload's basename supplies its identity.
export function parseSkillUpload({ content, fileName } = {}) {
  if (typeof content !== 'string') throw fail('SKILL.md 内容必须为文本字符串');
  if (!content.trim()) throw fail('SKILL.md 内容不能为空');
  if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_UPLOAD_BYTES) throw fail('SKILL.md 超过 200KB 上限');
  if (fileName !== undefined && typeof fileName !== 'string') throw fail('Skill 文件名必须为字符串');
  const filename = path.posix.basename((fileName ?? '').replaceAll('\\', '/').trim());
  if (filename && !SKILL_FILE_EXTENSION.test(filename)) throw fail('Skill 上传仅支持 .md / .markdown 文件');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content)) throw fail('SKILL.md 包含非文本控制字符');
  const source = content.replace(/^\uFEFF/, '');
  if (/^---\r?\n/.test(source) && !/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(source)) {
    throw fail('Skill frontmatter 缺少结束的 ---');
  }
  const header = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? '';
  if (/^(?:name|description|code):\s*[\[{]/m.test(header)) throw fail('Skill name、description、code 必须为文本字符串');
  const fallback = filename.replace(SKILL_FILE_EXTENSION, '') || 'unnamed-skill';
  const parsed = parseSkillDocument(source, path.join(fallback, 'SKILL.md'));
  for (const key of ['name', 'description', 'code']) {
    if (Object.hasOwn(parsed.metadata, key) && typeof parsed.metadata[key] !== 'string') {
      throw fail(`Skill ${key} 必须为文本字符串`);
    }
  }
  if (!parsed.content.trim()) throw fail('Skill 正文不能为空');
  const phaseTags = [...new Set(parsed.phaseTags.map((phase) => String(phase).trim().toUpperCase()))];
  if (phaseTags.some((phase) => !PHASES.has(phase))) throw fail('Skill phases 仅支持 PRE_PLAN、PLAN、POST_EXECUTE');
  return { ...parsed, phaseTags, contentHash: crypto.createHash('sha256').update(source).digest('hex') };
}

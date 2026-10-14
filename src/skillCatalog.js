import { normalizeSkillCode, normalizeSkillStatus, parseSkillUpload } from './skillUpload.js';
import { REQUIRED_TOOLS } from './skills.js';

// 平台内核工具不进 skills 表：它们由 filterTools() 无条件兜底，没有可开关的载体，
// 因此页面只做说明、不提供任何操作。文案必须与 skills.js 的 REQUIRED_TOOLS 对齐，
// 由 tests 断言守护，避免再次出现「代码声明与数据脱节」。
const CORE_TOOL_LABELS = {
  search_indicators: ['指标检索', '按业务问题检索当前主题下的可用指标'],
  get_indicator: ['指标口径', '读取指标业务口径、业务名和可用维度'],
  compile_query_contract: ['查询契约编译', '把业务问题编译成受控查询契约'],
  execute_query_contract: ['查询契约执行', '执行查询契约并取回结果集'],
  list_workspace_artifacts: ['工作区产物列表', '列出本次会话已生成的产物'],
  transform_workspace_artifact: ['工作区产物加工', '对已有产物做二次变换'],
  execute_analysis_code: ['分析代码执行', '在沙箱内执行大模型生成的分析代码'],
  search_user_memory: ['用户记忆检索', '检索沉淀的长期记忆'],
  request_clarification: ['追问澄清', '信息不足时向用户发起追问'],
};

// 上传的 Skill 必须用独立 source：syncExternalSkills() 会按 source='SKILL_MD' 做差量删除，
// 复用该值会让上传内容在管理员下次点「同步外部 Skill」时被静默清空。
const UPLOAD_SOURCE = 'UPLOAD';
const UPLOAD_PREFIX = 'upload:';
const REMOVABLE_SOURCES = new Set(['SKILL_MD', UPLOAD_SOURCE]);

export function missingCoreToolLabels() {
  return REQUIRED_TOOLS.filter((toolName) => !CORE_TOOL_LABELS[toolName]);
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(String(text ?? '')) ?? fallback;
  } catch {
    return fallback;
  }
}

function fail(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

// 公共 Skill 目录治理：与「某个智能体勾选了哪些 Skill」解耦，只管平台级资产本身。
// 与 auth.js 一样直接持有 database 并操作 database.db，不往 database.js 里继续堆方法。
export class SkillCatalog {
  constructor(database) {
    this.database = database;
  }

  list() {
    const usageRows = this.database.db.prepare(`
      SELECT skill_code AS code, COUNT(*) AS count
      FROM theme_skills
      GROUP BY skill_code
    `).all();
    const usage = new Map(usageRows.map((row) => [row.code, row.count]));

    const referenceRows = this.database.db.prepare(`
      SELECT ts.skill_code AS code, t.name AS themeName
      FROM theme_skills ts
      JOIN themes t ON t.id = ts.theme_id
      ORDER BY t.name
    `).all();
    const referencedBy = new Map();
    for (const row of referenceRows) {
      const names = referencedBy.get(row.code) ?? [];
      names.push(row.themeName);
      referencedBy.set(row.code, names);
    }

    const skills = this.database.db.prepare(`
      SELECT code, name, description, category, kind, tool_name AS toolName,
             instruction, status, source, source_path AS sourcePath,
             metadata_json AS metadataJson, phase_tags_json AS phaseTagsJson
      FROM skills
      ORDER BY source, category, code
    `).all().map((row) => {
      const source = row.source || 'BUILTIN';
      return {
        code: row.code,
        name: row.name,
        description: row.description,
        category: row.category,
        kind: row.kind,
        toolName: row.toolName,
        status: Number(row.status ?? 1),
        source,
        sourcePath: row.sourcePath,
        phaseTags: parseJson(row.phaseTagsJson, []),
        metadata: parseJson(row.metadataJson, {}),
        usage: usage.get(row.code) ?? 0,
        referencedBy: referencedBy.get(row.code) ?? [],
        removable: REMOVABLE_SOURCES.has(source),
      };
    });

    return {
      core: REQUIRED_TOOLS.map((toolName) => ({
        toolName,
        name: CORE_TOOL_LABELS[toolName]?.[0] ?? toolName,
        description: CORE_TOOL_LABELS[toolName]?.[1] ?? '',
      })),
      skills,
    };
  }

  setStatus(code, status) {
    const target = normalizeSkillCode(code);
    const row = this.database.db.prepare(
      'SELECT code FROM skills WHERE code = ?',
    ).get(target);
    if (!row) {
      throw fail('skill not found', 404);
    }
    const next = normalizeSkillStatus(status);
    this.database.db.prepare(
      'UPDATE skills SET status = ?, updated_at = ? WHERE code = ?',
    ).run(next, new Date().toISOString(), target);
    return { code: target, status: next };
  }

  remove(code) {
    const target = normalizeSkillCode(code);
    const row = this.database.db.prepare(
      'SELECT code, source FROM skills WHERE code = ?',
    ).get(target);
    if (!row) {
      throw fail('skill not found', 404);
    }
    const source = row.source || 'BUILTIN';
    if (!REMOVABLE_SOURCES.has(source)) {
      throw fail('内置 Skill 不支持删除，只能停用', 400);
    }
    const referencedBy = this.database.db.prepare(`
      SELECT t.name AS themeName
      FROM theme_skills ts
      JOIN themes t ON t.id = ts.theme_id
      WHERE ts.skill_code = ?
      ORDER BY t.name
    `).all(target).map((item) => item.themeName);
    // theme_skills 声明了 ON DELETE CASCADE，引用行会随之清理。
    this.database.db.prepare('DELETE FROM skills WHERE code = ?').run(target);
    return { code: target, deleted: 1, referencedBy };
  }

  saveUpload({ content, fileName } = {}) {
    const parsed = parseSkillUpload({ content, fileName });
    const slug = String(parsed.code).replace(/^external:/, '') || 'unnamed-skill';
    const code = `${UPLOAD_PREFIX}${slug}`;
    const existing = this.database.db.prepare(
      'SELECT code, source FROM skills WHERE code = ?',
    ).get(code);
    if (existing && (existing.source || 'BUILTIN') !== UPLOAD_SOURCE) {
      throw fail(
        `已存在同名 Skill（来源 ${existing.source || 'BUILTIN'}），请改名或先删除原条目`,
        400,
      );
    }
    const timestamp = new Date().toISOString();
    const contentHash = parsed.contentHash;
    this.database.db.prepare(`
      INSERT INTO skills
        (code, name, description, category, kind, tool_name, instruction,
         default_enabled, status, source, source_path, metadata_json,
         phase_tags_json, content, content_hash, created_at, updated_at)
      VALUES (?, ?, ?, 'EXTERNAL', 'INSTRUCTION', NULL, ?, 0, 1, ?, NULL, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        instruction = excluded.instruction,
        metadata_json = excluded.metadata_json,
        phase_tags_json = excluded.phase_tags_json,
        content = excluded.content,
        content_hash = excluded.content_hash,
        updated_at = excluded.updated_at
    `).run(
      code,
      parsed.name,
      parsed.description,
      parsed.instruction,
      UPLOAD_SOURCE,
      JSON.stringify(parsed.metadata ?? {}),
      JSON.stringify(parsed.phaseTags ?? []),
      parsed.content,
      contentHash,
      timestamp,
      timestamp,
    );
    return {
      code,
      name: parsed.name,
      description: parsed.description,
      phaseTags: parsed.phaseTags ?? [],
      source: UPLOAD_SOURCE,
    };
  }
}

export { CORE_TOOL_LABELS, REMOVABLE_SOURCES, UPLOAD_SOURCE };

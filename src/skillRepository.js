function nowIso() {
  return new Date().toISOString();
}

function asJson(value) {
  return JSON.stringify(value ?? []);
}

export class SkillRepository {
  constructor(db) {
    this.db = db;
  }

  syncExternalSkills(skills = []) {
    const timestamp = nowIso();
    const normalized = (skills ?? []).map((skill) => ({
      code: String(skill.code ?? '').trim(),
      name: String(skill.name ?? '').trim(),
      description: String(skill.description ?? '').trim(),
      instruction: String(skill.instruction ?? '').trim(),
      sourcePath: skill.sourcePath ? String(skill.sourcePath) : null,
      metadataJson: asJson(skill.metadata ?? {}),
      phaseTagsJson: asJson(skill.phaseTags ?? []),
      content: String(skill.content ?? ''),
      contentHash: String(skill.contentHash ?? ''),
      category: String(skill.category ?? 'EXTERNAL').trim().toUpperCase(),
      kind: String(skill.kind ?? 'INSTRUCTION').trim().toUpperCase(),
      toolName: skill.toolName ? String(skill.toolName).trim() : null,
    })).filter((skill) => skill.code && skill.name);

    this.db.exec('BEGIN');
    try {
      const upsert = this.db.prepare(`
        INSERT INTO skills
          (code, name, description, category, kind, tool_name, instruction,
           default_enabled, status, source, source_path, metadata_json,
           phase_tags_json, content, content_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1,
                'SKILL_MD', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(code) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          category = excluded.category,
          kind = excluded.kind,
          tool_name = excluded.tool_name,
          instruction = excluded.instruction,
          source = excluded.source,
          source_path = excluded.source_path,
          metadata_json = excluded.metadata_json,
          phase_tags_json = excluded.phase_tags_json,
          content = excluded.content,
          content_hash = excluded.content_hash,
          status = 1,
          updated_at = excluded.updated_at
        WHERE skills.source = 'SKILL_MD'
      `);
      for (const skill of normalized) {
        upsert.run(
          skill.code,
          skill.name,
          skill.description,
          skill.category,
          skill.kind,
          skill.toolName,
          skill.instruction,
          skill.sourcePath,
          skill.metadataJson,
          skill.phaseTagsJson,
          skill.content,
          skill.contentHash,
          timestamp,
          timestamp,
        );
      }
      const codes = normalized.map((skill) => skill.code);
      if (codes.length === 0) {
        this.db.prepare("DELETE FROM skills WHERE source = 'SKILL_MD'").run();
      } else {
        const placeholders = codes.map(() => '?').join(', ');
        this.db.prepare(`
          DELETE FROM skills
          WHERE source = 'SKILL_MD' AND code NOT IN (${placeholders})
        `).run(...codes);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return normalized.length;
  }
}

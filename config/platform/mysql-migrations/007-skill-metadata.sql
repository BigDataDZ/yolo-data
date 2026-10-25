-- Skill metadata and phase declarations may exceed short string limits.
-- STATEMENT
ALTER TABLE skills MODIFY COLUMN metadata_json LONGTEXT NOT NULL;
-- STATEMENT
ALTER TABLE skills MODIFY COLUMN phase_tags_json LONGTEXT NOT NULL;

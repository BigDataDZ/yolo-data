-- Create long-term user memory tables for existing MySQL installations.
-- STATEMENT
CREATE TABLE IF NOT EXISTS user_memory_documents (id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id BIGINT NOT NULL, theme_id BIGINT, scope_key VARCHAR(255) NOT NULL, scope_label VARCHAR(255) NOT NULL DEFAULT '', summary LONGTEXT NOT NULL, content LONGTEXT NOT NULL, version BIGINT NOT NULL DEFAULT 0, status BIGINT NOT NULL DEFAULT 1, summary_budget BIGINT NOT NULL DEFAULT 1200, content_budget BIGINT NOT NULL DEFAULT 8000, last_consolidated_at VARCHAR(255), injected_count BIGINT NOT NULL DEFAULT 0, last_injected_at VARCHAR(255), created_at VARCHAR(255) NOT NULL, updated_at VARCHAR(255) NOT NULL, UNIQUE (user_id, scope_key)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- STATEMENT
CREATE TABLE IF NOT EXISTS user_memory_notes (id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id BIGINT NOT NULL, theme_id BIGINT, scope_key VARCHAR(255) NOT NULL, kind VARCHAR(64) NOT NULL DEFAULT 'BUSINESS_KNOWLEDGE', source VARCHAR(64) NOT NULL DEFAULT 'DISTILLED', state VARCHAR(64) NOT NULL DEFAULT 'PENDING', content LONGTEXT NOT NULL, dedupe_key VARCHAR(128) NOT NULL, session_id BIGINT, merged_version BIGINT, created_at VARCHAR(255) NOT NULL, updated_at VARCHAR(255) NOT NULL, UNIQUE (user_id, scope_key, dedupe_key)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- STATEMENT
CREATE TABLE IF NOT EXISTS user_memory_versions (id BIGINT AUTO_INCREMENT PRIMARY KEY, document_id BIGINT NOT NULL, version BIGINT NOT NULL, summary LONGTEXT NOT NULL, content LONGTEXT NOT NULL, note_count BIGINT NOT NULL DEFAULT 0, change_reason VARCHAR(255) NOT NULL DEFAULT '', created_at VARCHAR(255) NOT NULL, UNIQUE (document_id, version)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- STATEMENT
CREATE INDEX idx_user_memory_documents_user ON user_memory_documents(user_id, status, updated_at);
-- STATEMENT
CREATE INDEX idx_user_memory_notes_scope ON user_memory_notes(user_id, scope_key, state, id);
-- STATEMENT
CREATE INDEX idx_user_memory_versions_doc ON user_memory_versions(document_id, version);

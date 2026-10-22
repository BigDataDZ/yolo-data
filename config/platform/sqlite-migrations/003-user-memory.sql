-- Create long-term user memory tables for existing SQLite installations.
-- STATEMENT
CREATE TABLE IF NOT EXISTS user_memory_documents (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, theme_id INTEGER, scope_key TEXT NOT NULL, scope_label TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0, status INTEGER NOT NULL DEFAULT 1, summary_budget INTEGER NOT NULL DEFAULT 1200, content_budget INTEGER NOT NULL DEFAULT 8000, last_consolidated_at TEXT, injected_count INTEGER NOT NULL DEFAULT 0, last_injected_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (user_id, scope_key));
-- STATEMENT
CREATE TABLE IF NOT EXISTS user_memory_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, theme_id INTEGER, scope_key TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'BUSINESS_KNOWLEDGE', source TEXT NOT NULL DEFAULT 'DISTILLED', state TEXT NOT NULL DEFAULT 'PENDING', content TEXT NOT NULL, dedupe_key TEXT NOT NULL, session_id INTEGER, merged_version INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (user_id, scope_key, dedupe_key));
-- STATEMENT
CREATE TABLE IF NOT EXISTS user_memory_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, version INTEGER NOT NULL, summary TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', note_count INTEGER NOT NULL DEFAULT 0, change_reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, UNIQUE (document_id, version));
-- STATEMENT
CREATE INDEX IF NOT EXISTS idx_user_memory_documents_user ON user_memory_documents(user_id, status, updated_at DESC);
-- STATEMENT
CREATE INDEX IF NOT EXISTS idx_user_memory_notes_scope ON user_memory_notes(user_id, scope_key, state, id DESC);
-- STATEMENT
CREATE INDEX IF NOT EXISTS idx_user_memory_versions_doc ON user_memory_versions(document_id, version DESC);

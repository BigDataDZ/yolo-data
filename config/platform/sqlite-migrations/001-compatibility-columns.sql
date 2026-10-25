-- Schema compatibility migration for databases created by earlier releases.
-- Statements are applied individually; existing columns are skipped by the runner.
-- STATEMENT
ALTER TABLE app_users ADD COLUMN password_hash TEXT;
-- STATEMENT
ALTER TABLE themes ADD COLUMN llm_config_json TEXT NOT NULL DEFAULT '{}';
-- STATEMENT
ALTER TABLE themes ADD COLUMN dataset_ids_json TEXT NOT NULL DEFAULT '[]';
-- STATEMENT
ALTER TABLE themes ADD COLUMN business_dataset_ids_json TEXT NOT NULL DEFAULT '[]';
-- STATEMENT
ALTER TABLE themes ADD COLUMN primary_business_dataset_id INTEGER;
-- STATEMENT
ALTER TABLE themes ADD COLUMN semantic_value_config_json TEXT NOT NULL DEFAULT '{}';
-- STATEMENT
ALTER TABLE themes ADD COLUMN semantic_policy_json TEXT NOT NULL DEFAULT '{}';
-- STATEMENT
ALTER TABLE themes ADD COLUMN examples_json TEXT NOT NULL DEFAULT '[]';
-- STATEMENT
ALTER TABLE themes ADD COLUMN model_ids_json TEXT NOT NULL DEFAULT '[]';
-- STATEMENT
ALTER TABLE themes ADD COLUMN default_model_id INTEGER;
-- STATEMENT
ALTER TABLE chat_sessions ADD COLUMN model_id INTEGER;
-- STATEMENT
ALTER TABLE query_plans ADD COLUMN source_type TEXT NOT NULL DEFAULT 'INDICATOR';
-- STATEMENT
ALTER TABLE query_plans ADD COLUMN dataset_id TEXT;
-- STATEMENT
ALTER TABLE query_plans ADD COLUMN compiler_version TEXT;
-- STATEMENT
ALTER TABLE query_plans ADD COLUMN trace_id TEXT;
-- STATEMENT
ALTER TABLE audit_logs ADD COLUMN trace_id TEXT;
-- STATEMENT
ALTER TABLE llm_call_logs ADD COLUMN trace_id TEXT;
-- STATEMENT
ALTER TABLE dataset_query_logs ADD COLUMN trace_id TEXT;
-- STATEMENT
ALTER TABLE skills ADD COLUMN source TEXT NOT NULL DEFAULT 'BUILTIN';
-- STATEMENT
ALTER TABLE skills ADD COLUMN source_path TEXT;
-- STATEMENT
ALTER TABLE skills ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
-- STATEMENT
ALTER TABLE skills ADD COLUMN phase_tags_json TEXT NOT NULL DEFAULT '[]';
-- STATEMENT
ALTER TABLE skills ADD COLUMN content TEXT NOT NULL DEFAULT '';
-- STATEMENT
ALTER TABLE skills ADD COLUMN content_hash TEXT;
-- STATEMENT
CREATE INDEX IF NOT EXISTS idx_query_plans_trace ON query_plans(trace_id);
-- STATEMENT
CREATE INDEX IF NOT EXISTS idx_llm_logs_trace ON llm_call_logs(trace_id);
-- STATEMENT
CREATE INDEX IF NOT EXISTS idx_audit_logs_trace ON audit_logs(trace_id);
-- STATEMENT
CREATE INDEX IF NOT EXISTS idx_dataset_query_logs_trace ON dataset_query_logs(trace_id);
-- STATEMENT
CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);
-- STATEMENT
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
-- STATEMENT
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

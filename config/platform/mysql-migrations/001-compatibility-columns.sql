-- Schema compatibility migration for older MySQL platform databases.
-- STATEMENT
ALTER TABLE app_users ADD COLUMN password_hash VARCHAR(255) NULL;
-- STATEMENT
ALTER TABLE themes ADD COLUMN llm_config_json LONGTEXT NULL;
-- STATEMENT
ALTER TABLE themes ADD COLUMN dataset_ids_json LONGTEXT NULL;
-- STATEMENT
ALTER TABLE themes ADD COLUMN business_dataset_ids_json LONGTEXT NULL;
-- STATEMENT
ALTER TABLE themes ADD COLUMN primary_business_dataset_id BIGINT NULL;
-- STATEMENT
ALTER TABLE themes ADD COLUMN semantic_value_config_json LONGTEXT NULL;
-- STATEMENT
ALTER TABLE themes ADD COLUMN semantic_policy_json LONGTEXT NULL;
-- STATEMENT
ALTER TABLE themes ADD COLUMN examples_json LONGTEXT NULL;
-- STATEMENT
ALTER TABLE themes ADD COLUMN model_ids_json LONGTEXT NULL;
-- STATEMENT
ALTER TABLE themes ADD COLUMN default_model_id BIGINT NULL;
-- STATEMENT
ALTER TABLE chat_sessions ADD COLUMN model_id BIGINT NULL;
-- STATEMENT
ALTER TABLE query_plans ADD COLUMN source_type VARCHAR(32) NOT NULL DEFAULT 'INDICATOR';
-- STATEMENT
ALTER TABLE query_plans ADD COLUMN dataset_id VARCHAR(255) NULL;
-- STATEMENT
ALTER TABLE query_plans ADD COLUMN compiler_version VARCHAR(255) NULL;
-- STATEMENT
ALTER TABLE query_plans ADD COLUMN trace_id VARCHAR(255) NULL;
-- STATEMENT
ALTER TABLE audit_logs ADD COLUMN trace_id VARCHAR(255) NULL;
-- STATEMENT
ALTER TABLE llm_call_logs ADD COLUMN trace_id VARCHAR(255) NULL;
-- STATEMENT
ALTER TABLE dataset_query_logs ADD COLUMN trace_id VARCHAR(255) NULL;
-- STATEMENT
ALTER TABLE skills ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT 'BUILTIN';
-- STATEMENT
ALTER TABLE skills ADD COLUMN source_path VARCHAR(1024) NULL;
-- STATEMENT
ALTER TABLE skills ADD COLUMN metadata_json LONGTEXT NULL;
-- STATEMENT
ALTER TABLE skills ADD COLUMN phase_tags_json LONGTEXT NULL;
-- STATEMENT
ALTER TABLE skills ADD COLUMN content LONGTEXT NULL;
-- STATEMENT
ALTER TABLE skills ADD COLUMN content_hash VARCHAR(255) NULL;
-- STATEMENT
CREATE INDEX idx_query_plans_trace ON query_plans(trace_id);
-- STATEMENT
CREATE INDEX idx_llm_logs_trace ON llm_call_logs(trace_id);
-- STATEMENT
CREATE INDEX idx_audit_logs_trace ON audit_logs(trace_id);
-- STATEMENT
CREATE INDEX idx_dataset_query_logs_trace ON dataset_query_logs(trace_id);
-- STATEMENT
CREATE TABLE IF NOT EXISTS user_sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL,
  created_at VARCHAR(255) NOT NULL,
  last_seen_at VARCHAR(255) NOT NULL,
  expires_at VARCHAR(255) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);
-- STATEMENT
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
-- STATEMENT
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);

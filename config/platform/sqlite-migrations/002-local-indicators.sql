-- Create the local indicator catalog for existing SQLite installations.
-- STATEMENT
CREATE TABLE IF NOT EXISTS local_indicators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  biz_name TEXT NOT NULL,
  type_id TEXT NOT NULL DEFAULT '',
  type_name TEXT NOT NULL DEFAULT '通用指标',
  indicator_level TEXT NOT NULL DEFAULT 'ATOMIC',
  business_caliber TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL DEFAULT 1,
  metrics_json TEXT NOT NULL DEFAULT '[]',
  dimensions_json TEXT NOT NULL DEFAULT '[]',
  models_json TEXT NOT NULL DEFAULT '[]',
  raw_json TEXT NOT NULL DEFAULT '{}',
  synced_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- STATEMENT
CREATE INDEX IF NOT EXISTS idx_local_indicators_name ON local_indicators(name);
-- STATEMENT
CREATE INDEX IF NOT EXISTS idx_local_indicators_type ON local_indicators(type_id);

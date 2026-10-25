-- Create the local indicator catalog for existing MySQL installations.
-- STATEMENT
CREATE TABLE IF NOT EXISTS local_indicators (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  biz_name VARCHAR(255) NOT NULL,
  type_id VARCHAR(255) NOT NULL DEFAULT '',
  type_name VARCHAR(255) NOT NULL DEFAULT '通用指标',
  indicator_level VARCHAR(255) NOT NULL DEFAULT 'ATOMIC',
  business_caliber LONGTEXT NOT NULL,
  description LONGTEXT NOT NULL,
  owner VARCHAR(255) NOT NULL DEFAULT '',
  department VARCHAR(255) NOT NULL DEFAULT '',
  status BIGINT NOT NULL DEFAULT 1,
  metrics_json LONGTEXT NOT NULL,
  dimensions_json LONGTEXT NOT NULL,
  models_json LONGTEXT NOT NULL,
  raw_json LONGTEXT NOT NULL,
  synced_at VARCHAR(255) NOT NULL,
  updated_at VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

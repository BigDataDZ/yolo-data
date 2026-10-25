-- Theme prompts and serialized semantic configuration are unbounded documents.
-- MySQL TEXT-family columns cannot keep defaults, so callers must provide values.
-- STATEMENT
ALTER TABLE themes MODIFY COLUMN description LONGTEXT NOT NULL;
-- STATEMENT
ALTER TABLE themes MODIFY COLUMN system_prompt LONGTEXT NOT NULL;
-- STATEMENT
ALTER TABLE themes MODIFY COLUMN indicator_ids_json LONGTEXT NOT NULL;
-- STATEMENT
ALTER TABLE themes MODIFY COLUMN allowed_dimensions_json LONGTEXT NOT NULL;
-- STATEMENT
ALTER TABLE themes MODIFY COLUMN llm_config_json LONGTEXT NOT NULL;
-- STATEMENT
ALTER TABLE themes MODIFY COLUMN dataset_ids_json LONGTEXT NOT NULL;
-- STATEMENT
ALTER TABLE themes MODIFY COLUMN business_dataset_ids_json LONGTEXT NOT NULL;
-- STATEMENT
ALTER TABLE themes MODIFY COLUMN semantic_value_config_json LONGTEXT NOT NULL;
-- STATEMENT
ALTER TABLE themes MODIFY COLUMN semantic_policy_json LONGTEXT NOT NULL;
-- STATEMENT
ALTER TABLE themes MODIFY COLUMN examples_json LONGTEXT NOT NULL;
-- STATEMENT
ALTER TABLE themes MODIFY COLUMN model_ids_json LONGTEXT NOT NULL;

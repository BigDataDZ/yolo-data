-- Platform settings contain serialized configuration that can exceed 255 characters.
-- STATEMENT
ALTER TABLE platform_settings MODIFY COLUMN value_json LONGTEXT NOT NULL;

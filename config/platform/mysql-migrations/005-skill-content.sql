-- Skill documents can be substantially larger than VARCHAR limits.
-- STATEMENT
ALTER TABLE skills MODIFY COLUMN content LONGTEXT NOT NULL;
-- STATEMENT
ALTER TABLE skills MODIFY COLUMN instruction LONGTEXT NOT NULL;
-- STATEMENT
ALTER TABLE skills MODIFY COLUMN description LONGTEXT NOT NULL;

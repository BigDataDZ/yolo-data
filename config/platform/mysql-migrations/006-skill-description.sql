-- External skill descriptions are not bounded to 255 characters.
-- STATEMENT
ALTER TABLE skills MODIFY COLUMN description LONGTEXT NOT NULL;

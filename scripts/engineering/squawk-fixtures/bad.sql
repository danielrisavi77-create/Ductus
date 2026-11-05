-- DAN-319 fixture, never applied: the migration lint step lints it on every run
-- and expects exit 1 naming adding-required-field.
-- migrate:up
SET LOCAL ROLE ductus_migrator;
ALTER TABLE fixture.note ADD COLUMN owner text NOT NULL;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
ALTER TABLE fixture.note DROP COLUMN owner;

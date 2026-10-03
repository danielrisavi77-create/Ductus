-- Runner check (P-4): pgTAP works and the migrations ran before the tests.
-- Every test file runs in one transaction and rolls back, so the pgTAP
-- extension never stays in the database.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(2);

SELECT has_table('public', 'schema_migrations', 'dbmate keeps its migration ledger');
SELECT ok(
  EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '20261003200000'),
  'baseline migration is applied'
);

SELECT * FROM finish();
ROLLBACK;

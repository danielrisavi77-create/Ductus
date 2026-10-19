-- DAN-228, step 1: the access log table (docs/PRODUCT.md 5, rule 17; contract
-- in the PR description). Ownership, forced RLS, no privilege for any other
-- role, append-only for the owner too, and the checks that keep a row to one
-- institution and to a reader who is not the owning student. Every person,
-- course and document below is invented (fixtures/institution.inc).
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';
SELECT no_plan();

INSERT INTO ref VALUES ('t0', '2026-10-19 12:05:00+00');
-- One row as text, with every column a placeholder or a literal.
CREATE FUNCTION pg_temp.row_sql(
  p_institution text, p_assignment text, p_owner text, p_reader text,
  p_role text DEFAULT 'teacher', p_surface text DEFAULT 'live_view', p_at text DEFAULT '{t0}',
  p_document text DEFAULT 'doc-a'
) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT format(
    $q$ INSERT INTO audit.access_log (institution_id, document_id, assignment_id, owner_id, reader_id, reader_role, surface, opened_at)
        VALUES (%s, %L, %s, %s, %s, %L, %L, %s::timestamptz) RETURNING 'written' $q$,
    p_institution, p_document, p_assignment, p_owner, p_reader, p_role, p_surface, p_at)
$$;
CREATE FUNCTION pg_temp.as_owner(p_sql text) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.ask_as('ductus_identity', 'anon', p_sql) $$;
CREATE FUNCTION pg_temp.rows() RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT count(*) FROM audit.access_log $$;

-- Catalogue: the schema, the owner, forced RLS and the only policy.
SELECT has_schema('audit');
SELECT bag_eq(
  $$ SELECT relname::text FROM pg_class WHERE relnamespace = 'audit'::regnamespace AND relkind IN ('r', 'p') $$,
  $$ VALUES ('access_log') $$, 'access_log is the only table of the audit schema');
SELECT row_eq(
  $$ SELECT relowner::regrole::text, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'audit.access_log'::regclass $$,
  ROW('ductus_identity'::text, true, true), 'the identity role owns access_log and RLS is enabled and forced');
SELECT bag_eq(
  $$ SELECT polname::text, polroles::regrole[]::text FROM pg_policy WHERE polrelid = 'audit.access_log'::regclass $$,
  $$ VALUES ('access_log_owner', '{ductus_identity}') $$, 'the only policy is the owner''s');
-- The columns are exactly these: no text of the work, no session, no address,
-- no device; one time, to the minute.
SELECT columns_are('audit', 'access_log', ARRAY[
  'id', 'institution_id', 'document_id', 'assignment_id', 'owner_id', 'reader_id', 'reader_role', 'surface', 'opened_at'
], 'access_log has exactly the listed columns');
SELECT bag_eq(
  $$ SELECT attname::text FROM pg_attribute
      WHERE attrelid = 'audit.access_log'::regclass AND attnum > 0 AND NOT attisdropped
        AND atttypid = 'timestamptz'::regtype $$,
  $$ VALUES ('opened_at') $$, 'opened_at is the only time column');

-- Nobody but the owner reaches the table or the schema.
SELECT is_empty(
  $$ SELECT a.grantee::regrole::text FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid = 'audit.access_log'::regclass AND a.grantee <> c.relowner $$,
  'no role but the owner has any privilege on access_log');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p
  CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence', 'ductus_migrator']) AS r
  WHERE has_table_privilege(r, 'audit.access_log', p)
), 'no other role reads, writes or empties access_log directly');
SELECT bag_eq(
  $$ SELECT rolname::text FROM pg_roles
      WHERE rolname LIKE 'ductus\_%' AND has_schema_privilege(rolname, 'audit', 'USAGE')
     UNION ALL SELECT 'public' WHERE has_schema_privilege('public', 'audit', 'USAGE') $$,
  $$ VALUES ('ductus_identity'), ('ductus_migrator') $$,
  'only the owner role (and the schema owner) may use the audit schema');
SELECT is_empty(
  $$ SELECT rolname::text FROM pg_roles
      WHERE rolname LIKE 'ductus\_%' AND rolname <> 'ductus_migrator' AND has_schema_privilege(rolname, 'audit', 'CREATE') $$,
  'no role but the schema owner creates in audit');
SELECT is_empty(
  $$ SELECT r || ' ' || p.oid::regprocedure::text FROM pg_proc p
      CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence']) AS r
      WHERE p.pronamespace = 'audit'::regnamespace AND has_function_privilege(r, p.oid, 'EXECUTE') $$,
  'no runtime role executes a function of the audit schema');

-- The web role, with any session, gets nothing and changes nothing.
SELECT is(pg_temp.ask('vesna', 'SELECT count(*) FROM audit.access_log'),
  '42501: permission denied for schema audit', 'the web role cannot read access_log');
SELECT is(pg_temp.ask('vesna', pg_temp.row_sql('{fak_a}', '{z1}', '{ana}', '{vesna}')),
  '42501: permission denied for schema audit', 'the web role cannot write access_log');
SELECT is(pg_temp.ask_as('ductus_worker', 'anon', 'SELECT count(*) FROM audit.access_log'),
  '42501: permission denied for schema audit', 'the worker cannot read access_log');
SELECT is(pg_temp.ask_as('ductus_retention', 'anon', 'DELETE FROM audit.access_log'),
  '42501: permission denied for schema audit', 'the retention role cannot delete from access_log');

-- The owner writes a valid row.
SELECT is(pg_temp.as_owner(pg_temp.row_sql('{fak_a}', '{z1}', '{ana}', '{vesna}')), 'written',
  'the owner writes a row: a teacher of the assignment opened Ana''s work');
SELECT is(pg_temp.as_owner(pg_temp.row_sql('{fak_a}', '{z1}', '{ana}', '{vesna}', p_surface => 'process_summary')),
  'written', 'the second surface is accepted');
SELECT is(pg_temp.rows(), 2::bigint, 'two rows are stored');

-- Append-only, for the owner too.
SELECT is(pg_temp.as_owner($$ UPDATE audit.access_log SET opened_at = opened_at + interval '1 minute' RETURNING 'changed' $$),
  'ZD403: append-only row', 'the owner cannot change a row');
SELECT is(pg_temp.as_owner($$ UPDATE audit.access_log SET reader_id = owner_id RETURNING 'changed' $$),
  'ZD403: append-only row', 'the owner cannot rewrite who opened the work');
SELECT is(pg_temp.as_owner($$ DELETE FROM audit.access_log RETURNING 'deleted' $$),
  'ZD403: append-only row', 'the owner cannot delete a row');
SELECT is(pg_temp.as_owner('TRUNCATE audit.access_log'),
  'ZD403: append-only row', 'the owner cannot empty the table');
SELECT is(pg_temp.rows(), 2::bigint, 'both rows are still there');

-- Checks: one institution per row, a reader who is not the owner, closed lists
-- and a time to the minute.
SELECT is(left(pg_temp.as_owner(pg_temp.row_sql('{fak_a}', '{z1}', '{ana}', '{ana}')), 6),
  '23514:', 'the owning student is never a reader of her own work');
SELECT is(left(pg_temp.as_owner(pg_temp.row_sql('{fak_a}', '{z1}', '{ana}', '{petra}')), 6),
  '23503:', 'a reader of another institution cannot be written');
SELECT is(left(pg_temp.as_owner(pg_temp.row_sql('{fak_a}', '{z1}', '{tomo}', '{vesna}')), 6),
  '23503:', 'an owner of another institution cannot be written');
SELECT is(left(pg_temp.as_owner(pg_temp.row_sql('{fak_a}', '{z3}', '{ana}', '{vesna}')), 6),
  '23503:', 'an assignment of another institution cannot be written');
SELECT is(left(pg_temp.as_owner(pg_temp.row_sql('{fak_a}', '{nobody}', '{ana}', '{vesna}')), 6),
  '23503:', 'an assignment that does not exist cannot be written');
SELECT is(left(pg_temp.as_owner(pg_temp.row_sql('{fak_a}', '{z1}', '{ana}', '{vesna}', p_role => 'student')), 6),
  '23514:', 'a reader role outside the list is refused');
SELECT is(left(pg_temp.as_owner(pg_temp.row_sql('{fak_a}', '{z1}', '{ana}', '{vesna}', p_surface => 'replay')), 6),
  '23514:', 'a surface outside the list is refused until a migration adds it');
SELECT is(left(pg_temp.as_owner(pg_temp.row_sql('{fak_a}', '{z1}', '{ana}', '{vesna}', p_at => quote_literal('2026-10-19 12:05:01+00'))), 6),
  '23514:', 'a time finer than the minute is refused');
SELECT is(left(pg_temp.as_owner(pg_temp.row_sql('{fak_a}', '{z1}', '{ana}', '{vesna}', p_document => '')), 6),
  '23514:', 'an empty document id is refused');
SELECT is(left(pg_temp.as_owner(pg_temp.row_sql('{fak_a}', '{z1}', '{ana}', '{vesna}', p_at => 'NULL')), 6),
  '23502:', 'a row without a time is refused');
SELECT is(pg_temp.rows(), 2::bigint, 'no refused row was stored');

-- Forced RLS is the protection, not only the missing grants: with USAGE and
-- every table privilege granted by mistake, the web role still sees no row,
-- writes no row and changes none.
GRANT USAGE ON SCHEMA audit TO ductus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON audit.access_log TO ductus_app;
SELECT is(pg_temp.ask('vesna', 'SELECT count(*) FROM audit.access_log'), '0',
  'with a mistaken grant the web role still reads no row');
SELECT is(left(pg_temp.ask('vesna', pg_temp.row_sql('{fak_a}', '{z1}', '{ana}', '{vesna}')), 6),
  '42501:', 'with a mistaken grant the web role still writes no row');
SELECT is(pg_temp.ask('vesna', $$ WITH d AS (DELETE FROM audit.access_log RETURNING 1) SELECT count(*) FROM d $$), '0',
  'with a mistaken grant the web role still deletes no row');
REVOKE SELECT, INSERT, UPDATE, DELETE ON audit.access_log FROM ductus_app;
REVOKE USAGE ON SCHEMA audit FROM ductus_app;
SELECT is(pg_temp.rows(), 2::bigint, 'the rows are unchanged');

SELECT * FROM finish();
ROLLBACK;

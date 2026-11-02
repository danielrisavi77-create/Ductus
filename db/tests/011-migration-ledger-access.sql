-- The dbmate ledger, public.schema_migrations, belongs to the migrator alone
-- (D-91 measure 6, docs/BACKEND.md 4.8 point 6): no application role, owner
-- role or login may read or write it. 010-roles-and-privileges.sql proves the
-- migrator owns it and that ductus_app cannot use the public schema; this
-- file covers every other role, first in the catalog and then by trying.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(54);

-- Every role but the migrator: each ductus_* role, and every role that is a
-- member of one, whatever its name, so a login added later is covered too.
CREATE TEMP VIEW ledger_role AS
  SELECT r.oid, r.rolname::text AS rolname
  FROM pg_roles r
  WHERE r.rolname <> 'ductus_migrator'
    AND (r.rolname LIKE 'ductus\_%'
         OR EXISTS (SELECT 1 FROM pg_auth_members m
                    WHERE m.member = r.oid AND pg_get_userbyid(m.roleid) LIKE 'ductus\_%'));
-- Rights reached directly, through a group, through PUBLIC or through a
-- predefined role such as pg_read_all_data all show here, because the
-- has_*_privilege functions resolve them.
CREATE TEMP VIEW ledger_access AS
  SELECT l.rolname || ': ' || p.privilege || ' on public.schema_migrations' AS found
  FROM ledger_role l
  CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege)
  WHERE has_table_privilege(l.oid, 'public.schema_migrations'::regclass, p.privilege)
  UNION ALL
  SELECT l.rolname || ': column ' || p.privilege || ' on public.schema_migrations'
  FROM ledger_role l
  CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) AS p(privilege)
  WHERE has_any_column_privilege(l.oid, 'public.schema_migrations'::regclass, p.privilege)
  UNION ALL
  SELECT l.rolname || ': ' || p.privilege || ' on schema public'
  FROM ledger_role l
  CROSS JOIN unnest(ARRAY['USAGE', 'CREATE']) AS p(privilege)
  WHERE has_schema_privilege(l.oid, 'public'::regnamespace, p.privilege);

SELECT ok(
  ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_evidence', 'ductus_identity', 'ductus_auth',
        'ductus_app_local', 'ductus_auth_local'] <@ ARRAY(SELECT rolname FROM ledger_role),
  'the check covers the six group roles and both local logins'
);
SELECT is_empty(
  'SELECT found FROM ledger_access',
  'no role but the migrator holds a right on the ledger or on the public schema'
);

-- Negative controls: each kind of right must be noticed. Each one is
-- granted, seen and taken back.
GRANT SELECT ON public.schema_migrations TO ductus_worker;
SELECT set_eq(
  'SELECT found FROM ledger_access',
  $$ VALUES ('ductus_worker: SELECT on public.schema_migrations'),
            ('ductus_worker: column SELECT on public.schema_migrations') $$,
  'SELECT granted to ductus_worker is noticed'
);
REVOKE SELECT ON public.schema_migrations FROM ductus_worker;
GRANT INSERT (version) ON public.schema_migrations TO ductus_retention;
SELECT set_eq(
  'SELECT found FROM ledger_access',
  $$ VALUES ('ductus_retention: column INSERT on public.schema_migrations') $$,
  'a column-level INSERT granted to ductus_retention is noticed'
);
REVOKE INSERT (version) ON public.schema_migrations FROM ductus_retention;
GRANT USAGE ON SCHEMA public TO ductus_auth;
SELECT set_eq(
  'SELECT found FROM ledger_access',
  $$ VALUES ('ductus_auth: USAGE on schema public'), ('ductus_auth_local: USAGE on schema public') $$,
  'USAGE on public granted to ductus_auth is noticed, also on the login that inherits it'
);
REVOKE USAGE ON SCHEMA public FROM ductus_auth;
GRANT DELETE ON public.schema_migrations TO PUBLIC;
SELECT set_eq(
  $$ SELECT split_part(found, ':', 1) FROM ledger_access $$,
  'SELECT rolname FROM ledger_role',
  'DELETE granted to PUBLIC is noticed on every role'
);
REVOKE DELETE ON public.schema_migrations FROM PUBLIC;
GRANT pg_read_all_data TO ductus_identity;
SELECT isnt_empty(
  $$ SELECT found FROM ledger_access WHERE found = 'ductus_identity: SELECT on public.schema_migrations' $$,
  'read access through pg_read_all_data is noticed'
);
REVOKE pg_read_all_data FROM ductus_identity;
CREATE ROLE test_ledger_login LOGIN;
GRANT ductus_worker TO test_ledger_login;
GRANT UPDATE ON public.schema_migrations TO test_ledger_login;
SELECT set_eq(
  'SELECT found FROM ledger_access',
  $$ VALUES ('test_ledger_login: UPDATE on public.schema_migrations'),
            ('test_ledger_login: column UPDATE on public.schema_migrations') $$,
  'a right on a login of another name that joins a ductus_* role is noticed'
);
REVOKE UPDATE ON public.schema_migrations FROM test_ledger_login;
DROP ROLE test_ledger_login;
SELECT is_empty(
  'SELECT found FROM ledger_access',
  'the ledger is clean again once the negative controls are taken back'
);

-- The same by trying. Inside this transaction only, every group role gets
-- USAGE on public so it can call pgTAP; the ledger still refuses it, which
-- shows the refusal comes from the table and not only from the schema.
GRANT USAGE ON SCHEMA public TO ductus_app, ductus_worker, ductus_retention, ductus_evidence, ductus_identity, ductus_auth;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ductus_app, ductus_worker, ductus_retention, ductus_evidence, ductus_identity, ductus_auth;
CREATE TEMP TABLE ledger_statement (what text PRIMARY KEY, statement text NOT NULL);
GRANT SELECT ON ledger_statement TO PUBLIC;
INSERT INTO ledger_statement VALUES
  ('SELECT', 'SELECT count(*) FROM public.schema_migrations'),
  ('INSERT', $$ INSERT INTO public.schema_migrations (version) VALUES ('99990101000000') $$),
  ('UPDATE', 'UPDATE public.schema_migrations SET version = version'),
  ('DELETE', 'DELETE FROM public.schema_migrations'),
  ('TRUNCATE', 'TRUNCATE public.schema_migrations');

SET LOCAL ROLE ductus_app;
SELECT throws_ok(statement, '42501', NULL, 'ductus_app: ' || what || ' on the ledger is denied') FROM ledger_statement;
RESET ROLE;
SET LOCAL ROLE ductus_worker;
SELECT throws_ok(statement, '42501', NULL, 'ductus_worker: ' || what || ' on the ledger is denied') FROM ledger_statement;
RESET ROLE;
SET LOCAL ROLE ductus_retention;
SELECT throws_ok(statement, '42501', NULL, 'ductus_retention: ' || what || ' on the ledger is denied') FROM ledger_statement;
RESET ROLE;
SET LOCAL ROLE ductus_evidence;
SELECT throws_ok(statement, '42501', NULL, 'ductus_evidence: ' || what || ' on the ledger is denied') FROM ledger_statement;
RESET ROLE;
SET LOCAL ROLE ductus_identity;
SELECT throws_ok(statement, '42501', NULL, 'ductus_identity: ' || what || ' on the ledger is denied') FROM ledger_statement;
RESET ROLE;
SET LOCAL ROLE ductus_auth;
SELECT throws_ok(statement, '42501', NULL, 'ductus_auth: ' || what || ' on the ledger is denied') FROM ledger_statement;
RESET ROLE;
SET LOCAL ROLE ductus_app_local;
SELECT throws_ok(statement, '42501', NULL, 'ductus_app_local: ' || what || ' on the ledger is denied') FROM ledger_statement;
RESET ROLE;
SET LOCAL ROLE ductus_auth_local;
SELECT throws_ok(statement, '42501', NULL, 'ductus_auth_local: ' || what || ' on the ledger is denied') FROM ledger_statement;
RESET ROLE;

-- Positive control: the same statements run for the migrator, so each
-- refusal above is about the role and not a broken statement. Everything is
-- rolled back with the transaction.
SET LOCAL ROLE ductus_migrator;
SELECT lives_ok(statement, 'ductus_migrator: ' || what || ' on the ledger runs') FROM ledger_statement;
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

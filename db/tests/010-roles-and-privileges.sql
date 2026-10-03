-- Roles and catalogue-wide guards (docs/BACKEND.md 3, rule 2). The generic
-- checks cover every future table and function, so a migration that forgets
-- RLS, search_path or the PUBLIC revoke fails here.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(14);

-- Group roles: none can log in or step around RLS.
SELECT bag_eq(
  $$ SELECT rolname::text FROM pg_roles WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin $$,
  ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_evidence', 'ductus_identity', 'ductus_auth'],
  'the six group roles exist'
);
SELECT is_empty(
  $$ SELECT rolname FROM pg_roles
     WHERE rolname IN ('ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_evidence', 'ductus_identity', 'ductus_auth')
       AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication) $$,
  'group roles are NOLOGIN, not superuser, without BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION'
);

-- ductus_app owns nothing and can create nothing.
SELECT is_empty(
  $$ SELECT relname FROM pg_class WHERE relowner = 'ductus_app'::regrole
     UNION ALL SELECT proname FROM pg_proc WHERE proowner = 'ductus_app'::regrole
     UNION ALL SELECT nspname FROM pg_namespace WHERE nspowner = 'ductus_app'::regrole $$,
  'ductus_app owns no table, function or schema'
);
SELECT is_empty(
  $$ SELECT nspname FROM pg_namespace
     WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema'
       AND has_schema_privilege('ductus_app', oid, 'CREATE') $$,
  'ductus_app has CREATE on no schema'
);
SELECT ok(
  NOT has_database_privilege('ductus_app', current_database(), 'CREATE')
    AND NOT has_database_privilege('ductus_app', current_database(), 'TEMPORARY'),
  'ductus_app cannot create schemas or temporary tables'
);
SELECT ok(
  NOT has_schema_privilege('ductus_app', 'public', 'USAGE'),
  'ductus_app cannot use the public schema'
);
SELECT ok(
  NOT has_database_privilege('ductus_evidence', current_database(), 'CONNECT')
    AND NOT has_database_privilege('ductus_identity', current_database(), 'CONNECT'),
  'owner roles cannot connect'
);

-- Every table outside the system and public schemas has forced RLS.
SELECT is_empty(
  $$ SELECT n.nspname || '.' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND n.nspname NOT LIKE 'pg\_%' AND n.nspname NOT IN ('information_schema', 'public')
       AND NOT (c.relrowsecurity AND c.relforcerowsecurity) $$,
  'every application table has ENABLE and FORCE ROW LEVEL SECURITY'
);
SELECT is_empty(
  $$ SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
       AND c.relname <> 'schema_migrations'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e') $$,
  'public holds only the dbmate ledger'
);
SELECT is_empty(
  $$ SELECT n.nspname || '.' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND n.nspname NOT LIKE 'pg\_%' AND n.nspname NOT IN ('information_schema', 'public')
       AND c.relowner NOT IN ('ductus_identity'::regrole, 'ductus_evidence'::regrole) $$,
  'application tables belong to a NOLOGIN owner role'
);

-- Functions: application schemas, extension members excluded.
CREATE TEMP VIEW app_function AS
  SELECT p.oid, n.nspname || '.' || p.proname AS name, p.prosecdef, p.proconfig, p.proacl, p.proowner
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname NOT IN ('information_schema', 'public')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');

SELECT is_empty(
  $$ SELECT name FROM app_function
     WHERE proacl IS NULL
        OR EXISTS (SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') $$,
  'no application function is executable by PUBLIC'
);
SELECT is_empty(
  $$ SELECT name FROM app_function
     WHERE NOT coalesce('search_path=""' = ANY (proconfig), false) $$,
  'every application function pins search_path to empty'
);
SELECT is_empty(
  $$ SELECT name FROM app_function
     WHERE prosecdef AND proowner NOT IN ('ductus_identity'::regrole, 'ductus_evidence'::regrole) $$,
  'SECURITY DEFINER functions belong to a NOLOGIN owner role'
);
SELECT is_empty(
  $$ SELECT name FROM app_function
     WHERE prosecdef AND has_function_privilege('ductus_worker', oid, 'EXECUTE')
       AND name IN ('app.current_actor', 'identity.close_current_session') $$,
  'ductus_worker gets no session functions'
);

SELECT * FROM finish();
ROLLBACK;

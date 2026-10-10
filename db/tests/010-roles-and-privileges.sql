-- Roles and catalogue-wide guards (docs/BACKEND.md 3, rule 2). The generic
-- checks cover every future table and function, so a migration that forgets
-- RLS, search_path or the PUBLIC revoke fails here.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(27);

-- Group roles: none can log in or step around RLS.
SELECT bag_eq(
  $$ SELECT rolname::text FROM pg_roles WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin $$,
  ARRAY['ductus_migrator', 'ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_evidence', 'ductus_identity', 'ductus_auth'],
  'the six group roles and the migrator exist, none with a login'
);
SELECT is_empty(
  $$ SELECT rolname FROM pg_roles
     WHERE rolname IN ('ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_evidence', 'ductus_identity', 'ductus_auth')
       AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication) $$,
  'group roles are NOLOGIN, not superuser, without BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION'
);

-- Logins come from the environment, never from a migration. The local stack
-- provisions exactly one (db/local/app-login.sql): the login of the web
-- process. It carries no attribute of its own; what it may do comes from its
-- single membership in ductus_app, listed further down.
SELECT bag_eq(
  $$ SELECT rolname::text FROM pg_roles WHERE rolname LIKE 'ductus\_%' AND rolcanlogin $$,
  ARRAY['ductus_app_local'],
  'the local application login is the only ductus_* role with a login'
);
SELECT is(
  (SELECT rolinherit AND NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
   FROM pg_roles WHERE rolname = 'ductus_app_local'),
  true,
  'ductus_app_local has no SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION'
);

-- The migrator is the only role with DDL, yet it is neither a superuser nor
-- above RLS. Owning the database, the ledger and every application schema
-- also proves that the migrations ran as this role and not as a superuser.
SELECT ok(
  (SELECT rolcreaterole AND NOT (rolsuper OR rolbypassrls OR rolreplication OR rolcreatedb)
   FROM pg_roles WHERE rolname = 'ductus_migrator'),
  'ductus_migrator has CREATEROLE but no SUPERUSER, BYPASSRLS, REPLICATION or CREATEDB'
);
SELECT is(
  (SELECT pg_get_userbyid(datdba)::text FROM pg_database WHERE datname = current_database()),
  'ductus_migrator',
  'ductus_migrator owns the database'
);
SELECT is_empty(
  $$ SELECT nspname::text FROM pg_namespace
     WHERE nspname NOT LIKE 'pg\_%' AND nspname NOT IN ('information_schema', 'public')
       AND nspowner <> 'ductus_migrator'::regrole
     UNION ALL
     SELECT 'public.schema_migrations' FROM pg_class
     WHERE oid = 'public.schema_migrations'::regclass AND relowner <> 'ductus_migrator'::regrole $$,
  'every application schema and the dbmate ledger belong to ductus_migrator'
);
SELECT is_empty(
  $$ SELECT pg_get_userbyid(roleid)::text FROM pg_auth_members
     WHERE member = 'ductus_migrator'::regrole AND inherit_option $$,
  'ductus_migrator inherits the privileges of no other role'
);
-- Privilege checks see only inherited rights, so a membership with SET alone
-- would let a role become an owner role unnoticed. Every membership that
-- involves a ductus_* role, as group or as member, is therefore listed with
-- its options: the migrator administers the roles it created and may SET ROLE
-- to the two owner roles; the local login inherits ductus_app and nothing
-- else. Any other row fails the comparison.
CREATE TEMP VIEW ductus_membership AS
  SELECT pg_get_userbyid(member) || ' in ' || pg_get_userbyid(roleid) || ':'
         || CASE WHEN admin_option THEN ' admin' ELSE '' END
         || CASE WHEN inherit_option THEN ' inherit' ELSE '' END
         || CASE WHEN set_option THEN ' set' ELSE '' END AS membership
  FROM pg_auth_members
  WHERE pg_get_userbyid(roleid) LIKE 'ductus\_%' OR pg_get_userbyid(member) LIKE 'ductus\_%';
CREATE TEMP VIEW allowed_membership AS
  SELECT unnest(ARRAY[
    'ductus_migrator in ductus_app: admin',
    'ductus_migrator in ductus_worker: admin',
    'ductus_migrator in ductus_retention: admin',
    'ductus_migrator in ductus_auth: admin',
    'ductus_migrator in ductus_evidence: admin',
    'ductus_migrator in ductus_identity: admin',
    'ductus_migrator in ductus_evidence: set',
    'ductus_migrator in ductus_identity: set',
    'ductus_app_local in ductus_app: inherit'
  ]) AS membership;

SELECT bag_eq(
  'SELECT membership FROM ductus_membership',
  'SELECT membership FROM allowed_membership',
  'the only memberships: the migrator as creator and with SET on the two owner roles, the local login in ductus_app'
);
-- Negative controls: the comparison above must notice a membership that is
-- not on the list. Each one is added, seen and taken back.
GRANT ductus_auth TO ductus_app_local;
SELECT bag_ne(
  'SELECT membership FROM ductus_membership',
  'SELECT membership FROM allowed_membership',
  'a second membership of the local login is noticed'
);
REVOKE ductus_auth FROM ductus_app_local;
GRANT ductus_app TO ductus_app_local WITH SET TRUE;
SELECT bag_ne(
  'SELECT membership FROM ductus_membership',
  'SELECT membership FROM allowed_membership',
  'SET on ductus_app for the local login is noticed'
);
GRANT ductus_app TO ductus_app_local WITH SET FALSE;
CREATE ROLE test_second_login LOGIN;
GRANT ductus_app TO test_second_login;
SELECT bag_ne(
  'SELECT membership FROM ductus_membership',
  'SELECT membership FROM allowed_membership',
  'another member of ductus_app is noticed, whatever its name'
);
DROP ROLE test_second_login;
SELECT bag_eq(
  'SELECT membership FROM ductus_membership',
  'SELECT membership FROM allowed_membership',
  'the memberships equal the allowed list again once the negative controls are taken back'
);
SELECT is_empty(
  $$ SELECT r.rolname || ' on ' || n.nspname FROM pg_roles r CROSS JOIN pg_namespace n
     WHERE r.rolname LIKE 'ductus\_%' AND r.rolname <> 'ductus_migrator'
       AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
       AND has_schema_privilege(r.rolname, n.oid, 'CREATE') $$,
  'no role but ductus_migrator has CREATE on a schema'
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
     WHERE proowner NOT IN ('ductus_migrator'::regrole, 'ductus_identity'::regrole, 'ductus_evidence'::regrole) $$,
  'application functions belong to the migrator or an owner role'
);
SELECT is_empty(
  $$ SELECT name FROM app_function
     WHERE prosecdef AND has_function_privilege('ductus_worker', oid, 'EXECUTE')
       AND name IN ('app.current_actor', 'identity.close_current_session') $$,
  'ductus_worker gets no session functions'
);

SELECT * FROM finish();
ROLLBACK;

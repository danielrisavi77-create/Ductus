-- Roles and catalogue-wide guards (docs/BACKEND.md 3, rule 2). The generic
-- checks cover every future table and function, so a migration that forgets
-- RLS, search_path or the PUBLIC revoke fails here.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(37);

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
-- provisions exactly two: the login of the web process
-- (db/local/app-login.sql) and the login of the login callback
-- (db/local/auth-login.sql). They carry no attribute of their own; what each
-- may do comes from its single membership, listed further down, and from
-- nothing granted or set on the login itself, checked after the ductus_app rows.
SELECT bag_eq(
  $$ SELECT rolname::text FROM pg_roles WHERE rolname LIKE 'ductus\_%' AND rolcanlogin $$,
  ARRAY['ductus_app_local', 'ductus_auth_local'],
  'the local application and login-callback logins are the only ductus_* roles with a login'
);
SELECT is_empty(
  $$ SELECT rolname::text FROM pg_roles
     WHERE rolname IN ('ductus_app_local', 'ductus_auth_local')
       AND NOT (rolinherit AND NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) $$,
  'ductus_app_local and ductus_auth_local have no SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION'
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
-- to the two owner roles; the web process login inherits ductus_app and the
-- login-callback login ductus_auth, each nothing else. Any other row fails
-- the comparison.
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
    'ductus_app_local in ductus_app: inherit',
    'ductus_auth_local in ductus_auth: inherit'
  ]) AS membership;

SELECT bag_eq(
  'SELECT membership FROM ductus_membership',
  'SELECT membership FROM allowed_membership',
  'the only memberships: the migrator as creator and with SET on the two owner roles, the local logins in ductus_app and ductus_auth'
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
-- The login callback never holds the rights of the web process.
GRANT ductus_app TO ductus_auth_local;
SELECT bag_ne(
  'SELECT membership FROM ductus_membership',
  'SELECT membership FROM allowed_membership',
  'ductus_app for the login-callback login is noticed'
);
REVOKE ductus_app FROM ductus_auth_local;
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

-- A login adds nothing to its group. The rows above look at ductus_app, so a
-- grant or a setting placed on the login itself would pass them. A login here
-- is every ductus_* role that can log in and every login that is a member of
-- a ductus_* role, so the rows below follow the membership list, not a name.
-- Each login is held to its group: ductus_auth for a login whose only
-- ductus_* membership is ductus_auth (the login callback), ductus_app for
-- every other, including one with no membership at all.
CREATE TEMP VIEW ductus_login AS
  SELECT r.oid, r.rolname::text AS login,
         CASE WHEN ARRAY(SELECT DISTINCT pg_get_userbyid(m.roleid)::text FROM pg_auth_members m
                         WHERE m.member = r.oid AND pg_get_userbyid(m.roleid) LIKE 'ductus\_%') = ARRAY['ductus_auth']
              THEN 'ductus_auth'::name ELSE 'ductus_app'::name END AS grp
  FROM pg_roles r
  WHERE r.rolcanlogin
    AND (r.rolname LIKE 'ductus\_%'
         OR EXISTS (SELECT 1 FROM pg_auth_members m
                    WHERE m.member = r.oid AND pg_get_userbyid(m.roleid) LIKE 'ductus\_%'));
-- pg_shdepend records every object a role owns, every privilege granted to it
-- on any object of any database, every default privilege and every policy
-- that names it. A login must have none of these.
CREATE TEMP VIEW login_dependency AS
  SELECT l.login || ': ' || d.classid::regclass::text || ' (' || d.deptype::text || ')' AS found
  FROM ductus_login l
  JOIN pg_shdepend d ON d.refclassid = 'pg_authid'::regclass AND d.refobjid = l.oid;
-- The same seen from the other side: nothing the login may do that its group
-- may not. PUBLIC grants reach both, so they do not show here.
CREATE TEMP VIEW login_extra_privilege AS
  SELECT l.login || ': ' || p.privilege || ' on ' || c.oid::regclass::text AS found
  FROM ductus_login l
  CROSS JOIN pg_class c
  CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege)
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND has_table_privilege(l.oid, c.oid, p.privilege) AND NOT has_table_privilege(l.grp, c.oid, p.privilege)
  UNION ALL
  SELECT l.login || ': column ' || p.privilege || ' on ' || c.oid::regclass::text
  FROM ductus_login l
  CROSS JOIN pg_class c
  CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) AS p(privilege)
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND has_any_column_privilege(l.oid, c.oid, p.privilege) AND NOT has_any_column_privilege(l.grp, c.oid, p.privilege)
  UNION ALL
  SELECT l.login || ': ' || p.privilege || ' on sequence ' || c.oid::regclass::text
  FROM ductus_login l
  CROSS JOIN pg_class c
  CROSS JOIN unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) AS p(privilege)
  WHERE c.relkind = 'S'
    AND has_sequence_privilege(l.oid, c.oid, p.privilege) AND NOT has_sequence_privilege(l.grp, c.oid, p.privilege)
  UNION ALL
  SELECT l.login || ': EXECUTE on ' || f.oid::regprocedure::text
  FROM ductus_login l
  CROSS JOIN pg_proc f
  WHERE has_function_privilege(l.oid, f.oid, 'EXECUTE') AND NOT has_function_privilege(l.grp, f.oid, 'EXECUTE')
  UNION ALL
  SELECT l.login || ': ' || p.privilege || ' on schema ' || n.nspname
  FROM ductus_login l
  CROSS JOIN pg_namespace n
  CROSS JOIN unnest(ARRAY['USAGE', 'CREATE']) AS p(privilege)
  WHERE has_schema_privilege(l.oid, n.oid, p.privilege) AND NOT has_schema_privilege(l.grp, n.oid, p.privilege)
  UNION ALL
  SELECT l.login || ': ' || p.privilege || ' on the database'
  FROM ductus_login l
  CROSS JOIN unnest(ARRAY['CREATE', 'TEMPORARY', 'CONNECT']) AS p(privilege)
  WHERE has_database_privilege(l.oid, current_database(), p.privilege)
    AND NOT has_database_privilege(l.grp, current_database(), p.privilege);
-- ALTER ROLE ... SET and ALTER DATABASE ... SET change what a new connection
-- starts with: a search_path, a role, row_security. Neither a ductus_* role,
-- nor a login, nor this database as a whole carries one.
CREATE TEMP VIEW login_setting AS
  SELECT CASE WHEN s.setrole = 0 THEN 'every role' ELSE pg_get_userbyid(s.setrole)::text END
         || ': ' || array_to_string(s.setconfig, ', ') AS found
  FROM pg_db_role_setting s
  WHERE s.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))
    AND (s.setrole = 0
         OR pg_get_userbyid(s.setrole) LIKE 'ductus\_%'
         OR s.setrole IN (SELECT oid FROM ductus_login));

SELECT is_empty(
  'SELECT found FROM login_dependency',
  'no login owns an object, holds a grant of its own or is named by a policy or a default privilege'
);
SELECT is_empty(
  'SELECT found FROM login_extra_privilege',
  'no login may do anything that its group may not'
);
SELECT is_empty(
  'SELECT found FROM login_setting',
  'no ductus_* role, login or database default carries a setting for new connections'
);
-- Negative controls: each of these went unnoticed while only ductus_app was
-- checked. Each one is added, seen and taken back.
GRANT SELECT ON identity.session TO ductus_app_local;
SELECT isnt_empty(
  'SELECT found FROM login_dependency',
  'a table privilege granted to the login itself is noticed as a grant'
);
SELECT isnt_empty(
  'SELECT found FROM login_extra_privilege',
  'a table privilege granted to the login itself is noticed as a right beyond ductus_app'
);
REVOKE SELECT ON identity.session FROM ductus_app_local;
-- The login callback is held to ductus_auth, not to ductus_app: a right that
-- ductus_app has, granted to that login, is still a right beyond its group.
GRANT EXECUTE ON FUNCTION identity.close_current_session() TO ductus_auth_local;
SELECT isnt_empty(
  $$ SELECT found FROM login_extra_privilege WHERE found LIKE 'ductus\_auth\_local: %' $$,
  'a ductus_app right granted to the login-callback login is noticed as a right beyond ductus_auth'
);
REVOKE EXECUTE ON FUNCTION identity.close_current_session() FROM ductus_auth_local;
GRANT CREATE ON DATABASE ductus TO ductus_app_local;
SELECT isnt_empty(
  'SELECT found FROM login_dependency',
  'a database privilege granted to the login itself is noticed'
);
REVOKE CREATE ON DATABASE ductus FROM ductus_app_local;
ALTER ROLE ductus_app_local SET search_path = test_elsewhere, public;
SELECT isnt_empty(
  'SELECT found FROM login_setting',
  'a search_path set on the login is noticed'
);
ALTER ROLE ductus_app_local RESET search_path;
SELECT is_empty(
  'SELECT found FROM login_dependency UNION ALL SELECT found FROM login_extra_privilege UNION ALL SELECT found FROM login_setting',
  'the login is clean again once the negative controls are taken back'
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

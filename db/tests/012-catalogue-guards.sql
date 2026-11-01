-- Catalogue guards for objects added later (F-020, DAN-158). The access
-- matrices name their tables, so a table, policy, view or function added
-- later with a wrong right would pass them; these read the catalogue instead.
-- Each guard has a negative control that is added, seen and taken back.
-- 010 already covers forced RLS, the owners, ductus_app writes and the
-- function rules of the application schemas; 020 the identity tables.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL lc_messages TO 'C';

SELECT plan(17);

-- Application schemas: everything outside the system schemas and public.
CREATE TEMP VIEW app_relation AS
  SELECT c.oid, n.nspname || '.' || c.relname AS name, c.relkind, c.reloptions
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND n.nspname NOT LIKE 'pg\_%' AND n.nspname NOT IN ('information_schema', 'public')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e');

-- 1. Tables are read by the owner roles and by ductus_app alone. Every other
-- role holds no right on any application relation: the worker, retention,
-- the login callback and the migrator act through functions, and PUBLIC gets
-- nothing. Every role is read, whatever its name, so a role a later
-- migration adds outside the Ductus roles is covered too. Superusers and the
-- predefined pg_* roles hold every right by design and are left out; 010
-- keeps the Ductus roles out of them. Roles that inherit ductus_app (its
-- logins) are held by the write guard of 010 and the matrices. The
-- has_*_privilege functions resolve groups and PUBLIC, so a right reached
-- either way shows here.
CREATE TEMP VIEW stray_privilege AS
  SELECT r.rolname || ': ' || p.privilege || ' on ' || a.name AS found
  FROM (SELECT rolname::text FROM pg_roles x
        WHERE NOT x.rolsuper AND x.rolname NOT LIKE 'pg\_%'
          AND x.rolname NOT IN ('ductus_identity', 'ductus_evidence')
          AND NOT pg_has_role(x.oid, 'ductus_app', 'USAGE')
        UNION ALL SELECT 'public') AS r (rolname)
  CROSS JOIN app_relation a
  CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p (privilege)
  WHERE has_table_privilege(r.rolname, a.oid, p.privilege)
     OR (p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
         AND has_any_column_privilege(r.rolname, a.oid, p.privilege));

SELECT is_empty('SELECT found FROM stray_privilege',
  'no role but the owners and ductus_app, nor PUBLIC, holds a right on an application relation');
GRANT SELECT ON institution.course TO ductus_worker;
SELECT set_eq('SELECT found FROM stray_privilege', ARRAY['ductus_worker: SELECT on institution.course'],
  'a table right granted to ductus_worker is noticed');
REVOKE SELECT ON institution.course FROM ductus_worker;
CREATE ROLE test_reporting NOLOGIN;
GRANT SELECT ON institution.course TO test_reporting;
SELECT set_eq('SELECT found FROM stray_privilege', ARRAY['test_reporting: SELECT on institution.course'],
  'a table right granted to a role outside the Ductus roles is noticed');
REVOKE SELECT ON institution.course FROM test_reporting;
DROP ROLE test_reporting;
GRANT SELECT (id) ON evidence.segment TO PUBLIC;
SELECT isnt_empty($$ SELECT found FROM stray_privilege WHERE found = 'public: SELECT on evidence.segment' $$,
  'a column right granted to PUBLIC is noticed');
REVOKE SELECT (id) ON evidence.segment FROM PUBLIC;
SELECT is_empty('SELECT found FROM stray_privilege', 'the relations are clean again once the controls are taken back');

-- 2. A policy that lets every row through is the owner policy of a table and
-- names an owner role alone; no policy applies to PUBLIC. A policy lets every
-- row through when USING or WITH CHECK is true, and also when the expression
-- its command needs is missing: USING for every command but INSERT, and the
-- check for INSERT, UPDATE and ALL, where WITH CHECK falls back to USING.
CREATE TEMP VIEW open_policy AS
  SELECT schemaname || '.' || tablename || '.' || policyname AS found
  FROM pg_policies
  WHERE schemaname NOT LIKE 'pg\_%' AND schemaname NOT IN ('information_schema', 'public')
    AND (qual = 'true' OR with_check = 'true'
         OR (cmd <> 'INSERT' AND qual IS NULL)
         OR (cmd IN ('INSERT', 'UPDATE', 'ALL') AND coalesce(with_check, qual) IS NULL))
    AND NOT roles <@ ARRAY['ductus_identity', 'ductus_evidence']::name[];
CREATE TEMP VIEW public_policy AS
  SELECT schemaname || '.' || tablename || '.' || policyname AS found
  FROM pg_policies
  WHERE schemaname NOT LIKE 'pg\_%' AND schemaname NOT IN ('information_schema', 'public')
    AND 'public' = ANY (roles);

SELECT is_empty('SELECT found FROM open_policy', 'every policy that passes every row names only an owner role');
SELECT is_empty('SELECT found FROM public_policy', 'no policy applies to PUBLIC');
CREATE POLICY test_open ON institution.course FOR SELECT TO ductus_app USING (true);
SELECT set_eq('SELECT found FROM open_policy', ARRAY['institution.course.test_open'],
  'a policy for ductus_app that passes every row is noticed');
DROP POLICY test_open ON institution.course;
CREATE POLICY test_no_using ON institution.course FOR SELECT TO ductus_app;
SELECT set_eq('SELECT found FROM open_policy', ARRAY['institution.course.test_no_using'],
  'a SELECT policy for ductus_app without USING is noticed');
DROP POLICY test_no_using ON institution.course;
CREATE POLICY test_no_check ON institution.course FOR INSERT TO ductus_app;
SELECT set_eq('SELECT found FROM open_policy', ARRAY['institution.course.test_no_check'],
  'an INSERT policy for ductus_app without WITH CHECK is noticed');
DROP POLICY test_no_check ON institution.course;
CREATE POLICY test_public ON institution.course FOR SELECT USING (false);
SELECT set_eq('SELECT found FROM public_policy', ARRAY['institution.course.test_public'],
  'a policy without a role, which applies to PUBLIC, is noticed');
DROP POLICY test_public ON institution.course;
SELECT is_empty('SELECT found FROM open_policy UNION ALL SELECT found FROM public_policy',
  'the policies are clean again once the controls are taken back');

-- 3. A view runs with the rights of its owner unless it is security_invoker,
-- and a materialized view keeps rows outside RLS: an application view must be
-- security_invoker, and there is no materialized view.
CREATE TEMP VIEW owner_rights_view AS
  SELECT a.name AS found FROM app_relation a
  WHERE a.relkind = 'm'
     OR (a.relkind = 'v' AND NOT EXISTS (
           SELECT 1 FROM unnest(coalesce(a.reloptions, '{}'::text[])) AS o (opt)
           WHERE lower(split_part(o.opt, '=', 1)) = 'security_invoker'
             AND lower(split_part(o.opt, '=', 2)) IN ('true', 'on', '1', 'yes')));

SELECT is_empty('SELECT found FROM owner_rights_view',
  'every application view is security_invoker and there is no materialized view');
CREATE VIEW institution.test_view AS SELECT 1 AS one;
SELECT set_eq('SELECT found FROM owner_rights_view', ARRAY['institution.test_view'],
  'a view that runs with the rights of its owner is noticed');
ALTER VIEW institution.test_view SET (security_invoker = on);
SELECT is_empty('SELECT found FROM owner_rights_view', 'the same view as security_invoker passes');
DROP VIEW institution.test_view;

-- 4. Schema public holds no function of its own: the function rules of 010
-- read the application schemas only, so a function there would escape them.
-- Extension members (pgTAP itself) are not the application's.
CREATE TEMP VIEW public_function AS
  SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS found
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');

SELECT is_empty('SELECT found FROM public_function', 'schema public holds no function outside an extension');
CREATE FUNCTION public.test_function() RETURNS integer LANGUAGE sql AS 'SELECT 1';
SELECT set_eq('SELECT found FROM public_function', ARRAY['test_function()'],
  'a function created in public is noticed');
DROP FUNCTION public.test_function();

SELECT * FROM finish();
ROLLBACK;

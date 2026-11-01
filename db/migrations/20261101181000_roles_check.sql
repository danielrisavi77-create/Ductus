-- migrate:up
-- D-91 measure 6 (docs/BACKEND.md 4.8 point 6): the group roles come from a
-- bootstrap that runs before the first migration (db/local/migrator.sql
-- locally, B0.1 on a managed database). The roles migration
-- (20261003210000_roles.sql) is already applied and db/migrations.sum keeps
-- it as it is, so it still creates a missing role. This migration only
-- checks: it creates, grants and alters nothing, and stops the deploy when
-- the roles are not in the state every later migration relies on.
--
-- The list is the roles migration's; tests/unit/infra/group-roles-lists.test.ts
-- keeps it equal to that one and to db/local/migrator.sql.
DO $$
DECLARE
  group_roles CONSTANT text[] := ARRAY[
    'ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_evidence', 'ductus_identity', 'ductus_auth'
  ];
  owner_roles CONSTANT text[] := ARRAY['ductus_identity', 'ductus_evidence'];
  role_name text;
BEGIN
  IF current_user <> 'ductus_migrator'
     OR (SELECT rolsuper OR rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'migrations must run as ductus_migrator without SUPERUSER or BYPASSRLS (current role: %)', current_user;
  END IF;

  SELECT g.wanted INTO role_name FROM unnest(group_roles) AS g(wanted)
  WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = g.wanted)
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'group role % does not exist', role_name;
  END IF;

  SELECT rolname INTO role_name FROM pg_catalog.pg_roles
  WHERE rolname = ANY (group_roles)
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'group role % has LOGIN or an elevated attribute', role_name;
  END IF;

  -- The migrator administers each group role directly, as when it creates
  -- them; that is what the roles migration's GRANT ... SET TRUE and the
  -- DROP ROLE of its down section need.
  SELECT r.rolname INTO role_name FROM pg_catalog.pg_roles r
  WHERE r.rolname = ANY (group_roles)
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members m
      WHERE m.roleid = r.oid AND m.member = 'ductus_migrator'::regrole AND m.admin_option
    )
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'ductus_migrator does not administer group role %', role_name;
  END IF;

  -- Inheriting a group role, directly or through another role, would put
  -- the migrator under that role's grants and RLS policies.
  SELECT g.wanted INTO role_name FROM unnest(group_roles) AS g(wanted)
  WHERE pg_catalog.pg_has_role('ductus_migrator', g.wanted, 'USAGE')
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'ductus_migrator inherits the privileges of group role %', role_name;
  END IF;

  -- Later migrations hand objects to the owner roles with SET ROLE.
  SELECT g.wanted INTO role_name FROM unnest(owner_roles) AS g(wanted)
  WHERE NOT pg_catalog.pg_has_role('ductus_migrator', g.wanted, 'SET')
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'ductus_migrator cannot SET ROLE to owner role %', role_name;
  END IF;
END
$$;

-- migrate:down
-- The check changed nothing, so there is nothing to undo.
SELECT 1;

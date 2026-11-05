-- Local and CI stack only (compose.yaml); `pnpm db:migrate` runs it before
-- dbmate. It stands in for the provisioning that staging and production get
-- in B0.1: the migrator exists before the first migration, owns the database
-- and is the only role with DDL (docs/BACKEND.md 3, rule 2), and the group
-- roles exist before the first migration too (D-91 measure 6, docs/BACKEND.md
-- 4.8 point 6). Run it again at any time: every step leaves a role that is
-- already right as it is.
--
-- No login and no password here: the compose user connects and dbmate
-- switches to ductus_migrator (`role=` in the connection URL), so every
-- migration runs without SUPERUSER and without BYPASSRLS, as it must on a
-- managed database.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ductus_migrator') THEN
    CREATE ROLE ductus_migrator NOLOGIN NOSUPERUSER CREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
  END IF;
  EXECUTE format('ALTER DATABASE %I OWNER TO ductus_migrator', current_database());

  -- A database migrated before this file existed keeps its ledger.
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    ALTER TABLE public.schema_migrations OWNER TO ductus_migrator;
  END IF;
END
$$;

-- The group roles. The roles migration (db/migrations/20261003210000_roles.sql)
-- finds them here, creates only one that is missing and stops on one with
-- LOGIN or an elevated attribute; db/migrations.sum keeps that migration as it
-- is. The list is the migration's and changes only together with it.
--
-- They are created as ductus_migrator, the way the migration would create
-- them: a role made by a CREATEROLE role is administered by it (ADMIN OPTION,
-- without INHERIT or SET). The migration needs that for its GRANT ... SET TRUE
-- on the owner roles and its migrate:down DROP ROLE, and pgTAP
-- (db/tests/010-roles-and-privileges.sql) lists exactly these memberships.
SET ROLE ductus_migrator;
DO $$
DECLARE
  group_roles CONSTANT text[] := ARRAY[
    'ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_evidence', 'ductus_identity', 'ductus_auth'
  ];
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY group_roles LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        role_name
      );
    END IF;
  END LOOP;

  -- Roles are cluster-wide and may predate this database. A role left over
  -- with the wrong attributes, or one the migrator does not administer, is
  -- not repaired here: B0.1 has no superuser to repair it with either, so it
  -- stops the bootstrap the same way.
  SELECT rolname INTO role_name FROM pg_catalog.pg_roles
  WHERE rolname = ANY (group_roles)
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'role % already exists with LOGIN or an elevated attribute', role_name;
  END IF;

  SELECT r.rolname INTO role_name FROM pg_catalog.pg_roles r
  WHERE r.rolname = ANY (group_roles)
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members m
      WHERE m.roleid = r.oid AND m.member = 'ductus_migrator'::regrole AND m.admin_option
    )
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'role % exists but ductus_migrator does not administer it', role_name;
  END IF;
END
$$;
RESET ROLE;

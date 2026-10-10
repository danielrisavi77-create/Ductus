-- migrate:up
-- Database roles (docs/BACKEND.md 3, rule 2). The roles created here are
-- NOLOGIN groups: login users and their passwords are provisioned per
-- environment and join a group with GRANT, so no secret lives in a
-- migration.
--
-- ductus_migrator is the only role with DDL. It is provisioned before the
-- first migration (db/local/migrator.sql for the local stack, B0.1 for
-- staging and production), owns the database and has CREATEROLE, but is
-- not a superuser, so nothing below may need one.
DO $$
DECLARE
  group_roles CONSTANT text[] := ARRAY[
    'ductus_app',       -- web process; subject to RLS, no evidence functions
    'ductus_worker',    -- background jobs; narrow SECURITY DEFINER functions only
    'ductus_retention', -- retention job; content pointer deletion only
    'ductus_evidence',  -- owner of evidence functions and tables
    'ductus_identity',  -- owner of identity tables and session functions
    'ductus_auth'       -- login callback only; the one role that may open a session (B-6)
  ];
  role_name text;
BEGIN
  IF current_user <> 'ductus_migrator'
     OR (SELECT rolsuper OR rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'migrations must run as ductus_migrator without SUPERUSER or BYPASSRLS (current role: %)', current_user;
  END IF;

  FOREACH role_name IN ARRAY group_roles LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        role_name
      );
    END IF;
  END LOOP;

  -- Roles are cluster-wide and may predate this database. Only a superuser
  -- can take SUPERUSER, REPLICATION or BYPASSRLS away, so a role that
  -- already exists with the wrong attributes stops the migration.
  SELECT rolname INTO role_name FROM pg_catalog.pg_roles
  WHERE rolname = ANY (group_roles)
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'role % already exists with LOGIN or an elevated attribute', role_name;
  END IF;
END
$$;

-- The migrator may act as an owner role (hand tables over to it, set its
-- default privileges) but inherits none of its privileges, so RLS policies
-- for the owner never apply to the migrator itself.
GRANT ductus_identity, ductus_evidence TO ductus_migrator WITH INHERIT FALSE, SET TRUE;

-- Nobody reaches the database or the public schema by default.
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO ductus_app, ductus_worker, ductus_retention, ductus_auth',
    current_database()
  );
END
$$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- PostgreSQL grants EXECUTE on every new function to PUBLIC. Without this,
-- each future SECURITY DEFINER function would be callable by any role. The
-- setting belongs to the role that creates the function, so each of the
-- three roles that may own one gets it. FOR ROLE needs the privileges of
-- the target role, which the migrator does not inherit, hence SET ROLE.
ALTER DEFAULT PRIVILEGES FOR ROLE ductus_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
SET LOCAL ROLE ductus_identity;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
SET LOCAL ROLE ductus_evidence;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
SET LOCAL ROLE ductus_migrator;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 8).
-- Every grant is taken back by name: DROP OWNED would need the privileges
-- of each role, which the migrator does not inherit.
ALTER DEFAULT PRIVILEGES FOR ROLE ductus_migrator GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
SET LOCAL ROLE ductus_identity;
ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
SET LOCAL ROLE ductus_evidence;
ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
SET LOCAL ROLE ductus_migrator;
DO $$
BEGIN
  EXECUTE format(
    'REVOKE ALL ON DATABASE %I FROM ductus_app, ductus_worker, ductus_retention, ductus_auth',
    current_database()
  );
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO PUBLIC', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO PUBLIC;
DROP ROLE ductus_app, ductus_worker, ductus_retention, ductus_evidence, ductus_identity, ductus_auth;

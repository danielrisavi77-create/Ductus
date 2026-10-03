-- migrate:up
-- Database roles (docs/BACKEND.md 3, rule 2). All of them are NOLOGIN
-- groups: login users and their passwords are provisioned per environment
-- (db/local for the local stack, B0.1 for staging and production) and join
-- a group with GRANT, so no secret lives in a migration.
--
-- ductus_migrator is whoever runs dbmate (the compose superuser locally,
-- the provisioned admin elsewhere); it owns the schemas and is not created
-- here.
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'ductus_app',       -- web process; subject to RLS, no evidence functions
    'ductus_worker',    -- background jobs; narrow SECURITY DEFINER functions only
    'ductus_retention', -- retention job; content pointer deletion only
    'ductus_evidence',  -- owner of evidence functions and tables
    'ductus_identity',  -- owner of identity tables and session functions
    'ductus_auth'       -- login callback only; the one role that may open a session (B-6)
  ] LOOP
    -- Roles are cluster-wide and may predate this database, so the
    -- attributes are enforced even when the role already exists.
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I', role_name);
    END IF;
    EXECUTE format(
      'ALTER ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
      role_name
    );
  END LOOP;
END
$$;

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
-- each future SECURITY DEFINER function would be callable by any role.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE ductus_identity REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE ductus_evidence REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 8).
ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO PUBLIC', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO PUBLIC;
DROP OWNED BY ductus_app, ductus_worker, ductus_retention, ductus_evidence, ductus_identity, ductus_auth;
DROP ROLE ductus_app, ductus_worker, ductus_retention, ductus_evidence, ductus_identity, ductus_auth;

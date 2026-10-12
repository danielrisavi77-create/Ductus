-- Local and CI stack only (compose.yaml); `pnpm db:migrate` runs it after
-- dbmate, once ductus_auth exists. It stands in for the provisioning that
-- staging and production get in B0.1: the login callback opens sessions as a
-- plain login that is a member of ductus_auth (B-6, docs/BACKEND.md 4.3), a
-- login of its own so the web process login (ductus_app_local) never holds
-- open_session. AUTH_DATABASE_URL in .env.example points at it.
--
-- Unlike app-login.sql, no password lives in the repository. The caller
-- passes one, `psql -v auth_password=...`, from DUCTUS_AUTH_LOCAL_PASSWORD;
-- CI generates a random one per run. The same guard stops this file on any
-- database but the local socket of the compose container.
\set ON_ERROR_STOP on
SELECT pg_catalog.inet_server_addr() IS NULL AS local_socket \gset
\if :local_socket
\else
  DO $$ BEGIN RAISE EXCEPTION 'db/local/auth-login.sql is for the local compose stack only'; END $$;
\endif
\if :{?auth_password}
  SELECT pg_catalog.length(:'auth_password') >= 16 AS password_ok \gset
\else
  \set password_ok false
\endif
\if :password_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'DUCTUS_AUTH_LOCAL_PASSWORD must be set, at least 16 characters (.env.example)'; END $$;
\endif

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ductus_auth_local') THEN
    CREATE ROLE ductus_auth_local;
  END IF;
END
$$;
-- Stated on every run, so a role left over with other attributes is reset.
-- The password is a psql variable, which a DO body cannot read, so the
-- statement is built with %L quoting and run by \gexec.
SELECT pg_catalog.format(
  'ALTER ROLE ductus_auth_local LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'auth_password'
) \gexec

-- The one membership: inherited rights of ductus_auth (EXECUTE on
-- identity.open_session, USAGE on identity, CONNECT) and nothing else; never
-- ductus_app. pgTAP (db/tests/010-roles-and-privileges.sql) lists this
-- membership by name and fails on any other.
GRANT ductus_auth TO ductus_auth_local WITH INHERIT TRUE, SET FALSE;

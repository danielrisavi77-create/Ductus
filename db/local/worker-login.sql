-- Local and CI stack only (compose.yaml); `pnpm db:migrate` runs it after
-- dbmate, once the group roles exist. It stands in for the provisioning that
-- staging and production get in B0.1: the worker process (DAN-517) connects
-- as a plain login that is a member of ductus_worker (docs/BACKEND.md 3,
-- rule 2), never as the web login or an owner role.
--
-- As in auth-login.sql, no password lives in the repository. The caller
-- passes one, `psql -v worker_password=...`, from DUCTUS_WORKER_LOCAL_PASSWORD
-- (scripts/db/provision-worker.mjs); CI generates a random one per run. The
-- file stops on any database but the local socket of the compose container.
\set ON_ERROR_STOP on
SELECT pg_catalog.inet_server_addr() IS NULL AS local_socket \gset
\if :local_socket
\else
  DO $$ BEGIN RAISE EXCEPTION 'db/local/worker-login.sql is for the local compose stack only'; END $$;
\endif
\if :{?worker_password}
  SELECT pg_catalog.length(:'worker_password') >= 16 AS password_ok \gset
\else
  \set password_ok false
\endif
\if :password_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'DUCTUS_WORKER_LOCAL_PASSWORD must be set, at least 16 characters (.env.example)'; END $$;
\endif

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ductus_worker_local') THEN
    CREATE ROLE ductus_worker_local;
  END IF;
END
$$;
-- Stated on every run, so a role left over with other attributes is reset.
-- The password is a psql variable, which a DO body cannot read, so the
-- statement is built with %L quoting and run by \gexec.
SELECT pg_catalog.format(
  'ALTER ROLE ductus_worker_local LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'worker_password'
) \gexec

-- The one membership: inherited rights of ductus_worker and nothing else. SET
-- is off because the login never needs to become the group role. pgTAP
-- (db/tests/010-roles-and-privileges.sql) lists this membership by name and
-- fails on any other.
GRANT ductus_worker TO ductus_worker_local WITH INHERIT TRUE, SET FALSE;

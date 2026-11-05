-- Local and CI stack only (compose.yaml); `pnpm db:migrate` runs it after
-- dbmate, once the group roles exist. It stands in for the provisioning that
-- staging and production get in B0.1: the worker process (DAN-517) connects
-- as a plain login that is a member of ductus_worker (docs/BACKEND.md 3,
-- rule 2), never as the web login or an owner role.
--
-- The password is a local-only value, like every credential in compose.yaml.
-- It is public, so this file must never reach a database that holds real
-- data: it stops unless it runs over the local socket of the compose
-- container, which no managed database offers.
DO $$
BEGIN
  IF pg_catalog.inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'db/local/worker-login.sql is for the local compose stack only';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ductus_worker_local') THEN
    CREATE ROLE ductus_worker_local;
  END IF;
  -- Stated on every run, so a role left over with other attributes is reset.
  ALTER ROLE ductus_worker_local
    LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    PASSWORD 'ductus-worker-local-only';
END
$$;

-- The one membership: inherited rights of ductus_worker and nothing else. SET
-- is off because the login never needs to become the group role. pgTAP
-- (db/tests/010-roles-and-privileges.sql) lists this membership by name and
-- fails on any other.
GRANT ductus_worker TO ductus_worker_local WITH INHERIT TRUE, SET FALSE;

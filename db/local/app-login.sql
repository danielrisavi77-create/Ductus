-- Local and CI stack only (compose.yaml); `pnpm db:migrate` runs it after
-- dbmate, once the group roles exist. It stands in for the provisioning that
-- staging and production get in B0.1: the web process connects as a plain
-- login that is a member of ductus_app (docs/BACKEND.md 3, rule 2), which is
-- what APP_DATABASE_URL in .env.example points at.
--
-- The password is a local-only value, like every credential in compose.yaml.
-- It is public, so this file must never reach a database that holds real
-- data: it stops unless it runs over the local socket of the compose
-- container, which no managed database offers.
DO $$
BEGIN
  IF pg_catalog.inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'db/local/app-login.sql is for the local compose stack only';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ductus_app_local') THEN
    CREATE ROLE ductus_app_local;
  END IF;
  -- Stated on every run, so a role left over with other attributes is reset.
  ALTER ROLE ductus_app_local
    LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    PASSWORD 'ductus-app-local-only';
END
$$;

-- The one membership: inherited rights of ductus_app and nothing else. SET is
-- off because the login never needs to become the group role. pgTAP
-- (db/tests/010-roles-and-privileges.sql) lists this membership by name and
-- fails on any other.
GRANT ductus_app TO ductus_app_local WITH INHERIT TRUE, SET FALSE;

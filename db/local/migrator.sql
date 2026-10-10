-- Local and CI stack only (compose.yaml); `pnpm db:migrate` runs it before
-- dbmate. It stands in for the provisioning that staging and production get
-- in B0.1: the migrator exists before the first migration, owns the database
-- and is the only role with DDL (docs/BACKEND.md 3, rule 2).
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

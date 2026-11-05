-- DAN-517, attack plan #1021 step 3 (D-71, D-91; docs/backend/baza-i-pogon.md
-- 4.8 t. 7): the owner of the pg-boss queue. ductus_queue is a NOLOGIN group
-- like the roles of 20261003210000_roles.sql: it owns the pgboss schema
-- objects that the next migration installs, so no pg-boss table, function or
-- type belongs to the migrator or to an existing owner role. The schema itself
-- belongs to the migrator like every other schema here.
-- migrate:up
SET LOCAL ROLE ductus_migrator;

DO $$
BEGIN
  IF current_user <> 'ductus_migrator'
     OR (SELECT rolsuper OR rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'migrations must run as ductus_migrator without SUPERUSER or BYPASSRLS (current role: %)', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ductus_queue') THEN
    CREATE ROLE ductus_queue NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  -- Roles are cluster-wide and may predate this database (see the roles
  -- migration): an existing role with LOGIN or an elevated attribute stops it.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'ductus_queue'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'role ductus_queue already exists with LOGIN or an elevated attribute';
  END IF;
END
$$;

-- As for the other owner roles: the migrator may act as the owner but
-- inherits none of its privileges.
GRANT ductus_queue TO ductus_migrator WITH INHERIT FALSE, SET TRUE;

CREATE SCHEMA pgboss;
-- CREATE on the schema only while the pg-boss plan runs (next migration).
GRANT USAGE ON SCHEMA pgboss TO ductus_queue;

SET LOCAL ROLE ductus_queue;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
SET LOCAL ROLE ductus_migrator;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
DROP SCHEMA pgboss;
SET LOCAL ROLE ductus_queue;
ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
SET LOCAL ROLE ductus_migrator;
REVOKE ductus_queue FROM ductus_migrator;
DROP ROLE ductus_queue;

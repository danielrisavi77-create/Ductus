-- DAN-517, attack plan #1021 step 3 (D-71, D-74; docs/backend/baza-i-pogon.md
-- 4.8 t. 7): who may use the pg-boss schema. Only the worker, with row rights:
-- it builds no table, index or partition (migrate: false, queues without
-- partition), so a partitioned queue or a DDL path fails for lack of rights.
-- The web role gets nothing. pg-boss functions are SECURITY INVOKER; the
-- worker calls only the clock and create_queue.
--
-- The plan creates queue_stats partitions named after the day it ran. Nothing
-- writes queue_stats while persistQueueStats is false (pg-boss 12.38.0
-- dist/boss.js, #supervisePass), and the dates would make the schema differ
-- from db/schema.sql on other days (D-91 measure 4), so they are dropped.
-- migrate:up
SET LOCAL ROLE ductus_queue;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = 'pgboss.queue_stats'::regclass
    ORDER BY c.relname
  LOOP
    EXECUTE format('DROP TABLE pgboss.%I', r.relname);
  END LOOP;
END
$$;

-- The pg-boss function bodies name every object with its schema, so an empty
-- search_path changes nothing for them and closes the path for a caller's
-- objects, as for every other function here.
ALTER FUNCTION pgboss.job_now() SET search_path = '';
ALTER FUNCTION pgboss.job_table_format(text, text) SET search_path = '';
ALTER FUNCTION pgboss.job_table_run(text, text, text) SET search_path = '';
ALTER FUNCTION pgboss.job_table_run_async(text, integer, text, text, text) SET search_path = '';
ALTER FUNCTION pgboss.create_queue(text, jsonb) SET search_path = '';
ALTER FUNCTION pgboss.delete_queue(text) SET search_path = '';

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pgboss FROM PUBLIC;
SET LOCAL ROLE ductus_migrator;
GRANT USAGE ON SCHEMA pgboss TO ductus_worker;
SET LOCAL ROLE ductus_queue;
GRANT EXECUTE ON FUNCTION pgboss.job_now(), pgboss.create_queue(text, jsonb) TO ductus_worker;

GRANT SELECT ON pgboss.version TO ductus_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  pgboss.queue, pgboss.schedule, pgboss.subscription, pgboss.bam, pgboss.job, pgboss.job_common,
  pgboss.warning, pgboss.queue_stats, pgboss.job_dependency, pgboss.instance
  TO ductus_worker;

-- Every pg-boss table has forced RLS like every other table here. The queue
-- holds identifiers only (D-74), so the worker sees every row; the owner
-- keeps every row for a later pg-boss upgrade plan.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pgboss' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE pgboss.%I ENABLE ROW LEVEL SECURITY', r.relname);
    EXECUTE format('ALTER TABLE pgboss.%I FORCE ROW LEVEL SECURITY', r.relname);
    EXECUTE format('CREATE POLICY pgboss_worker ON pgboss.%I TO ductus_worker USING (true) WITH CHECK (true)', r.relname);
    EXECUTE format('CREATE POLICY pgboss_owner ON pgboss.%I TO ductus_queue USING (true) WITH CHECK (true)', r.relname);
  END LOOP;
END
$$;
SET LOCAL ROLE ductus_migrator;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_queue;
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pgboss' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('DROP POLICY pgboss_worker ON pgboss.%I', r.relname);
    EXECUTE format('DROP POLICY pgboss_owner ON pgboss.%I', r.relname);
    EXECUTE format('ALTER TABLE pgboss.%I NO FORCE ROW LEVEL SECURITY', r.relname);
    EXECUTE format('ALTER TABLE pgboss.%I DISABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA pgboss FROM ductus_worker;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pgboss FROM ductus_worker;
SET LOCAL ROLE ductus_migrator;
REVOKE USAGE ON SCHEMA pgboss FROM ductus_worker;

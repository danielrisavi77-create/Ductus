-- DAN-517, attack plan #1021 step 3 (D-71, D-74, D-91; docs/backend/baza-i-pogon.md
-- 4.8 t. 7): the pg-boss queue schema and who may use it. The package's SQL
-- is installed verbatim (scripts/engineering/pgboss-contract.mjs); this pins
-- what the migrations around it decide: the owner, the worker's rights, RLS,
-- the search_path of the package functions, and that the worker cannot build
-- tables (migrate: false, queues without partition).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL lc_messages TO 'C';

SELECT plan(24);

-- Owner: the schema belongs to the migrator like every schema; everything in
-- it to ductus_queue, which holds no DDL right once the migrations are done.
SELECT is(
  (SELECT pg_get_userbyid(nspowner)::text FROM pg_namespace WHERE nspname = 'pgboss'),
  'ductus_migrator', 'the pgboss schema belongs to ductus_migrator');
SELECT is_empty(
  $$ SELECT relname::text FROM pg_class WHERE relnamespace = 'pgboss'::regnamespace AND relowner <> 'ductus_queue'::regrole
     UNION ALL SELECT proname::text FROM pg_proc WHERE pronamespace = 'pgboss'::regnamespace AND proowner <> 'ductus_queue'::regrole
     UNION ALL SELECT typname::text FROM pg_type WHERE typnamespace = 'pgboss'::regnamespace AND typowner <> 'ductus_queue'::regrole $$,
  'every relation, function and type of pgboss belongs to ductus_queue');
SELECT ok(
  NOT has_schema_privilege('ductus_queue', 'pgboss', 'CREATE')
  AND NOT has_database_privilege('ductus_queue', current_database(), 'CREATE'),
  'ductus_queue keeps no CREATE on the schema or the database after the plan');

-- The installed schema: version 46, the tables of pg-boss 12.38.0, no dated
-- queue_stats partition and no partitioned queue.
SELECT is((SELECT version FROM pgboss.version), 46, 'pgboss.version is schema 46');
SELECT set_eq(
  $$ SELECT relname::text FROM pg_class WHERE relnamespace = 'pgboss'::regnamespace AND relkind IN ('r', 'p') $$,
  ARRAY['bam', 'instance', 'job', 'job_common', 'job_dependency', 'queue', 'queue_stats', 'schedule',
        'subscription', 'version', 'warning'],
  'pgboss holds exactly the tables of the construction plan, without dated queue_stats partitions');
SELECT set_eq(
  $$ SELECT c.relname::text FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent IN ('pgboss.job'::regclass, 'pgboss.queue_stats'::regclass) $$,
  ARRAY['job_common'],
  'the only partition is job_common, the shared table of unpartitioned queues');
SELECT is_empty($$ SELECT name FROM pgboss.queue WHERE partition $$, 'no queue has its own partition');
SELECT set_eq(
  $$ SELECT conrelid::regclass::text || ' ' || conname || ' ' || confdeltype::text || confupdtype::text
     FROM pg_constraint WHERE contype = 'f' AND connamespace = 'pgboss'::regnamespace $$,
  ARRAY['pgboss.job_common dlq_fkey ra', 'pgboss.job_common q_fkey ra', 'pgboss.queue queue_dead_letter_fkey aa',
        'pgboss.schedule schedule_name_fkey ca', 'pgboss.subscription subscription_name_fkey ca'],
  'the foreign keys of pgboss are those of the package, none of them leaves the schema');
SELECT is_empty(
  $$ SELECT conname::text FROM pg_constraint
     WHERE contype = 'f' AND (connamespace = 'pgboss'::regnamespace) <> (confrelid::regclass::text LIKE 'pgboss.%') $$,
  'no foreign key joins pgboss and another schema');

-- Functions: invoker rights, an empty search_path, no PUBLIC.
SELECT is_empty(
  $$ SELECT proname::text FROM pg_proc WHERE pronamespace = 'pgboss'::regnamespace
     AND (prosecdef OR NOT coalesce('search_path=""' = ANY (proconfig), false)) $$,
  'every pgboss function is SECURITY INVOKER with an empty search_path');

-- Rights: the worker alone, row rights only; the web process and every other
-- Ductus role get nothing.
SELECT set_eq(
  $$ SELECT c.relname || ' ' || p.privilege FROM pg_class c
     CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p (privilege)
     WHERE c.relnamespace = 'pgboss'::regnamespace AND c.relkind IN ('r', 'p')
       AND has_table_privilege('ductus_worker', c.oid, p.privilege) $$,
  $$ SELECT t || ' ' || p FROM unnest(ARRAY['queue', 'schedule', 'subscription', 'bam', 'job', 'job_common', 'warning',
                                            'queue_stats', 'job_dependency', 'instance']) AS t
     CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p
     UNION ALL SELECT 'version SELECT' $$,
  'ductus_worker holds exactly SELECT on version and row rights on the other tables');
SELECT set_eq(
  $$ SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace = 'pgboss'::regnamespace
     AND has_function_privilege('ductus_worker', oid, 'EXECUTE') $$,
  ARRAY['pgboss.job_now()', 'pgboss.create_queue(text,jsonb)'],
  'ductus_worker executes the clock and create_queue, nothing that builds tables');
SELECT is_empty(
  $$ SELECT r || ' ' || c.relname FROM pg_class c
     CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_retention', 'ductus_auth', 'ductus_identity', 'ductus_evidence', 'public']) AS r
     WHERE c.relnamespace = 'pgboss'::regnamespace AND c.relkind IN ('r', 'p')
       AND (has_table_privilege(r, c.oid, 'SELECT') OR has_table_privilege(r, c.oid, 'INSERT')
            OR has_table_privilege(r, c.oid, 'UPDATE') OR has_table_privilege(r, c.oid, 'DELETE'))
     UNION ALL
     SELECT r || ' ' || p.oid::regprocedure::text FROM pg_proc p
     CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_retention', 'ductus_auth', 'ductus_identity', 'ductus_evidence', 'public']) AS r
     WHERE p.pronamespace = 'pgboss'::regnamespace AND has_function_privilege(r, p.oid, 'EXECUTE')
     UNION ALL
     SELECT r || ' USAGE' FROM unnest(ARRAY['ductus_app', 'ductus_retention', 'ductus_auth', 'public']) AS r
     WHERE has_schema_privilege(r, 'pgboss', 'USAGE') $$,
  'no other role, nor PUBLIC, reaches a pgboss table, function or the schema');

-- RLS: forced on every table, with exactly the worker and owner policies.
SELECT is_empty(
  $$ SELECT relname::text FROM pg_class WHERE relnamespace = 'pgboss'::regnamespace AND relkind IN ('r', 'p')
     AND NOT (relrowsecurity AND relforcerowsecurity) $$,
  'every pgboss table has forced row level security');
SELECT set_eq(
  $$ SELECT tablename || ' ' || policyname || ' ' || array_to_string(roles, ',') || ' ' || cmd
     FROM pg_policies WHERE schemaname = 'pgboss' $$,
  $$ SELECT t || ' ' || p FROM unnest(ARRAY['bam', 'instance', 'job', 'job_common', 'job_dependency', 'queue',
                                            'queue_stats', 'schedule', 'subscription', 'version', 'warning']) AS t
     CROSS JOIN unnest(ARRAY['pgboss_worker ductus_worker ALL', 'pgboss_owner ductus_queue ALL']) AS p $$,
  'each pgboss table has exactly the worker and owner policies');

-- Behaviour as the worker: an unpartitioned queue and a job work; anything
-- that builds a table fails for lack of rights. Inside this transaction only,
-- and after the catalogue checks above, the two roles get USAGE on public so
-- they can call pgTAP (as in 011); it gives nothing in pgboss.
GRANT USAGE ON SCHEMA public TO ductus_worker, ductus_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ductus_worker, ductus_app;
SET LOCAL ROLE ductus_worker;
SELECT lives_ok($$ SELECT pgboss.create_queue('test_sweep', '{"policy":"standard"}') $$,
  'the worker creates an unpartitioned queue');
SELECT lives_ok($$ INSERT INTO pgboss.job (name, data) VALUES ('test_sweep', '{"domainId":"00000000-0000-4000-8000-000000000001"}') $$,
  'the worker inserts a job');
SELECT is((SELECT count(*)::int FROM pgboss.job WHERE name = 'test_sweep'), 1, 'the worker reads its job');
SELECT throws_ok($$ SELECT pgboss.create_queue('test_partitioned', '{"policy":"standard","partition":true}') $$,
  '42501', NULL, 'a partitioned queue fails: the worker cannot create its table');
SELECT throws_ok($$ SELECT pgboss.job_table_run('SELECT 1', 'job_common') $$,
  '42501', NULL, 'the worker cannot run the DDL helper');
SELECT throws_ok($$ SELECT pgboss.delete_queue('test_sweep') $$,
  '42501', NULL, 'the worker cannot delete a queue');
SELECT throws_ok($$ TRUNCATE pgboss.job $$, '42501', NULL, 'the worker cannot truncate the queue');
RESET ROLE;

SET LOCAL ROLE ductus_app;
SELECT throws_ok($$ SELECT count(*) FROM pgboss.job $$, '42501', NULL, 'the web process cannot read the queue');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM pgboss.queue WHERE name = 'test_partitioned'), 0,
  'the failed partitioned queue left no row');

SELECT * FROM finish();
ROLLBACK;

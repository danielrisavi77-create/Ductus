-- DAN-184, M11.9-P01 (contract on #1836, c.6821517800; round 3 c.6867544247):
-- the in-app alarm channel. An alarm is a kind from a closed set and a few
-- timestamps; no column can hold a person, an institution, a work or any free
-- text. Several replicas report into it: an alarm stays open while any
-- reporter has a fresh fault row for its kind (ops_alarm_fault, 120 s).
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
SELECT no_plan();

-- 1. The tables: every text column is bound to a set; nothing else is text.
SELECT is(
  (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END,
                     ', ' ORDER BY a.attnum)
   FROM pg_attribute a WHERE a.attrelid = 'identity.ops_alarm'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
  'id uuid not null, kind text not null, category text not null, first_raised_at timestamp with time zone not null, '
  'last_raised_at timestamp with time zone not null, raise_count integer not null, resolved_at timestamp with time zone',
  'ops_alarm has no column for a person, an institution, a work or a message'
);
SELECT is(
  (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END,
                     ', ' ORDER BY a.attnum)
   FROM pg_attribute a WHERE a.attrelid = 'identity.ops_alarm_fault'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
  'kind text not null, reporter uuid not null, reported_at timestamp with time zone not null',
  'ops_alarm_fault holds a kind, a random process id and a time, nothing else'
);
SELECT is(
  (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
   WHERE c.conrelid = 'identity.ops_alarm_fault'::regclass AND c.contype = 'p'),
  'PRIMARY KEY (kind, reporter)',
  'one fault row per kind and reporter'
);
SELECT is(
  (SELECT string_agg(a.attrelid::regclass::text || '.' || a.attname, ',' ORDER BY a.attrelid::regclass::text, a.attnum)
   FROM pg_attribute a
   WHERE a.attrelid IN ('identity.ops_alarm'::regclass, 'identity.ops_alarm_fault'::regclass)
     AND a.attnum > 0 AND NOT a.attisdropped
     AND a.atttypid = 'text'::regtype
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = a.attrelid AND c.contype = 'c' AND c.conkey = ARRAY[a.attnum]
         AND pg_get_constraintdef(c.oid) LIKE '%= ANY (ARRAY[%'
     )),
  NULL,
  'every text column of both tables is bound to a closed set'
);
SELECT is(
  (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i
   WHERE i.indrelid = 'identity.ops_alarm'::regclass AND i.indisunique AND NOT i.indisprimary),
  'CREATE UNIQUE INDEX ops_alarm_open_kind ON identity.ops_alarm USING btree (kind) WHERE (resolved_at IS NULL)',
  'at most one open alarm per kind'
);
SELECT is(
  (SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || pg_get_function_result(p.oid)
          || ' ' || p.provolatile::text || CASE WHEN p.prosecdef THEN ' definer' ELSE '' END
          || ' ' || array_to_string(p.proconfig, ',')
          || CASE WHEN has_function_privilege('ductus_app', p.oid, 'EXECUTE') THEN ' app' ELSE '' END
          || CASE WHEN has_function_privilege('public', p.oid, 'EXECUTE') THEN ' public' ELSE '' END, ' | ' ORDER BY p.proname)
   FROM pg_proc p
   WHERE p.proname LIKE '%ops\_alarm%'),
  'raise_ops_alarm(p_kind text, p_reporter uuid) void v definer search_path="",lock_timeout=2000ms app | '
  'resolve_ops_alarm(p_kind text, p_reporter uuid) boolean v definer search_path="",lock_timeout=2000ms app',
  'two calls for ductus_app, each taking a kind and a reporter, and PUBLIC calls neither'
);
SELECT is(
  (SELECT count(*)::int FROM pg_proc p
   WHERE p.proname IN ('raise_ops_alarm', 'resolve_ops_alarm')
     AND p.prosrc LIKE '%LOCK TABLE identity.ops_alarm_fault IN SHARE ROW EXCLUSIVE MODE;%'),
  2,
  'both calls take the self-conflicting lock on the fault rows, so a raise and a resolve run one after the other'
);
SELECT ok(
  (SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity AND c.relowner = 'ductus_identity'::regrole) AND count(*) = 2
   FROM pg_class c WHERE c.oid IN ('identity.ops_alarm'::regclass, 'identity.ops_alarm_fault'::regclass)),
  'both tables have ENABLE and FORCE ROW LEVEL SECURITY and belong to ductus_identity'
);
SELECT is(
  (SELECT string_agg(pol.polname || ' ' || pol.polcmd::text || ' ' || array_to_string(pol.polroles::regrole[], ','), ' | ' ORDER BY pol.polname)
   FROM pg_policy pol WHERE pol.polrelid IN ('identity.ops_alarm'::regclass, 'identity.ops_alarm_fault'::regclass)),
  'ops_alarm_fault_owner * ductus_identity | ops_alarm_owner * ductus_identity',
  'the only policies are the owner''s'
);
SELECT is(
  (SELECT string_agg(t.tgname, ',') FROM pg_trigger t
   WHERE t.tgrelid IN ('identity.ops_alarm'::regclass, 'identity.ops_alarm_fault'::regclass) AND NOT t.tgisinternal),
  NULL,
  'no trigger copies an alarm or a fault row elsewhere'
);

-- 2. The access matrix of the new tables: role by operation, as migrated.
CREATE FUNCTION pg_temp.probe(p_table text, p_role text, p_op text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_result text;
BEGIN
  v_result := pg_temp.ask_as(p_role, 'anon', CASE p_table || ' ' || p_op
    WHEN 'ops_alarm SELECT' THEN 'SELECT ''rows='' || count(*) FROM identity.ops_alarm'
    WHEN 'ops_alarm INSERT' THEN 'WITH x AS (INSERT INTO identity.ops_alarm (kind, category) VALUES (''ready_queue'', ''operational'') RETURNING 1) SELECT ''rows='' || count(*) FROM x'
    WHEN 'ops_alarm UPDATE' THEN 'WITH x AS (UPDATE identity.ops_alarm SET resolved_at = now() RETURNING 1) SELECT ''rows='' || count(*) FROM x'
    WHEN 'ops_alarm DELETE' THEN 'WITH x AS (DELETE FROM identity.ops_alarm RETURNING 1) SELECT ''rows='' || count(*) FROM x'
    WHEN 'ops_alarm_fault SELECT' THEN 'SELECT ''rows='' || count(*) FROM identity.ops_alarm_fault'
    WHEN 'ops_alarm_fault INSERT' THEN 'WITH x AS (INSERT INTO identity.ops_alarm_fault (kind, reporter) VALUES (''ready_queue'', gen_random_uuid()) RETURNING 1) SELECT ''rows='' || count(*) FROM x'
    WHEN 'ops_alarm_fault UPDATE' THEN 'WITH x AS (UPDATE identity.ops_alarm_fault SET reported_at = now() RETURNING 1) SELECT ''rows='' || count(*) FROM x'
    WHEN 'ops_alarm_fault DELETE' THEN 'WITH x AS (DELETE FROM identity.ops_alarm_fault RETURNING 1) SELECT ''rows='' || count(*) FROM x'
  END);
  RETURN CASE
    WHEN v_result LIKE '42501: permission denied for schema %' THEN 'no schema privilege'
    WHEN v_result LIKE '42501: permission denied for table %' THEN 'no table privilege'
    ELSE v_result
  END;
END
$$;
SELECT is(pg_temp.probe(t.tbl, r.role, o.op), r.expect[o.n], format('%s: %s on %s', r.role, o.op, t.tbl))
FROM (VALUES
  ('ductus_app', ARRAY['no table privilege', 'no table privilege', 'no table privilege', 'no table privilege']),
  ('ductus_auth', ARRAY['no table privilege', 'no table privilege', 'no table privilege', 'no table privilege']),
  ('ductus_evidence', ARRAY['no schema privilege', 'no schema privilege', 'no schema privilege', 'no schema privilege']),
  ('ductus_migrator', ARRAY['no table privilege', 'no table privilege', 'no table privilege', 'no table privilege']),
  ('ductus_retention', ARRAY['no table privilege', 'no table privilege', 'no table privilege', 'no table privilege']),
  ('ductus_worker', ARRAY['no schema privilege', 'no schema privilege', 'no schema privilege', 'no schema privilege']),
  ('ductus_test_stranger', ARRAY['no schema privilege', 'no schema privilege', 'no schema privilege', 'no schema privilege'])
) AS r (role, expect)
CROSS JOIN unnest(ARRAY['ops_alarm', 'ops_alarm_fault']) AS t (tbl)
CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) WITH ORDINALITY AS o (op, n);
SELECT ok(has_table_privilege('ductus_identity', t.tbl, o.op),
  format('ductus_identity (owner): %s on %s', o.op, t.tbl))
FROM unnest(ARRAY['identity.ops_alarm', 'identity.ops_alarm_fault']) AS t (tbl)
CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS o (op);
SELECT ok(NOT has_function_privilege(r.role, f.fn, 'EXECUTE'), format('%s does not call %s', r.role, f.fn))
FROM unnest(ARRAY['ductus_auth', 'ductus_evidence', 'ductus_worker', 'ductus_retention', 'ductus_test_stranger']) AS r (role)
CROSS JOIN unnest(ARRAY['identity.raise_ops_alarm(text, uuid)', 'identity.resolve_ops_alarm(text, uuid)']) AS f (fn);

-- 3. Calls as the web process. A raise answers "ok"; a resolve answers true
-- when the alarm of the kind is closed (or none was open) and false when a
-- fresh fault row of another reporter holds it open. Reporters a and b stand
-- for two replicas sharing the database.
CREATE FUNCTION pg_temp.a() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-4000-8000-00000000000a'::uuid $$;
CREATE FUNCTION pg_temp.b() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-4000-8000-00000000000b'::uuid $$;
CREATE FUNCTION pg_temp.call(p_fn text, p_kind text, p_reporter uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask('anon', format('SELECT coalesce(nullif(identity.%I(%L, %L)::text, ''''), ''ok'')', p_fn, p_kind, p_reporter))
$$;
CREATE FUNCTION pg_temp.owner(p_sql text) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.ask_as('ductus_identity', 'anon', p_sql) $$;
CREATE FUNCTION pg_temp.alarms() RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.owner($q$ SELECT coalesce(string_agg(concat_ws(' ', kind, category, raise_count,
                                                                  CASE WHEN resolved_at IS NULL THEN 'open' ELSE 'closed' END),
                                                        ' | ' ORDER BY kind, first_raised_at, resolved_at NULLS LAST), '')
                           FROM identity.ops_alarm $q$)
$$;
CREATE FUNCTION pg_temp.faults() RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.owner(format($q$ SELECT coalesce(string_agg(kind || ' ' || CASE reporter WHEN %L THEN 'a' WHEN %L THEN 'b' ELSE 'other' END,
                                                             ' | ' ORDER BY kind, reporter), '')
                                  FROM identity.ops_alarm_fault $q$, pg_temp.a(), pg_temp.b()))
$$;
-- Makes reporter a's fault row of a kind p_seconds older, as if a had last
-- reported that long ago.
CREATE FUNCTION pg_temp.age_a(p_kind text, p_seconds int) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.owner(format($q$ WITH x AS (UPDATE identity.ops_alarm_fault SET reported_at = reported_at - make_interval(secs => %s)
                                             WHERE kind = %L AND reporter = %L RETURNING 1)
                                  SELECT 'rows=' || count(*) FROM x $q$, p_seconds, p_kind, pg_temp.a()))
$$;

SELECT is(pg_temp.call(f.fn, k.kind, pg_temp.a()), 'ZD422: invalid input', format('ZD422: %s with %s', f.fn, coalesce(k.kind, 'no kind')))
FROM unnest(ARRAY['raise_ops_alarm', 'resolve_ops_alarm']) AS f (fn)
CROSS JOIN (VALUES (NULL::text), (''), ('READY_DATABASE'), ('ready_database '), ('Moj esej o Krleži'), ('ready')) AS k (kind);
SELECT is(pg_temp.call(f.fn, 'ready_queue', NULL), 'ZD422: invalid input', format('ZD422: %s with no reporter', f.fn))
FROM unnest(ARRAY['raise_ops_alarm', 'resolve_ops_alarm']) AS f (fn);
SELECT is(pg_temp.alarms() || '/' || pg_temp.faults(), '/', 'no refused call wrote a row');

SELECT is(pg_temp.call('resolve_ops_alarm', 'ready_queue', pg_temp.b()), 'true', 'resolving with nothing open is accepted');
SELECT is(pg_temp.alarms() || '/' || pg_temp.faults(), '/', 'and writes nothing');

-- Two reporters: a sees the fault, b sees none. The alarm stays open.
SELECT is(pg_temp.call('raise_ops_alarm', 'ready_queue', pg_temp.a()), 'ok', 'a raises');
SELECT is(pg_temp.call('resolve_ops_alarm', 'ready_queue', pg_temp.b()), 'false', 'b cannot close what a still sees');
SELECT is(pg_temp.call('resolve_ops_alarm', 'ready_queue', pg_temp.b()), 'false', 'nor on a second try');
SELECT is(pg_temp.alarms(), 'ready_queue operational 1 open', 'the alarm a raised stays open');
SELECT is(pg_temp.faults(), 'ready_queue a', 'a''s fault row is kept; b had none');

-- Kinds are independent: a's queue fault does not hold a signing alarm.
SELECT is(pg_temp.call('raise_ops_alarm', 'ready_signing', pg_temp.b()), 'ok', 'b raises signing');
SELECT is(pg_temp.call('resolve_ops_alarm', 'ready_signing', pg_temp.b()), 'true', 'b closes signing while a holds the queue');
SELECT is(pg_temp.alarms(), 'ready_queue operational 1 open | ready_signing security 1 closed',
  'signing is a security alarm and closes on its own');

-- a recovers: the alarm closes. A new fault opens a new episode.
SELECT is(pg_temp.call('resolve_ops_alarm', 'ready_queue', pg_temp.a()), 'true', 'a recovers and closes');
SELECT is(pg_temp.faults(), '', 'a''s fault row is gone');
SELECT is(pg_temp.call('raise_ops_alarm', 'ready_queue', pg_temp.a()), 'ok', 'a raises again');
SELECT is(pg_temp.alarms(), 'ready_queue operational 1 closed | ready_queue operational 1 open | ready_signing security 1 closed',
  'a raise after a close opens a new episode and leaves the closed one');

-- Both see the fault; one recovering keeps it open, the second closes it.
SELECT is(pg_temp.call('raise_ops_alarm', 'ready_queue', pg_temp.b()), 'ok', 'b raises too');
SELECT is(pg_temp.call('resolve_ops_alarm', 'ready_queue', pg_temp.a()), 'false', 'a recovers, b still holds');
SELECT is(pg_temp.call('resolve_ops_alarm', 'ready_queue', pg_temp.b()), 'true', 'b recovers and closes');
SELECT is(pg_temp.alarms(), 'ready_queue operational 1 closed | ready_queue operational 2 closed | ready_signing security 1 closed',
  'the second episode counted both raises and is closed');

-- a stops reporting in the middle of a fault: its row holds for 120 s, then
-- b closes.
SELECT is(pg_temp.call('raise_ops_alarm', 'ready_queue', pg_temp.a()), 'ok', 'a raises a third episode');
SELECT is(pg_temp.age_a('ready_queue', 119), 'rows=1', 'a last reported 119 s ago');
SELECT is(pg_temp.call('resolve_ops_alarm', 'ready_queue', pg_temp.b()), 'false', 'a fresh row still holds');
SELECT is(pg_temp.age_a('ready_queue', 2), 'rows=1', 'a last reported 121 s ago');
SELECT is(pg_temp.call('resolve_ops_alarm', 'ready_queue', pg_temp.b()), 'true', 'a stale row does not hold');
SELECT is(pg_temp.faults(), '', 'and is deleted');
SELECT is(pg_temp.alarms(),
  'ready_queue operational 1 closed | ready_queue operational 2 closed | ready_queue operational 1 closed | ready_signing security 1 closed',
  'the third episode is closed');

-- A raise drops stale rows of its kind; a repeated raise refreshes its own.
SELECT is(pg_temp.call('raise_ops_alarm', 'ready_queue', pg_temp.a()), 'ok', 'a raises a fourth episode');
SELECT is(pg_temp.age_a('ready_queue', 121), 'rows=1', 'a last reported 121 s ago');
SELECT is(pg_temp.call('raise_ops_alarm', 'ready_queue', pg_temp.b()), 'ok', 'b raises');
SELECT is(pg_temp.faults(), 'ready_queue b', 'b''s raise dropped a''s stale row');
SELECT is(pg_temp.call('raise_ops_alarm', 'ready_queue', pg_temp.a()), 'ok', 'a raises again');
SELECT is(pg_temp.age_a('ready_queue', 100), 'rows=1', 'a last reported 100 s ago');
SELECT is(pg_temp.call('raise_ops_alarm', 'ready_queue', pg_temp.a()), 'ok', 'a refreshes');
SELECT is(pg_temp.owner(format($$ SELECT (reported_at > statement_timestamp() - interval '5 seconds')::text
                                  FROM identity.ops_alarm_fault WHERE kind = 'ready_queue' AND reporter = %L $$, pg_temp.a())),
  'true', 'a''s row is fresh again after the refresh');
SELECT is(pg_temp.alarms(),
  'ready_queue operational 1 closed | ready_queue operational 2 closed | ready_queue operational 1 closed | '
  'ready_queue operational 4 open | ready_signing security 1 closed',
  'every raise in the episode counts, refreshes included');
SELECT is(pg_temp.owner($$ SELECT bool_and(last_raised_at >= first_raised_at AND (resolved_at IS NULL OR resolved_at >= last_raised_at))::text
                           FROM identity.ops_alarm $$), 'true', 'the timestamps of every episode are in order');

-- 4. The table refuses a category that does not match the kind and a count
-- below one, even from its owner.
SELECT is(pg_temp.owner($$ INSERT INTO identity.ops_alarm (kind, category) VALUES ('ready_storage', 'security') RETURNING 'x' $$),
  '23514: new row for relation "ops_alarm" violates check constraint "ops_alarm_check"', 'storage is not a security alarm');
SELECT is(pg_temp.owner($$ INSERT INTO identity.ops_alarm (kind, category, raise_count) VALUES ('ready_storage', 'operational', 0) RETURNING 'x' $$),
  '23514: new row for relation "ops_alarm" violates check constraint "ops_alarm_raise_count_check"', 'a count below one is refused');
SELECT is(pg_temp.owner($$ INSERT INTO identity.ops_alarm (kind, category) VALUES ('ready_queue', 'operational') RETURNING 'x' $$),
  '23505: duplicate key value violates unique constraint "ops_alarm_open_kind"', 'a second open alarm of a kind is refused');
SELECT is(pg_temp.owner($$ INSERT INTO identity.ops_alarm_fault (kind, reporter) VALUES ('ready', gen_random_uuid()) RETURNING 'x' $$),
  '23514: new row for relation "ops_alarm_fault" violates check constraint "ops_alarm_fault_kind_check"', 'a fault row of an unknown kind is refused');

SELECT * FROM finish();
ROLLBACK;

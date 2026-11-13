-- DAN-184, M11.9-P01 (contract on #1836, c.6821517800): the in-app alarm
-- channel. An alarm is a kind from a closed set and a few timestamps; no
-- column can hold a person, an institution, a work or any free text.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
SELECT no_plan();

-- 1. The table: every text column is bound to a set; nothing else is text.
SELECT is(
  (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END,
                     ', ' ORDER BY a.attnum)
   FROM pg_attribute a WHERE a.attrelid = 'identity.ops_alarm'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
  'id uuid not null, kind text not null, category text not null, first_raised_at timestamp with time zone not null, '
  'last_raised_at timestamp with time zone not null, raise_count integer not null, resolved_at timestamp with time zone',
  'ops_alarm has no column for a person, an institution, a work or a message'
);
SELECT is(
  (SELECT string_agg(a.attname, ',' ORDER BY a.attnum)
   FROM pg_attribute a
   WHERE a.attrelid = 'identity.ops_alarm'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.atttypid = 'text'::regtype
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = a.attrelid AND c.contype = 'c' AND c.conkey = ARRAY[a.attnum]
         AND pg_get_constraintdef(c.oid) LIKE '%= ANY (ARRAY[%'
     )),
  NULL,
  'every text column is bound to a closed set'
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
  'raise_ops_alarm(p_kind text) void v definer search_path="",lock_timeout=2000ms app | resolve_ops_alarm(p_kind text) void v definer search_path="",lock_timeout=2000ms app',
  'two calls for ductus_app, each taking only a kind, and PUBLIC calls neither'
);
SELECT ok(
  (SELECT c.relrowsecurity AND c.relforcerowsecurity AND c.relowner = 'ductus_identity'::regrole
   FROM pg_class c WHERE c.oid = 'identity.ops_alarm'::regclass),
  'ops_alarm has ENABLE and FORCE ROW LEVEL SECURITY and belongs to ductus_identity'
);
SELECT is(
  (SELECT string_agg(pol.polname || ' ' || pol.polcmd::text || ' ' || array_to_string(pol.polroles::regrole[], ','), ' | ')
   FROM pg_policy pol WHERE pol.polrelid = 'identity.ops_alarm'::regclass),
  'ops_alarm_owner * ductus_identity',
  'the only policy is the owner''s'
);
SELECT is(
  (SELECT string_agg(t.tgname, ',') FROM pg_trigger t WHERE t.tgrelid = 'identity.ops_alarm'::regclass AND NOT t.tgisinternal),
  NULL,
  'no trigger copies an alarm elsewhere'
);

-- 2. The access matrix of the new table: role by operation, as migrated.
CREATE FUNCTION pg_temp.probe(p_role text, p_op text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_result text;
BEGIN
  v_result := pg_temp.ask_as(p_role, 'anon', CASE p_op
    WHEN 'SELECT' THEN 'SELECT ''rows='' || count(*) FROM identity.ops_alarm'
    WHEN 'INSERT' THEN 'WITH x AS (INSERT INTO identity.ops_alarm (kind, category) VALUES (''ready_queue'', ''operational'') RETURNING 1) SELECT ''rows='' || count(*) FROM x'
    WHEN 'UPDATE' THEN 'WITH x AS (UPDATE identity.ops_alarm SET resolved_at = now() RETURNING 1) SELECT ''rows='' || count(*) FROM x'
    WHEN 'DELETE' THEN 'WITH x AS (DELETE FROM identity.ops_alarm RETURNING 1) SELECT ''rows='' || count(*) FROM x'
  END);
  RETURN CASE
    WHEN v_result LIKE '42501: permission denied for schema %' THEN 'no schema privilege'
    WHEN v_result LIKE '42501: permission denied for table %' THEN 'no table privilege'
    ELSE v_result
  END;
END
$$;
SELECT is(pg_temp.probe(r.role, o.op), r.expect[o.n], format('%s: %s on ops_alarm', r.role, o.op))
FROM (VALUES
  ('ductus_app', ARRAY['no table privilege', 'no table privilege', 'no table privilege', 'no table privilege']),
  ('ductus_auth', ARRAY['no table privilege', 'no table privilege', 'no table privilege', 'no table privilege']),
  ('ductus_evidence', ARRAY['no schema privilege', 'no schema privilege', 'no schema privilege', 'no schema privilege']),
  ('ductus_migrator', ARRAY['no table privilege', 'no table privilege', 'no table privilege', 'no table privilege']),
  ('ductus_retention', ARRAY['no table privilege', 'no table privilege', 'no table privilege', 'no table privilege']),
  ('ductus_worker', ARRAY['no schema privilege', 'no schema privilege', 'no schema privilege', 'no schema privilege']),
  ('ductus_test_stranger', ARRAY['no schema privilege', 'no schema privilege', 'no schema privilege', 'no schema privilege'])
) AS r (role, expect)
CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) WITH ORDINALITY AS o (op, n);
SELECT ok(has_table_privilege('ductus_identity', 'identity.ops_alarm', o.op),
  format('ductus_identity (owner): %s on ops_alarm', o.op))
FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS o (op);
SELECT ok(NOT has_function_privilege(r.role, f.fn, 'EXECUTE'), format('%s does not call %s', r.role, f.fn))
FROM unnest(ARRAY['ductus_auth', 'ductus_evidence', 'ductus_worker', 'ductus_retention', 'ductus_test_stranger']) AS r (role)
CROSS JOIN unnest(ARRAY['identity.raise_ops_alarm(text)', 'identity.resolve_ops_alarm(text)']) AS f (fn);

-- 3. Calls as the web process, with and without a session: the session does
-- not matter, the kind is the only input.
CREATE FUNCTION pg_temp.call(p_fn text, p_kind text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask('anon', format('SELECT identity.%I(%L)::text || ''ok''', p_fn, p_kind))
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

SELECT is(pg_temp.call(f.fn, k.kind), 'ZD422: invalid input', format('ZD422: %s with %s', f.fn, coalesce(k.kind, 'no kind')))
FROM unnest(ARRAY['raise_ops_alarm', 'resolve_ops_alarm']) AS f (fn)
CROSS JOIN (VALUES (NULL::text), (''), ('READY_DATABASE'), ('ready_database '), ('Moj esej o Krleži'), ('ready')) AS k (kind);
SELECT is(pg_temp.alarms(), '', 'no refused call wrote a row');

SELECT is(pg_temp.call('resolve_ops_alarm', 'ready_queue'), 'ok', 'resolving with nothing open is accepted');
SELECT is(pg_temp.alarms(), '', 'and writes nothing');

SELECT is(pg_temp.call('raise_ops_alarm', 'ready_queue'), 'ok', 'a raise is accepted');
SELECT is(pg_temp.call('raise_ops_alarm', 'ready_queue'), 'ok', 'a repeated raise is accepted');
SELECT is(pg_temp.call('raise_ops_alarm', 'ready_signing'), 'ok', 'a signing raise is accepted');
SELECT is(pg_temp.alarms(), 'ready_queue operational 2 open | ready_signing security 1 open',
  'a repeated raise counts on the open alarm; signing is a security alarm');

SELECT is(pg_temp.call('resolve_ops_alarm', 'ready_queue'), 'ok', 'a resolve is accepted');
SELECT is(pg_temp.call('raise_ops_alarm', 'ready_queue'), 'ok', 'a raise after the resolve is accepted');
SELECT is(pg_temp.alarms(), 'ready_queue operational 2 closed | ready_queue operational 1 open | ready_signing security 1 open',
  'a raise after a resolve opens a new episode and leaves the closed one');
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

SELECT * FROM finish();
ROLLBACK;

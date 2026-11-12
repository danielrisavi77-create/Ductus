-- DAN-427, M11.5-P02 (contract on #1836, c.6820446364): a person's interface
-- language. Each person reads and sets only their own; who it is comes from
-- the session. Personas of institution.inc; every person is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
SELECT no_plan();

-- 1. The table, the calls and the owner.
SELECT is(
  (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END,
                     ', ' ORDER BY a.attnum)
   FROM pg_attribute a WHERE a.attrelid = 'identity.user_preference'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
  'user_id uuid not null, institution_id uuid not null, interface_locale text not null, updated_at timestamp with time zone not null',
  'user_preference holds the interface language and nothing else'
);
SELECT is(
  (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
   WHERE c.conrelid = 'identity.user_preference'::regclass AND c.contype = 'c'),
  'CHECK ((interface_locale = ANY (ARRAY[''hr''::text, ''en''::text])))',
  'interface_locale is bound to the set of catalogues'
);
SELECT is(
  (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
   FROM pg_attribute a WHERE a.attrelid = 'identity.user_account'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
  'id uuid, institution_id uuid, oidc_issuer text, oidc_subject text, hr_edu_person_unique_id text, created_at timestamp with time zone',
  'user_account and what AAI@EduHr sent are unchanged (D-09)'
);
SELECT is(
  (SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || pg_get_function_result(p.oid)
          || ' ' || p.provolatile::text || CASE WHEN p.prosecdef THEN ' definer' ELSE '' END
          || ' ' || array_to_string(p.proconfig, ',')
          || CASE WHEN has_function_privilege('ductus_app', p.oid, 'EXECUTE') THEN ' app' ELSE '' END
          || CASE WHEN has_function_privilege('public', p.oid, 'EXECUTE') THEN ' public' ELSE '' END, ' | ' ORDER BY p.proname)
   FROM pg_proc p
   WHERE p.proname LIKE '%interface\_locale%'),
  'interface_locale() text s definer search_path="" app | set_interface_locale(p_locale text) text v definer search_path="" app',
  'two calls for ductus_app, with no argument for a user or an institution, and PUBLIC calls neither'
);
SELECT ok(
  (SELECT c.relrowsecurity AND c.relforcerowsecurity AND c.relowner = 'ductus_identity'::regrole
   FROM pg_class c WHERE c.oid = 'identity.user_preference'::regclass),
  'user_preference has ENABLE and FORCE ROW LEVEL SECURITY and belongs to ductus_identity'
);
SELECT is(
  (SELECT string_agg(pol.polname || ' ' || pol.polcmd::text || ' ' || array_to_string(pol.polroles::regrole[], ','), ' | ')
   FROM pg_policy pol WHERE pol.polrelid = 'identity.user_preference'::regclass),
  'user_preference_owner * ductus_identity',
  'the only policy is the owner''s'
);
SELECT is(
  (SELECT string_agg(t.tgname, ',') FROM pg_trigger t WHERE t.tgrelid = 'identity.user_preference'::regclass AND NOT t.tgisinternal),
  NULL,
  'no trigger on user_preference'
);

-- 2. The access matrix of the new table: role by operation, as migrated.
CREATE FUNCTION pg_temp.probe(p_role text, p_op text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_result text;
BEGIN
  v_result := pg_temp.ask_as(p_role, 'anon', CASE p_op
    WHEN 'SELECT' THEN 'SELECT ''rows='' || count(*) FROM identity.user_preference'
    WHEN 'INSERT' THEN 'WITH x AS (INSERT INTO identity.user_preference DEFAULT VALUES RETURNING 1) SELECT ''rows='' || count(*) FROM x'
    WHEN 'UPDATE' THEN 'WITH x AS (UPDATE identity.user_preference SET interface_locale = ''en'' RETURNING 1) SELECT ''rows='' || count(*) FROM x'
    WHEN 'DELETE' THEN 'WITH x AS (DELETE FROM identity.user_preference RETURNING 1) SELECT ''rows='' || count(*) FROM x'
  END);
  RETURN CASE
    WHEN v_result LIKE '42501: permission denied for schema %' THEN 'no schema privilege'
    WHEN v_result LIKE '42501: permission denied for table %' THEN 'no table privilege'
    ELSE v_result
  END;
END
$$;
SELECT is(pg_temp.probe(r.role, o.op), r.expect[o.n], format('%s: %s on user_preference', r.role, o.op))
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
SELECT ok(has_table_privilege('ductus_identity', 'identity.user_preference', o.op),
  format('ductus_identity (owner): %s on user_preference', o.op))
FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS o (op);
SELECT ok(NOT has_function_privilege(r.role, f.fn, 'EXECUTE'), format('%s does not call %s', r.role, f.fn))
FROM unnest(ARRAY['ductus_auth', 'ductus_evidence', 'ductus_worker', 'ductus_retention', 'ductus_test_stranger']) AS r (role)
CROSS JOIN unnest(ARRAY['identity.set_interface_locale(text)', 'identity.interface_locale()']) AS f (fn);

-- 3. Each person their own: Ana (fak-a), Dora (fak-a) and Tomo (fak-b).
CREATE FUNCTION pg_temp.owner(p_sql text) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.ask_as('ductus_identity', 'anon', p_sql) $$;

SELECT is(pg_temp.ask('ana', 'SELECT identity.interface_locale()'), NULL, 'nothing chosen yet: NULL (the default)');
SELECT is(pg_temp.ask('ana', 'SELECT identity.set_interface_locale(''en'')'), 'en', 'Ana chooses English');
SELECT is(pg_temp.ask('tomo', 'SELECT identity.set_interface_locale(''hr'')'), 'hr', 'Tomo chooses Croatian');
SELECT is(pg_temp.ask('ana', 'SELECT identity.interface_locale()'), 'en', 'Ana reads her own choice');
SELECT is(pg_temp.ask('dora', 'SELECT identity.interface_locale()'), NULL, 'Dora, same institution, does not read Ana''s');
SELECT is(pg_temp.ask('tomo', 'SELECT identity.interface_locale()'), 'hr', 'Tomo, another institution, reads only his');
SELECT is(pg_temp.ask('ana', 'SELECT identity.set_interface_locale(''hr'')'), 'hr', 'Ana changes her mind');
SELECT is(
  pg_temp.owner($$ SELECT string_agg(p.name || ' ' || (u.institution_id = p.institution_id)::text || ' ' || u.interface_locale,
                                     ' | ' ORDER BY p.name)
                   FROM identity.user_preference u JOIN person p ON p.id = u.user_id $$),
  'ana true hr | tomo true hr',
  'one row per person, with the session''s institution; a change updates the row'
);

-- 4. Values outside the set: ZD422, nothing written or changed.
SELECT is(pg_temp.ask('dora', format('SELECT identity.set_interface_locale(%L)', v.locale)), 'ZD422: invalid input',
  format('ZD422: %s', v.what))
FROM (VALUES
  ('upper case', 'HR'), ('region', 'hr-HR'), ('underscore region', 'en_GB'), ('unknown language', 'de'),
  ('empty', ''), ('padding', ' hr'), ('newline', E'hr\n'), ('Cyrillic look-alike', chr(1211) || 'r'),
  ('NULL', NULL)
) AS v (what, locale);
SELECT is(pg_temp.ask('ana', 'SELECT identity.set_interface_locale(''de'')'), 'ZD422: invalid input',
  'a refused value on an existing row');
SELECT is(pg_temp.owner('SELECT string_agg(interface_locale, '','' ORDER BY user_id) FROM identity.user_preference'), 'hr,hr',
  'no refused call wrote or changed a row');

-- 5. No live session: ZD401 on both calls, nothing written.
SELECT is(pg_temp.ask(t.name, f.sql), 'ZD401: not authenticated', format('ZD401 for %s: %s', t.name, f.sql))
FROM unnest(ARRAY['anon', 'expired', 'closed', 'unknown']) AS t (name)
CROSS JOIN unnest(ARRAY['SELECT identity.set_interface_locale(''en'')', 'SELECT identity.interface_locale()']) AS f (sql);
SELECT is(pg_temp.owner('SELECT count(*)::text FROM identity.user_preference'), '2', 'no call without a session wrote a row');

SELECT * FROM finish();
ROLLBACK;

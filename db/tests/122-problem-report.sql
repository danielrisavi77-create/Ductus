-- DAN-431, M11.10-P01 (contract on #1836, c.6788234570): a student or a
-- teacher reports a problem; the report holds their own description and a
-- closed technical context, never the text of a work. Personas of
-- institution.inc; every person, course and text is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
SELECT no_plan();

-- 1. The table: one free text column (the description); every other column is
-- a key, a time, a number or a text bound by a CHECK to a set or a pattern.
SELECT is(
  (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END,
                     ', ' ORDER BY a.attnum)
   FROM pg_attribute a WHERE a.attrelid = 'identity.problem_report'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
  'id uuid not null, reference text not null, institution_id uuid not null, user_id uuid not null, category text not null, '
  'description text not null, route text, app_version text not null, browser_family text not null, browser_major integer, '
  'sync_state text, created_at timestamp with time zone not null',
  'problem_report has no column for a title, a paragraph, a work or a journal'
);
SELECT is(
  (SELECT string_agg(a.attname, ',' ORDER BY a.attnum)
   FROM pg_attribute a
   WHERE a.attrelid = 'identity.problem_report'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.atttypid = 'text'::regtype
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = a.attrelid AND c.contype = 'c' AND c.conkey = ARRAY[a.attnum]
         AND (pg_get_constraintdef(c.oid) LIKE '%= ANY (ARRAY[%' OR pg_get_constraintdef(c.oid) LIKE '%~ ''^%$''%')
     )),
  'description',
  'every text column but description is bound to a set or an anchored pattern'
);
SELECT is(
  (SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || pg_get_function_result(p.oid)
          || ' ' || p.provolatile::text || CASE WHEN p.prosecdef THEN ' definer' ELSE '' END
          || ' ' || array_to_string(p.proconfig, ',')
          || CASE WHEN has_function_privilege('ductus_app', p.oid, 'EXECUTE') THEN ' app' ELSE '' END
          || CASE WHEN has_function_privilege('public', p.oid, 'EXECUTE') THEN ' public' ELSE '' END, ' | ' ORDER BY p.proname)
   FROM pg_proc p
   WHERE p.proname LIKE '%problem\_report%'),
  'submit_problem_report(p_category text, p_description text, p_route text, p_app_version text, p_browser_family text, '
  'p_browser_major integer, p_sync_state text) text v definer search_path="" app',
  'one call for ductus_app, with no argument for a user, an institution or a work, and PUBLIC calls it not'
);
SELECT ok(
  (SELECT c.relrowsecurity AND c.relforcerowsecurity AND c.relowner = 'ductus_identity'::regrole
   FROM pg_class c WHERE c.oid = 'identity.problem_report'::regclass),
  'problem_report has ENABLE and FORCE ROW LEVEL SECURITY and belongs to ductus_identity'
);
SELECT is(
  (SELECT string_agg(pol.polname || ' ' || pol.polcmd::text || ' ' || array_to_string(pol.polroles::regrole[], ','), ' | ')
   FROM pg_policy pol WHERE pol.polrelid = 'identity.problem_report'::regclass),
  'problem_report_owner * ductus_identity',
  'the only policy is the owner''s'
);
SELECT is(
  (SELECT string_agg(t.tgname, ',') FROM pg_trigger t WHERE t.tgrelid = 'identity.problem_report'::regclass AND NOT t.tgisinternal),
  NULL,
  'no trigger copies a report elsewhere'
);

-- 2. The access matrix of the new table: role by operation, as migrated.
CREATE FUNCTION pg_temp.probe(p_role text, p_op text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_result text;
BEGIN
  v_result := pg_temp.ask_as(p_role, 'anon', CASE p_op
    WHEN 'SELECT' THEN 'SELECT ''rows='' || count(*) FROM identity.problem_report'
    WHEN 'INSERT' THEN 'WITH x AS (INSERT INTO identity.problem_report DEFAULT VALUES RETURNING 1) SELECT ''rows='' || count(*) FROM x'
    WHEN 'UPDATE' THEN 'WITH x AS (UPDATE identity.problem_report SET description = ''x'' RETURNING 1) SELECT ''rows='' || count(*) FROM x'
    WHEN 'DELETE' THEN 'WITH x AS (DELETE FROM identity.problem_report RETURNING 1) SELECT ''rows='' || count(*) FROM x'
  END);
  RETURN CASE
    WHEN v_result LIKE '42501: permission denied for schema %' THEN 'no schema privilege'
    WHEN v_result LIKE '42501: permission denied for table %' THEN 'no table privilege'
    ELSE v_result
  END;
END
$$;
SELECT is(pg_temp.probe(r.role, o.op), r.expect[o.n], format('%s: %s on problem_report', r.role, o.op))
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
SELECT ok(has_table_privilege('ductus_identity', 'identity.problem_report', o.op),
  format('ductus_identity (owner): %s on problem_report', o.op))
FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS o (op);
SELECT ok(NOT has_function_privilege(r.role, 'identity.submit_problem_report(text, text, text, text, text, integer, text)', 'EXECUTE'),
  format('%s does not call submit_problem_report', r.role))
FROM unnest(ARRAY['ductus_auth', 'ductus_evidence', 'ductus_worker', 'ductus_retention', 'ductus_test_stranger']) AS r (role);

-- 3. The classes of input. A call with every value in its class; then each
-- argument alone moved out of its class (ZD422), with nothing written.
CREATE FUNCTION pg_temp.submit(p_actor text, p_category text, p_description text, p_route text,
                               p_app_version text, p_family text, p_major bigint, p_sync text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format('SELECT identity.submit_problem_report(%L, %L, %L, %L, %L, %L::integer, %L)',
                                     p_category, p_description, p_route, p_app_version, p_family, p_major, p_sync))
$$;
CREATE FUNCTION pg_temp.owner(p_sql text) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.ask_as('ductus_identity', 'anon', p_sql) $$;

CREATE TEMP TABLE sent (actor text, reference text);
INSERT INTO sent VALUES
  ('ana', pg_temp.submit('ana', 'technical', 'Spremanje stoji na „Spremam”.', '/rad/[assignmentId]/predaja',
                         '1.4.0+0a1b2c3', 'firefox', 132, 'SYNCING')),
  ('vesna', pg_temp.submit('vesna', 'course', 'Kolegij se ne prikazuje.', NULL, '0a1b2c3d', 'other', NULL, NULL));
SELECT matches(reference, '^PR-[0-9A-F]{10}$', format('%s gets a reference, nothing else', actor)) FROM sent ORDER BY actor;
SELECT isnt((SELECT reference FROM sent WHERE actor = 'ana'), (SELECT reference FROM sent WHERE actor = 'vesna'),
  'two reports, two references');
SELECT is(
  pg_temp.owner($$ SELECT string_agg(concat_ws(' ', p.name, r.institution_id = p.institution_id, r.category, r.route,
                                               r.app_version, r.browser_family, r.browser_major, r.sync_state), ' | ' ORDER BY p.name)
                   FROM identity.problem_report r JOIN person p ON p.id = r.user_id $$),
  'ana t technical /rad/[assignmentId]/predaja 1.4.0+0a1b2c3 firefox 132 SYNCING | vesna t course 0a1b2c3d other',
  'who sent it and where from come from the session; the context is stored as sent'
);
SELECT is(
  pg_temp.owner(format($$ SELECT p.name FROM identity.problem_report r JOIN person p ON p.id = r.user_id
                          WHERE r.reference = %L $$, (SELECT reference FROM sent WHERE actor = 'ana'))),
  'ana',
  'the reference names the report it was returned for'
);

SELECT is(pg_temp.submit('ana', c.category, c.description, c.route, c.app_version, c.family, c.major, c.sync),
          'ZD422: invalid input', format('ZD422: %s', c.what))
FROM (VALUES
  ('category outside the set', 'other', 'Opis.', '/', '1.0.0', 'chromium', 1, 'SYNCED'),
  ('no category', NULL, 'Opis.', '/', '1.0.0', 'chromium', 1, 'SYNCED'),
  ('no description', 'technical', NULL, '/', '1.0.0', 'chromium', 1, 'SYNCED'),
  ('empty description', 'technical', '', '/', '1.0.0', 'chromium', 1, 'SYNCED'),
  ('description of spaces and line breaks', 'technical', E' \n\t ', '/', '1.0.0', 'chromium', 1, 'SYNCED'),
  ('description of a no-break and a zero width space', 'technical', chr(160) || chr(8203), '/', '1.0.0', 'chromium', 1, 'SYNCED'),
  ('description of 1001 characters', 'technical', repeat('a', 1001), '/', '1.0.0', 'chromium', 1, 'SYNCED'),
  ('description with a control character', 'technical', 'a' || chr(1) || 'b', '/', '1.0.0', 'chromium', 1, 'SYNCED'),
  ('description with DEL', 'technical', 'a' || chr(127) || 'b', '/', '1.0.0', 'chromium', 1, 'SYNCED'),
  ('description with a bidi override', 'technical', 'a' || chr(8238) || 'b', '/', '1.0.0', 'chromium', 1, 'SYNCED'),
  ('description with a bidi isolate', 'technical', 'a' || chr(8294) || 'b', '/', '1.0.0', 'chromium', 1, 'SYNCED'),
  ('route with a title in it', 'technical', 'Opis.', '/rad/Moj esej o Krleži', '1.0.0', 'chromium', 1, 'SYNCED'),
  ('route with a real id instead of the template', 'technical', 'Opis.', '/zadatak/00000000-0000-4000-8000-0000000000a1', '1.0.0', 'chromium', 1, 'SYNCED'),
  ('route with a query', 'technical', 'Opis.', '/rad?naslov=esej', '1.0.0', 'chromium', 1, 'SYNCED'),
  ('route outside the set', 'technical', 'Opis.', '/nepostojeca', '1.0.0', 'chromium', 1, 'SYNCED'),
  ('app version with words', 'technical', 'Opis.', '/', '1.0.0 Moj esej', 'chromium', 1, 'SYNCED'),
  ('app version with a sentence after a hash', 'technical', 'Opis.', '/', '1.0.0+abcdef0 tekst', 'chromium', 1, 'SYNCED'),
  ('app version of hex letters only, too short', 'technical', 'Opis.', '/', 'abc', 'chromium', 1, 'SYNCED'),
  ('no app version', 'technical', 'Opis.', '/', NULL, 'chromium', 1, 'SYNCED'),
  ('browser family outside the set', 'technical', 'Opis.', '/', '1.0.0', 'Mozilla/5.0 (X11)', 1, 'SYNCED'),
  ('no browser family', 'technical', 'Opis.', '/', '1.0.0', NULL, 1, 'SYNCED'),
  ('browser major below 0', 'technical', 'Opis.', '/', '1.0.0', 'chromium', -1, 'SYNCED'),
  ('browser major above 999', 'technical', 'Opis.', '/', '1.0.0', 'chromium', 1000, 'SYNCED'),
  ('sync state outside the set', 'technical', 'Opis.', '/', '1.0.0', 'chromium', 1, 'synced'),
  ('sync state carrying text', 'technical', 'Opis.', '/', '1.0.0', 'chromium', 1, 'Prvi odlomak rada')
) AS c (what, category, description, route, app_version, family, major, sync);
SELECT is(pg_temp.submit('ana', 'technical', 'Opis.', '/', '1.0.0', 'chromium', 3000000000, 'SYNCED'),
          '22003: value "3000000000" is out of range for type integer', 'a browser major beyond integer is refused before the call');
SELECT is(pg_temp.submit('ana', 'account', repeat('ž', 1000), '/', '1.0.0', 'safari', 0, NULL) ~ '^PR-[0-9A-F]{10}$', true,
  '1000 characters, not bytes, is the limit');
-- DAN-429: the public status page /stanje is a page in the shell, so its
-- route is in the set; the same migration carries /kako-radi (DAN-431, #1973)
-- and the access log route (DAN-294, #1969).
SELECT is(pg_temp.submit('vesna', 'technical', 'Stanje se ne osvježava.', t.route, '1.0.0', 'chromium', 1, NULL) ~ '^PR-[0-9A-F]{10}$', true,
  format('a report from %s is accepted', t.route))
FROM unnest(ARRAY['/stanje', '/kako-radi', '/rad/[assignmentId]/dnevnik-pristupa']) AS t (route);
SELECT is(pg_temp.owner($$ SELECT string_agg(route, ' | ' ORDER BY route) FROM identity.problem_report
                           WHERE user_id = {vesna} AND route IS NOT NULL $$),
  '/kako-radi | /rad/[assignmentId]/dnevnik-pristupa | /stanje', 'the new routes are stored as sent');
SELECT is(pg_temp.owner('SELECT count(*)::text FROM identity.problem_report'), '6', 'only the accepted calls wrote a row');

-- 4. No live session: ZD401, nothing written.
SELECT is(pg_temp.submit(t.name, 'technical', 'Opis.', '/', '1.0.0', 'chromium', 1, NULL), 'ZD401: not authenticated',
  format('ZD401 for %s', t.name))
FROM unnest(ARRAY['anon', 'expired', 'closed', 'unknown']) AS t (name);
SELECT is(pg_temp.owner('SELECT count(*)::text FROM identity.problem_report'), '6', 'no call without a session wrote a row');

-- 5. At most five in a sliding hour, per account. Ana has sent two; older
-- reports of Dora's do not count.
SELECT is(pg_temp.submit('ana', 'technical', 'Opis ' || n, '/', '1.0.0', 'chromium', 1, NULL) ~ '^PR-', true,
  format('Ana''s report %s of 5 in the hour', n + 2))
FROM generate_series(1, 3) AS n;
SELECT is(pg_temp.submit('ana', 'technical', 'Šesti.', '/', '1.0.0', 'chromium', 1, NULL), 'ZD429: too many reports',
  'the sixth in the hour is refused');
SELECT is(pg_temp.owner($$ SELECT count(*)::text FROM identity.problem_report WHERE user_id = {ana} $$), '5',
  'the refused one wrote nothing');
SELECT is(pg_temp.submit('dora', 'technical', 'Dorin.', '/', '1.0.0', 'chromium', 1, NULL) ~ '^PR-', true,
  'another account has its own limit');
SELECT is(pg_temp.owner($$
  WITH x AS (UPDATE identity.problem_report SET created_at = statement_timestamp() - interval '61 minutes'
             WHERE user_id = {ana} AND description LIKE 'Opis %' RETURNING 1)
  SELECT count(*)::text FROM x $$), '3', 'three of Ana''s reports age past the hour');
SELECT is(pg_temp.submit('ana', 'technical', 'Opet.', '/', '1.0.0', 'chromium', 1, NULL) ~ '^PR-', true,
  'a report older than an hour no longer counts');

SELECT * FROM finish();
ROLLBACK;

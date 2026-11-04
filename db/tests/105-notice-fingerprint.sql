-- The fingerprint of the notice a student acknowledged (DAN-306, M2.13-P02a;
-- attack plan #1502, A to F). The same golden vectors are asserted in
-- src/domain/notice/fingerprint.test.ts, so the server and the TS mirror
-- agree. Parallel sessions (E1, E2, E4) are in
-- tests/integration/institution.integration.test.ts.
-- Synthetic fixtures only (fixtures/institution.inc): Z1 of K1 is at version
-- 2, which Ana acknowledged before this migration (a row without a
-- fingerprint) and Dora has not.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';

SELECT plan(76);

-- Both golden vectors under one TimeZone, lc_time and DateStyle.
CREATE FUNCTION pg_temp.golden(p_zone text, p_lc_time text, p_datestyle text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('TimeZone', p_zone, true);
  PERFORM set_config('DateStyle', p_datestyle, true);
  BEGIN
    PERFORM set_config('lc_time', p_lc_time, true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('lc_time', 'C', true);
  END;
  RETURN institution.notice_fingerprint(1, 'Osvrt na zadani ulomak', 'Napišite osvrt na zadani ulomak.', 'essay',
           '2026-11-10T08:00:00.000Z', '2026-11-24T22:59:00.000Z', 'partially_allowed',
           '{proofreading,formatting,proofreading}', 'basic', 800, 1200)
    || ' ' || institution.notice_fingerprint(2, 'Kratki rad', E'Redak 1\r\nRedak\t2 "citat" \\ ž 😀', 'master_thesis',
           '2027-01-01T00:00:00.000Z', '2027-01-31T23:59:59.999Z', 'prohibited', '{translation}', 'extended',
           NULL, NULL);
END
$$;
-- The fingerprint of a stored version under a template version (A13).
CREATE FUNCTION pg_temp.of_version(p_template integer, p_assignment uuid, p_version integer) RETURNS text
LANGUAGE sql AS $$
  SELECT institution.notice_fingerprint(p_template, v.title, v.instructions, v.work_type, v.opens_at, v.due_at,
           v.ai_policy, v.ai_purposes, v.evidence_profile, v.word_min, v.word_max)
  FROM institution.assignment_version v WHERE v.assignment_id = p_assignment AND v.version_no = p_version
$$;
-- What a student stored for Z1, as text.
CREATE FUNCTION pg_temp.stored(p_student text, p_version integer) RETURNS text
LANGUAGE sql AS $$
  SELECT concat_ws(' ', coalesce(n.notice_template_version::text, '-'), coalesce(n.notice_fingerprint, '-'),
                   n.acknowledged_at)
  FROM institution.notice_acknowledgment n
  WHERE n.assignment_id = pg_temp.id('z1') AND n.version_no = p_version AND n.student_id = pg_temp.id(p_student)
$$;
CREATE FUNCTION pg_temp.acks() RETURNS bigint
LANGUAGE sql AS $$ SELECT count(*) FROM institution.notice_acknowledgment $$;

-- 1. The fingerprint (A2 to A7). The session's time zone, lc_time and
-- DateStyle do not change it (A6), and the SQL is the canonical bytes.
SELECT is(
  pg_temp.golden(g.zone, g.lc_time, g.datestyle),
  '46887c60a041c0c4d9b03a87bc255037fd18a8d15eaf276aefd7c3e4877baf2d '
  'ed1f97681a3e115bced99beb26d683f5ed57b59bb3c420602671894db0582c1d',
  'golden vectors under ' || g.zone || ', lc_time ' || g.lc_time || ', DateStyle ' || g.datestyle
)
FROM (VALUES
  (1, 'UTC', 'C', 'ISO, MDY'),
  (2, 'Europe/Zagreb', 'hr_HR.UTF-8', 'SQL, DMY'),
  (3, 'America/Los_Angeles', 'en_US.UTF-8', 'German, DMY')
) AS g (n, zone, lc_time, datestyle)
ORDER BY g.n;
SET LOCAL TimeZone TO 'UTC';
SET LOCAL DateStyle TO 'ISO, MDY';
SET LOCAL lc_time TO 'C';
SELECT is(
  encode(sha256(convert_to('ductus-notice-fingerprint-v1' || E'\n'
    || '{"aiPolicy":"partially_allowed","aiPurposes":["formatting","proofreading"],"dueAt":"2026-11-24T22:59:00.000Z",'
    || '"evidenceProfile":"basic","instructions":"Napišite osvrt na zadani ulomak.","opensAt":"2026-11-10T08:00:00.000Z",'
    || '"templateVersion":1,"title":"Osvrt na zadani ulomak","wordMax":1200,"wordMin":800,"workType":"essay"}', 'UTF8')), 'hex'),
  '46887c60a041c0c4d9b03a87bc255037fd18a8d15eaf276aefd7c3e4877baf2d',
  'the golden vector is sha256 of the prefix, a line feed and the JCS text'
);
SELECT is(
  institution.notice_fingerprint(1, 'Osvrt na zadani ulomak', 'Napišite osvrt na zadani ulomak.', 'essay',
    '2026-11-10T08:00:00.000999Z', '2026-11-24T22:59:00.000999Z', 'partially_allowed',
    '{formatting,proofreading}', 'basic', 800, 1200),
  '46887c60a041c0c4d9b03a87bc255037fd18a8d15eaf276aefd7c3e4877baf2d',
  'microseconds are cut to milliseconds, as a JavaScript Date holds them'
);
SELECT is(
  institution.notice_fingerprint(1, 't', 'u', 'essay', '2026-11-10 00:00Z', '2026-11-24 00:00Z', 'prohibited', '{translation}', 'basic', NULL, NULL),
  institution.notice_fingerprint(1, 't', 'u', 'essay', '2026-11-10 00:00Z', '2026-11-24 00:00Z', 'prohibited', '{}', 'basic', NULL, NULL),
  'a prohibited policy carries no purposes (A7)'
);
SELECT isnt(
  institution.notice_fingerprint(1, 't', 'u', 'essay', '2026-11-10 00:00Z', '2026-11-24 00:00Z', 'prohibited', '{}', 'basic', NULL, NULL),
  institution.notice_fingerprint(1, 't', 'u', 'essay', '2026-11-10 00:00Z', '2026-11-24 00:00Z', 'encouraged', '{}', 'basic', NULL, NULL),
  'prohibited differs from a policy that allows no purpose (A7)'
);

-- 2. Signatures and privileges (B5). The old signature is gone; the web
-- process may call the new one and not the fingerprint itself.
SELECT hasnt_function('institution', 'acknowledge_notice', ARRAY['uuid', 'integer'], 'acknowledge_notice(uuid, integer) is gone');
SELECT has_function('institution', 'acknowledge_notice', ARRAY['uuid', 'integer', 'integer'], 'acknowledge_notice(uuid, integer, integer) exists');
SELECT is_definer('institution', 'acknowledge_notice', ARRAY['uuid', 'integer', 'integer'], 'acknowledge_notice is SECURITY DEFINER');
SELECT ok(has_function_privilege('ductus_app', 'institution.acknowledge_notice(uuid, integer, integer)', 'EXECUTE'),
          'ductus_app may acknowledge with the template version');
SELECT ok(NOT has_function_privilege('ductus_app',
  'institution.notice_fingerprint(integer, text, text, text, timestamptz, timestamptz, text, text[], text, integer, integer)', 'EXECUTE'),
  'ductus_app may not call notice_fingerprint');
SELECT matches(
  pg_temp.ask('dora', $$ SELECT institution.notice_fingerprint(1, 't', 'u', 'essay', now(), now(), 'prohibited', '{}', 'basic', NULL, NULL) $$),
  '^42501: ', 'a student cannot call notice_fingerprint'
);

-- 3. The refusals of the old signature stay (B6) and write nothing.
SELECT is(pg_temp.ask(a.actor, 'SELECT institution.acknowledge_notice({z1}, 2, 1)'), 'ZD401: not authenticated',
          a.actor || ': acknowledge_notice is refused')
FROM unnest(ARRAY['anon', 'expired', 'closed', 'unknown']) WITH ORDINALITY AS a (actor, n)
ORDER BY a.n;
SELECT is(pg_temp.ask(a.actor, 'SELECT institution.acknowledge_notice({z1}, 2, 1)'), 'ZD403: forbidden',
          a.actor || ': acknowledge_notice of Z1 is refused')
FROM unnest(ARRAY['vesna', 'iva', 'boris', 'marko', 'petra']) WITH ORDINALITY AS a (actor, n)
ORDER BY a.n;
SELECT is(pg_temp.ask('dora', format('SELECT institution.acknowledge_notice({z1}, %s, 1)', v)), 'ZD409: conflict',
          'Dora: version ' || v || ' is not current')
FROM unnest(ARRAY[1, 3]) AS v;
SELECT is(pg_temp.acks(), 4::bigint, 'the refused calls left no row behind');

-- 4. A template version below 1 or none is invalid input and writes nothing.
SELECT is(pg_temp.ask('dora', format('SELECT institution.acknowledge_notice({z1}, 2, %s)', t)), 'ZD422: invalid input',
          'Dora: template version ' || t || ' is refused')
FROM unnest(ARRAY['0', '-1', 'NULL']) WITH ORDINALITY AS u (t, n)
ORDER BY u.n;
SELECT is(pg_temp.stored('dora', 2), NULL, 'Dora has no acknowledgment of version 2 yet');

-- 5. The server computes the fingerprint from the stored version (A13); a
-- repeat for the same notice returns the first time (E4), a repeat for
-- another template version is a conflict and changes nothing (C1).
SELECT matches(pg_temp.ask('dora', 'SELECT institution.acknowledge_notice({z1}, 2, 1)'), '^[0-9]{4}-',
               'Dora acknowledges version 2 with template version 1');
SELECT is(pg_temp.stored('dora', 2), concat_ws(' ', '1', pg_temp.of_version(1, pg_temp.id('z1'), 2), now()),
          'the row holds template version 1 and the fingerprint of the stored version 2');
UPDATE institution.notice_acknowledgment SET acknowledged_at = now() - interval '1 day'
 WHERE assignment_id = pg_temp.id('z1') AND version_no = 2 AND student_id = pg_temp.id('dora');
SELECT is(pg_temp.ask('dora', $$ SELECT (institution.acknowledge_notice({z1}, 2, 1) = now() - interval '1 day')::text $$), 'true',
          'a repeat for the same notice returns the first time');
CREATE TEMP TABLE before_conflict AS SELECT pg_temp.stored('dora', 2) AS dora, pg_temp.stored('ana', 2) AS ana;
SELECT is(pg_temp.ask('dora', 'SELECT institution.acknowledge_notice({z1}, 2, 2)'), 'ZD409: conflict',
          'a repeat with another template version is a conflict');
SELECT is(pg_temp.stored('dora', 2), (SELECT dora FROM before_conflict), 'and leaves the row as it was');

-- 6. A row written before the migration has no fingerprint and gets none:
-- a repeat is a conflict and the row stays as it was (C3, C5).
SELECT is(pg_temp.ask('ana', 'SELECT institution.acknowledge_notice({z1}, 2, 1)'), 'ZD409: conflict',
          'Ana: a repeat over a row without a fingerprint is a conflict');
SELECT is(pg_temp.stored('ana', 2), (SELECT ana FROM before_conflict), 'Ana''s row still has no template version and no fingerprint');

-- 7. The gate does not change (F1): a row counts with or without a fingerprint.
SELECT is(pg_temp.ask(a.actor, 'SELECT institution.has_acknowledged_current({z1})::text'), 'true',
          a.actor || ': has_acknowledged_current answers true (' || a.why || ')')
FROM (VALUES (1, 'ana', 'row without a fingerprint'), (2, 'dora', 'row with a fingerprint')) AS a (n, actor, why)
ORDER BY a.n;

-- 8. What a student confirmed stays what they confirmed (C2): the owner role
-- cannot change or fill in the fingerprint, the web process cannot change or
-- delete a row, and a row holds both columns or neither.
SELECT is(pg_temp.ask_as('ductus_identity', 'anon', s.statement), 'ZD403: notice acknowledgment is immutable',
          'the owner role cannot ' || s.what)
FROM (VALUES
  (1, 'change a fingerprint', $$ UPDATE institution.notice_acknowledgment SET notice_fingerprint = repeat('0', 64)
                                  WHERE student_id = {dora} AND version_no = 2 $$),
  (2, 'change a template version', $$ UPDATE institution.notice_acknowledgment SET notice_template_version = 2
                                       WHERE student_id = {dora} AND version_no = 2 $$),
  (3, 'fill in a row written before the migration',
   $$ UPDATE institution.notice_acknowledgment SET notice_template_version = 1, notice_fingerprint = repeat('0', 64)
       WHERE student_id = {ana} AND version_no = 2 $$)
) AS s (n, what, statement)
ORDER BY s.n;
SELECT matches(pg_temp.ask('dora', s.statement), '^42501: ', 'ductus_app cannot ' || s.what)
FROM (VALUES
  (1, 'change a fingerprint', $$ UPDATE institution.notice_acknowledgment SET notice_fingerprint = repeat('0', 64) $$),
  (2, 'delete an acknowledgment', $$ DELETE FROM institution.notice_acknowledgment $$)
) AS s (n, what, statement)
ORDER BY s.n;
SELECT matches(pg_temp.ask_as('ductus_identity', 'anon', format(
  $$ INSERT INTO institution.notice_acknowledgment
       (assignment_id, version_no, student_id, institution_id, notice_template_version, notice_fingerprint)
     VALUES ({z1}, 1, {boris}, {fak_a}, %s, %s) $$, c.template, c.fingerprint)),
  '^23514: ', 'a row cannot hold ' || c.what)
FROM (VALUES
  (1, 'template version 0', '0', $$ repeat('a', 64) $$),
  (2, 'a fingerprint without a template version', 'NULL', $$ repeat('a', 64) $$),
  (3, 'a fingerprint in capitals', '1', $$ repeat('A', 64) $$),
  (4, 'a template version without a fingerprint', '1', 'NULL')
) AS c (n, what, template, fingerprint)
ORDER BY c.n;
SELECT is(concat_ws(' | ', pg_temp.stored('dora', 2), pg_temp.stored('ana', 2), pg_temp.acks()),
          concat_ws(' | ', (SELECT dora FROM before_conflict), (SELECT ana FROM before_conflict), '5'),
          'the refused changes left every row as it was');

-- 9. The course name and the course's AI rule are not part of the notice
-- (answer 6): changed, they change no fingerprint, and every stored one is
-- the fingerprint of its stored version (A13).
UPDATE institution.course SET name = 'Preimenovani izmišljeni kolegij', ai_policy = 'prohibited' WHERE id = pg_temp.id('k1');
SELECT is(pg_temp.ask('dora', $$ SELECT (institution.acknowledge_notice({z1}, 2, 1) = now() - interval '1 day')::text $$), 'true',
          'after the course changed, the same notice is still the same');
SELECT is_empty(
  $$ SELECT 1 FROM institution.notice_acknowledgment n
      WHERE n.notice_fingerprint IS DISTINCT FROM pg_temp.of_version(n.notice_template_version, n.assignment_id, n.version_no)
        AND n.notice_fingerprint IS NOT NULL $$,
  'every stored fingerprint is that of the stored version and template version'
);

-- 10. A later template version is a template version like any other, and a
-- new version of the assignment needs a new acknowledgment.
SELECT is(pg_temp.ask('vesna', $$ SELECT institution.publish_assignment_version({z1}, 2, 'Z1 treća verzija',
            'Nove upute za izmišljeni zadatak.', 'essay', '2026-11-02 08:00+01', '2026-12-01 23:59+01',
            'partially_allowed', '{proofreading}', 'extended', true, NULL, NULL)::text $$), '3',
          'Vesna publishes version 3');
SELECT matches(pg_temp.ask('dora', 'SELECT institution.acknowledge_notice({z1}, 3, 2147483647)'), '^[0-9]{4}-',
               'Dora acknowledges version 3 with template version 2147483647');
SELECT is(pg_temp.stored('dora', 3), concat_ws(' ', '2147483647', pg_temp.of_version(2147483647, pg_temp.id('z1'), 3), now()),
          'the row holds that template version and its fingerprint of version 3');
SELECT isnt(pg_temp.of_version(2147483647, pg_temp.id('z1'), 3), pg_temp.of_version(1, pg_temp.id('z1'), 3),
            'the template version is part of the fingerprint (A8)');
SELECT is(pg_temp.ask(a.actor, 'SELECT institution.has_acknowledged_current({z1})::text'), a.expected,
          a.actor || ': has_acknowledged_current of version 3 answers ' || a.expected)
FROM (VALUES (1, 'ana', 'false'), (2, 'dora', 'true')) AS a (n, actor, expected)
ORDER BY a.n;

-- 11. Who reads the new columns (D1 to D6): the row rules do not change. The
-- teacher of the assignment reads every acknowledgment of it, a student her
-- own, nobody else any. Mentors read under the same row rule (037).
SELECT is(
  pg_temp.ask(r.actor, $$ SELECT coalesce(string_agg(n.version_no || '.' || p.name || '.'
             || coalesce(n.notice_template_version::text, '-') || '.'
             || CASE WHEN n.notice_fingerprint ~ '^[0-9a-f]{64}$' THEN 'f' ELSE '-' END,
             ' ' ORDER BY n.version_no, p.name), 'none')
           FROM institution.notice_acknowledgment n JOIN person p ON p.id = n.student_id
          WHERE n.assignment_id = {z1} $$),
  r.expected, r.actor || ' reads ' || r.why
)
FROM (VALUES
  (1, 'vesna', '1.ana.-.- 1.dora.-.- 2.ana.-.- 2.dora.1.f 3.dora.2147483647.f', 'every acknowledgment of Z1 (teacher)'),
  (2, 'dora', '1.dora.-.- 2.dora.1.f 3.dora.2147483647.f', 'her own, with the fingerprints'),
  (3, 'ana', '1.ana.-.- 2.ana.-.-', 'her own and nothing of Dora'),
  (4, 'iva', 'none', 'nothing (administrator)'),
  (5, 'marko', 'none', 'nothing (teacher of another course)'),
  (6, 'boris', 'none', 'nothing (student outside K1)'),
  (7, 'petra', 'none', 'nothing (teacher at fak-b)'),
  (8, 'lea', 'none', 'nothing (administrator at fak-b)'),
  (9, 'anon', 'none', 'nothing (no session)')
) AS r (n, actor, expected, why)
ORDER BY r.n;

-- 12. The supported years are 1000 to 9999 after conversion to UTC (review
-- c.6632344287, QA c.6632559838). Below them to_char's YYYY and
-- Date.prototype.toISOString write different years (1 BC is 0001 in SQL and
-- 0000 in JavaScript), so such an instant is not assignment content. The same
-- vectors are in src/server/institution/create-assignment.test.ts and
-- src/domain/notice/fingerprint.test.ts.
SELECT is(institution.is_assignment_content('Zadatak', 'Upute.', 'essay', c.opens::timestamptz, c.due::timestamptz,
            'prohibited', '{}', 'basic', false), c.expected, c.why)
FROM (VALUES
  (1, '0001-01-01T00:00:00+14:00', '2026-12-01T00:00:00Z', false, 'opens at +14:00 on 0001-01-01 is UTC year 0'),
  (2, '0001-01-01T00:00:00+01:00', '2026-12-01T00:00:00Z', false, 'opens at +01:00 on 0001-01-01 is UTC year 0'),
  (3, '2026-11-02T08:00:00Z', '9999-12-31T23:00:00-01:00', false, 'a due instant in UTC year 10000'),
  (4, '1000-01-01T00:00:00-01:00', '2026-12-01T00:00:00Z', true, 'an offset that stays at the lower edge'),
  (5, '0999-12-31T23:00:00-01:00', '2026-12-01T00:00:00Z', true, 'a local year 999 that is UTC year 1000'),
  (6, '2026-11-02T08:00:00Z', '9999-12-31T23:00:00+14:00', true, 'an offset that stays at the upper edge')
) AS c (n, opens, due, expected, why)
ORDER BY c.n;
SELECT is(pg_temp.ask('vesna', format($$ SELECT institution.create_assignment({k1}, 'Zadatak', 'Upute.', 'essay',
            %L, '2026-12-01T00:00:00Z', 'prohibited', '{}', 'basic', false, NULL, NULL)::text $$, o)),
          'ZD422: invalid input', 'Vesna cannot create an assignment that opens at ' || o)
FROM unnest(ARRAY['0001-01-01T00:00:00+14:00', '0001-01-01T00:00:00+01:00']) WITH ORDINALITY AS u (o, n)
ORDER BY u.n;
SELECT is(pg_temp.ask('vesna', $$ SELECT institution.publish_assignment_version({z1}, 3, 'Z1 četvrta verzija',
            'Upute.', 'essay', '0001-01-01T00:00:00+14:00', '2026-12-01 23:59+01', 'prohibited', '{}', 'basic',
            false, NULL, NULL)::text $$), 'ZD422: invalid input',
          'Vesna cannot publish a version that opens in UTC year 0');
SELECT matches(pg_temp.ask('vesna', $$ SELECT institution.create_assignment({k1}, 'Zadatak na rubu', 'Upute.', 'essay',
                 '1000-01-01T00:00:00-01:00', '2026-12-01T00:00:00Z', 'prohibited', '{}', 'basic', false, NULL,
                 NULL)::text $$),
               '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
               'Vesna creates an assignment that opens at the lower edge');
SELECT is(
  institution.notice_fingerprint(1, 'Osvrt na zadani ulomak', 'Napišite osvrt na zadani ulomak.', 'essay',
    '1000-01-01T00:00:00-01:00', '2026-11-24T22:59:00.000Z', 'partially_allowed',
    '{proofreading,formatting,proofreading}', 'basic', 800, 1200),
  'e29ba1fd26110106c3b259ad8116a1a61ea1a1ef2703638a2e332b39fd5cc42c',
  'the lower edge has the fingerprint of the TS mirror'
);

SELECT * FROM finish();
ROLLBACK;

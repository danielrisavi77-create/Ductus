-- The word range of an assignment version (DAN-229): optional, each bound null
-- or 1 to 1 000 000, word_min <= word_max, part of what a create retry must
-- repeat, set anew by every published version but only relaxed (rule 14),
-- and read under the existing
-- RLS. Synthetic fixtures only (fixtures/institution.inc).
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';

SELECT plan(40);

-- create_assignment with a request key, as the route calls it.
CREATE FUNCTION pg_temp.create_ranged(p_actor text, p_key text, p_min integer, p_max integer,
                                      p_title text DEFAULT 'Esej s rasponom') RETURNS text
LANGUAGE sql AS $f$
  SELECT pg_temp.ask(p_actor, format(
    'SELECT institution.create_assignment({k1}, %L::uuid, %L, %L, %L, %L::timestamptz, %L::timestamptz, %L, %L::text[], %L, %L, %L::integer, %L::integer)',
    p_key, p_title, 'Upute za izmišljeni zadatak.', 'essay', '2026-11-02 08:00+01', '2026-12-01 23:59+01',
    'partially_allowed', ARRAY['proofreading']::text[], 'basic', false, p_min, p_max))
$f$;
CREATE FUNCTION pg_temp.publish_ranged(p_actor text, p_assignment text, p_expected integer, p_min integer, p_max integer)
RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.ask(p_actor, format(
    'SELECT institution.publish_assignment_version(%L::uuid, %s, %L, %L, %L, %L::timestamptz, %L::timestamptz, %L, %L::text[], %L, %L, %L::integer, %L::integer)',
    p_assignment, p_expected, 'Esej s rasponom', 'Nove upute.', 'essay', '2026-11-02 08:00+01', '2026-12-01 23:59+01',
    'partially_allowed', ARRAY['proofreading']::text[], 'basic', false, p_min, p_max))
$f$;
CREATE FUNCTION pg_temp.range_of(p_assignment text, p_version integer) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(word_min::text, 'null') || '-' || coalesce(word_max::text, 'null')
    FROM institution.assignment_version WHERE assignment_id = p_assignment::uuid AND version_no = p_version
$$;

-- 1. A range is stored as given, and an identical retry returns the same assignment.
CREATE TEMP TABLE ranged AS SELECT pg_temp.create_ranged('vesna', '00000000-0000-4000-8000-000000000101', 2000, 2500) AS id;
SELECT matches((SELECT id FROM ranged), '^[0-9a-f-]{36}$', 'a teacher creates an assignment with a range of 2 000 to 2 500 words');
SELECT is(pg_temp.range_of((SELECT id FROM ranged), 1), '2000-2500', 'the first version holds the range');
SELECT is(pg_temp.create_ranged('vesna', '00000000-0000-4000-8000-000000000101', 2000, 2500), (SELECT id FROM ranged),
  'an identical retry returns the original assignment');

-- 2. The range is part of what a retry must repeat.
SELECT is(pg_temp.create_ranged('vesna', '00000000-0000-4000-8000-000000000101', 1999, 2500), 'ZD409: conflict',
  'the same key cannot silently change the lower bound');
SELECT is(pg_temp.create_ranged('vesna', '00000000-0000-4000-8000-000000000101', 2000, 2501), 'ZD409: conflict',
  'the same key cannot silently change the upper bound');
SELECT is(pg_temp.create_ranged('vesna', '00000000-0000-4000-8000-000000000101', NULL, NULL), 'ZD409: conflict',
  'the same key cannot silently drop the range');

-- 3. Each bound is optional, and equal bounds are a range.
SELECT is(pg_temp.range_of(pg_temp.create_ranged('vesna', '00000000-0000-4000-8000-000000000102', 1500, NULL), 1),
  '1500-null', 'a lower bound alone is accepted');
SELECT is(pg_temp.range_of(pg_temp.create_ranged('vesna', '00000000-0000-4000-8000-000000000103', NULL, 1000000), 1),
  'null-1000000', 'an upper bound alone, at the limit, is accepted');
SELECT is(pg_temp.range_of(pg_temp.create_ranged('vesna', '00000000-0000-4000-8000-000000000104', 1, 1), 1),
  '1-1', 'equal bounds of one word are accepted');
SELECT is(pg_temp.range_of(pg_temp.create_ranged('vesna', '00000000-0000-4000-8000-000000000106', NULL, NULL), 1),
  'null-null', 'no range is accepted');

-- 4. Anything else is refused before a key is reserved.
SELECT is(pg_temp.create_ranged('vesna', '00000000-0000-4000-8000-000000000105', v.min, v.max), 'ZD422: invalid input',
  'create_assignment refuses ' || v.what)
FROM (VALUES
  (1, 0, NULL, 'a lower bound of 0'),
  (2, -1, NULL, 'a negative lower bound'),
  (3, NULL, 0, 'an upper bound of 0'),
  (4, NULL, 1000001, 'an upper bound above 1 000 000'),
  (5, 1000001, NULL, 'a lower bound above 1 000 000'),
  (6, 2500, 2000, 'a lower bound above the upper one')
) AS v (n, min, max, what)
ORDER BY v.n;
SELECT is((SELECT count(*) FROM institution.assignment WHERE request_id = '00000000-0000-4000-8000-000000000105'),
  0::bigint, 'refused ranges reserve no key');
SELECT is(pg_temp.ask('vesna', $$ SELECT institution.create_assignment({k1}, 'Esej', 'Upute.', 'essay', now(),
    now() + interval '1 day', 'partially_allowed', '{proofreading}', 'basic', false, 3000, 2000) $$),
  'ZD422: invalid input', 'the create without a request key refuses a reversed range too');
SELECT is(pg_temp.range_of(pg_temp.ask('vesna', $$ SELECT institution.create_assignment({k1}, 'Esej', 'Upute.', 'essay',
    now(), now() + interval '1 day', 'partially_allowed', '{proofreading}', 'basic', false, 800, 1200) $$), 1),
  '800-1200', 'the create without a request key stores the range');

-- 5. A published version carries its own range; the earlier one keeps its.
-- Rule 14: a bound may only be dropped or relaxed, never added or tightened.
SELECT is(pg_temp.publish_ranged('vesna', (SELECT id FROM ranged), 1, 1500, 3000), '2',
  'a new version may relax both bounds');
SELECT is(pg_temp.range_of((SELECT id FROM ranged), 2), '1500-3000', 'the new version holds its range');
SELECT is(pg_temp.range_of((SELECT id FROM ranged), 1), '2000-2500', 'the first version keeps its range');
SELECT is(pg_temp.publish_ranged('vesna', (SELECT id FROM ranged), 2, v.min, v.max), 'ZD422: invalid input',
  'publish refuses ' || v.what)
FROM (VALUES
  (1, 1600, 3000, 'a higher lower bound'),
  (2, 1500, 2900, 'a lower upper bound'),
  (3, 1500, 1500, 'equal bounds inside the current range'),
  (4, 4000, 3000, 'a reversed range')
) AS v (n, min, max, what)
ORDER BY v.n;
SELECT is((SELECT current_version FROM institution.assignment WHERE id = (SELECT id FROM ranged)::uuid), 2,
  'a refused publish writes no version');
SELECT is(pg_temp.publish_ranged('vesna', (SELECT id FROM ranged), 2, NULL, 3000), '3',
  'a new version may drop the lower bound');
SELECT is(pg_temp.publish_ranged('vesna', (SELECT id FROM ranged), 3, 1, 3000), 'ZD422: invalid input',
  'publish refuses a lower bound where the current version has none');
SELECT is(pg_temp.publish_ranged('vesna', (SELECT id FROM ranged), 3, NULL, NULL), '4',
  'a new version may drop the upper bound');
SELECT is(pg_temp.publish_ranged('vesna', (SELECT id FROM ranged), 4, NULL, 1000000), 'ZD422: invalid input',
  'publish refuses an upper bound where the current version has none');
SELECT is(pg_temp.publish_ranged('marko', (SELECT id FROM ranged), 4, NULL, NULL), 'ZD403: forbidden',
  'a teacher of another course cannot publish a range');

-- 6. The table refuses a bad range even from the owner role.
SELECT throws_ok(
  $$ INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
       due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, word_min, word_max, created_by)
     VALUES ('00000000-0000-4000-8000-0000000000a2', 9, 'Z2', 'Upute.', 'essay', now(), now() + interval '1 day',
       'prohibited', '{}', 'basic', false, 0, NULL, '00000000-0000-4000-8000-000000000102') $$,
  '23514', NULL, 'the table constraint refuses a bound of 0 written directly'
);

-- 7. Reads stay under the existing RLS.
SELECT is(pg_temp.ask('ana', format('SELECT word_min || ''-'' || word_max FROM institution.assignment_version WHERE assignment_id = %L AND version_no = 1',
  (SELECT id FROM ranged))), '2000-2500', 'a student of the course reads the range');
SELECT is(pg_temp.ask(v.actor, format('SELECT count(*)::text FROM institution.assignment_version WHERE assignment_id = %L',
  (SELECT id FROM ranged))), '0', v.actor || ' reads no version of the assignment, so no range')
FROM (VALUES (1, 'marko'), (2, 'boris'), (3, 'tomo')) AS v (n, actor)
ORDER BY v.n;

-- 8. The old signatures are gone: no call writes a version without stating its range.
SELECT is(to_regprocedure(v.sig), NULL, 'no function ' || v.sig)
FROM (VALUES
  (1, 'institution.create_assignment(uuid,text,text,text,timestamptz,timestamptz,text,text[],text,boolean)'),
  (2, 'institution.create_assignment(uuid,uuid,text,text,text,timestamptz,timestamptz,text,text[],text,boolean)'),
  (3, 'institution.publish_assignment_version(uuid,integer,text,text,text,timestamptz,timestamptz,text,text[],text,boolean)')
) AS v (n, sig)
ORDER BY v.n;

SELECT * FROM finish();
ROLLBACK;

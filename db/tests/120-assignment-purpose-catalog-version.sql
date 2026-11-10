-- DAN-402, M9.3-P01b (contract on #1836, attack plan #1855): every assignment
-- version names the version of the AI purpose catalogue its purposes come
-- from. Version 1 is the five purposes of level 1, version 2 adds five of
-- level 2. Existing versions are version 1, a version inherits the version
-- before it, and only the new create_assignment overload chooses 2.
-- Personas of institution.inc; every person, course and text is invented.
--
--   Vesna teaches K1 (partially_allowed; Z1 at version 2), Ana studies in K1,
--   Marko teaches K2 (prohibited; Z2 at version 1).
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';
SELECT no_plan();

-- create_assignment with a request key and a catalogue version.
CREATE FUNCTION pg_temp.create_cat(p_actor text, p_key text, p_purposes text, p_version integer,
                                   p_policy text DEFAULT 'partially_allowed') RETURNS text
LANGUAGE sql AS $f$
  SELECT pg_temp.ask(p_actor, format(
    'SELECT institution.create_assignment({k1}, %L::uuid, %L, %L, %L, %L::timestamptz, %L::timestamptz, %L, %L::text[], %L, %L, NULL::integer, NULL::integer, %L::integer)',
    p_key, 'Esej s katalogom', 'Upute za izmišljeni zadatak.', 'essay', '2026-11-02 08:00+01', '2026-12-01 23:59+01',
    p_policy, p_purposes, 'basic', false, p_version))
$f$;
-- The same through the signature without a catalogue version.
CREATE FUNCTION pg_temp.create_old(p_actor text, p_key text, p_purposes text) RETURNS text
LANGUAGE sql AS $f$
  SELECT pg_temp.ask(p_actor, format(
    'SELECT institution.create_assignment({k1}, %L::uuid, %L, %L, %L, %L::timestamptz, %L::timestamptz, %L, %L::text[], %L, %L, NULL::integer, NULL::integer)',
    p_key, 'Esej s katalogom', 'Upute za izmišljeni zadatak.', 'essay', '2026-11-02 08:00+01', '2026-12-01 23:59+01',
    'partially_allowed', p_purposes, 'basic', false))
$f$;
CREATE FUNCTION pg_temp.publish_cat(p_actor text, p_assignment text, p_expected integer, p_purposes text,
                                    p_policy text DEFAULT 'partially_allowed') RETURNS text
LANGUAGE sql AS $f$
  SELECT pg_temp.ask(p_actor, format(
    'SELECT institution.publish_assignment_version(%L::uuid, %s, %L, %L, %L, %L::timestamptz, %L::timestamptz, %L, %L::text[], %L, %L, NULL::integer, NULL::integer)',
    p_assignment, p_expected, 'Esej s katalogom', 'Nove upute.', 'essay', '2026-11-02 08:00+01', '2026-12-01 23:59+01',
    p_policy, p_purposes, 'basic', false))
$f$;
CREATE FUNCTION pg_temp.catalog_of(p_assignment text, p_version integer) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(purpose_catalog_version::text, 'none')
    FROM institution.assignment_version WHERE assignment_id = p_assignment::uuid AND version_no = p_version
$$;

-- 1. The column, the catalogue and who may call what.
SELECT is(
  (SELECT a.attnotnull::text || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), 'no default')
     FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'institution.assignment_version'::regclass AND a.attname = 'purpose_catalog_version'),
  'true 1', 'purpose_catalog_version is NOT NULL with default 1, the old rule for a first version that names none');
SELECT is((SELECT count(*) FROM institution.assignment_version WHERE purpose_catalog_version <> 1), 0::bigint,
  'every version that existed before is version 1');
SELECT is((SELECT convalidated FROM pg_constraint
            WHERE conrelid = 'institution.assignment_version'::regclass AND conname = 'assignment_version_check'),
  true, 'the content CHECK is validated, not NOT VALID');
SELECT is((SELECT count(*) FROM institution.assignment_version v
            WHERE NOT coalesce(institution.is_assignment_content(v.title, v.instructions, v.work_type, v.opens_at, v.due_at,
                     v.ai_policy, v.ai_purposes, v.evidence_profile, v.import_allowed, v.purpose_catalog_version), false)),
  0::bigint, 'every stored version satisfies the rule of its catalogue version');
SELECT is(institution.purpose_catalog_keys(v.version), v.keys::text[], 'catalogue version ' || coalesce(v.version::text, 'NULL'))
FROM (VALUES
  (1, 1, '{formatting,proofreading,literature_search,transcription,translation}'),
  (2, 2, '{formatting,proofreading,literature_search,transcription,translation,explanation,brainstorming,restructuring,example_generation,data_coding}'),
  (3, 0, NULL), (4, 3, NULL), (5, NULL, NULL)
) AS v (n, version, keys)
ORDER BY v.n;
SELECT is(
  (SELECT string_agg(p.oid::regprocedure::text || ' ' || has_function_privilege('ductus_app', p.oid, 'EXECUTE')::text
                     || ' ' || has_function_privilege('public', p.oid, 'EXECUTE')::text, ' | ' ORDER BY p.oid::regprocedure::text)
     FROM pg_proc p
    WHERE p.oid IN ('institution.purpose_catalog_keys(integer)'::regprocedure,
                    'institution.assignment_version_purpose_catalog()'::regprocedure,
                    'institution.is_assignment_content(text,text,text,timestamptz,timestamptz,text,text[],text,boolean,integer)'::regprocedure,
                    'institution.create_assignment(uuid,uuid,text,text,text,timestamptz,timestamptz,text,text[],text,boolean,integer,integer,integer)'::regprocedure)),
  'institution.assignment_version_purpose_catalog() false false'
  ' | institution.create_assignment(uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,text,text[],text,boolean,integer,integer,integer) true false'
  ' | institution.is_assignment_content(text,text,text,timestamp with time zone,timestamp with time zone,text,text[],text,boolean,integer) false false'
  ' | institution.purpose_catalog_keys(integer) false false',
  'only the new create_assignment is callable by ductus_app, nothing by PUBLIC');

-- 2. A teacher creates on either version, with that version's purposes.
SELECT is(pg_temp.catalog_of(pg_temp.create_cat('vesna', v.key, v.purposes, v.version, v.policy), 1), v.version::text,
  'create_assignment accepts ' || v.what)
FROM (VALUES
  (1, '00000000-0000-4000-8000-000000000201', '{}', 1, 'partially_allowed', 'no purpose on version 1'),
  (2, '00000000-0000-4000-8000-000000000202', '{proofreading}', 1, 'partially_allowed', 'a level 1 key on version 1'),
  (3, '00000000-0000-4000-8000-000000000203', '{}', 2, 'partially_allowed', 'no purpose on version 2'),
  (4, '00000000-0000-4000-8000-000000000204', '{proofreading}', 2, 'partially_allowed', 'a level 1 key on version 2'),
  (5, '00000000-0000-4000-8000-000000000205', '{explanation}', 2, 'partially_allowed', 'a level 2 key on version 2'),
  (6, '00000000-0000-4000-8000-000000000206',
      '{formatting,proofreading,literature_search,transcription,translation,explanation,brainstorming,restructuring,example_generation,data_coding}',
      2, 'partially_allowed', 'all ten keys on version 2'),
  (7, '00000000-0000-4000-8000-000000000207', '{}', 2, 'prohibited', 'a prohibited policy with no purpose on version 2')
) AS v (n, key, purposes, version, policy, what)
ORDER BY v.n;

-- 3. Anything else is refused before a key is reserved.
SELECT is(pg_temp.create_cat('vesna', '00000000-0000-4000-8000-0000000002ff', v.purposes, v.version, v.policy),
  'ZD422: invalid input', 'create_assignment refuses ' || v.what)
FROM (VALUES
  (1, '{explanation}', 1, 'partially_allowed', 'a level 2 key on version 1'),
  (2, '{}', 0, 'partially_allowed', 'catalogue version 0'),
  (3, '{}', 3, 'partially_allowed', 'catalogue version 3'),
  (4, '{}', -1, 'partially_allowed', 'catalogue version -1'),
  (5, '{}', NULL, 'partially_allowed', 'no catalogue version'),
  (6, '{Explanation}', 2, 'partially_allowed', 'a key in other letter case'),
  (7, '{unknown_purpose}', 2, 'partially_allowed', 'an unknown key'),
  (8, '{""}', 2, 'partially_allowed', 'an empty key'),
  (9, '{NULL}', 2, 'partially_allowed', 'a NULL key'),
  (10, '{explanation,NULL}', 2, 'partially_allowed', 'a NULL key beside a valid one'),
  (11, '{{explanation}}', 2, 'partially_allowed', 'a two-dimensional list'),
  (12, NULL, 2, 'partially_allowed', 'a NULL list'),
  (13, '{proofreading,proofreading,proofreading,proofreading,proofreading,proofreading}', 1, 'partially_allowed',
       'more keys than version 1 has'),
  (14, '{formatting,proofreading,literature_search,transcription,translation,explanation,brainstorming,restructuring,example_generation,data_coding,explanation}',
       2, 'partially_allowed', 'more keys than version 2 has'),
  (15, '{explanation}', 2, 'prohibited', 'a purpose under a prohibited policy'),
  (16, '{explanation}', 2, 'encouraged', 'a policy above the course')
) AS v (n, purposes, version, policy, what)
ORDER BY v.n;
SELECT is((SELECT count(*) FROM institution.assignment WHERE request_id = '00000000-0000-4000-8000-0000000002ff'),
  0::bigint, 'refused catalogue versions and purposes reserve no key');
SELECT is(pg_temp.create_cat('marko', '00000000-0000-4000-8000-0000000002fe', '{}', 2), 'ZD403: forbidden',
  'a teacher of another course cannot create on version 2');

-- 4. The signatures without a version are version 1.
SELECT is(pg_temp.create_old('vesna', '00000000-0000-4000-8000-0000000002fd', '{explanation}'), 'ZD422: invalid input',
  'the signature without a version refuses a level 2 key');
SELECT is(pg_temp.catalog_of(pg_temp.create_old('vesna', '00000000-0000-4000-8000-000000000208', '{proofreading}'), 1),
  '1', 'the signature without a version stores version 1');
SELECT is(pg_temp.ask('vesna', $$ SELECT institution.create_assignment({k1}, 'Esej', 'Upute.', 'essay', now(),
    now() + interval '1 day', 'partially_allowed', '{explanation}', 'basic', false, NULL, NULL) $$),
  'ZD422: invalid input', 'the create without a request key refuses a level 2 key');
SELECT is(pg_temp.catalog_of(pg_temp.ask('vesna', $$ SELECT institution.create_assignment({k1}, 'Esej', 'Upute.', 'essay',
    now(), now() + interval '1 day', 'partially_allowed', '{proofreading}', 'basic', false, NULL, NULL) $$), 1),
  '1', 'the create without a request key stores version 1');

-- 5. The version is part of what a retry must repeat.
CREATE TEMP TABLE v2 AS SELECT pg_temp.create_cat('vesna', '00000000-0000-4000-8000-000000000209', '{proofreading}', 2) AS id;
CREATE TEMP TABLE v1 AS SELECT pg_temp.create_cat('vesna', '00000000-0000-4000-8000-00000000020a', '{proofreading}', 1) AS id;
SELECT is(pg_temp.create_cat('vesna', '00000000-0000-4000-8000-000000000209', '{proofreading}', 2), (SELECT id FROM v2),
  'an identical retry on version 2 returns the original assignment');
SELECT is(pg_temp.create_cat('vesna', '00000000-0000-4000-8000-000000000209', '{proofreading}', 1), 'ZD409: conflict',
  'the same key cannot move an assignment from version 2 to version 1');
SELECT is(pg_temp.create_old('vesna', '00000000-0000-4000-8000-000000000209', '{proofreading}'), 'ZD409: conflict',
  'a retry of a version 2 assignment through the signature without a version is a conflict');
SELECT is(pg_temp.create_cat('vesna', '00000000-0000-4000-8000-00000000020a', '{proofreading}', 2), 'ZD409: conflict',
  'the same key cannot move an assignment from version 1 to version 2');
SELECT is(pg_temp.create_old('vesna', '00000000-0000-4000-8000-00000000020a', '{proofreading}'), (SELECT id FROM v1),
  'a retry of a version 1 assignment through the signature without a version returns it');

-- 6. A published version keeps the catalogue; purposes may only narrow.
CREATE TEMP TABLE wide AS
  SELECT pg_temp.create_cat('vesna', '00000000-0000-4000-8000-00000000020b', '{proofreading,explanation,brainstorming}', 2) AS id;
SELECT is(pg_temp.publish_cat('vesna', (SELECT id FROM wide), 1, '{explanation,brainstorming}'), '2',
  'a version 2 assignment publishes a narrower set of level 2 keys');
SELECT is(pg_temp.catalog_of((SELECT id FROM wide), 2), '2', 'the published version keeps version 2');
SELECT is(pg_temp.publish_cat('vesna', (SELECT id FROM wide), 2, v.purposes), v.result, 'publish ' || v.what)
FROM (VALUES
  (1, '{explanation,brainstorming,proofreading}', 'ZD422: invalid input', 'refuses a purpose dropped before'),
  (2, '{data_coding}', 'ZD422: invalid input', 'refuses a level 2 key never listed'),
  (3, '{Explanation}', 'ZD422: invalid input', 'refuses a key in other letter case'),
  (4, '{{explanation}}', 'ZD422: invalid input', 'refuses a two-dimensional list'),
  (5, '{explanation,NULL}', 'ZD422: invalid input', 'refuses a NULL key')
) AS v (n, purposes, result, what)
ORDER BY v.n;
SELECT is(pg_temp.publish_cat('vesna', (SELECT id FROM wide), 1, '{explanation}'), 'ZD409: conflict',
  'publish against an older version is a conflict');
SELECT is(pg_temp.publish_cat('marko', (SELECT id FROM wide), 2, '{explanation}'), 'ZD403: forbidden',
  'a teacher of another course cannot publish');
SELECT is((SELECT current_version FROM institution.assignment WHERE id = (SELECT id FROM wide)::uuid), 2,
  'a refused publish writes no version');
SELECT is(pg_temp.publish_cat('vesna', '00000000-0000-4000-8000-0000000000a1', 2, '{}'), '3', 'an existing assignment publishes as before');
SELECT is(pg_temp.catalog_of('00000000-0000-4000-8000-0000000000a1', 3), '1', 'and stays on version 1');

-- 7. A change of the language of the work keeps the catalogue.
SELECT is(pg_temp.ask('vesna', format('SELECT institution.set_assignment_work_language(%L::uuid, 2, %L)::text',
  (SELECT id FROM wide), 'en')), '3', 'the language of a version 2 assignment changes');
SELECT is(pg_temp.catalog_of((SELECT id FROM wide), 3), '2', 'the version it writes keeps version 2');

-- 8. A student of the course reads the version under the existing RLS; others read nothing.
SELECT is(pg_temp.ask('ana', format('SELECT purpose_catalog_version::text FROM institution.assignment_version WHERE assignment_id = %L AND version_no = 1',
  (SELECT id FROM wide))), '2', 'a student of the course reads the catalogue version');
SELECT is(pg_temp.ask(v.actor, format('SELECT count(*)::text FROM institution.assignment_version WHERE assignment_id = %L',
  (SELECT id FROM wide))), '0', v.actor || ' reads no version of the assignment')
FROM (VALUES (1, 'marko'), (2, 'tomo')) AS v (n, actor)
ORDER BY v.n;

-- 9. The client cannot write the column; the owner role cannot change a catalogue.
SELECT matches(pg_temp.ask('vesna', v.sql), '^42501: permission denied', 'ductus_app cannot ' || v.what)
FROM (VALUES
  (1, $$ UPDATE institution.assignment_version SET purpose_catalog_version = 2 WHERE assignment_id = {z1} RETURNING 'x' $$,
      'update a catalogue version'),
  (2, $$ INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
         due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, purpose_catalog_version, created_by)
       VALUES ({z2}, 2, 'Z2', 'Upute.', 'essay', now(), now() + interval '1 day', 'prohibited', '{}', 'basic', false, 2, {marko})
       RETURNING 'x' $$, 'insert a version')
) AS v (n, sql, what)
ORDER BY v.n;
SELECT throws_ok(
  $$ INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
       due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, purpose_catalog_version, created_by)
     VALUES ('00000000-0000-4000-8000-0000000000a2', 2, 'Z2', 'Upute.', 'essay', now(), now() + interval '1 day',
       'prohibited', '{}', 'basic', false, 2, '00000000-0000-4000-8000-000000000102') $$,
  'ZD422', 'invalid input', 'a version that names another catalogue than the version before is refused'
);
SELECT throws_ok(
  format($$ INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
       due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, purpose_catalog_version, created_by)
     VALUES (%L, 4, 'W', 'Upute.', 'essay', now(), now() + interval '1 day',
       'partially_allowed', '{explanation}', 'basic', false, 3, '00000000-0000-4000-8000-000000000101') $$, (SELECT id FROM wide)),
  'ZD422', 'invalid input', 'a later version that names an unknown catalogue is refused before the CHECK'
);
SELECT lives_ok(
  format($$ INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
       due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, purpose_catalog_version, created_by)
     VALUES (%L, 4, 'W', 'Upute.', 'essay', now(), now() + interval '1 day',
       'partially_allowed', '{explanation}', 'basic', false, 1, '00000000-0000-4000-8000-000000000101') $$, (SELECT id FROM wide)),
  'a version 2 assignment version that names 1, the default, is accepted'
);
SELECT is(pg_temp.catalog_of((SELECT id FROM wide), 4), '2', 'and keeps version 2: it cannot fall back to version 1');
SELECT throws_ok(
  $$ INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
       due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, created_by)
     VALUES ('00000000-0000-4000-8000-0000000000a2', 2, 'Z2', 'Upute.', 'essay', now(), now() + interval '1 day',
       'partially_allowed', '{explanation}', 'basic', false, '00000000-0000-4000-8000-000000000102') $$,
  '23514', NULL, 'an omitted version inherits version 1, whose rule refuses a level 2 key'
);
SELECT lives_ok(
  format($$ INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
       due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, created_by)
     VALUES (%L, 5, 'W', 'Upute.', 'essay', now(), now() + interval '1 day',
       'partially_allowed', '{explanation}', 'basic', false, '00000000-0000-4000-8000-000000000101') $$, (SELECT id FROM wide)),
  'an omitted version on a version 2 assignment is accepted'
);
SELECT is(pg_temp.catalog_of((SELECT id FROM wide), 5), '2', 'and inherits version 2');
INSERT INTO institution.assignment (id, course_id, institution_id, current_version, created_by)
SELECT '00000000-0000-4000-8000-0000000000a9', c.id, c.institution_id, 1, '00000000-0000-4000-8000-000000000101'
  FROM institution.course c WHERE c.id = '00000000-0000-4000-8000-0000000000c1';
SELECT throws_ok(
  $$ INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
       due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, purpose_catalog_version, created_by)
     VALUES ('00000000-0000-4000-8000-0000000000a9', 1, 'Z9', 'Upute.', 'essay', now(), now() + interval '1 day',
       'prohibited', '{}', 'basic', false, 3, '00000000-0000-4000-8000-000000000101') $$,
  '23514', NULL, 'the table refuses an unknown catalogue version written directly'
);

SELECT * FROM finish();
ROLLBACK;

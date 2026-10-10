-- Assignments, their versions and the acknowledgment of the notice (B-7
-- part 2; docs/ARCHITECTURE.md 3; plan of attack on issue #153, items 20 to
-- 25 and 28 to 30). Items 26 and 27 need parallel sessions and are in
-- tests/integration/institution.integration.test.ts.
-- Synthetic fixtures only (fixtures/institution.inc): Z1 of K1 is at version
-- 2, which Ana has acknowledged and Dora has not.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';

SELECT plan(152);

-- The nine arguments of a version as SQL text, with up to two replaced.
CREATE FUNCTION pg_temp.content(p_field text DEFAULT NULL, p_value text DEFAULT NULL,
                                p_field2 text DEFAULT NULL, p_value2 text DEFAULT NULL) RETURNS text
LANGUAGE sql AS $f$
  SELECT string_agg(CASE d.field WHEN p_field THEN p_value WHEN p_field2 THEN p_value2 ELSE d.value END, ', ' ORDER BY d.n)
  FROM (VALUES
    (1, 'title', $$'Esej o izmišljenoj temi'$$),
    (2, 'instructions', $$E'Prvi red uputa.\n\tDrugi red.'$$),
    (3, 'work_type', $$'essay'$$),
    (4, 'opens_at', $$'2026-11-02 08:00+01'$$),
    (5, 'due_at', $$'2026-12-01 23:59+01'$$),
    (6, 'ai_policy', $$'partially_allowed'$$),
    (7, 'ai_purposes', $$'{formatting,proofreading}'$$),
    (8, 'evidence_profile', $$'extended'$$),
    (9, 'import_allowed', 'true')
  ) AS d (n, field, value)
$f$;
CREATE FUNCTION pg_temp.create_in(p_actor text, p_course text, p_content text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format('SELECT institution.create_assignment(%s, %s)', p_course, p_content))
$$;
CREATE FUNCTION pg_temp.publish(p_actor text, p_assignment text, p_expected text, p_content text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format('SELECT institution.publish_assignment_version(%s, %s, %s)', p_assignment, p_expected, p_content))
$$;
CREATE FUNCTION pg_temp.counts() RETURNS text
LANGUAGE sql AS $$
  SELECT concat_ws(' ', (SELECT count(*) FROM institution.assignment), (SELECT count(*) FROM institution.assignment_version),
                        (SELECT count(*) FROM institution.notice_acknowledgment))
$$;

-- 1. Without an open session every function refuses and changes nothing
-- (plan 8). "expired" and "closed" are sessions of Ana, who has acknowledged.
SELECT is(pg_temp.ask(a.actor, c.call), 'ZD401: not authenticated', a.actor || ': ' || c.name || ' is refused')
FROM unnest(ARRAY['anon', 'expired', 'closed', 'unknown']) WITH ORDINALITY AS a (actor, n)
CROSS JOIN (VALUES
  (1, 'create_assignment', format('SELECT institution.create_assignment({k1}, %s)', pg_temp.content())),
  (2, 'publish_assignment_version', format('SELECT institution.publish_assignment_version({z1}, 2, %s)', pg_temp.content())),
  (3, 'acknowledge_notice', 'SELECT institution.acknowledge_notice({z1}, 2)')
) AS c (n, name, call)
ORDER BY a.n, c.n;
SELECT is(
  pg_temp.ask(a.actor, 'SELECT institution.has_acknowledged_current({z1})::text'), 'false',
  a.actor || ': has_acknowledged_current answers false'
)
FROM unnest(ARRAY['anon', 'expired', 'closed', 'unknown']) WITH ORDINALITY AS a (actor, n)
ORDER BY a.n;
SELECT is(pg_temp.counts(), '3 4 4', 'the refused calls left no row behind');

-- 2. create_assignment: a teacher of that course only. A course one may not
-- manage and no course read the same (plan 4, 5 and 11).
SELECT is(
  pg_temp.create_in(v.actor, v.course, pg_temp.content()), 'ZD403: forbidden',
  format('%s: create_assignment in %s is refused (%s)', v.actor, v.course, v.why)
)
FROM (VALUES
  (1, 'ana', '{k1}', 'student of the course'),
  (2, 'boris', '{k1}', 'not a member'),
  (3, 'marko', '{k1}', 'teacher of another course'),
  (4, 'iva', '{k1}', 'administrator'),
  (5, 'nina', '{k1}', 'teacher role not confirmed'),
  (6, 'petra', '{k1}', 'teacher at another institution'),
  (7, 'vesna', '{k2}', 'teacher of another course'),
  (8, 'vesna', '{nobody}', 'no such course'),
  (9, 'vesna', 'NULL', 'no course given')
) AS v (n, actor, course, why)
ORDER BY v.n;
SELECT is(pg_temp.counts(), '3 4 4', 'the refused calls created nothing');

-- Plan 28: the assignment and its first version arrive together.
CREATE TEMP TABLE made AS SELECT pg_temp.create_in('vesna', '{k1}', pg_temp.content()) AS id;
SELECT matches((SELECT id FROM made), '^[0-9a-f-]{36}$', 'Vesna creates an assignment in K1');
SELECT is(
  (SELECT concat_ws(' ', a.course_id = pg_temp.id('k1'), a.current_version, a.created_by = pg_temp.id('vesna'), a.created_at = now(),
                    (SELECT string_agg(v.version_no::text, ',') FROM institution.assignment_version v WHERE v.assignment_id = a.id))
   FROM institution.assignment a, made WHERE a.id::text = made.id),
  't 1 t t 1', 'it belongs to K1, names Vesna and the database time, and points at its only version, number 1'
);
SELECT is(
  (SELECT concat_ws('|', v.title, v.instructions = E'Prvi red uputa.\n\tDrugi red.', v.work_type,
                    v.opens_at = '2026-11-02 08:00+01', v.due_at = '2026-12-01 23:59+01', v.ai_policy, v.ai_purposes,
                    v.evidence_profile, v.import_allowed, v.created_by = pg_temp.id('vesna'), v.created_at = now())
   FROM institution.assignment_version v, made WHERE v.assignment_id::text = made.id),
  'Esej o izmišljenoj temi|t|essay|t|t|partially_allowed|{formatting,proofreading}|extended|t|t|t',
  'the version holds what was sent, lines and tab of the instructions included'
);
SELECT is(
  pg_temp.ask('ana', format('SELECT title FROM institution.assignment_version WHERE assignment_id = %L', (SELECT id FROM made)))
  || ' / ' || pg_temp.ask('boris', format('SELECT count(*) FROM institution.assignment WHERE id = %L', (SELECT id FROM made))),
  'Esej o izmišljenoj temi / 0', 'a student of K1 reads it at once, a student outside K1 does not'
);
-- The pointer is a foreign key checked at commit. Checked now instead, it
-- holds for every assignment so far, and neither an assignment without a
-- version nor a pointer to a missing version can be written.
SET CONSTRAINTS ALL IMMEDIATE;
SELECT throws_ok(
  format('INSERT INTO institution.assignment (course_id, created_by) VALUES (%L, %L)', pg_temp.id('k1'), pg_temp.id('vesna')),
  '23503', NULL, 'an assignment without its first version cannot be stored, by the owner either'
);
SELECT throws_ok(
  format('UPDATE institution.assignment SET current_version = 9 WHERE id = %L', pg_temp.id('z1')),
  '23503', NULL, 'nor can the pointer name a version that does not exist'
);
SET CONSTRAINTS ALL DEFERRED;

-- 3. What a version may hold (plan 23, 29 and 30). Every refusal is the same
-- two words, whatever was sent.
SELECT is(
  pg_temp.create_in('vesna', '{k1}', pg_temp.content(v.field, v.value)), 'ZD422: invalid input',
  'create_assignment refuses ' || v.what
)
FROM (VALUES
  (1, 'title', $$''$$, 'an empty title'),
  (2, 'title', $$'   '$$, 'a title of spaces'),
  (3, 'title', $$repeat('a', 201)$$, 'a title of 201 characters'),
  (4, 'title', $$repeat('a', 100000)$$, 'a title of 100,000 characters'),
  (5, 'title', $$E'two\nlines'$$, 'a line break in the title'),
  (6, 'title', $$U&'zero\200Bwidth'$$, 'a zero-width character in the title'),
  (7, 'title', $$U&'bidi\202Eoverride'$$, 'a bidirectional override in the title'),
  (8, 'title', $$U&'\3164'$$, 'a title that is one invisible filler'),
  (9, 'title', 'NULL', 'a missing title'),
  (10, 'instructions', $$repeat('a', 20001)$$, 'instructions of 20,001 characters'),
  (11, 'instructions', $$repeat('a', 1000000)$$, 'instructions of a million characters'),
  (12, 'instructions', $$E'bell\x07'$$, 'a control character in the instructions'),
  (13, 'instructions', $$U&'c1\0085control'$$, 'a C1 control in the instructions'),
  (14, 'instructions', $$U&'bidi\202Eoverride'$$, 'a bidirectional override in the instructions'),
  (15, 'instructions', $$U&'bidi\2066isolate'$$, 'a directional isolate in the instructions'),
  (16, 'instructions', 'NULL', 'missing instructions'),
  (17, 'work_type', $$'homework'$$, 'a work type outside D-03'),
  (18, 'work_type', $$'ESSAY'$$, 'a work type in another letter case'),
  (19, 'work_type', $$''$$, 'an empty work type'),
  (20, 'work_type', 'NULL', 'a missing work type'),
  (21, 'opens_at', $$'2026-12-01 23:59+01'$$, 'an opening at the very moment of the deadline'),
  (22, 'opens_at', $$'2026-12-02 00:00+01'$$, 'an opening after the deadline'),
  (23, 'opens_at', $$'-infinity'$$, 'an assignment that was always open'),
  (24, 'opens_at', 'NULL', 'a missing opening'),
  (25, 'due_at', $$'infinity'$$, 'a deadline that never comes'),
  (26, 'due_at', 'NULL', 'a missing deadline'),
  (27, 'ai_policy', $$'encouraged'$$, 'an AI rule wider than the rule of K1 (D-52)'),
  (28, 'ai_policy', $$'required'$$, 'an AI rule outside D-52'),
  (29, 'ai_policy', $$''$$, 'an empty AI rule'),
  (30, 'ai_policy', 'NULL', 'a missing AI rule'),
  (31, 'ai_policy', $$'prohibited'$$, 'a prohibition that still lists purposes'),
  (32, 'ai_purposes', $$'{formatting,ghostwriting}'$$, 'a purpose outside D-80'),
  (33, 'ai_purposes', $$'{{formatting},{proofreading}}'$$, 'purposes in two dimensions'),
  (34, 'ai_purposes', $$ARRAY['formatting', NULL]$$, 'a missing purpose in the list'),
  (35, 'ai_purposes', $$'{formatting,formatting,formatting,formatting,formatting,formatting}'$$, 'six purposes'),
  (36, 'ai_purposes', 'NULL', 'missing purposes'),
  (37, 'evidence_profile', $$'standard-v1'$$, 'an evidence profile outside D-05'),
  (38, 'evidence_profile', 'NULL', 'a missing evidence profile'),
  (39, 'import_allowed', 'NULL', 'a missing answer on import')
) AS v (n, field, value, what)
ORDER BY v.n;
SELECT is(
  pg_temp.create_in('marko', '{k2}', pg_temp.content()), 'ZD422: invalid input',
  'Marko cannot allow AI in an assignment of K2, whose course rule prohibits it'
);
SELECT matches(
  pg_temp.ask('vesna', format('SELECT institution.create_assignment({k1}, %s, %s)', pg_temp.content(), v.extra)),
  '^42883: ', 'create_assignment has no parameter for ' || v.what
)
FROM (VALUES (1, '{boris}', 'the creator'), (2, '7', 'the version number')) AS v (n, extra, what)
ORDER BY v.n;
SELECT is(pg_temp.counts(), '4 5 4', 'the refused calls created nothing: only the assignment of section 2 was added');

SELECT matches(
  pg_temp.create_in(v.actor, v.course, pg_temp.content(v.field, v.value, v.field2, v.value2)), '^[0-9a-f-]{36}$',
  'create_assignment accepts ' || v.what
)
FROM (VALUES
  (1, 'vesna', '{k1}', 'title', $$'<script>alert(1)</script>'$$, NULL, NULL, 'markup in the title, as plain text'),
  (2, 'vesna', '{k1}', 'title', $$repeat('a', 200)$$, NULL, NULL, 'a title of 200 characters'),
  (3, 'vesna', '{k1}', 'instructions', $$repeat('a', 20000)$$, NULL, NULL, 'instructions of 20,000 characters'),
  (4, 'vesna', '{k1}', 'instructions', $$E'<img src=x onerror=alert(1)>\r\n\tdrugi red'$$, NULL, NULL, 'markup and line ends in the instructions'),
  (5, 'vesna', '{k1}', 'ai_policy', $$'prohibited'$$, 'ai_purposes', $$'{}'$$, 'a rule narrower than the rule of K1'),
  (6, 'vesna', '{k1}', 'ai_purposes', $$'{}'$$, NULL, NULL, 'a partial permission with no purpose listed'),
  (7, 'marko', '{k2}', 'ai_policy', $$'prohibited'$$, 'ai_purposes', $$'{}'$$, 'a prohibition in K2, where the course prohibits AI'),
  (8, 'petra', '{k3}', 'ai_policy', $$'encouraged'$$, 'ai_purposes', $$'{formatting,proofreading,literature_search,transcription,translation}'$$,
   'the widest rule with all five purposes in K3, where the course encourages AI'),
  (9, 'vesna', '{k1}', 'evidence_profile', $$'basic'$$, 'import_allowed', 'false', 'the basic profile without import'),
  (10, 'vesna', '{k1}', 'work_type', $$'short_paper'$$, NULL, NULL, 'the work type short_paper'),
  (11, 'vesna', '{k1}', 'work_type', $$'seminar_paper'$$, NULL, NULL, 'the work type seminar_paper'),
  (12, 'vesna', '{k1}', 'work_type', $$'bachelor_thesis'$$, NULL, NULL, 'the work type bachelor_thesis'),
  (13, 'vesna', '{k1}', 'work_type', $$'master_thesis'$$, NULL, NULL, 'the work type master_thesis'),
  (14, 'vesna', '{k1}', 'work_type', $$'specialist_thesis'$$, NULL, NULL, 'the work type specialist_thesis'),
  (15, 'vesna', '{k1}', 'work_type', $$'doctoral_thesis'$$, NULL, NULL, 'the work type doctoral_thesis')
) AS v (n, actor, course, field, value, field2, value2, what)
ORDER BY v.n;
SELECT is(
  (SELECT string_agg(v.title, '') FROM institution.assignment_version v WHERE v.title LIKE '<%')
  || ' / ' || (SELECT string_agg(v.instructions, '') FROM institution.assignment_version v WHERE v.instructions LIKE '<%'),
  E'<script>alert(1)</script> / <img src=x onerror=alert(1)>\r\n\tdrugi red',
  'markup is stored and returned as the same plain text'
);

-- Plan 30: on 25 Oct 2026 the clock in Zagreb shows 02:30 twice. Instants are
-- stored and compared, not what the clock shows.
SET LOCAL TimeZone TO 'Europe/Zagreb';
CREATE TEMP TABLE night AS
SELECT pg_temp.create_in('vesna', '{k1}', pg_temp.content('opens_at', $$'2026-10-25 02:30+02'$$, 'due_at', $$'2026-10-25 02:30+01'$$)) AS id;
SELECT is(
  (SELECT concat_ws(' ', v.opens_at, v.due_at, v.due_at - v.opens_at) FROM institution.assignment_version v, night
   WHERE v.assignment_id::text = night.id),
  '2026-10-25 02:30:00+02 2026-10-25 02:30:00+01 01:00:00',
  'an assignment that opens at the first 02:30 and is due at the second lasts one hour'
);
SELECT is(
  pg_temp.create_in('vesna', '{k1}', pg_temp.content('opens_at', $$'2026-10-25 02:30+01'$$, 'due_at', $$'2026-10-25 02:30+02'$$)),
  'ZD422: invalid input', 'the other way round the deadline is an hour before the opening, and it is refused'
);
CREATE TEMP TABLE noon AS
SELECT pg_temp.create_in('vesna', '{k1}', pg_temp.content('opens_at', $$'2026-10-24 12:00'$$, 'due_at', $$'2026-10-25 12:00'$$)) AS id;
SELECT is(
  (SELECT extract(epoch FROM v.due_at - v.opens_at) / 3600 FROM institution.assignment_version v, noon
   WHERE v.assignment_id::text = noon.id),
  25::numeric, 'from noon to noon across that night, written without an offset in Zagreb time, is 25 hours'
);
RESET TimeZone;

-- 4. A version is immutable (plan 20), for the owner role as well. TRUNCATE
-- is refused earlier, and for another reason, while checks of this
-- transaction are still waiting, so they are run first.
SET CONSTRAINTS ALL IMMEDIATE;
SELECT is(
  pg_temp.ask_as('ductus_identity', 'anon', v.statement), 'ZD403: assignment version is immutable',
  'the owner role cannot ' || v.what
)
FROM (VALUES
  (1, 'rewrite a version', $$ UPDATE institution.assignment_version SET title = 'Drugi naslov' WHERE assignment_id = {z1} $$),
  (2, 'widen a version', $$ UPDATE institution.assignment_version SET ai_policy = 'encouraged', import_allowed = true WHERE assignment_id = {z2} $$),
  (3, 'delete a version', $$ DELETE FROM institution.assignment_version WHERE assignment_id = {z1} AND version_no = 1 $$),
  (4, 'empty the table', 'TRUNCATE institution.assignment_version, institution.assignment, institution.notice_acknowledgment')
) AS v (n, what, statement)
ORDER BY v.n;
SET CONSTRAINTS ALL DEFERRED;
SELECT throws_ok(
  $$ UPDATE institution.assignment_version SET title = title $$, 'ZD403', 'assignment version is immutable',
  'nor can the operator, even with an update that changes no value'
);
-- docs/TESTING.md 5: without the trigger the very same statement goes
-- through, so the trigger is what refuses it.
ALTER TABLE institution.assignment_version DISABLE TRIGGER assignment_version_immutable;
SELECT is(
  pg_temp.ask_as('ductus_identity', 'anon', $$ WITH x AS (UPDATE institution.assignment_version SET title = title
                                                         WHERE assignment_id = {z1} RETURNING 1) SELECT count(*) FROM x $$),
  '2', 'with the trigger disabled the owner role rewrites both versions of Z1'
);
ALTER TABLE institution.assignment_version ENABLE TRIGGER assignment_version_immutable;
SELECT is(
  pg_temp.ask_as('ductus_identity', 'anon', $$ WITH x AS (UPDATE institution.assignment_version SET title = title
                                                         WHERE assignment_id = {z1} RETURNING 1) SELECT count(*) FROM x $$),
  'ZD403: assignment version is immutable', 'and with the trigger back the same statement is refused'
);

-- 5. publish_assignment_version: a teacher of the course of that assignment.
SELECT is(
  pg_temp.publish(v.actor, v.assignment, '2', pg_temp.content('ai_purposes', $$'{proofreading}'$$)), 'ZD403: forbidden',
  format('%s: publish_assignment_version of %s is refused (%s)', v.actor, v.assignment, v.why)
)
FROM (VALUES
  (1, 'ana', '{z1}', 'student of the course'),
  (2, 'boris', '{z1}', 'not a member'),
  (3, 'marko', '{z1}', 'teacher of another course'),
  (4, 'iva', '{z1}', 'administrator'),
  (5, 'petra', '{z1}', 'teacher at another institution'),
  (6, 'vesna', '{z2}', 'assignment of another course'),
  (7, 'vesna', '{nobody}', 'no such assignment'),
  (8, 'vesna', 'NULL', 'no assignment given')
) AS v (n, actor, assignment, why)
ORDER BY v.n;
-- The caller says which version the change started from.
SELECT is(
  pg_temp.publish('vesna', '{z1}', v.expected, pg_temp.content('ai_purposes', $$'{proofreading}'$$)), 'ZD409: conflict',
  'publishing over ' || v.what || ' is a conflict'
)
FROM (VALUES (1, '1', 'the first version, which is no longer current'), (2, '3', 'a version that does not exist yet'),
             (3, '0', 'version zero'), (4, 'NULL', 'no version')) AS v (n, expected, what)
ORDER BY v.n;
-- Plan 22 (docs/PRODUCT.md 5, rule 14): a new version never widens. Z1 is at
-- partially_allowed with {proofreading}, extended, import allowed.
CREATE TEMP TABLE narrow AS
SELECT pg_temp.create_in('vesna', '{k1}', pg_temp.content('evidence_profile', $$'basic'$$, 'import_allowed', 'false')) AS id;
SELECT is(
  pg_temp.publish('vesna', v.assignment, v.expected, pg_temp.content(v.field, v.value, v.field2, v.value2)), 'ZD422: invalid input',
  'a new version cannot ' || v.what
)
FROM (VALUES
  (1, '{z1}', '2', 'ai_purposes', $$'{proofreading,translation}'$$, NULL, NULL, 'add a purpose'),
  (2, '{z1}', '2', 'ai_purposes', $$'{formatting}'$$, NULL, NULL, 'bring back a purpose that the second version dropped'),
  (3, '{z1}', '2', 'ai_purposes', $$'{translation}'$$, NULL, NULL, 'swap the purpose for another'),
  (4, '{z1}', '2', 'ai_policy', $$'encouraged'$$, 'ai_purposes', $$'{proofreading}'$$, 'widen the AI rule'),
  (5, '{z1}', '2', 'title', $$''$$, 'ai_purposes', $$'{proofreading}'$$, 'have an empty title'),
  (6, (SELECT quote_literal(id) FROM narrow), '1', 'evidence_profile', $$'extended'$$, 'import_allowed', 'false',
   'go from the basic to the extended evidence profile'),
  (7, (SELECT quote_literal(id) FROM narrow), '1', 'evidence_profile', $$'basic'$$, 'import_allowed', 'true',
   'allow import where it was not allowed')
) AS v (n, assignment, expected, field, value, field2, value2, what)
ORDER BY v.n;
SELECT is(
  (SELECT string_agg(a.current_version::text, ' ' ORDER BY a.id = pg_temp.id('z1') DESC) FROM institution.assignment a, narrow
   WHERE a.id = pg_temp.id('z1') OR a.id::text = narrow.id)
  || ' ' || (SELECT count(*) FROM institution.assignment_version v, narrow
             WHERE v.assignment_id = pg_temp.id('z1') OR v.assignment_id::text = narrow.id),
  '2 1 3', 'after every refusal Z1 is at version 2 and the other assignment at version 1, with no version added'
);

-- Plan 21: a change is a new version, and the acknowledgment of the earlier
-- one does not carry over.
SELECT is(pg_temp.ask('ana', 'SELECT institution.has_acknowledged_current({z1})::text'), 'true', 'Ana has acknowledged the current version of Z1');
SELECT is(
  pg_temp.publish('vesna', '{z1}', '2', pg_temp.content('ai_policy', $$'prohibited'$$, 'ai_purposes', $$'{}'$$)), '3',
  'Vesna publishes a narrower version of Z1 with another title, instructions and dates, and gets its number'
);
SELECT is(
  (SELECT concat_ws(' ', a.current_version,
                    (SELECT string_agg(concat_ws(':', v.version_no, v.title, v.ai_policy, v.ai_purposes), ' ' ORDER BY v.version_no)
                     FROM institution.assignment_version v WHERE v.assignment_id = a.id))
   FROM institution.assignment a WHERE a.id = pg_temp.id('z1')),
  '3 1:Z1:partially_allowed:{formatting,proofreading} 2:Z1:partially_allowed:{proofreading} 3:Esej o izmišljenoj temi:prohibited:{}',
  'Z1 points at version 3; versions 1 and 2 are as they were'
);
SELECT is(
  (SELECT concat_ws(' ', v.created_by = pg_temp.id('vesna'), v.created_at = now()) FROM institution.assignment_version v
   WHERE v.assignment_id = pg_temp.id('z1') AND v.version_no = 3),
  't t', 'the new version names Vesna and the database time'
);
SELECT is(
  pg_temp.publish('vesna', '{z1}', '2', pg_temp.content('ai_policy', $$'prohibited'$$, 'ai_purposes', $$'{}'$$)), 'ZD409: conflict',
  'the same request again, still naming version 2, is a conflict: no number is given twice (plan 27)'
);
SELECT is(
  pg_temp.ask('ana', 'SELECT institution.has_acknowledged_current({z1})::text') || ' '
  || pg_temp.ask('ana', 'SELECT count(*) FROM institution.notice_acknowledgment WHERE assignment_id = {z1}'),
  'false 2', 'Ana has not acknowledged the new version; her two earlier acknowledgments stay as they were'
);

-- 6. acknowledge_notice: a student of the course, for herself, the current
-- version only (plan 24).
SELECT is(
  pg_temp.ask(v.actor, format('SELECT institution.acknowledge_notice(%s, %s)', v.assignment, v.version_no)), 'ZD403: forbidden',
  format('%s: acknowledge_notice of %s is refused (%s)', v.actor, v.assignment, v.why)
)
FROM (VALUES
  (1, 'vesna', '{z1}', '3', 'the teacher is not a student of the course'),
  (2, 'boris', '{z1}', '3', 'not a member'),
  (3, 'marko', '{z1}', '3', 'teacher of another course'),
  (4, 'iva', '{z1}', '3', 'administrator'),
  (5, 'tomo', '{z1}', '3', 'student at another institution'),
  (6, 'ana', '{z2}', '1', 'assignment of a course she is not in'),
  (7, 'ana', '{nobody}', '1', 'no such assignment'),
  (8, 'ana', 'NULL', '1', 'no assignment given')
) AS v (n, actor, assignment, version_no, why)
ORDER BY v.n;
SELECT is(
  pg_temp.ask('dora', format('SELECT institution.acknowledge_notice({z1}, %s)', v.version_no)), 'ZD409: conflict',
  'Dora acknowledging ' || v.what || ' of Z1 is a conflict'
)
FROM (VALUES (1, '2', 'version 2, which was current a moment ago'), (2, '1', 'version 1'), (3, '4', 'a version that does not exist'),
             (4, 'NULL', 'no version')) AS v (n, version_no, what)
ORDER BY v.n;
SELECT matches(
  pg_temp.ask('ana', 'SELECT institution.acknowledge_notice({z1}, 3, {dora})'), '^42883: ',
  'acknowledge_notice has no parameter for the student: nobody acknowledges for another'
);
SELECT is(pg_temp.counts(), '22 24 4', 'none of these calls stored an acknowledgment');

SELECT is(
  pg_temp.ask('dora', 'SELECT (institution.acknowledge_notice({z1}, 3) = now())::text'), 'true',
  'Dora acknowledges version 3 and gets the database time back'
);
SELECT is(
  (SELECT string_agg(concat_ws(' ', n.version_no, n.acknowledged_at = now()), ';' ORDER BY n.version_no)
   FROM institution.notice_acknowledgment n WHERE n.student_id = pg_temp.id('dora')),
  '1 t;3 t', 'her acknowledgment of version 3 stands beside the one of version 1'
);
UPDATE institution.notice_acknowledgment SET acknowledged_at = now() - interval '1 day'
 WHERE student_id = pg_temp.id('dora') AND version_no = 3;
SELECT is(
  pg_temp.ask('dora', $$ SELECT (institution.acknowledge_notice({z1}, 3) = now() - interval '1 day')::text $$)
  || ' ' || (SELECT count(*) FROM institution.notice_acknowledgment WHERE student_id = pg_temp.id('dora')),
  'true 2', 'acknowledging again returns the first time and adds no row'
);
-- Plan 25: has the caller acknowledged the version that is current now?
SELECT is(
  pg_temp.ask(v.actor, 'SELECT institution.has_acknowledged_current({z1})::text'), v.expected,
  v.actor || ': ' || v.why
)
FROM (VALUES
  (1, 'dora', 'true', 'acknowledged the current version'),
  (2, 'ana', 'false', 'acknowledged only earlier versions'),
  (3, 'boris', 'false', 'not a member'),
  (4, 'vesna', 'false', 'the teacher is not asked to acknowledge'),
  (5, 'iva', 'false', 'administrator')
) AS v (n, actor, expected, why)
ORDER BY v.n;
SELECT is(
  pg_temp.ask('vesna', $$ SELECT string_agg(p.name || '.' || n.version_no, ' ' ORDER BY n.version_no, p.name)
                          FROM institution.notice_acknowledgment n JOIN person p ON p.id = n.student_id
                          WHERE n.assignment_id = {z1} $$),
  'ana.1 dora.1 ana.2 dora.3', 'the teacher reads who acknowledged which version'
);
-- A student the teacher removed acknowledges nothing and counts as not having
-- acknowledged; what she acknowledged stays for the teacher to read.
SELECT is(
  pg_temp.ask('vesna', 'SELECT institution.remove_student({k1}, {dora})::text')
  || ' ' || pg_temp.ask('dora', 'SELECT institution.acknowledge_notice({z1}, 3)')
  || ' ' || pg_temp.ask('dora', 'SELECT institution.has_acknowledged_current({z1})::text')
  || ' ' || pg_temp.ask('vesna', $$ SELECT count(*) FROM institution.notice_acknowledgment WHERE student_id = {dora} $$),
  'true ZD403: forbidden false 2', 'removed from K1, Dora can no longer acknowledge and no longer counts; Vesna still reads her two rows'
);

SELECT * FROM finish();
ROLLBACK;

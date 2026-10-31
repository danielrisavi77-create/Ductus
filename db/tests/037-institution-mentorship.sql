-- Mentorship access matrix (DAN-349 part 1, #916): who reads a mentorship,
-- its assignment, the versions and the acknowledgments; that a mentorship and
-- a course never open each other's work; the faculty's rule a version of a
-- mentorship's assignment must stay within. The institution-wide catalogue
-- (tables, grants, policies, triggers, functions, role by table by operation)
-- is in 030. Synthetic fixtures only.
BEGIN;
\ir fixtures/institution.inc
\ir fixtures/mentorship.inc
-- Denials are told apart by their message below, so the language is fixed.
SET LOCAL lc_messages TO 'C';

SELECT plan(92);

-- 1. The contract: the rules of a mentorship are an assignment, and the
-- evidence keeps its assignment.
SELECT is(
  (SELECT attnotnull FROM pg_attribute
    WHERE attrelid = 'evidence.project'::regclass AND attname = 'assignment_id'),
  true,
  'evidence.project.assignment_id stays NOT NULL: a mentorship''s work belongs to its assignment'
);
SELECT is(
  (SELECT convalidated FROM pg_constraint
    WHERE conrelid = 'institution.assignment'::regclass AND conname = 'assignment_course_or_mentorship_check'),
  true,
  'every assignment belongs to a course or to a mentorship, and the existing rows were checked'
);

-- 2. Who sees what through ductus_app. One line per actor: the mentorships,
-- and every assignment, version and acknowledgment the session can read.
CREATE FUNCTION pg_temp.msees(p_actor text) RETURNS text
LANGUAGE sql AS $f$
  SELECT pg_temp.ask(p_actor, $q$
    SELECT concat_ws(' | ',
      'mentorships: ' || coalesce((
        SELECT string_agg(r.name || CASE WHEN m.ended_at IS NULL THEN '' ELSE '(ended)' END, ' ' ORDER BY r.name)
        FROM institution.mentorship m JOIN ref r ON r.val = m.id::text), '-'),
      'assignments: ' || coalesce((
        SELECT string_agg(z.name, ' ' ORDER BY z.name)
        FROM institution.assignment a JOIN ref z ON z.val = a.id::text), '-'),
      'versions: ' || coalesce((
        SELECT string_agg(z.name || '.' || v.version_no, ' ' ORDER BY z.name, v.version_no)
        FROM institution.assignment_version v JOIN ref z ON z.val = v.assignment_id::text), '-'),
      'acks: ' || coalesce((
        SELECT string_agg(z.name || '.' || n.version_no || '.' || p.name, ' ' ORDER BY z.name, n.version_no, p.name)
        FROM institution.notice_acknowledgment n
        JOIN ref z ON z.val = n.assignment_id::text
        JOIN person p ON p.id = n.student_id), '-'))
  $q$)
$f$;
CREATE FUNCTION pg_temp.none() RETURNS text
LANGUAGE sql AS $$ SELECT 'mentorships: - | assignments: - | versions: - | acks: -' $$;

SELECT is(pg_temp.msees(v.actor), v.expected, v.actor || ': ' || v.note)
FROM (VALUES
  (1, 'marko', 'mentorships: ms1 | assignments: z2 zm1 | versions: z2.1 zm1.1 | acks: zm1.1.ana',
   'mentor sees the mentorship, its assignment, version and Ana''s acknowledgment, beside his own course'),
  (2, 'ana', 'mentorships: ms1 | assignments: z1 zm1 | versions: z1.1 z1.2 zm1.1 | acks: z1.1.ana z1.2.ana zm1.1.ana',
   'student sees her mentorship and its rules beside her course'),
  (3, 'dora', 'mentorships: ms2(ended) | assignments: z1 | versions: z1.1 z1.2 | acks: z1.1.dora',
   'student of an ended mentorship keeps its row and loses its assignment and her acknowledgment of it'),
  (4, 'vesna', 'mentorships: - | assignments: z1 | versions: z1.1 z1.2 | acks: z1.1.ana z1.1.dora z1.2.ana',
   'former mentor of Dora and teacher of Ana''s course sees no mentorship and nothing of zm1 or zm2'),
  (5, 'boris', 'mentorships: ms3 | assignments: zm3 | versions: zm3.1 | acks: -',
   'student sees his mentorship although his mentor''s role is not confirmed'),
  (6, 'nina', pg_temp.none(), 'mentor whose teacher role nobody confirmed sees nothing'),
  (7, 'iva', pg_temp.none(), 'administrator sees no mentorship and no work of one'),
  (8, 'lea', pg_temp.none(), 'administrator of another institution sees nothing'),
  (9, 'petra', 'mentorships: - | assignments: z3 | versions: z3.1 | acks: z3.1.tomo',
   'teacher at another institution sees only her own course'),
  (10, 'tomo', 'mentorships: - | assignments: z3 | versions: z3.1 | acks: z3.1.tomo',
   'student at another institution sees only his own course'),
  (11, 'anon', pg_temp.none(), 'no session sees nothing'),
  (12, 'expired', pg_temp.none(), 'expired session of Ana sees nothing'),
  (13, 'closed', pg_temp.none(), 'closed session of Ana sees nothing'),
  (14, 'unknown', pg_temp.none(), 'token of no session sees nothing')
) AS v (n, actor, expected, note)
ORDER BY v.n;

-- 3. The same by id. A mentorship and a course never open each other's work,
-- and a work one has no part in reads as one that does not exist.
SELECT is(
  pg_temp.ask(v.actor, format($$ SELECT concat_ws(' ',
    (SELECT count(*) FROM institution.assignment WHERE id = %1$s),
    (SELECT count(*) FROM institution.assignment_version WHERE assignment_id = %1$s),
    (SELECT count(*) FROM institution.notice_acknowledgment WHERE assignment_id = %1$s),
    coalesce(institution.actor_assignment_role(%1$s), 'null'),
    institution.has_acknowledged_current(%1$s)::text) $$, v.assignment)),
  v.expected,
  format('%s: %s by id (assignment, versions, acknowledgments, part in it, current version acknowledged), %s',
         v.actor, v.assignment, v.note)
)
FROM (VALUES
  (1, 'marko', '{zm1}', '1 1 1 teacher false', 'the mentor'),
  (2, 'ana', '{zm1}', '1 1 1 student true', 'the student'),
  (3, 'vesna', '{zm1}', '0 0 0 null false', 'Ana''s course teacher has no part in her mentorship'),
  (4, 'marko', '{z1}', '0 0 0 null false', 'Ana''s mentor has no part in her course'),
  (5, 'dora', '{zm1}', '0 0 0 null false', 'another student of Ana''s course'),
  (6, 'dora', '{zm2}', '0 0 0 null false', 'the student of an ended mentorship'),
  (7, 'vesna', '{zm2}', '0 0 0 null false', 'the mentor of an ended mentorship'),
  (8, 'nina', '{zm3}', '0 0 0 null false', 'a mentor without a confirmed teacher role'),
  (9, 'boris', '{zm3}', '1 1 0 student false', 'the student, before he acknowledged'),
  (10, 'petra', '{zm1}', '0 0 0 null false', 'a teacher at another institution'),
  (11, 'tomo', '{zm1}', '0 0 0 null false', 'a student at another institution'),
  (12, 'iva', '{zm1}', '0 0 0 null false', 'the administrator'),
  (13, 'anon', '{zm1}', '0 0 0 null false', 'no session'),
  (14, 'expired', '{zm1}', '0 0 0 null false', 'an expired session of the student'),
  (15, 'boris', '{nobody}', '0 0 0 null false', 'an assignment that does not exist')
) AS v (n, actor, assignment, expected, note)
ORDER BY v.n;
SELECT is(
  pg_temp.ask(v.actor, format('SELECT coalesce(institution.actor_mentorship_role(%s), ''null'')', v.mentorship)),
  v.expected, format('%s: part in %s', v.actor, v.mentorship)
)
FROM (VALUES
  (1, 'marko', '{ms1}', 'teacher'), (2, 'ana', '{ms1}', 'student'), (3, 'dora', '{ms2}', 'null'),
  (4, 'vesna', '{ms2}', 'null'), (5, 'nina', '{ms3}', 'null'), (6, 'boris', '{ms3}', 'student'),
  (7, 'petra', '{ms1}', 'null'), (8, 'tomo', '{ms1}', 'null'), (9, 'iva', '{ms1}', 'null'),
  (10, 'anon', '{ms1}', 'null'), (11, 'ana', '{nobody}', 'null'), (12, 'dora', '{ms1}', 'null')
) AS v (n, actor, mentorship, expected)
ORDER BY v.n;
-- The teacher's list of courses stays a list of courses.
SELECT is(
  pg_temp.ask('marko', $$ SELECT string_agg(z.name, ' ' ORDER BY z.name)
                          FROM institution.list_teacher_courses() t JOIN ref z ON z.val = t.assignment_id::text $$),
  'z2', 'Marko: list_teacher_courses holds the assignment of his course and not the one of his mentorship'
);

-- 4. The notice of a mentorship's work is acknowledged as any other.
SELECT is(
  pg_temp.ask('boris', $$ SELECT (institution.acknowledge_notice({zm3}, 1) IS NOT NULL)::text $$), 'true',
  'Boris acknowledges the current version of his work'
);
SELECT is(
  pg_temp.ask('boris', $$ SELECT institution.has_acknowledged_current({zm3})::text $$), 'true',
  'Boris: the current version is acknowledged'
);
SELECT is(pg_temp.ask(v.actor, v.statement), v.expected, v.actor || ': ' || v.note)
FROM (VALUES
  (1, 'marko', $$ SELECT institution.acknowledge_notice({zm1}, 1)::text $$, 'ZD403: forbidden',
   'the mentor cannot acknowledge for the student'),
  (2, 'nina', $$ SELECT institution.acknowledge_notice({zm3}, 1)::text $$, 'ZD403: forbidden',
   'a mentor without a confirmed role cannot either'),
  (3, 'dora', $$ SELECT institution.acknowledge_notice({zm2}, 1)::text $$, 'ZD403: forbidden',
   'the work of an ended mentorship takes no acknowledgment'),
  (4, 'ana', $$ SELECT institution.acknowledge_notice({zm1}, 2)::text $$, 'ZD409: conflict',
   'only the current version can be acknowledged')
) AS v (n, actor, statement, expected, note)
ORDER BY v.n;

-- 5. No new version of a mentorship's rules through the teacher's function
-- (#916): the mentor's narrowing has no screen yet. A course is unchanged.
CREATE FUNCTION pg_temp.publish(p_assignment text, p_title text, p_work_type text) RETURNS text
LANGUAGE sql AS $$
  SELECT format($q$ SELECT institution.publish_assignment_version(%s, 1, %L, 'Nove upute.', %L, now(),
                    now() + interval '30 days', 'prohibited', '{}', 'basic', false, NULL, NULL)::text $q$,
                p_assignment, p_title, p_work_type)
$$;
SELECT is(pg_temp.ask('marko', pg_temp.publish('{zm1}', 'ZM1B', 'master_thesis')), 'ZD403: forbidden',
          'Marko: no new version of the mentorship''s rules');
SELECT is(pg_temp.ask('ana', pg_temp.publish('{zm1}', 'ZM1B', 'master_thesis')), 'ZD403: forbidden',
          'Ana: no new version of the rules of her own work');
SELECT is(pg_temp.ask('marko', pg_temp.publish('{z2}', 'Z2B', 'essay')), '2',
          'Marko: a new version of his course''s assignment as before');

-- 6. Nobody writes a mentorship, a rule or a mentorship's assignment directly.
SELECT is(pg_temp.ask(v.actor, v.statement), '42501: permission denied for table ' || v.tbl, v.actor || ' cannot ' || v.what)
FROM (VALUES
  (1, 'ana', 'mentorship', 'end her own mentorship',
   $$ UPDATE institution.mentorship SET ended_at = now() WHERE student_id = {ana} $$),
  (2, 'marko', 'mentorship', 'make himself the mentor of another student',
   $$ INSERT INTO institution.mentorship (institution_id, mentor_id, student_id, work_type)
      VALUES ({fak_a}, {marko}, {dora}, 'master_thesis') $$),
  (3, 'marko', 'mentorship', 'remove a mentorship',
   $$ DELETE FROM institution.mentorship WHERE mentor_id = {marko} $$),
  (4, 'marko', 'faculty_work_rule', 'read the faculty''s rule directly',
   $$ SELECT count(*) FROM institution.faculty_work_rule $$),
  (5, 'iva', 'faculty_work_rule', 'write the faculty''s rule directly',
   $$ INSERT INTO institution.faculty_work_rule (institution_id, work_type, ai_policy, ai_purposes, evidence_profile, import_allowed)
      VALUES ({fak_a}, 'doctoral_thesis', 'encouraged', '{}', 'extended', true) $$),
  (6, 'marko', 'assignment', 'give his mentorship a second assignment',
   $$ INSERT INTO institution.assignment (mentorship_id, institution_id, created_by) VALUES ({ms1}, {fak_a}, {marko}) $$)
) AS v (n, actor, tbl, what, statement)
ORDER BY v.n;

-- 7. The rules of the tables and of the versions, checked as the operator
-- would write them. A statement that passes is undone at once, so every row
-- below meets the fixture as it was. fak-b has no rule for any work type;
-- ms5 there has no assignment yet.
INSERT INTO ref VALUES ('ms5', '00000000-0000-4000-8000-0000000000d5');
INSERT INTO institution.mentorship (id, institution_id, mentor_id, student_id, work_type)
VALUES (pg_temp.id('ms4'), pg_temp.id('fak_b'), pg_temp.id('petra'), pg_temp.id('tomo'), 'doctoral_thesis'),
       (pg_temp.id('ms5'), pg_temp.id('fak_b'), pg_temp.id('petra'), pg_temp.id('tomo'), 'master_thesis');
INSERT INTO institution.assignment (id, mentorship_id, institution_id, current_version, created_by)
VALUES (pg_temp.id('zm4'), pg_temp.id('ms4'), pg_temp.id('fak_b'), 1, pg_temp.id('petra'));

CREATE FUNCTION pg_temp.try(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_sql text := p_sql;
  r record;
BEGIN
  FOR r IN SELECT name, val FROM ref LOOP
    v_sql := replace(v_sql, '{' || r.name || '}', quote_literal(r.val));
  END LOOP;
  BEGIN
    EXECUTE v_sql;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'ZZ999';
  EXCEPTION WHEN OTHERS THEN
    RETURN CASE SQLSTATE WHEN 'ZZ999' THEN 'ok' ELSE SQLSTATE END;
  END;
END
$$;
CREATE FUNCTION pg_temp.version(p_assignment text, p_work_type text, p_ai_policy text, p_ai_purposes text,
                                p_evidence_profile text, p_import_allowed boolean) RETURNS text
LANGUAGE sql AS $$
  SELECT format($q$ INSERT INTO institution.assignment_version (
                      assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
                      ai_purposes, evidence_profile, import_allowed, created_by)
                    VALUES (%s, 2, 'Druga verzija', 'Upute.', %L, now(), now() + interval '30 days', %L, %L::text[],
                            %L, %L::boolean, {marko}) $q$,
                p_assignment, p_work_type, p_ai_policy, p_ai_purposes, p_evidence_profile, p_import_allowed)
$$;

SELECT is(pg_temp.try(v.statement), v.expected, v.note)
FROM (VALUES
  (1, pg_temp.version('{zm1}', 'master_thesis', 'encouraged', '{}', 'basic', false), 'ZD422',
   'a version with a wider AI rule than the faculty''s is refused'),
  (2, pg_temp.version('{zm1}', 'master_thesis', 'partially_allowed', '{translation}', 'basic', false), 'ZD422',
   'a version with a purpose the faculty does not allow is refused'),
  (3, pg_temp.version('{zm2}', 'bachelor_thesis', 'prohibited', '{}', 'extended', false), 'ZD422',
   'a version with a wider evidence profile than the faculty''s is refused'),
  (4, pg_temp.version('{zm1}', 'master_thesis', 'partially_allowed', '{}', 'basic', true), 'ZD422',
   'a version that allows import the faculty does not allow is refused'),
  (5, pg_temp.version('{zm1}', 'essay', 'prohibited', '{}', 'basic', false), 'ZD422',
   'a version of another work type than the mentorship''s is refused'),
  (6, pg_temp.version('{zm4}', 'doctoral_thesis', 'prohibited', '{}', 'basic', false), 'ZD503',
   'without the faculty''s rule for the work type no version is written'),
  (7, pg_temp.version('{zm1}', 'master_thesis', 'prohibited', '{}', 'basic', false), 'ok',
   'a version narrower than the faculty''s rule is written'),
  (8, pg_temp.version('{zm1}', 'master_thesis', 'partially_allowed', '{proofreading,literature_search}', 'extended', false), 'ok',
   'a version equal to the faculty''s rule is written'),
  (9, pg_temp.version('{z3}', 'essay', 'encouraged', '{translation}', 'extended', true), 'ok',
   'a version of a course''s assignment is not held to any faculty work rule'),
  (10, $$ INSERT INTO institution.assignment (course_id, mentorship_id, institution_id, created_by)
          VALUES ({k2}, {ms1}, {fak_a}, {marko}) $$, '23514',
   'an assignment of a course and a mentorship at once is refused'),
  (11, $$ INSERT INTO institution.assignment (institution_id, created_by) VALUES ({fak_a}, {marko}) $$, '23514',
   'an assignment of neither is refused'),
  (12, $$ INSERT INTO institution.assignment (mentorship_id, institution_id, created_by) VALUES ({ms1}, {fak_a}, {marko}) $$,
   '23505', 'a second assignment of one mentorship is refused'),
  (13, $$ INSERT INTO institution.assignment (mentorship_id, institution_id, created_by) VALUES ({ms5}, {fak_a}, {marko}) $$,
   '23503', 'an assignment of another institution''s mentorship is refused'),
  (14, $$ INSERT INTO institution.mentorship (institution_id, mentor_id, student_id, work_type)
          VALUES ({fak_a}, {vesna}, {ana}, 'master_thesis') $$, '23505',
   'a second open mentorship of the same kind for one student is refused'),
  (15, $$ INSERT INTO institution.mentorship (institution_id, mentor_id, student_id, work_type)
          VALUES ({fak_a}, {marko}, {dora}, 'bachelor_thesis') $$, 'ok',
   'an ended mentorship does not hold the place of a new one'),
  (16, $$ INSERT INTO institution.mentorship (institution_id, mentor_id, student_id, work_type)
          VALUES ({fak_a}, {ana}, {ana}, 'doctoral_thesis') $$, '23514',
   'nobody mentors the own work'),
  (17, $$ INSERT INTO institution.mentorship (institution_id, mentor_id, student_id, work_type)
          VALUES ({fak_a}, {petra}, {ana}, 'doctoral_thesis') $$, '23503',
   'a mentor of another institution is refused'),
  (18, $$ INSERT INTO institution.mentorship (institution_id, mentor_id, student_id, work_type)
          VALUES ({fak_a}, {vesna}, {ana}, 'essay') $$, '23514',
   'a mentorship is of a final or higher thesis only'),
  (19, $$ INSERT INTO institution.mentorship (institution_id, mentor_id, student_id, work_type, started_at, ended_at)
          VALUES ({fak_a}, {vesna}, {ana}, 'doctoral_thesis', now(), now() - interval '1 day') $$, '23514',
   'a mentorship cannot end before it starts'),
  (20, $$ INSERT INTO institution.faculty_work_rule (institution_id, work_type, ai_policy, ai_purposes, evidence_profile, import_allowed)
          VALUES ({fak_b}, 'master_thesis', 'prohibited', '{proofreading}', 'basic', false) $$, '23514',
   'a faculty rule that prohibits AI allows no purpose')
) AS v (n, statement, expected, note)
ORDER BY v.n;

-- 8. Removal works at once: no cached decision.
UPDATE institution.institution_role SET revoked_at = now() WHERE user_id = pg_temp.id('marko');
SELECT is(pg_temp.msees('marko'), pg_temp.none(),
          'mentor whose teacher role was revoked: the mentorship and its work are gone at once');
SELECT is(pg_temp.msees('ana'),
          'mentorships: ms1 | assignments: z1 zm1 | versions: z1.1 z1.2 zm1.1 | acks: z1.1.ana z1.2.ana zm1.1.ana',
          'the student keeps her mentorship and its rules');
UPDATE institution.institution_role SET revoked_at = NULL WHERE user_id = pg_temp.id('marko');
UPDATE institution.mentorship SET ended_at = now() WHERE id = pg_temp.id('ms1');
SELECT is(pg_temp.msees('ana'),
          'mentorships: ms1(ended) | assignments: z1 | versions: z1.1 z1.2 | acks: z1.1.ana z1.2.ana',
          'ended mentorship: the student keeps its row and loses its work at once');
SELECT is(pg_temp.msees('marko'), 'mentorships: - | assignments: z2 | versions: z2.1 z2.2 | acks: -',
          'ended mentorship: the mentor loses it and its work at once, and keeps his course');
SELECT is(pg_temp.ask('ana', $$ SELECT institution.has_acknowledged_current({zm1})::text $$), 'false',
          'ended mentorship: the earlier acknowledgment no longer counts');
SELECT is(pg_temp.ask('ana', $$ SELECT institution.acknowledge_notice({zm1}, 1)::text $$), 'ZD403: forbidden',
          'ended mentorship: nothing more is acknowledged');
UPDATE institution.mentorship SET ended_at = NULL WHERE id = pg_temp.id('ms1');

-- 9. Grants by mistake (docs/TESTING.md 5): with every privilege on both
-- tables, RLS still holds.
GRANT ALL ON institution.mentorship, institution.faculty_work_rule TO ductus_app;
SELECT is(pg_temp.ask(v.actor, v.statement), v.expected, 'mistaken grant, ' || v.actor || ': ' || v.note)
FROM (VALUES
  (1, 'marko', $$ SELECT count(*)::text FROM institution.faculty_work_rule $$, '0',
   'the faculty''s rule is still not readable'),
  (2, 'iva', $$ INSERT INTO institution.faculty_work_rule (institution_id, work_type, ai_policy, ai_purposes, evidence_profile, import_allowed)
                VALUES ({fak_a}, 'doctoral_thesis', 'encouraged', '{}', 'extended', true) $$,
   '42501: new row violates row-level security policy for table "faculty_work_rule"', 'no rule is written'),
  (3, 'marko', $$ INSERT INTO institution.mentorship (institution_id, mentor_id, student_id, work_type)
                  VALUES ({fak_a}, {marko}, {dora}, 'master_thesis') $$,
   '42501: new row violates row-level security policy for table "mentorship"', 'no mentorship is written'),
  (4, 'ana', $$ WITH x AS (UPDATE institution.mentorship SET ended_at = now() RETURNING 1) SELECT count(*)::text FROM x $$,
   '0', 'the student ends nothing'),
  (5, 'marko', $$ WITH x AS (DELETE FROM institution.mentorship RETURNING 1) SELECT count(*)::text FROM x $$,
   '0', 'the mentor removes nothing'),
  (6, 'boris', $$ WITH x AS (UPDATE institution.faculty_work_rule SET import_allowed = true RETURNING 1)
                  SELECT count(*)::text FROM x $$,
   '0', 'nobody widens the faculty''s rule')
) AS v (n, actor, statement, expected, note)
ORDER BY v.n;
SELECT is(
  (SELECT concat_ws(' ', (SELECT count(*) FROM institution.mentorship WHERE ended_at IS NULL),
                         (SELECT count(*) FROM institution.mentorship),
                         (SELECT count(*) FROM institution.faculty_work_rule))),
  '4 5 2',
  'after every attempt the mentorships and rules are all still there'
);

SELECT * FROM finish();
ROLLBACK;

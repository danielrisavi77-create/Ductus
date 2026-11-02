-- DAN-344 R-2 (#923, contract c.6434766713 points 2, 3 and 6): the students
-- of a course and of an assignment with their name pair, for the teacher
-- only, with nothing of a work and without writing anything. Personas of
-- institution.inc. Added here: name pairs for Ana, Boris and Tomo (Dora has
-- none); Boris left K1 once and was let back; Nina was a K1 student and left,
-- and holds an open K1 teacher membership without a confirmed teacher role;
-- Marko was a teacher of K1 and left. Everything is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

-- The given names differ from the fixture names, so a name beside the wrong
-- student shows.
INSERT INTO identity.person_name (user_id, institution_id, given_name, family_name)
VALUES (pg_temp.id('ana'), pg_temp.id('fak_a'), 'Iskra', 'Prva'),
       (pg_temp.id('boris'), pg_temp.id('fak_a'), 'Luka', 'Treci'),
       (pg_temp.id('tomo'), pg_temp.id('fak_b'), 'Vid', 'Cetvrti');

INSERT INTO institution.course_member (course_id, institution_id, user_id, role, member_to)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('boris'), 'student', now()),
       (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('boris'), 'student', NULL),
       (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('nina'), 'student', now()),
       (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('marko'), 'teacher', now()),
       (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('nina'), 'teacher', NULL);

-- The rows of p_function(p_target) as p_actor, in the function's own order,
-- as "student:given/family" ("-" for a null), or "none", or "SQLSTATE: ...".
-- Ids are replaced by fixture names.
CREATE FUNCTION pg_temp.roster(p_actor text, p_function text, p_target text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_result text;
  r record;
BEGIN
  v_result := pg_temp.ask(p_actor, format(
    $q$ SELECT coalesce(string_agg(w.student_id::text || ':' || coalesce(w.given_name, '-') || '/'
                                   || coalesce(w.family_name, '-'), ' ' ORDER BY w.n), 'none')
          FROM %s(%s) WITH ORDINALITY AS w (student_id, given_name, family_name, n) $q$,
    p_function, coalesce(quote_literal(pg_temp.id(p_target)::text) || '::uuid', 'NULL::uuid')));
  FOR r IN SELECT name, id FROM person LOOP
    v_result := replace(v_result, r.id::text, r.name);
  END LOOP;
  RETURN v_result;
END
$$;
CREATE FUNCTION pg_temp.course(p_actor text, p_course text) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.roster(p_actor, 'app.teacher_course_students', p_course) $$;
CREATE FUNCTION pg_temp.names(p_actor text, p_assignment text) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.roster(p_actor, 'app.teacher_assignment_names', p_assignment) $$;
-- The students app.assignment_submissions gives the same caller, in its order.
CREATE FUNCTION pg_temp.submitters(p_actor text, p_assignment text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_result text;
  r record;
BEGIN
  v_result := pg_temp.ask(p_actor, format(
    $q$ SELECT coalesce(string_agg(w.student_id::text, ' ' ORDER BY w.n), 'none')
          FROM app.assignment_submissions(%s::uuid) WITH ORDINALITY AS w (student_id, a, b, c, d, n) $q$,
    quote_literal(pg_temp.id(p_assignment)::text)));
  FOR r IN SELECT name, id FROM person LOOP
    v_result := replace(v_result, r.id::text, r.name);
  END LOOP;
  RETURN v_result;
END
$$;
-- Row counts of every table in audit and evidence, to show a call writes none.
CREATE FUNCTION pg_temp.written() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(format('%s=%s', c.oid::regclass,
           (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %s', c.oid::regclass), false, true, '')))[1]),
         ' ' ORDER BY n.nspname, c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('audit', 'evidence') AND c.relkind IN ('r', 'p')
$$;

-- Catalogue.
SELECT is(
  (SELECT format('%s %s %s %s', proowner::regrole, prosecdef, provolatile, 'search_path=""' = ANY (proconfig))
     FROM pg_proc WHERE oid = 'app.teacher_course_students(uuid)'::regprocedure),
  'ductus_identity t s t', 'the course list is a STABLE SECURITY DEFINER function of the identity role, empty search_path');
SELECT is(
  (SELECT format('%s %s %s %s', proowner::regrole, prosecdef, provolatile, 'search_path=""' = ANY (proconfig))
     FROM pg_proc WHERE oid = 'app.teacher_assignment_names(uuid)'::regprocedure),
  'ductus_evidence t s t', 'the assignment list is a STABLE SECURITY DEFINER function of the evidence role, empty search_path');
SELECT bag_eq(
  $$ SELECT f || ' ' || r FROM unnest(ARRAY['app.teacher_course_students(uuid)', 'app.teacher_assignment_names(uuid)']) AS f,
                             unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth',
                                          'ductus_test_stranger']) AS r
      WHERE has_function_privilege(r, f, 'EXECUTE') $$,
  $$ VALUES ('app.teacher_course_students(uuid) ductus_app'), ('app.teacher_assignment_names(uuid) ductus_app') $$,
  'of the runtime roles only the web role executes either list');
SELECT ok(NOT has_function_privilege('ductus_evidence', 'app.teacher_course_students(uuid)', 'EXECUTE'),
  'the evidence role does not execute the course list');
SELECT ok(NOT has_function_privilege('ductus_identity', 'app.teacher_assignment_names(uuid)', 'EXECUTE'),
  'the identity role does not execute the assignment list');
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p, aclexplode(p.proacl) a
      WHERE p.oid IN ('app.teacher_course_students(uuid)'::regprocedure, 'app.teacher_assignment_names(uuid)'::regprocedure)
        AND a.grantee = 0 $$,
  'PUBLIC executes neither list');
SELECT is(pg_get_function_result('app.teacher_course_students(uuid)'::regprocedure),
  'TABLE(student_id uuid, given_name text, family_name text)', 'the course list returns the student and the name pair only');
SELECT is(pg_get_function_result('app.teacher_assignment_names(uuid)'::regprocedure),
  'TABLE(student_id uuid, given_name text, family_name text)', 'the assignment list returns the student and the name pair only');
SELECT is(pg_get_function_arguments('app.teacher_course_students(uuid)'::regprocedure), 'p_course_id uuid',
  'the course list takes only the course: no identity or institution argument');
SELECT is(pg_get_function_arguments('app.teacher_assignment_names(uuid)'::regprocedure), 'p_assignment_id uuid',
  'the assignment list takes only the assignment: no identity or institution argument');
SELECT matches(pg_temp.ask_as('ductus_test_stranger', 'vesna', $$ SELECT count(*) FROM app.teacher_course_students({k1}) $$),
  '^42501:.*$', 'an unrelated role cannot call the course list');
SELECT matches(pg_temp.ask_as('ductus_test_stranger', 'vesna', $$ SELECT count(*) FROM app.teacher_assignment_names({z1}) $$),
  '^42501:.*$', 'an unrelated role cannot call the assignment list');

-- Point 2: the students of a course.
CREATE TEMP TABLE before AS SELECT pg_temp.written() AS counts;
SELECT is(pg_temp.course('vesna', 'k1'), 'ana:Iskra/Prva dora:-/- boris:Luka/Treci',
  'the teacher of the course: every open student once with the own pair, null without one, '
  'a student who left is not listed and one let back is');
SELECT is(pg_temp.course('petra', 'k3'), 'tomo:Vid/Cetvrti', 'the teacher of another course gets that course');
SELECT is((SELECT counts FROM before), pg_temp.written(), 'the course list writes no audit or evidence row');

SELECT is(pg_temp.course(a.who, a.course), 'none', a.why)
  FROM (VALUES
    ('marko', 'k1', 'a teacher of another course and former teacher of this one gets nothing'),
    ('marko', 'k2', 'a teacher of a course without students gets nothing'),
    ('nina', 'k1', 'an open teacher membership without a confirmed teacher role gets nothing'),
    ('ana', 'k1', 'a student of the course gets nothing'),
    ('tomo', 'k1', 'a student of another institution gets nothing'),
    ('petra', 'k1', 'a teacher of another institution gets nothing'),
    ('iva', 'k1', 'the administrator of the institution gets nothing'),
    ('boris', 'k1', 'a student let back gets nothing'),
    ('vesna', 'k3', 'the course of another institution is the same nothing'),
    ('vesna', 'nobody', 'a course that does not exist is the same nothing'),
    ('vesna', 'z1', 'an assignment id in place of a course is the same nothing'),
    ('vesna', NULL, 'no course is the same nothing')
  ) AS a (who, course, why);
SELECT is(pg_temp.ask('vesna', $$ SELECT count(*) FROM app.teacher_course_students('not-a-uuid') $$),
  '22P02: invalid input syntax for type uuid: "not-a-uuid"', 'an id of the wrong shape never reaches the function');
SELECT matches(pg_temp.course(t, 'k1'), '^ZD401: not authenticated$', 'no valid session is ZD401: ' || t)
  FROM unnest(ARRAY['anon', 'expired', 'closed', 'unknown']) AS t;

-- Point 3: the students of an assignment, the set of assignment_submissions.
SELECT is(pg_temp.names('vesna', 'z1'), 'ana:Iskra/Prva dora:-/- boris:Luka/Treci',
  'the teacher of the assignment: the students of its course with the own pair');
SELECT is(regexp_replace(pg_temp.names(a.who, a.z), ':[^ ]*', '', 'g'), pg_temp.submitters(a.who, a.z),
          'the same students as assignment_submissions for ' || a.who || ' on ' || a.z)
  FROM (VALUES ('vesna', 'z1'), ('petra', 'z3'), ('marko', 'z1'), ('marko', 'z2'), ('nina', 'z1'), ('ana', 'z1'),
               ('tomo', 'z1'), ('petra', 'z1'), ('iva', 'z1'), ('vesna', 'z3'), ('vesna', 'nobody')) AS a (who, z);
SELECT is(pg_temp.names(a.who, a.z), 'none', a.why)
  FROM (VALUES
    ('marko', 'z1', 'a former teacher of the course gets nothing'),
    ('nina', 'z1', 'a teacher membership without a confirmed role gets nothing'),
    ('ana', 'z1', 'a student of the course gets nothing'),
    ('petra', 'z1', 'a teacher of another institution gets nothing'),
    ('iva', 'z1', 'the administrator gets nothing'),
    ('vesna', 'z3', 'the assignment of another institution is the same nothing'),
    ('vesna', 'nobody', 'an assignment that does not exist is the same nothing'),
    ('vesna', 'k1', 'a course id in place of an assignment is the same nothing'),
    ('vesna', NULL, 'no assignment is the same nothing')
  ) AS a (who, z, why);
SELECT matches(pg_temp.names(t, 'z1'), '^ZD401: not authenticated$', 'no valid session is ZD401: ' || t)
  FROM unnest(ARRAY['anon', 'expired', 'closed', 'unknown']) AS t;
SELECT is((SELECT counts FROM before), pg_temp.written(),
  'neither list writes an audit or evidence row: no work opening, no fast path window');
SELECT is((SELECT count(*) FROM audit.access_log), 0::bigint, 'no access log row at all');
SELECT is((SELECT count(*) FROM evidence.fast_path_window), 0::bigint, 'no fast path window at all');

-- A teacher who leaves the course loses both lists at once.
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('vesna') AND member_to IS NULL;
SELECT is(pg_temp.course('vesna', 'k1'), 'none', 'a teacher who left the course gets no course list');
SELECT is(pg_temp.names('vesna', 'z1'), 'none', 'a teacher who left the course gets no assignment list');

SELECT * FROM finish();
ROLLBACK;

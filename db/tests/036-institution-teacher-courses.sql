-- The teacher's courses and assignments for the Z3 entry (DAN-230,
-- institution.list_teacher_courses): only courses where the caller is a
-- teacher by actor_course_role, computed on every call; no session ZD401;
-- no confirmed teacher role ZD403. Synthetic fixtures only
-- (fixtures/institution.inc): Vesna teaches K1 (Z1 at version 2, Ana and
-- Dora), Marko K2 (Z2, no student), Petra K3 at fak-b (Z3, Tomo).
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';

SELECT plan(22);

-- K4: a second course of Vesna's, without an assignment.
INSERT INTO ref VALUES ('k4', '00000000-0000-4000-8000-0000000000c4');
INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
VALUES (pg_temp.id('k4'), pg_temp.id('fak_a'), 'K4', '2025/2026', 'prohibited', pg_temp.id('vesna'));
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k4'), pg_temp.id('fak_a'), pg_temp.id('vesna'), 'teacher');

-- What the caller gets, one "course year rule title version students" per row, sorted.
CREATE FUNCTION pg_temp.listing(p_actor text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, $q$
    SELECT coalesce(string_agg(
             concat_ws(' ', (SELECT r.name FROM ref r WHERE r.val = l.course_id::text), l.course_name, l.academic_year, l.ai_policy,
                       coalesce(l.title, '-'), coalesce(l.work_type, '-'), coalesce(l.current_version::text, '-'),
                       coalesce(l.enrolled_students::text, '-'),
                       CASE WHEN l.opens_at IS NULL THEN '-' ELSE 'opens' END,
                       CASE WHEN l.due_at IS NULL THEN '-' ELSE 'due' END),
             '; ' ORDER BY l.course_name, l.title), '')
      FROM institution.list_teacher_courses() l $q$)
$$;

-- 1. Each teacher sees exactly the own courses, with the current version and the count of students.
SELECT is(pg_temp.listing('vesna'), 'k1 K1 2026/2027 partially_allowed Z1 essay 2 2 opens due; k4 K4 2025/2026 prohibited - - - 0 - -',
  'Vesna sees K1 with its rule, Z1 at version 2 and two students, and K4 with its own rule, without an assignment or a student');
SELECT is(pg_temp.listing('marko'), 'k2 K2 2026/2027 prohibited Z2 essay 1 0 opens due', 'Marko sees only K2, with no student');
SELECT is(pg_temp.listing('petra'), 'k3 K3 2026/2027 encouraged Z3 essay 1 1 opens due',
  'Petra of fak-b sees only K3, never a course of fak-a');

-- 2. Anyone without a confirmed teacher role is refused, as is no session.
SELECT is(pg_temp.listing(v.actor), 'ZD403: forbidden', v.actor || ' (' || v.who || ') is refused')
FROM (VALUES
  (1, 'ana', 'a student of K1'),
  (2, 'tomo', 'a student of K3'),
  (3, 'boris', 'a student in no course'),
  (4, 'iva', 'an administrator'),
  (5, 'lea', 'an administrator of fak-b'),
  (6, 'nina', 'a teacher role nobody confirmed')
) AS v (n, actor, who)
ORDER BY v.n;
SELECT is(pg_temp.listing(v.actor), 'ZD401: not authenticated', v.actor || ' has no open session')
FROM unnest(ARRAY['anon', 'expired', 'closed', 'unknown']) WITH ORDINALITY AS v (actor, n)
ORDER BY v.n;

-- 3. The answer holds no person and nothing of a work: the columns are fixed.
SELECT is(
  pg_get_function_result('institution.list_teacher_courses()'::regprocedure),
  'TABLE(course_id uuid, course_name text, academic_year text, assignment_id uuid, title text, work_type text, opens_at timestamp with time zone, due_at timestamp with time zone, current_version integer, enrolled_students integer, ai_policy text)',
  'the function returns only the fields of the contract, the course''s rule last (DAN-344 T03)'
);
SELECT is(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'institution.list_teacher_courses()'::regprocedure), false,
  'the function runs as the caller, so the policies decide every row'
);

-- 4. Access follows the relation on every call (C-23).
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k4') AND user_id = pg_temp.id('vesna');
SELECT is(pg_temp.listing('vesna'), 'k1 K1 2026/2027 partially_allowed Z1 essay 2 2 opens due',
  'a closed membership drops the course at once');
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k2') AND user_id = pg_temp.id('marko');
SELECT is(pg_temp.listing('marko'), '', 'a teacher without an open membership gets an empty list, not a refusal');
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('dora');
SELECT is(pg_temp.listing('vesna'), 'k1 K1 2026/2027 partially_allowed Z1 essay 2 1 opens due',
  'a student who left is no longer counted');
UPDATE institution.institution_role SET revoked_at = now()
 WHERE user_id = pg_temp.id('vesna') AND role = 'teacher';
SELECT is(pg_temp.listing('vesna'), 'ZD403: forbidden', 'a revoked teacher role is refused at once');

-- 5. Only ductus_app may call it, and only through its session.
SELECT is(has_function_privilege('ductus_app', 'institution.list_teacher_courses()', 'EXECUTE'), true,
  'ductus_app may call the function');
SELECT is(has_function_privilege('ductus_test_stranger', 'institution.list_teacher_courses()', 'EXECUTE'), false,
  'PUBLIC may not call the function');
-- The function was dropped and created again for its new column: no other role got it back.
SELECT is(
  (SELECT array_agg(r ORDER BY r) FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth',
                                                   'ductus_identity', 'ductus_evidence', 'ductus_test_stranger']) AS r
    WHERE has_function_privilege(r, 'institution.list_teacher_courses()', 'EXECUTE')),
  ARRAY['ductus_app', 'ductus_identity'],
  'only the web role and the owning identity role execute the function');

SELECT * FROM finish();
ROLLBACK;

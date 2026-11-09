-- migrate:up
-- DAN-51, M2.15-P02 (contract on #1091, c.6728959896): the read policies that
-- asked actor_course_role(course_id) or actor_assignment_role(assignment_id)
-- called a SECURITY DEFINER function once per row, and each call read the
-- session again through app.current_actor(). They now compare the row with the
-- actor's own courses or assignments, computed once per statement as an
-- initplan: col = ANY ((SELECT institution.actor_course_ids(...))::uuid[]).
-- The cast keeps the scalar subquery: without it the parser reads
-- ANY ((SELECT ...)) as ANY (subquery) and compares uuid with uuid[].
--
-- Who sees what does not change. actor_course_ids(roles) holds exactly the
-- courses for which actor_course_role() returns one of roles: an actor has at
-- most one open membership per course (course_member_open_idx), so the role
-- is a function of the course. actor_assignment_ids(roles) holds exactly the
-- assignments for which actor_assignment_role() returns one of roles: an
-- assignment has a course or a mentorship, never both
-- (assignment_course_or_mentorship_check), and each branch below is the
-- branch of actor_assignment_role() for that case. db/tests/118 compares the
-- old and the new expressions row by row for every actor of the fixtures.
--
-- Inside the helpers too every call that does not depend on a row is its own
-- scalar subquery, so a statement reads the session a fixed number of times.
-- The arrays are computed for every statement anew, from the session of that
-- statement, so a prepared or cached plan keeps no actor's scope.
-- work_accommodation_read keeps its per-row call (plpgsql reader, out of scope).
SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE FUNCTION institution.actor_course_ids(p_roles text[]) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(pg_catalog.array_agg(m.course_id), '{}')
  FROM app.current_actor() a
  JOIN institution.course_member m ON m.user_id = a.user_id AND m.institution_id = a.institution_id
  WHERE m.member_to IS NULL AND m.role = ANY (p_roles)
    AND (m.role = 'student' OR (SELECT institution.actor_has_role('teacher')))
$$;

CREATE FUNCTION institution.actor_assignment_ids(p_roles text[]) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(pg_catalog.array_agg(x.id), '{}')
  FROM (
    SELECT a.id
    FROM institution.assignment a
    WHERE a.course_id = ANY ((SELECT institution.actor_course_ids(p_roles))::uuid[])
    UNION ALL
    SELECT a.id
    FROM app.current_actor() c
    JOIN institution.mentorship m ON m.institution_id = c.institution_id AND m.ended_at IS NULL
    JOIN institution.assignment a ON a.mentorship_id = m.id
    WHERE CASE WHEN m.mentor_id = c.user_id AND (SELECT institution.actor_has_role('teacher')) THEN 'teacher'
               WHEN m.student_id = c.user_id THEN 'student' END = ANY (p_roles)
  ) x
$$;

REVOKE ALL ON FUNCTION institution.actor_course_ids(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION institution.actor_assignment_ids(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.actor_course_ids(text[]) TO ductus_app;
GRANT EXECUTE ON FUNCTION institution.actor_assignment_ids(text[]) TO ductus_app;

-- actor_course_role(x) = 'teacher'       -> x = ANY (actor_course_ids('{teacher}'))
-- actor_course_role(x) IS NOT NULL       -> x = ANY (actor_course_ids('{teacher,student}'))
-- and the same for actor_assignment_role and actor_assignment_ids.
ALTER POLICY assignment_read ON institution.assignment
  USING (institution_id = (SELECT app.current_institution_id())
         AND id = ANY ((SELECT institution.actor_assignment_ids('{teacher,student}'))::uuid[]));
ALTER POLICY assignment_version_read ON institution.assignment_version
  USING (assignment_id = ANY ((SELECT institution.actor_assignment_ids('{teacher,student}'))::uuid[]));
ALTER POLICY course_read ON institution.course
  USING (id = ANY ((SELECT institution.actor_course_ids('{teacher,student}'))::uuid[]));
ALTER POLICY course_editor_read ON institution.course_editor
  USING (user_id = (SELECT app.current_user_id())
         OR course_id = ANY ((SELECT institution.actor_course_ids('{teacher}'))::uuid[]));
ALTER POLICY course_enrollment_code_read ON institution.course_enrollment_code
  USING (course_id = ANY ((SELECT institution.actor_course_ids('{teacher}'))::uuid[]));
ALTER POLICY course_holder_read ON institution.course_holder
  USING (user_id = (SELECT app.current_user_id())
         OR course_id = ANY ((SELECT institution.actor_course_ids('{teacher}'))::uuid[]));
ALTER POLICY course_member_read ON institution.course_member
  USING (user_id = (SELECT app.current_user_id())
         OR course_id = ANY ((SELECT institution.actor_course_ids('{teacher}'))::uuid[])
         OR (role = 'teacher' AND member_to IS NULL
             AND course_id = ANY ((SELECT institution.actor_course_ids('{teacher,student}'))::uuid[])));
ALTER POLICY notice_acknowledgment_read ON institution.notice_acknowledgment
  USING (institution_id = (SELECT app.current_institution_id())
         AND (assignment_id = ANY ((SELECT institution.actor_assignment_ids('{teacher}'))::uuid[])
              OR (student_id = (SELECT app.current_user_id())
                  AND assignment_id = ANY ((SELECT institution.actor_assignment_ids('{student}'))::uuid[]))));
ALTER POLICY seminar_group_read ON institution.seminar_group
  USING (course_id = ANY ((SELECT institution.actor_course_ids('{teacher}'))::uuid[]));
ALTER POLICY seminar_group_member_read ON institution.seminar_group_member
  USING (user_id = (SELECT app.current_user_id())
         OR course_id = ANY ((SELECT institution.actor_course_ids('{teacher}'))::uuid[]));
ALTER POLICY seminar_group_teacher_read ON institution.seminar_group_teacher
  USING (user_id = (SELECT app.current_user_id())
         OR course_id = ANY ((SELECT institution.actor_course_ids('{teacher}'))::uuid[]));
ALTER POLICY team_substitution_read ON institution.team_substitution
  USING (absent_id = (SELECT app.current_user_id())
         OR substitute_id = (SELECT app.current_user_id())
         OR course_id = ANY ((SELECT institution.actor_course_ids('{teacher}'))::uuid[]));
ALTER POLICY work_grant_read ON institution.work_grant
  USING (institution_id = (SELECT app.current_institution_id())
         AND (grantee_id = (SELECT app.current_user_id())
              OR student_id = (SELECT app.current_user_id())
              OR assignment_id = ANY ((SELECT institution.actor_assignment_ids('{teacher}'))::uuid[])));
ALTER POLICY work_language_override_read ON institution.work_language_override
  USING (institution_id = (SELECT app.current_institution_id())
         AND (student_id = (SELECT app.current_user_id())
              OR assignment_id = ANY ((SELECT institution.actor_assignment_ids('{teacher}'))::uuid[])));

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

ALTER POLICY assignment_read ON institution.assignment
  USING (institution_id = (SELECT app.current_institution_id())
         AND institution.actor_assignment_role(id) IS NOT NULL);
ALTER POLICY assignment_version_read ON institution.assignment_version
  USING (institution.actor_assignment_role(assignment_id) IS NOT NULL);
ALTER POLICY course_read ON institution.course
  USING (institution.actor_course_role(id) IS NOT NULL);
ALTER POLICY course_editor_read ON institution.course_editor
  USING (user_id = (SELECT app.current_user_id()) OR institution.actor_course_role(course_id) = 'teacher');
ALTER POLICY course_enrollment_code_read ON institution.course_enrollment_code
  USING (institution.actor_course_role(course_id) = 'teacher');
ALTER POLICY course_holder_read ON institution.course_holder
  USING (user_id = (SELECT app.current_user_id()) OR institution.actor_course_role(course_id) = 'teacher');
ALTER POLICY course_member_read ON institution.course_member
  USING (user_id = (SELECT app.current_user_id())
         OR institution.actor_course_role(course_id) = 'teacher'
         OR (role = 'teacher' AND member_to IS NULL AND institution.actor_course_role(course_id) IS NOT NULL));
ALTER POLICY notice_acknowledgment_read ON institution.notice_acknowledgment
  USING (institution_id = (SELECT app.current_institution_id())
         AND (institution.actor_assignment_role(assignment_id) = 'teacher'
              OR (student_id = (SELECT app.current_user_id())
                  AND institution.actor_assignment_role(assignment_id) = 'student')));
ALTER POLICY seminar_group_read ON institution.seminar_group
  USING (institution.actor_course_role(course_id) = 'teacher');
ALTER POLICY seminar_group_member_read ON institution.seminar_group_member
  USING (user_id = (SELECT app.current_user_id()) OR institution.actor_course_role(course_id) = 'teacher');
ALTER POLICY seminar_group_teacher_read ON institution.seminar_group_teacher
  USING (user_id = (SELECT app.current_user_id()) OR institution.actor_course_role(course_id) = 'teacher');
ALTER POLICY team_substitution_read ON institution.team_substitution
  USING (absent_id = (SELECT app.current_user_id())
         OR substitute_id = (SELECT app.current_user_id())
         OR institution.actor_course_role(course_id) = 'teacher');
ALTER POLICY work_grant_read ON institution.work_grant
  USING (institution_id = (SELECT app.current_institution_id())
         AND (grantee_id = (SELECT app.current_user_id())
              OR student_id = (SELECT app.current_user_id())
              OR institution.actor_assignment_role(assignment_id) = 'teacher'));
ALTER POLICY work_language_override_read ON institution.work_language_override
  USING (institution_id = (SELECT app.current_institution_id())
         AND (student_id = (SELECT app.current_user_id())
              OR institution.actor_assignment_role(assignment_id) = 'teacher'));

DROP FUNCTION institution.actor_assignment_ids(text[]);
DROP FUNCTION institution.actor_course_ids(text[]);

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- DAN-344 R-1 (contract on #923, comment 6434766713, accepted): the rule on
-- AI help of each of the teacher's courses, for the new assignment form
-- (T03). create_assignment refuses a rule wider than the course's, so the
-- form needs the course's own rule rather than a guess that would quietly
-- narrow the assignment. institution.list_teacher_courses of
-- 20261022100000 is dropped and created again with one more column,
-- ai_policy, last; the body, the courses, the errors and the grants are
-- otherwise unchanged. SECURITY INVOKER: the existing policies stay the
-- authority on every row.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION institution.list_teacher_courses();
-- One row per assignment, and one row with a null assignment for a course
-- without any. The order is the route's (Croatian collation in the client).
CREATE FUNCTION institution.list_teacher_courses()
RETURNS TABLE (
  course_id uuid, course_name text, academic_year text,
  assignment_id uuid, title text, work_type text, opens_at timestamptz, due_at timestamptz,
  current_version integer, enrolled_students integer, ai_policy text
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF app.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  IF NOT institution.actor_has_role('teacher') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  RETURN QUERY
  SELECT c.id, c.name, c.academic_year,
         a.id, v.title, v.work_type, v.opens_at, v.due_at, a.current_version,
         (SELECT count(*)::integer FROM institution.course_member m
           WHERE m.course_id = c.id AND m.role = 'student' AND m.member_to IS NULL),
         c.ai_policy
    FROM institution.course c
    LEFT JOIN institution.assignment a ON a.course_id = c.id AND a.institution_id = c.institution_id
    LEFT JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = a.current_version
   WHERE c.institution_id = app.current_institution_id()
     AND institution.actor_course_role(c.id) = 'teacher';
END
$$;
REVOKE ALL ON FUNCTION institution.list_teacher_courses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.list_teacher_courses() TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;
DROP FUNCTION institution.list_teacher_courses();
-- The function of 20261022100000, verbatim.
CREATE FUNCTION institution.list_teacher_courses()
RETURNS TABLE (
  course_id uuid, course_name text, academic_year text,
  assignment_id uuid, title text, work_type text, opens_at timestamptz, due_at timestamptz,
  current_version integer, enrolled_students integer
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF app.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  IF NOT institution.actor_has_role('teacher') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  RETURN QUERY
  SELECT c.id, c.name, c.academic_year,
         a.id, v.title, v.work_type, v.opens_at, v.due_at, a.current_version,
         (SELECT count(*)::integer FROM institution.course_member m
           WHERE m.course_id = c.id AND m.role = 'student' AND m.member_to IS NULL)
    FROM institution.course c
    LEFT JOIN institution.assignment a ON a.course_id = c.id AND a.institution_id = c.institution_id
    LEFT JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = a.current_version
   WHERE c.institution_id = app.current_institution_id()
     AND institution.actor_course_role(c.id) = 'teacher';
END
$$;
REVOKE ALL ON FUNCTION institution.list_teacher_courses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.list_teacher_courses() TO ductus_app;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

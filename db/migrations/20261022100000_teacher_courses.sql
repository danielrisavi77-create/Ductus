-- DAN-230: the teacher's courses and their assignments for the Z3 entry
-- (GET /api/teacher/courses; contract on #476, comment 6278724427, 3a,
-- accepted by the orchestrator). Only courses where the caller is a teacher
-- by institution.actor_course_role (an open teacher membership and a
-- confirmed teacher role at the session's institution), computed on every
-- call (C-23). No session is ZD401; a caller without a confirmed teacher role
-- is ZD403; a teacher without an open membership gets no rows. Nothing about
-- a student but the number of open student memberships of the course.
-- SECURITY INVOKER: the existing policies stay the authority on every row.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- One row per assignment, and one row with a null assignment for a course
-- without any. The order is the route's (Croatian collation in the client).
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

-- migrate:down
SET LOCAL ROLE ductus_identity;
DROP FUNCTION institution.list_teacher_courses();
RESET ROLE;

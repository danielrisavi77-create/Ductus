-- DAN-344 R-2 (#923, contract c.6434766713 points 2 and 3; D-170 as amended
-- by the owner on #87): two lists of names for a teacher, neither with
-- anything of a work. The name pair is the one the fast path shows
-- (identity.person_name, null when the account has none, #757 D1), and the
-- students are the same ones: open student memberships of a course whose
-- teacher asks.
--
-- app.teacher_course_students: the students of one course, for its teacher.
-- app.teacher_assignment_names: the students of one assignment, for its
-- teacher, the same set as app.assignment_submissions (#745).
--
-- Every caller other than the teacher, and a course or assignment that does
-- not exist or is of another institution, gets the same empty set; no
-- session is ZD401. Neither function writes: no work is opened, so there is
-- no audit.access_log row and no fast path window (P-03).
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_identity, ductus_evidence;

SET LOCAL ROLE ductus_identity;
CREATE FUNCTION app.teacher_course_students(p_course_id uuid)
RETURNS TABLE (student_id uuid, given_name text, family_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor record;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  -- Decided once per call, in the session's institution (actor_course_role).
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RETURN;
  END IF;
  -- One open membership per student and course, so one row per student.
  RETURN QUERY
  SELECT m.user_id, n.given_name, n.family_name
    FROM institution.course_member m
    LEFT JOIN identity.person_name n ON n.user_id = m.user_id AND n.institution_id = m.institution_id
   WHERE m.course_id = p_course_id AND m.institution_id = v_actor.institution_id
     AND m.role = 'student' AND m.member_to IS NULL
   ORDER BY m.user_id;
END
$$;
REVOKE ALL ON FUNCTION app.teacher_course_students(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.teacher_course_students(uuid) TO ductus_app;

SET LOCAL ROLE ductus_evidence;
-- The evidence role alone executes teacher_assignment_student_names; this
-- passes on its rows and nothing else.
CREATE FUNCTION app.teacher_assignment_names(p_assignment_id uuid)
RETURNS TABLE (student_id uuid, given_name text, family_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor record;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  RETURN QUERY
  SELECT n.student_id, n.given_name, n.family_name
    FROM app.teacher_assignment_student_names(p_assignment_id) n
   ORDER BY n.student_id;
END
$$;
REVOKE ALL ON FUNCTION app.teacher_assignment_names(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.teacher_assignment_names(uuid) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity, ductus_evidence;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.teacher_assignment_names(uuid);
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_identity;
DROP FUNCTION app.teacher_course_students(uuid);
RESET ROLE;

-- F-113 decision B, step B2 (#711, contract c.6390760491): the works of an
-- assignment for its teacher, as pairs of student and document id, so the
-- teacher's pages can link to a student's work. Only the teacher of the
-- assignment (institution.actor_assignment_role, decided on every call) gets
-- rows, and only for students with an open membership in its course; every
-- other caller gets no rows, with no error that tells the cases apart. No
-- session is ZD401. Nothing is written, and no text, revision, time, name or
-- institution leaves the function.
--
-- Two owners, as with open_student_work: the identity role names the
-- students of the course and executes nothing on evidence; the evidence role
-- reads the works and gets no right on institution tables.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_identity, ductus_evidence;

SET LOCAL ROLE ductus_identity;
-- The open student memberships of the assignment's course, for its teacher
-- only; no rows for anyone else. Executable by the evidence role alone.
CREATE FUNCTION app.teacher_assignment_students(p_assignment_id uuid) RETURNS TABLE (student_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.user_id
    FROM app.current_actor() a
    JOIN institution.assignment s ON s.id = p_assignment_id AND s.institution_id = a.institution_id
    JOIN institution.course_member m ON m.course_id = s.course_id AND m.institution_id = s.institution_id
   WHERE m.role = 'student' AND m.member_to IS NULL
     AND institution.actor_assignment_role(p_assignment_id) = 'teacher'
$$;
REVOKE ALL ON FUNCTION app.teacher_assignment_students(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.teacher_assignment_students(uuid) TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;
CREATE FUNCTION app.assignment_works(p_assignment_id uuid) RETURNS TABLE (student_id uuid, document_id text)
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
  SELECT d.principal_id, d.id
    FROM app.teacher_assignment_students(p_assignment_id) s
    JOIN evidence.project p
      ON p.assignment_id = p_assignment_id AND p.institution_id = v_actor.institution_id AND p.principal_id = s.student_id
    JOIN evidence.document d
      ON d.project_id = p.id AND d.institution_id = p.institution_id AND d.principal_id = p.principal_id
   ORDER BY d.principal_id, d.id;
END
$$;
REVOKE ALL ON FUNCTION app.assignment_works(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assignment_works(uuid) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity, ductus_evidence;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app TO ductus_identity, ductus_evidence;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.assignment_works(uuid);
SET LOCAL ROLE ductus_identity;
DROP FUNCTION app.teacher_assignment_students(uuid);
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity, ductus_evidence;

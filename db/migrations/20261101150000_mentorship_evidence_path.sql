-- migrate:up
-- DAN-349, part 2 of 4 (#916, contract issuecomment-6431784351): the evidence
-- path of a mentorship's work. The two functions every evidence and teacher
-- list entrypoint already goes through gain a branch for an assignment that
-- belongs to a mentorship (20261028100000); the course branch of each is
-- exactly as it was, so no outcome for a course's assignment changes. Same
-- signatures, owners and grants; no table, grant or policy is added.
SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- As 20261017130000, with the mentorship as the second authority row: a
-- course's assignment locks the caller's open student membership, a
-- mentorship's assignment locks the mentorship, which must be open, of the
-- assignment's institution and have the caller as its student, and the
-- confirmed teacher role of its mentor. Both FOR SHARE
-- until the caller commits, so ending the mentorship (the operator's UPDATE)
-- waits for an acceptance in progress, as a removal from a course does, and
-- an acceptance that waited re-reads the committed row. No row: not the
-- student of the assignment.
CREATE OR REPLACE FUNCTION app.lock_student_assignment(p_assignment_id uuid)
RETURNS TABLE (current_version integer, opens_at timestamptz, acknowledged boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor record;
  v_assignment institution.assignment%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RETURN;
  END IF;
  SELECT a.* INTO v_assignment FROM institution.assignment a
   WHERE a.id = p_assignment_id AND a.institution_id = v_actor.institution_id
   FOR SHARE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_assignment.course_id IS NOT NULL THEN
    PERFORM 1 FROM institution.course_member m
     WHERE m.course_id = v_assignment.course_id AND m.institution_id = v_actor.institution_id
       AND m.user_id = v_actor.user_id AND m.role = 'student' AND m.member_to IS NULL
     FOR SHARE;
  ELSE
    -- Only while the mentor holds the teacher role, confirmed and not revoked
    -- (#916, invariant 3): a mentor without it closes the student's path as
    -- it closes the mentor's lists. The role row is held FOR SHARE with the
    -- mentorship, so revoking the role waits for an acceptance in progress.
    PERFORM 1 FROM institution.mentorship s
      JOIN institution.institution_role r
        ON r.user_id = s.mentor_id AND r.institution_id = s.institution_id AND r.role = 'teacher'
       AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
     WHERE s.id = v_assignment.mentorship_id AND s.institution_id = v_actor.institution_id
       AND s.student_id = v_actor.user_id AND s.ended_at IS NULL
     FOR SHARE;
  END IF;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT v.version_no, v.opens_at, EXISTS (
           SELECT 1 FROM institution.notice_acknowledgment n
            WHERE n.assignment_id = v.assignment_id AND n.version_no = v.version_no
              AND n.student_id = v_actor.user_id AND n.institution_id = v_actor.institution_id)
    FROM institution.assignment_version v
   WHERE v.assignment_id = v_assignment.id AND v.version_no = v_assignment.current_version;
END
$$;

-- As 20261025090000, with the mentorship's student for a mentorship's
-- assignment: one student, while the mentorship is open. The teacher
-- condition is the one it was (actor_assignment_role, which for a
-- mentorship's assignment is 'teacher' only for its mentor with the teacher
-- role confirmed and not revoked, 20261028100000).
CREATE OR REPLACE FUNCTION app.teacher_assignment_students(p_assignment_id uuid) RETURNS TABLE (student_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.user_id
    FROM app.current_actor() a
    JOIN institution.assignment s ON s.id = p_assignment_id AND s.institution_id = a.institution_id
    JOIN institution.course_member m ON m.course_id = s.course_id AND m.institution_id = s.institution_id
   WHERE m.role = 'student' AND m.member_to IS NULL
     AND institution.actor_assignment_role(p_assignment_id) = 'teacher'
  UNION ALL
  SELECT t.student_id
    FROM app.current_actor() a
    JOIN institution.assignment s ON s.id = p_assignment_id AND s.institution_id = a.institution_id
    JOIN institution.mentorship t ON t.id = s.mentorship_id AND t.institution_id = s.institution_id
   WHERE t.ended_at IS NULL
     AND institution.actor_assignment_role(p_assignment_id) = 'teacher'
$$;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
-- The definitions of 20261017130000 and 20261025090000.
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE OR REPLACE FUNCTION app.lock_student_assignment(p_assignment_id uuid)
RETURNS TABLE (current_version integer, opens_at timestamptz, acknowledged boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor record;
  v_assignment institution.assignment%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RETURN;
  END IF;
  SELECT a.* INTO v_assignment FROM institution.assignment a
   WHERE a.id = p_assignment_id AND a.institution_id = v_actor.institution_id
   FOR SHARE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM 1 FROM institution.course_member m
   WHERE m.course_id = v_assignment.course_id AND m.institution_id = v_actor.institution_id
     AND m.user_id = v_actor.user_id AND m.role = 'student' AND m.member_to IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT v.version_no, v.opens_at, EXISTS (
           SELECT 1 FROM institution.notice_acknowledgment n
            WHERE n.assignment_id = v.assignment_id AND n.version_no = v.version_no
              AND n.student_id = v_actor.user_id AND n.institution_id = v_actor.institution_id)
    FROM institution.assignment_version v
   WHERE v.assignment_id = v_assignment.id AND v.version_no = v_assignment.current_version;
END
$$;

CREATE OR REPLACE FUNCTION app.teacher_assignment_students(p_assignment_id uuid) RETURNS TABLE (student_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.user_id
    FROM app.current_actor() a
    JOIN institution.assignment s ON s.id = p_assignment_id AND s.institution_id = a.institution_id
    JOIN institution.course_member m ON m.course_id = s.course_id AND m.institution_id = s.institution_id
   WHERE m.role = 'student' AND m.member_to IS NULL
     AND institution.actor_assignment_role(p_assignment_id) = 'teacher'
$$;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity;

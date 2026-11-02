-- migrate:up
-- DAN-309 (M2.3-P01, contract on #1091, comment 6569706023): the student's
-- workspace ("Moji radovi") read from one authorised view. It takes no
-- parameter: who asks comes only from the session (app.current_user_id and
-- app.current_institution_id). One row per assignment of every course where
-- the caller holds an open student membership in their own institution, with
-- only their own work and submission beside it. It names no other person and
-- carries no text, comment or activity time. SECURITY INVOKER: the RLS of
-- every table it reads stays a second barrier behind the explicit predicates.
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;

CREATE FUNCTION app.student_workspace()
RETURNS TABLE (
  assignment_id uuid,
  course_id uuid,
  course_name text,
  academic_year text,
  title text,
  opens_at timestamptz,
  due_at timestamptz,
  current_version integer,
  acknowledged boolean,
  document_id text,
  server_revision bigint,
  submitted_revision bigint,
  submitted_at timestamptz,
  after_deadline boolean
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_institution uuid := app.current_institution_id();
BEGIN
  IF v_user IS NULL OR v_institution IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  -- A project holds the caller's work on one assignment (unique per
  -- assignment, institution and person); a submission is one per the same.
  RETURN QUERY
  SELECT a.id, c.id, c.name, c.academic_year, v.title, v.opens_at, v.due_at, a.current_version,
    EXISTS (
      SELECT 1 FROM institution.notice_acknowledgment n
       WHERE n.assignment_id = a.id AND n.version_no = a.current_version
         AND n.student_id = v_user AND n.institution_id = v_institution),
    d.id, d.current_revision, s.revision, s.requested_at, s.after_deadline
    FROM institution.course_member m
    JOIN institution.course c
      ON c.id = m.course_id AND c.institution_id = v_institution
    JOIN institution.assignment a
      ON a.course_id = c.id AND a.institution_id = v_institution
    JOIN institution.assignment_version v
      ON v.assignment_id = a.id AND v.version_no = a.current_version
    LEFT JOIN evidence.project p
      ON p.assignment_id = a.id AND p.institution_id = v_institution AND p.principal_id = v_user
    LEFT JOIN evidence.document d
      ON d.project_id = p.id AND d.institution_id = v_institution AND d.principal_id = v_user
    LEFT JOIN evidence.submission s
      ON s.assignment_id = a.id AND s.institution_id = v_institution AND s.principal_id = v_user
   WHERE m.user_id = v_user AND m.institution_id = v_institution
     AND m.role = 'student' AND m.member_to IS NULL
   ORDER BY a.id, d.id;
END
$$;

REVOKE ALL ON FUNCTION app.student_workspace() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.student_workspace() TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.student_workspace();
RESET ROLE;

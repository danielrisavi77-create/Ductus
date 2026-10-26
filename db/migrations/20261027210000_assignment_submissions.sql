-- DAN-290 (#745, audit A3; contract c.6403391413): which students of an
-- assignment submitted, with which revision and whether after the deadline,
-- for the assignment's teacher. One row per student with an open membership
-- in its course (app.teacher_assignment_students), in student order; a
-- student without a submission has submitted = false and the other columns
-- NULL. "Submitted" is a row in evidence.submission, as in work_submitted: a
-- request alone is not a submission. The time is the request's, cut to the
-- minute in UTC; the exact time, the recorded time, the deadline, the hash,
-- the ids and the receipt stay in the database. Every caller other than the
-- teacher gets no rows, with no error that tells the cases apart; no session
-- is ZD401. Writes nothing.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;
CREATE FUNCTION app.assignment_submissions(p_assignment_id uuid)
RETURNS TABLE (student_id uuid, submitted boolean, revision bigint, requested_minute timestamptz, after_deadline boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor record;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  -- At most one submission per student and assignment (its unique key), and
  -- one open membership per student and course, so one row per student.
  RETURN QUERY
  SELECT s.student_id, x.id IS NOT NULL, x.revision,
         pg_catalog.date_trunc('minute', x.requested_at, 'UTC'), x.after_deadline
    FROM app.teacher_assignment_students(p_assignment_id) s
    LEFT JOIN evidence.submission x
      ON x.assignment_id = p_assignment_id AND x.institution_id = v_actor.institution_id
     AND x.principal_id = s.student_id
   ORDER BY s.student_id;
END
$$;
REVOKE ALL ON FUNCTION app.assignment_submissions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assignment_submissions(uuid) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.assignment_submissions(uuid);
RESET ROLE;

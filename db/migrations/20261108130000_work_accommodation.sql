-- migrate:up
-- DAN-380, M2.9-P01 (contract on #1091, c.6722796115): a student marks an
-- approved accommodation on their own work (D-50); a teacher or mentor of the
-- work sees that it is marked, never why.
--
-- The mark is a row and nothing else. No column, argument or log line holds a
-- kind, a reason, a note or a diagnosis: whether the mark itself is health
-- data is open (docs/privacy/05 t. 10), so it stays the least that can be
-- kept and is removed by deleting the row.
--
-- Only the student of the work writes it, for themselves, through
-- set_work_accommodation(), and only until their submission request (ZD409).
-- The writer locks the assignment FOR UPDATE; request_submission holds it FOR
-- SHARE, so the first of the two decides and the other sees it
-- (tests/integration/work-accommodation-submission-race.integration.test.ts).
-- A co-mentor or committee member (work_grant) does not see it here.
SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE TABLE institution.work_accommodation (
  institution_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  student_id uuid NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (assignment_id, student_id),
  FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment (id, institution_id),
  FOREIGN KEY (student_id, institution_id) REFERENCES identity.user_account (id, institution_id)
);

ALTER TABLE institution.work_accommodation ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution.work_accommodation FORCE ROW LEVEL SECURITY;
CREATE POLICY work_accommodation_owner ON institution.work_accommodation TO ductus_identity
  USING (true) WITH CHECK (true);
-- The student of the work and a teacher or mentor of the work see the mark.
CREATE POLICY work_accommodation_read ON institution.work_accommodation FOR SELECT TO ductus_app
  USING (
    institution_id = (SELECT app.current_institution_id())
    AND (student_id = (SELECT app.current_user_id())
         OR institution.actor_assignment_role(assignment_id) = 'teacher')
  );

-- Is the work of p_student_id on the assignment marked: true or false for
-- that student and for a teacher or mentor of the work, null for anyone else,
-- so that nobody else learns whether a mark exists.
CREATE FUNCTION institution.work_accommodation(p_assignment_id uuid, p_student_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_institution uuid;
  v_role text;
BEGIN
  SELECT a.user_id, a.institution_id INTO v_user, v_institution FROM app.current_actor() a;
  v_role := institution.actor_assignment_role(p_assignment_id);
  IF v_user IS NULL OR p_student_id IS NULL
     OR NOT coalesce((v_role = 'student' AND p_student_id = v_user)
                     OR (v_role = 'teacher'
                         AND institution.work_relation(p_student_id, p_assignment_id) = 'student'), false) THEN
    RETURN NULL;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM institution.work_accommodation w
     WHERE w.assignment_id = p_assignment_id AND w.student_id = p_student_id
       AND w.institution_id = v_institution);
END
$$;

-- The caller marks (true) or unmarks (false) their own work on the assignment
-- and gets back whether it is marked afterwards. The same value again changes
-- nothing, marked_at included.
CREATE FUNCTION institution.set_work_accommodation(p_assignment_id uuid, p_marked boolean) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_assignment_role(p_assignment_id) IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF p_marked IS NULL THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  -- A submission request waits here, or this call waits for it, then sees it.
  PERFORM 1 FROM institution.assignment a WHERE a.id = p_assignment_id FOR UPDATE;
  -- Again on the row as it is now: a removal that committed while this call
  -- waited is seen, and one that comes later waits for this call.
  IF NOT institution.lock_assignment_student(p_assignment_id, actor.user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF app.work_submission_requested(p_assignment_id, actor.user_id) THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  IF p_marked THEN
    INSERT INTO institution.work_accommodation (institution_id, assignment_id, student_id)
    VALUES (actor.institution_id, p_assignment_id, actor.user_id)
    ON CONFLICT (assignment_id, student_id) DO NOTHING;
  ELSE
    DELETE FROM institution.work_accommodation w
     WHERE w.assignment_id = p_assignment_id AND w.student_id = actor.user_id;
  END IF;
  RETURN p_marked;
END
$$;

REVOKE ALL ON FUNCTION institution.work_accommodation(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION institution.set_work_accommodation(uuid, boolean) FROM PUBLIC;
GRANT SELECT ON institution.work_accommodation TO ductus_app;
GRANT EXECUTE ON FUNCTION institution.work_accommodation(uuid, uuid) TO ductus_app;
GRANT EXECUTE ON FUNCTION institution.set_work_accommodation(uuid, boolean) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION institution.set_work_accommodation(uuid, boolean);
DROP FUNCTION institution.work_accommodation(uuid, uuid);
DROP TABLE institution.work_accommodation;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- DAN-515 (M2.6-P03, D-204; contract on #1091, c.6591114645): a mentorship
-- comes into being only when the teacher a student asked approves the
-- request. The teacher must hold the teacher role, confirmed and not revoked,
-- in the student's institution; the administrator approves nothing. Every
-- request, withdrawal and approval leaves one append-only audit row with the
-- actor from the session, written in the same statement as the change.
--
-- Errors carry no input, as in the rest of the schema: ZD401 no session,
-- ZD403 not allowed (also for what does not exist or is someone else's),
-- ZD409 the state forbids it, ZD422 invalid input.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA audit TO ductus_identity;
GRANT CREATE ON SCHEMA institution TO ductus_identity;

SET LOCAL ROLE ductus_identity;

-- A request is open while neither withdrawn_at nor approved_at is set; it is
-- never deleted. An approved request points to the mentorship it created.
CREATE TABLE institution.mentorship_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  student_id uuid NOT NULL,
  teacher_id uuid NOT NULL,
  work_type text NOT NULL
    CHECK (work_type IN ('bachelor_thesis', 'master_thesis', 'specialist_thesis', 'doctoral_thesis')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  approved_at timestamptz,
  mentorship_id uuid UNIQUE,
  UNIQUE (id, institution_id, student_id, teacher_id),
  FOREIGN KEY (student_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (teacher_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (mentorship_id, institution_id) REFERENCES institution.mentorship (id, institution_id),
  CHECK (student_id <> teacher_id),
  CHECK (num_nonnulls(withdrawn_at, approved_at) <= 1),
  CHECK ((approved_at IS NULL) = (mentorship_id IS NULL))
);
-- One open request of a kind per student.
CREATE UNIQUE INDEX mentorship_request_open_idx ON institution.mentorship_request (institution_id, student_id, work_type)
  WHERE withdrawn_at IS NULL AND approved_at IS NULL;
CREATE INDEX mentorship_request_teacher_open_idx ON institution.mentorship_request (teacher_id)
  WHERE withdrawn_at IS NULL AND approved_at IS NULL;
CREATE INDEX mentorship_request_student_idx ON institution.mentorship_request (student_id);

ALTER TABLE institution.mentorship_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution.mentorship_request FORCE ROW LEVEL SECURITY;
CREATE POLICY mentorship_request_owner ON institution.mentorship_request TO ductus_identity USING (true) WITH CHECK (true);
-- The student reads the own requests. The teacher reads the open ones made
-- to them, and only with the teacher role confirmed and not revoked. The
-- administrator reads none.
CREATE POLICY mentorship_request_read ON institution.mentorship_request FOR SELECT TO ductus_app
  USING (
    institution_id = (SELECT app.current_institution_id())
    AND (student_id = (SELECT app.current_user_id())
         OR (teacher_id = (SELECT app.current_user_id()) AND withdrawn_at IS NULL AND approved_at IS NULL
             AND (SELECT institution.actor_has_role('teacher'))))
  );

-- One row per request and kind. The row is bound to the request it records,
-- so the trail cannot name a student, teacher or institution the request
-- never had; mentorship_id is set on 'approved' only.
CREATE TABLE audit.mentorship_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  request_id uuid NOT NULL,
  student_id uuid NOT NULL,
  teacher_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('requested', 'withdrawn', 'approved')),
  actor_id uuid NOT NULL,
  mentorship_id uuid,
  occurred_at timestamptz NOT NULL,
  UNIQUE (request_id, kind),
  CONSTRAINT mentorship_event_request_fkey FOREIGN KEY (request_id, institution_id, student_id, teacher_id)
    REFERENCES institution.mentorship_request (id, institution_id, student_id, teacher_id),
  FOREIGN KEY (actor_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (mentorship_id, institution_id) REFERENCES institution.mentorship (id, institution_id),
  CHECK ((kind = 'approved') = (mentorship_id IS NOT NULL))
);
CREATE INDEX mentorship_event_institution_idx ON audit.mentorship_event (institution_id, occurred_at);

CREATE TRIGGER mentorship_event_append_only BEFORE UPDATE OR DELETE ON audit.mentorship_event
  FOR EACH ROW EXECUTE FUNCTION audit.reject_change();
CREATE TRIGGER mentorship_event_no_truncate BEFORE TRUNCATE ON audit.mentorship_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_change();

-- As teacher_role_event: forced RLS with only the owner's policy and no
-- privilege for any other role.
ALTER TABLE audit.mentorship_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.mentorship_event FORCE ROW LEVEL SECURITY;
CREATE POLICY mentorship_event_owner ON audit.mentorship_event TO ductus_identity USING (true) WITH CHECK (true);

-- The confirmed, unrevoked teacher role row of p_user_id in p_institution_id,
-- locked FOR SHARE: revoke_teacher_role updates that row, so a revocation
-- waits until the caller's transaction ends, and one that committed first
-- makes the re-check after the wait find no row.
CREATE FUNCTION institution.lock_teacher_role(p_user_id uuid) RETURNS uuid
LANGUAGE sql VOLATILE SET search_path = ''
AS $$
  SELECT r.id FROM app.current_actor() a
  JOIN institution.institution_role r ON r.institution_id = a.institution_id
  WHERE r.user_id = p_user_id AND r.role = 'teacher'
    AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
  FOR SHARE OF r
$$;

-- The student asks a confirmed teacher of the own institution to mentor one
-- work of a kind. Returns the request.
CREATE FUNCTION institution.request_mentorship(p_teacher_id uuid, p_work_type text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_id uuid;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF p_work_type IS NULL
     OR p_work_type NOT IN ('bachelor_thesis', 'master_thesis', 'specialist_thesis', 'doctoral_thesis') THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  -- Requests and approvals of one student's kind of work take turns, so a
  -- request made and approved while this one runs cannot slip between the
  -- check below and the insert. The approval takes the same lock first.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'institution.mentorship_request:' || actor.institution_id || ':' || actor.user_id || ':' || p_work_type, 0));
  IF p_teacher_id IS NOT DISTINCT FROM actor.user_id
     OR institution.lock_teacher_role(p_teacher_id) IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF EXISTS (
    SELECT 1 FROM institution.mentorship m
    WHERE m.institution_id = actor.institution_id AND m.student_id = actor.user_id
      AND m.work_type = p_work_type AND m.ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  BEGIN
    WITH requested AS (
      INSERT INTO institution.mentorship_request (institution_id, student_id, teacher_id, work_type)
      VALUES (actor.institution_id, actor.user_id, p_teacher_id, p_work_type)
      RETURNING id, institution_id, student_id, teacher_id
    ), logged AS (
      INSERT INTO audit.mentorship_event (institution_id, request_id, student_id, teacher_id, kind, actor_id, occurred_at)
      SELECT institution_id, id, student_id, teacher_id, 'requested', actor.user_id, now() FROM requested
    )
    SELECT id INTO v_id FROM requested;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END;
  RETURN v_id;
END
$$;

-- The student withdraws the own open request. False when it was already
-- withdrawn; ZD409 once it is approved.
CREATE FUNCTION institution.withdraw_mentorship_request(p_request_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  req institution.mentorship_request;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT * INTO req FROM institution.mentorship_request r
  WHERE r.id = p_request_id AND r.institution_id = actor.institution_id AND r.student_id = actor.user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  ELSIF req.approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  ELSIF req.withdrawn_at IS NOT NULL THEN
    RETURN false;
  END IF;
  WITH withdrawn AS (
    UPDATE institution.mentorship_request r SET withdrawn_at = now() WHERE r.id = req.id
    RETURNING r.id, r.institution_id, r.student_id, r.teacher_id
  )
  INSERT INTO audit.mentorship_event (institution_id, request_id, student_id, teacher_id, kind, actor_id, occurred_at)
  SELECT institution_id, id, student_id, teacher_id, 'withdrawn', actor.user_id, now() FROM withdrawn;
  RETURN true;
END
$$;

-- The teacher the request was made to approves it, and only then the
-- mentorship exists, with that teacher as mentor and as the one who
-- confirmed it. Approving again returns the same mentorship and writes
-- nothing. Anyone else, the administrator included, gets ZD403 whatever the
-- state of the request.
CREATE FUNCTION institution.approve_mentorship_request(p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  req institution.mentorship_request;
  v_mentorship uuid;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  -- The lock of request_mentorship comes before any row lock, in the same
  -- order there; student and kind of a request never change.
  SELECT * INTO req FROM institution.mentorship_request r
  WHERE r.id = p_request_id AND r.institution_id = actor.institution_id AND r.teacher_id = actor.user_id;
  IF FOUND THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'institution.mentorship_request:' || req.institution_id || ':' || req.student_id || ':' || req.work_type, 0));
  END IF;
  -- Two approvals of one request wait for each other here.
  SELECT * INTO req FROM institution.mentorship_request r
  WHERE r.id = p_request_id AND r.institution_id = actor.institution_id AND r.teacher_id = actor.user_id
  FOR UPDATE;
  IF NOT FOUND OR institution.lock_teacher_role(actor.user_id) IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  ELSIF req.approved_at IS NOT NULL THEN
    RETURN req.mentorship_id;
  ELSIF req.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  BEGIN
    INSERT INTO institution.mentorship (institution_id, mentor_id, student_id, work_type, confirmed_by)
    VALUES (req.institution_id, actor.user_id, req.student_id, req.work_type, actor.user_id)
    RETURNING id INTO v_mentorship;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END;
  WITH approved AS (
    UPDATE institution.mentorship_request r SET approved_at = now(), mentorship_id = v_mentorship
    WHERE r.id = req.id
    RETURNING r.id, r.institution_id, r.student_id, r.teacher_id, r.mentorship_id
  )
  INSERT INTO audit.mentorship_event (
    institution_id, request_id, student_id, teacher_id, kind, actor_id, mentorship_id, occurred_at
  )
  SELECT institution_id, id, student_id, teacher_id, 'approved', actor.user_id, mentorship_id, now() FROM approved;
  RETURN v_mentorship;
END
$$;

REVOKE ALL ON FUNCTION institution.lock_teacher_role(uuid), institution.request_mentorship(uuid, text),
  institution.withdraw_mentorship_request(uuid), institution.approve_mentorship_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.request_mentorship(uuid, text), institution.withdraw_mentorship_request(uuid),
  institution.approve_mentorship_request(uuid) TO ductus_app;
GRANT SELECT ON institution.mentorship_request TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA audit FROM ductus_identity;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;
DROP FUNCTION institution.approve_mentorship_request(uuid);
DROP FUNCTION institution.withdraw_mentorship_request(uuid);
DROP FUNCTION institution.request_mentorship(uuid, text);
DROP FUNCTION institution.lock_teacher_role(uuid);
DROP TABLE audit.mentorship_event;
DROP TABLE institution.mentorship_request;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

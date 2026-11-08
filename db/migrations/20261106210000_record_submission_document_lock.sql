-- DAN-314 2c (docs/backend/suradnja.md 4.14, #1506): record_submission takes
-- the evidence packages of its document FOR UPDATE in id order, then the
-- document row FOR UPDATE, after the assignment and membership and before the
-- INSERT. A collaboration write (create, respond, accept, reopen, withdraw a
-- revision request) holds the document FOR SHARE until it commits, so the two
-- are ordered on that row: the write that came first stays, and the one that
-- comes after the submission is forbidden (ZD403, 2b). The package order is the
-- one commit_evidence_segment takes (package, then assignment, then document),
-- so a submission and a segment commit of one document never deadlock. Every
-- outcome, grant and the owner stay as they are; only the two locks are new.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;

CREATE OR REPLACE FUNCTION app.record_submission(p_submission_request_id uuid, p_artifact_hash text)
RETURNS TABLE (
  outcome text, submission_id uuid, requested_at timestamptz, due_at timestamptz, after_deadline boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor record;
  v_request evidence.submission_request%ROWTYPE;
  v_due timestamptz;
  v_existing evidence.submission%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz, NULL::boolean;
    RETURN;
  END IF;
  IF p_submission_request_id IS NULL OR p_artifact_hash IS NULL OR p_artifact_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz, NULL::boolean;
    RETURN;
  END IF;

  SELECT s.* INTO v_request
    FROM evidence.submission_request s
   WHERE s.id = p_submission_request_id AND s.institution_id = v_actor.institution_id
     AND s.principal_id = v_actor.user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz, NULL::boolean;
    RETURN;
  END IF;
  -- Lock order as in request_submission: assignment and membership first.
  PERFORM 1 FROM app.lock_student_assignment(v_request.assignment_id);
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz, NULL::boolean;
    RETURN;
  END IF;
  -- Compared before the existing row is returned, so a later reconstruction
  -- that no longer matches is never answered as a success.
  IF p_artifact_hash <> v_request.content_hash THEN
    RETURN QUERY SELECT 'artifact_mismatch'::text, NULL::uuid, v_request.requested_at, NULL::timestamptz,
      NULL::boolean;
    RETURN;
  END IF;

  -- The deadline of the version the request names, not of a later version.
  v_due := app.assignment_version_due(v_request.assignment_id, v_request.assignment_version);

  -- 4.14: the packages first, in id order as commit_evidence_segment takes its
  -- one, then the document, as the collaboration writes take it (FOR SHARE in
  -- lock_document_for_write). A revision-request write that holds the document
  -- finishes first and stays; one that comes after waits here and then sees
  -- the submission (ZD403). Taken before the INSERT, so the trigger
  -- close_submitted_packages finds its rows already held.
  PERFORM 1 FROM evidence.package k
   WHERE k.document_id = v_request.document_id AND k.institution_id = v_request.institution_id
   ORDER BY k.id FOR UPDATE;
  PERFORM 1 FROM evidence.document d
   WHERE d.id = v_request.document_id AND d.institution_id = v_request.institution_id
     FOR UPDATE;

  INSERT INTO evidence.submission (
    submission_request_id, institution_id, principal_id, assignment_id, assignment_version, revision,
    artifact_hash, requested_at, due_at, recorded_at
  ) VALUES (
    v_request.id, v_request.institution_id, v_request.principal_id, v_request.assignment_id,
    v_request.assignment_version, v_request.revision, v_request.content_hash, v_request.requested_at, v_due,
    pg_catalog.clock_timestamp()
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT s.* INTO STRICT v_existing
      FROM evidence.submission s
     WHERE s.submission_request_id = v_request.id AND s.institution_id = v_actor.institution_id;
    RETURN QUERY SELECT 'existing'::text, v_existing.id, v_existing.requested_at, v_existing.due_at,
      v_existing.after_deadline;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'recorded'::text, v_id, v_request.requested_at, v_due, v_request.requested_at > v_due;
END
$$;
REVOKE ALL ON FUNCTION app.record_submission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_submission(uuid, text) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;

CREATE OR REPLACE FUNCTION app.record_submission(p_submission_request_id uuid, p_artifact_hash text)
RETURNS TABLE (
  outcome text, submission_id uuid, requested_at timestamptz, due_at timestamptz, after_deadline boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor record;
  v_request evidence.submission_request%ROWTYPE;
  v_due timestamptz;
  v_existing evidence.submission%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz, NULL::boolean;
    RETURN;
  END IF;
  IF p_submission_request_id IS NULL OR p_artifact_hash IS NULL OR p_artifact_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz, NULL::boolean;
    RETURN;
  END IF;

  SELECT s.* INTO v_request
    FROM evidence.submission_request s
   WHERE s.id = p_submission_request_id AND s.institution_id = v_actor.institution_id
     AND s.principal_id = v_actor.user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz, NULL::boolean;
    RETURN;
  END IF;
  -- Lock order as in request_submission: assignment and membership first.
  PERFORM 1 FROM app.lock_student_assignment(v_request.assignment_id);
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz, NULL::boolean;
    RETURN;
  END IF;
  -- Compared before the existing row is returned, so a later reconstruction
  -- that no longer matches is never answered as a success.
  IF p_artifact_hash <> v_request.content_hash THEN
    RETURN QUERY SELECT 'artifact_mismatch'::text, NULL::uuid, v_request.requested_at, NULL::timestamptz,
      NULL::boolean;
    RETURN;
  END IF;

  -- The deadline of the version the request names, not of a later version.
  v_due := app.assignment_version_due(v_request.assignment_id, v_request.assignment_version);

  INSERT INTO evidence.submission (
    submission_request_id, institution_id, principal_id, assignment_id, assignment_version, revision,
    artifact_hash, requested_at, due_at, recorded_at
  ) VALUES (
    v_request.id, v_request.institution_id, v_request.principal_id, v_request.assignment_id,
    v_request.assignment_version, v_request.revision, v_request.content_hash, v_request.requested_at, v_due,
    pg_catalog.clock_timestamp()
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT s.* INTO STRICT v_existing
      FROM evidence.submission s
     WHERE s.submission_request_id = v_request.id AND s.institution_id = v_actor.institution_id;
    RETURN QUERY SELECT 'existing'::text, v_existing.id, v_existing.requested_at, v_existing.due_at,
      v_existing.after_deadline;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'recorded'::text, v_id, v_request.requested_at, v_due, v_request.requested_at > v_due;
END
$$;
REVOKE ALL ON FUNCTION app.record_submission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_submission(uuid, text) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

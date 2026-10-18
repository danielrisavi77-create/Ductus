-- B-12 step 3 / DAN-87: the submission (docs/ARCHITECTURE.md 3 and 6,
-- docs/BACKEND.md 4.6). A submission completes one request after the
-- reconstruction of its revision matched: it carries the request's time,
-- assignment version, revision and hash, the deadline of that version and the
-- lateness flag derived from them, pinned by composite foreign keys so no
-- field can drift from the request it completes. One per student and
-- assignment (owner decision P8 on #385). Mapping every reconstruction
-- outcome to a decision (P1 to P3) and the signed receipt (P4) are the next
-- steps. Identity and institution come from current_actor() (4.1, 4.3).
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; all revoked at the end.
GRANT USAGE, CREATE ON SCHEMA evidence TO ductus_identity;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
GRANT CREATE ON SCHEMA evidence TO ductus_evidence;
GRANT CREATE ON SCHEMA app TO ductus_identity, ductus_evidence;
GRANT ductus_evidence TO ductus_identity WITH INHERIT FALSE, SET TRUE;

SET LOCAL ROLE ductus_identity;
-- The submission names the version and its deadline in one foreign key.
ALTER TABLE institution.assignment_version ADD CONSTRAINT assignment_version_due_key
  UNIQUE (assignment_id, version_no, due_at);
-- The evidence role has no access to schema institution: it reads the deadline
-- of one version of an assignment of the caller's institution through this.
CREATE FUNCTION app.assignment_version_due(p_assignment_id uuid, p_version_no integer)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT v.due_at
    FROM institution.assignment_version v
    JOIN institution.assignment a ON a.id = v.assignment_id
    JOIN app.current_actor() c ON a.institution_id = c.institution_id
   WHERE v.assignment_id = p_assignment_id AND v.version_no = p_version_no
$$;
REVOKE ALL ON FUNCTION app.assignment_version_due(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assignment_version_due(uuid, integer) TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;
-- ... and the request with every field it copies.
ALTER TABLE evidence.submission_request ADD CONSTRAINT evidence_submission_request_pinned_key
  UNIQUE (id, institution_id, principal_id, assignment_id, assignment_version, revision, content_hash, requested_at);
GRANT REFERENCES ON evidence.submission_request TO ductus_identity;

SET LOCAL ROLE ductus_identity;
-- D-103: institution key and composite foreign keys throughout. The artifact
-- hash is the request's content hash (the foreign key makes them equal); the
-- lateness flag is computed from the stored time and deadline and cannot be
-- written. P6: a request exactly at the deadline is on time.
CREATE TABLE evidence.submission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_request_id uuid NOT NULL UNIQUE,
  institution_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  assignment_version integer NOT NULL,
  revision bigint NOT NULL,
  artifact_hash text NOT NULL CHECK (artifact_hash ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  after_deadline boolean GENERATED ALWAYS AS (requested_at > due_at) STORED,
  recorded_at timestamptz NOT NULL,
  CHECK (recorded_at >= requested_at),
  UNIQUE (assignment_id, institution_id, principal_id),
  FOREIGN KEY (submission_request_id, institution_id, principal_id, assignment_id, assignment_version,
               revision, artifact_hash, requested_at)
    REFERENCES evidence.submission_request (id, institution_id, principal_id, assignment_id, assignment_version,
                                            revision, content_hash, requested_at),
  FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment (id, institution_id),
  FOREIGN KEY (assignment_id, assignment_version, due_at)
    REFERENCES institution.assignment_version (assignment_id, version_no, due_at),
  FOREIGN KEY (principal_id, institution_id) REFERENCES identity.user_account (id, institution_id)
);
CREATE INDEX evidence_submission_principal_idx ON evidence.submission (principal_id, institution_id);
CREATE INDEX evidence_submission_request_pin_idx ON evidence.submission (
  submission_request_id, institution_id, principal_id, assignment_id, assignment_version, revision,
  artifact_hash, requested_at);
CREATE INDEX evidence_submission_version_idx ON evidence.submission (assignment_id, assignment_version, due_at);
ALTER TABLE evidence.submission OWNER TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;
REVOKE REFERENCES ON evidence.submission_request FROM ductus_identity;

ALTER TABLE evidence.submission ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence.submission FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_submission_owner ON evidence.submission
  TO ductus_evidence USING (true) WITH CHECK (true);
-- The student reads the own submissions. The teacher's view comes with the
-- signed receipt (F-10): until then a row is not shown as submitted.
CREATE POLICY evidence_submission_read ON evidence.submission FOR SELECT TO ductus_app
  USING (institution_id = (SELECT app.current_institution_id()) AND principal_id = (SELECT app.current_user_id()));
GRANT SELECT ON evidence.submission TO ductus_app;

CREATE TRIGGER evidence_submission_immutable BEFORE UPDATE OR DELETE ON evidence.submission
  FOR EACH ROW EXECUTE FUNCTION evidence.reject_append_only_change();
CREATE TRIGGER evidence_submission_no_truncate BEFORE TRUNCATE ON evidence.submission
  FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();

-- The web process calls this once the reconstruction of the request's
-- revision matched, with the hash of the reconstructed document. Outcomes:
-- recorded (new row), existing (the earlier submission, unchanged),
-- unauthorized (no session, not the caller's request, no longer an active
-- student of its assignment, or no such request: one answer), invalid,
-- artifact_mismatch (the hash is not the requested revision's: nothing is
-- written). Only "recorded" writes.
CREATE FUNCTION app.record_submission(p_submission_request_id uuid, p_artifact_hash text)
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
REVOKE CREATE ON SCHEMA app FROM ductus_identity, ductus_evidence;
REVOKE CREATE ON SCHEMA evidence FROM ductus_identity, ductus_evidence;
REVOKE USAGE ON SCHEMA evidence FROM ductus_identity;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;
REVOKE ductus_evidence FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA evidence TO ductus_evidence;
GRANT ductus_evidence TO ductus_identity WITH INHERIT FALSE, SET TRUE;
SET LOCAL ROLE ductus_identity;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.record_submission(uuid, text);
DROP TABLE evidence.submission;
ALTER TABLE evidence.submission_request DROP CONSTRAINT evidence_submission_request_pinned_key;
RESET ROLE;
SET LOCAL ROLE ductus_identity;
DROP FUNCTION app.assignment_version_due(uuid, integer);
ALTER TABLE institution.assignment_version DROP CONSTRAINT assignment_version_due_key;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence FROM ductus_evidence;
REVOKE ductus_evidence FROM ductus_identity;

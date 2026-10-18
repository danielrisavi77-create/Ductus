-- B-12 step 2 / DAN-87: the submission request (docs/ARCHITECTURE.md 6 t. 1
-- and 2, docs/BACKEND.md 4.6). A request records the student's click: the
-- time from the database clock, the assignment version, and the committed
-- revision it names, pinned by hash. It is written before any reconstruction
-- and never changes; reconstruction, the outcome and the signed receipt are
-- the next step and add their own append-only rows. Identity and institution
-- come from current_actor(), never from an argument (4.1, 4.3).
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; all revoked at the end.
GRANT USAGE, CREATE ON SCHEMA evidence TO ductus_identity;
GRANT CREATE ON SCHEMA evidence TO ductus_evidence;
GRANT CREATE ON SCHEMA app TO ductus_identity, ductus_evidence;
GRANT ductus_evidence TO ductus_identity WITH INHERIT FALSE, SET TRUE;

SET LOCAL ROLE ductus_identity;
SET LOCAL ROLE ductus_evidence;
-- The request names project, student and assignment in one foreign key.
ALTER TABLE evidence.project ADD CONSTRAINT evidence_project_assignment_key
  UNIQUE (id, institution_id, principal_id, assignment_id);
GRANT REFERENCES ON evidence.project, evidence.document, evidence.document_revision TO ductus_identity;

-- After the deadline means strictly later than it: a request at the deadline
-- instant is on time. Both values are instants, so the time zone and the
-- daylight saving change play no part.
CREATE FUNCTION evidence.is_after_due(p_requested_at timestamptz, p_due_at timestamptz) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path = ''
AS $$ SELECT p_requested_at > p_due_at $$;
REVOKE ALL ON FUNCTION evidence.is_after_due(timestamptz, timestamptz) FROM PUBLIC;

SET LOCAL ROLE ductus_identity;
-- The deadline of one immutable assignment version, for the evidence role only.
CREATE FUNCTION app.assignment_version_due_at(p_assignment_id uuid, p_version_no integer) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT v.due_at FROM institution.assignment_version v
   WHERE v.assignment_id = p_assignment_id AND v.version_no = p_version_no
$$;
REVOKE ALL ON FUNCTION app.assignment_version_due_at(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assignment_version_due_at(uuid, integer) TO ductus_evidence;

-- One request per student and assignment (D-103: institution key and
-- composite foreign keys throughout). The revision and its hash name a
-- committed revision of the student's own document of that assignment.
CREATE TABLE evidence.submission_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  assignment_version integer NOT NULL,
  project_id text NOT NULL,
  document_id text NOT NULL,
  principal_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz NOT NULL,
  after_due boolean NOT NULL,
  UNIQUE (assignment_id, institution_id, principal_id),
  UNIQUE (id, institution_id, principal_id),
  FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment (id, institution_id),
  FOREIGN KEY (assignment_id, assignment_version)
    REFERENCES institution.assignment_version (assignment_id, version_no),
  FOREIGN KEY (principal_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (project_id, institution_id, principal_id, assignment_id)
    REFERENCES evidence.project (id, institution_id, principal_id, assignment_id),
  FOREIGN KEY (document_id, institution_id, project_id, principal_id)
    REFERENCES evidence.document (id, institution_id, project_id, principal_id),
  FOREIGN KEY (document_id, institution_id, revision, content_hash)
    REFERENCES evidence.document_revision (document_id, institution_id, revision, content_hash)
);
CREATE INDEX evidence_submission_request_principal_idx
  ON evidence.submission_request (principal_id, institution_id);
CREATE INDEX evidence_submission_request_document_idx
  ON evidence.submission_request (document_id, institution_id, revision, content_hash);
ALTER TABLE evidence.submission_request OWNER TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;
REVOKE REFERENCES ON evidence.project, evidence.document, evidence.document_revision FROM ductus_identity;

ALTER TABLE evidence.submission_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence.submission_request FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_submission_request_owner ON evidence.submission_request
  TO ductus_evidence USING (true) WITH CHECK (true);
-- The student reads the own requests. The teacher reads the outcome, which
-- is the next step; a request alone is not a submission.
CREATE POLICY evidence_submission_request_read ON evidence.submission_request FOR SELECT TO ductus_app
  USING (institution_id = (SELECT app.current_institution_id()) AND principal_id = (SELECT app.current_user_id()));
GRANT SELECT ON evidence.submission_request TO ductus_app;

CREATE TRIGGER evidence_submission_request_immutable BEFORE UPDATE OR DELETE ON evidence.submission_request
  FOR EACH ROW EXECUTE FUNCTION evidence.reject_append_only_change();
CREATE TRIGGER evidence_submission_request_no_truncate BEFORE TRUNCATE ON evidence.submission_request
  FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();

-- Outcomes: requested (new row), existing (the earlier request, unchanged),
-- unauthorized (no session, not the caller's document, not an active student
-- of its assignment, or no such document: one answer), invalid, stale_revision
-- (not the current revision), no_evidence (revision 0), not_acknowledged
-- (current version not acknowledged). Only "requested" writes.
CREATE FUNCTION app.request_submission(p_document_id text, p_revision bigint)
RETURNS TABLE (
  outcome text, submission_request_id uuid, requested_at timestamptz, revision bigint,
  assignment_version integer, after_due boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  -- The click, read before any lock wait (4.6: before reconstruction).
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_actor record;
  v_document evidence.document%ROWTYPE;
  v_project evidence.project%ROWTYPE;
  v_assignment record;
  v_existing evidence.submission_request%ROWTYPE;
  v_due timestamptz;
  v_id uuid;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::timestamptz, NULL::bigint, NULL::integer, NULL::boolean;
    RETURN;
  END IF;
  IF p_document_id IS NULL OR length(p_document_id) NOT BETWEEN 1 AND 256
     OR p_document_id ~ '[[:cntrl:]]' OR p_document_id <> pg_catalog.btrim(p_document_id)
     OR p_revision IS NULL OR p_revision < 0 OR p_revision > 9007199254740991 THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::timestamptz, NULL::bigint, NULL::integer, NULL::boolean;
    RETURN;
  END IF;

  SELECT pr.* INTO v_project
    FROM evidence.document d
    JOIN evidence.project pr ON pr.id = d.project_id AND pr.institution_id = d.institution_id
   WHERE d.id = p_document_id AND d.institution_id = v_actor.institution_id
     AND d.principal_id = v_actor.user_id AND pr.principal_id = v_actor.user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::timestamptz, NULL::bigint, NULL::integer, NULL::boolean;
    RETURN;
  END IF;
  -- Lock order as in commit_evidence_segment: assignment and membership
  -- (FOR SHARE), then the document (FOR UPDATE). A concurrent commit or a
  -- second request waits here and then sees the committed state.
  SELECT * INTO v_assignment FROM app.lock_student_assignment(v_project.assignment_id);
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::timestamptz, NULL::bigint, NULL::integer, NULL::boolean;
    RETURN;
  END IF;
  SELECT d.* INTO v_document
    FROM evidence.document d
   WHERE d.id = p_document_id AND d.institution_id = v_actor.institution_id
     AND d.principal_id = v_actor.user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::timestamptz, NULL::bigint, NULL::integer, NULL::boolean;
    RETURN;
  END IF;

  SELECT s.* INTO v_existing
    FROM evidence.submission_request s
   WHERE s.assignment_id = v_project.assignment_id AND s.institution_id = v_actor.institution_id
     AND s.principal_id = v_actor.user_id;
  IF FOUND THEN
    RETURN QUERY SELECT 'existing'::text, v_existing.id, v_existing.requested_at, v_existing.revision,
      v_existing.assignment_version, v_existing.after_due;
    RETURN;
  END IF;
  IF NOT v_assignment.acknowledged THEN
    RETURN QUERY SELECT 'not_acknowledged'::text, NULL::uuid, NULL::timestamptz, NULL::bigint, NULL::integer, NULL::boolean;
    RETURN;
  END IF;
  IF p_revision <> v_document.current_revision THEN
    RETURN QUERY SELECT 'stale_revision'::text, NULL::uuid, NULL::timestamptz, v_document.current_revision,
      NULL::integer, NULL::boolean;
    RETURN;
  END IF;
  IF v_document.current_revision = 0 THEN
    RETURN QUERY SELECT 'no_evidence'::text, NULL::uuid, NULL::timestamptz, NULL::bigint, NULL::integer, NULL::boolean;
    RETURN;
  END IF;

  v_due := app.assignment_version_due_at(v_project.assignment_id, v_assignment.current_version);
  v_id := gen_random_uuid();
  INSERT INTO evidence.submission_request (
    id, institution_id, assignment_id, assignment_version, project_id, document_id, principal_id,
    revision, content_hash, requested_at, after_due
  ) VALUES (
    v_id, v_actor.institution_id, v_project.assignment_id, v_assignment.current_version, v_project.id,
    v_document.id, v_actor.user_id, v_document.current_revision, v_document.current_content_hash,
    v_now, evidence.is_after_due(v_now, v_due)
  );
  RETURN QUERY SELECT 'requested'::text, v_id, v_now, v_document.current_revision,
    v_assignment.current_version, evidence.is_after_due(v_now, v_due);
END
$$;
REVOKE ALL ON FUNCTION app.request_submission(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.request_submission(text, bigint) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity, ductus_evidence;
REVOKE CREATE ON SCHEMA evidence FROM ductus_identity, ductus_evidence;
REVOKE USAGE ON SCHEMA evidence FROM ductus_identity;
REVOKE ductus_evidence FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app TO ductus_identity, ductus_evidence;
GRANT CREATE ON SCHEMA evidence TO ductus_evidence;
GRANT ductus_evidence TO ductus_identity WITH INHERIT FALSE, SET TRUE;
SET LOCAL ROLE ductus_identity;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.request_submission(text, bigint);
DROP TABLE evidence.submission_request;
DROP FUNCTION evidence.is_after_due(timestamptz, timestamptz);
ALTER TABLE evidence.project DROP CONSTRAINT evidence_project_assignment_key;
SET LOCAL ROLE ductus_identity;
DROP FUNCTION app.assignment_version_due_at(uuid, integer);
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity, ductus_evidence;
REVOKE CREATE ON SCHEMA evidence FROM ductus_evidence;
REVOKE ductus_evidence FROM ductus_identity;

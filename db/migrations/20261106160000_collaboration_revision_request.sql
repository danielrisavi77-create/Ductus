-- DAN-314 step 2a (docs/backend/suradnja.md 4.14, attack plan #1506,
-- contract on #1091 c.6684460326): a revision request is its own record with
-- an anchor in schema collaboration, not a comment thread and not built on
-- D-133. It never writes the document, a revision, a segment, a receipt or a
-- hash. This step adds the store, creating, reading and the retention delete;
-- the four transitions with the expected write counter come in step 2b.
-- Errors: ZD401 no session, ZD403 not allowed, not there or already
-- submitted (same answer), ZD422 invalid input.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
GRANT USAGE, CREATE ON SCHEMA collaboration TO ductus_evidence;

-- The row lock a write takes on the document before it asks whether the
-- document is submitted (4.14, "Zaključavanje s predajom"). Owned by the
-- evidence role and executable only by the identity role, like
-- document_scope, so schema collaboration still has no right on evidence.
-- Returns nothing; a document outside the caller's institution is ZD403.
SET LOCAL ROLE ductus_evidence;
CREATE FUNCTION collaboration.lock_document_for_write(p_document_id text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM 1
    FROM evidence.document d
    JOIN app.current_actor() a ON a.institution_id = d.institution_id
   WHERE d.id = p_document_id
     FOR SHARE OF d;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
END
$$;
REVOKE ALL ON FUNCTION collaboration.lock_document_for_write(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collaboration.lock_document_for_write(text) TO ductus_identity;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_identity;

-- One sequence for every row_seq of every request: no value is handed out
-- twice, so a counter read on another request never equals the stored one
-- (attack C4). No role but the owner has any right on it.
CREATE SEQUENCE collaboration.revision_request_seq AS bigint
  MINVALUE 1 MAXVALUE 9007199254740991 NO CYCLE;

-- Instruction and explanation: as is_comment_body, and stricter: at least one
-- character that is neither Unicode White_Space (NBSP included) nor zero
-- width (U+200B to U+200D, U+2060, U+FEFF). is_comment_body is unchanged.
CREATE FUNCTION collaboration.is_revision_text(p_text text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT p_text IS NOT NULL AND p_text IS NFC NORMALIZED
    AND char_length(p_text) BETWEEN 1 AND 2000
    AND translate(p_text, E'\n\t', '') !~ '[[:cntrl:]]'
    AND p_text !~ E'[\u202A-\u202E\u2066-\u2069]'
    AND p_text ~ E'[^\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]'
$$;

-- No foreign key to evidence.document, as comment_thread: scope, assignment
-- and owner are copied from the document when the request is created.
CREATE TABLE collaboration.revision_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  document_id text NOT NULL CHECK (length(document_id) BETWEEN 1 AND 256),
  anchor jsonb NOT NULL CHECK (collaboration.is_text_anchor(anchor)),
  state text NOT NULL CHECK (state IN ('open', 'responded', 'accepted', 'reopened', 'withdrawn')),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 1000),
  row_seq bigint NOT NULL UNIQUE CHECK (row_seq BETWEEN 1 AND 9007199254740991),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, institution_id),
  FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment (id, institution_id),
  FOREIGN KEY (owner_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (created_by, institution_id) REFERENCES identity.user_account (id, institution_id)
);
CREATE INDEX revision_request_document_idx ON collaboration.revision_request (document_id, institution_id);

-- One row per version; history is never rewritten. closed_* is set once.
CREATE TABLE collaboration.revision_request_version (
  request_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 1000),
  instruction text NOT NULL CHECK (collaboration.is_revision_text(instruction)),
  requested_revision bigint NOT NULL CHECK (requested_revision BETWEEN 0 AND 9007199254740991),
  opened_by uuid NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_as text CHECK (closed_as IN ('accepted', 'reopened', 'withdrawn')),
  closed_by uuid,
  closed_at timestamptz,
  accepted_revision bigint CHECK (accepted_revision BETWEEN 0 AND 9007199254740991),
  accepted_range_hash text CHECK (accepted_range_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (request_id, version),
  UNIQUE (request_id, version, institution_id),
  -- A NULL comparison would pass a CHECK, so these compare null-safely.
  CHECK ((closed_as IS NULL) = (closed_by IS NULL) AND (closed_as IS NULL) = (closed_at IS NULL)),
  CHECK ((accepted_revision IS NOT NULL) = (closed_as IS NOT DISTINCT FROM 'accepted')),
  CHECK (accepted_range_hash IS NULL OR closed_as IS NOT DISTINCT FROM 'accepted'),
  FOREIGN KEY (request_id, institution_id) REFERENCES collaboration.revision_request (id, institution_id),
  FOREIGN KEY (opened_by, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (closed_by, institution_id) REFERENCES identity.user_account (id, institution_id)
);

-- The student's answer to one version: at most one per version.
CREATE TABLE collaboration.revision_response (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  version integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('done', 'declined')),
  explanation text NOT NULL CHECK (collaboration.is_revision_text(explanation)),
  response_revision bigint NOT NULL CHECK (response_revision BETWEEN 0 AND 9007199254740991),
  author_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, version),
  FOREIGN KEY (request_id, version, institution_id)
    REFERENCES collaboration.revision_request_version (request_id, version, institution_id),
  FOREIGN KEY (author_id, institution_id) REFERENCES identity.user_account (id, institution_id)
);

-- Forced RLS with only the owner's policy: no runtime role has any privilege
-- on these tables; the web role reads through list_revision_requests alone.
ALTER TABLE collaboration.revision_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration.revision_request FORCE ROW LEVEL SECURITY;
ALTER TABLE collaboration.revision_request_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration.revision_request_version FORCE ROW LEVEL SECURITY;
ALTER TABLE collaboration.revision_response ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration.revision_response FORCE ROW LEVEL SECURITY;
CREATE POLICY revision_request_owner ON collaboration.revision_request
  TO ductus_identity USING (true) WITH CHECK (true);
CREATE POLICY revision_request_version_owner ON collaboration.revision_request_version
  TO ductus_identity USING (true) WITH CHECK (true);
CREATE POLICY revision_response_owner ON collaboration.revision_response
  TO ductus_identity USING (true) WITH CHECK (true);

-- A teacher of the assignment opens a request on a range of a student's
-- document. Order (4.14): session, scope and role, document lock, submitted,
-- input, write. The submitted check is its own statement after the lock, so
-- under READ COMMITTED it sees a submission committed while the lock waited.
CREATE FUNCTION collaboration.create_revision_request(
  p_document_id text, p_anchor jsonb, p_instruction text, p_requested_revision bigint
)
RETURNS TABLE (request_id uuid, row_seq bigint, version integer, state text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  actor record;
  scope record;
  v_id uuid;
  v_seq bigint;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT * INTO scope FROM collaboration.document_scope(p_document_id);
  IF collaboration.actor_role(scope.institution_id, scope.assignment_id, scope.principal_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  PERFORM collaboration.lock_document_for_write(p_document_id);
  IF app.document_submitted(p_document_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- Checked before the table constraints, whose errors would quote the row.
  IF NOT coalesce(collaboration.is_text_anchor(p_anchor), false)
     OR NOT coalesce(collaboration.is_revision_text(p_instruction), false)
     OR p_requested_revision IS NULL
     OR p_requested_revision NOT BETWEEN 0 AND 9007199254740991 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  v_seq := nextval('collaboration.revision_request_seq');
  INSERT INTO collaboration.revision_request
    (institution_id, assignment_id, owner_id, document_id, anchor, state, version, row_seq, created_by)
  VALUES
    (scope.institution_id, scope.assignment_id, scope.principal_id, p_document_id, p_anchor, 'open', 1, v_seq, actor.user_id)
  RETURNING id INTO v_id;
  INSERT INTO collaboration.revision_request_version
    (request_id, institution_id, version, instruction, requested_revision, opened_by)
  VALUES (v_id, scope.institution_id, 1, p_instruction, p_requested_revision, actor.user_id);
  RETURN QUERY SELECT v_id, v_seq, 1, 'open'::text;
END
$$;

-- One reading for student and teacher alike (PRODUCT 5 rule 5): one row per
-- version of every request, withdrawn ones included. No person id, no
-- institution, no exact time (P-03 window of 5 minutes), no document content;
-- the anchor comes back as stored, only in the row of version 1. Reading
-- takes no lock and works after submission.
CREATE FUNCTION collaboration.list_revision_requests(p_document_id text)
RETURNS TABLE (
  request_id uuid, request_state text, request_version integer, request_row_seq bigint, anchor jsonb,
  version integer, instruction text, requested_revision bigint, opened_is_own boolean, opened_window timestamptz,
  response_kind text, response_explanation text, response_revision bigint, response_is_own boolean,
  response_window timestamptz, closed_as text, closed_is_own boolean, closed_window timestamptz,
  accepted_revision bigint, accepted_range_hash text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  actor record;
  scope record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT * INTO scope FROM collaboration.document_scope(p_document_id);
  IF collaboration.actor_role(scope.institution_id, scope.assignment_id, scope.principal_id) IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  RETURN QUERY
    SELECT r.id, r.state, r.version, r.row_seq, CASE WHEN v.version = 1 THEN r.anchor END,
           v.version, v.instruction, v.requested_revision, v.opened_by = actor.user_id,
           date_bin('5 minutes', v.opened_at, timestamptz '2000-01-01 00:00:00+00'),
           s.kind, s.explanation, s.response_revision, s.author_id = actor.user_id,
           date_bin('5 minutes', s.created_at, timestamptz '2000-01-01 00:00:00+00'),
           v.closed_as, v.closed_by = actor.user_id,
           date_bin('5 minutes', v.closed_at, timestamptz '2000-01-01 00:00:00+00'),
           v.accepted_revision, v.accepted_range_hash
      FROM collaboration.revision_request r
      JOIN collaboration.revision_request_version v ON v.request_id = r.id AND v.institution_id = r.institution_id
      LEFT JOIN collaboration.revision_response s
        ON s.request_id = v.request_id AND s.version = v.version AND s.institution_id = v.institution_id
     WHERE r.document_id = p_document_id AND r.institution_id = scope.institution_id
     ORDER BY r.created_at, r.id, v.version;
END
$$;

-- Deletes every request of a document with its versions and responses, in
-- the same transaction as the document itself (D-12, as delete_live_state).
-- No rows: nothing happens. Takes and returns no text.
CREATE FUNCTION collaboration.delete_revision_requests(p_document_id text, p_institution_id uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  -- No foreign key of the application cascades (033), so the children go first.
  DELETE FROM collaboration.revision_response s
   USING collaboration.revision_request r
   WHERE s.request_id = r.id AND s.institution_id = r.institution_id
     AND r.document_id = p_document_id AND r.institution_id = p_institution_id;
  DELETE FROM collaboration.revision_request_version v
   USING collaboration.revision_request r
   WHERE v.request_id = r.id AND v.institution_id = r.institution_id
     AND r.document_id = p_document_id AND r.institution_id = p_institution_id;
  DELETE FROM collaboration.revision_request r
   WHERE r.document_id = p_document_id AND r.institution_id = p_institution_id;
$$;

GRANT EXECUTE ON FUNCTION
  collaboration.create_revision_request(text, jsonb, text, bigint),
  collaboration.list_revision_requests(text)
TO ductus_app;
GRANT EXECUTE ON FUNCTION collaboration.delete_revision_requests(text, uuid) TO ductus_retention;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;
REVOKE USAGE, CREATE ON SCHEMA collaboration FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_identity;
DROP FUNCTION collaboration.delete_revision_requests(text, uuid);
DROP FUNCTION collaboration.list_revision_requests(text);
DROP FUNCTION collaboration.create_revision_request(text, jsonb, text, bigint);
DROP TABLE collaboration.revision_response;
DROP TABLE collaboration.revision_request_version;
DROP TABLE collaboration.revision_request;
DROP FUNCTION collaboration.is_revision_text(text);
DROP SEQUENCE collaboration.revision_request_seq;
RESET ROLE;
-- The evidence role has no usage on the schema any more; the migrator,
-- a member of the owner role, drops its function.
SET LOCAL ROLE ductus_migrator;
DROP FUNCTION collaboration.lock_document_for_write(text);

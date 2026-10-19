-- B-8 step 2 / DAN-83: a student's work and its text checkpoints
-- (docs/BACKEND.md 4.13 t. 6, 4.10 t. 1, 3 and 5). open_student_work creates,
-- once per student and assignment, the project, the document at revision 0
-- with its checkpoint, and the package; evidence_commit_context is the cheap
-- check the ingest route runs before it reads a segment (4.13 t. 3.2).
-- Identity and institution come from current_actor(), never from an argument
-- (4.1, 4.3). The checkpoint table is thinned later, so it is not part of the
-- append-only guarantee of this schema; its rows are never updated.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA evidence, app TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;
-- One work per student and assignment, so two tabs never create two.
ALTER TABLE evidence.project ADD CONSTRAINT evidence_project_one_per_student
  UNIQUE (assignment_id, institution_id, principal_id);

-- Revision 0 (4.10 t. 3): the editor's empty document, one empty paragraph
-- with a fixed node id, as exact JCS bytes. The same bytes and their hash are
-- fixed in src/domain/document/revision-zero.ts and its known-answer test.
CREATE FUNCTION evidence.revision_zero_document() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT '{"nodes":[{"children":[],"id":"00000000-0000-4000-8000-000000000000","type":"paragraph"}],"schemaVersion":1}'::text
$$;
REVOKE ALL ON FUNCTION evidence.revision_zero_document() FROM PUBLIC;

-- The text of one revision, kept as the exact bytes (text, never jsonb). The
-- hash is computed here from those bytes and the foreign key pins it to the
-- revision's own hash, so no checkpoint can carry other text than the one the
-- revision was committed with, nor name a revision or institution that does
-- not match (D-103).
CREATE TABLE evidence.document_checkpoint (
  document_id text NOT NULL,
  institution_id uuid NOT NULL,
  revision bigint NOT NULL,
  body text NOT NULL CHECK (octet_length(body) BETWEEN 1 AND 2097152),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (document_id, institution_id, revision),
  FOREIGN KEY (document_id, institution_id, revision, content_hash)
    REFERENCES evidence.document_revision (document_id, institution_id, revision, content_hash)
);

-- The writer gives only the bytes: hash and time are the database's.
CREATE FUNCTION evidence.seal_document_checkpoint() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.content_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(NEW.body, 'UTF8')), 'hex');
  NEW.created_at := pg_catalog.now();
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION evidence.seal_document_checkpoint() FROM PUBLIC;
CREATE TRIGGER evidence_checkpoint_seal BEFORE INSERT ON evidence.document_checkpoint
  FOR EACH ROW EXECUTE FUNCTION evidence.seal_document_checkpoint();
-- A row never changes. Only thinning and retention delete rows (4.10 t. 5).
CREATE TRIGGER evidence_checkpoint_immutable BEFORE UPDATE ON evidence.document_checkpoint
  FOR EACH ROW EXECUTE FUNCTION evidence.reject_append_only_change();
CREATE TRIGGER evidence_checkpoint_no_truncate BEFORE TRUNCATE ON evidence.document_checkpoint
  FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();

-- No read policy and no grant for the web role: the text is read only
-- through the reading RPC of 4.10 t. 6.
ALTER TABLE evidence.document_checkpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence.document_checkpoint FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_document_checkpoint_owner ON evidence.document_checkpoint
  TO ductus_evidence USING (true) WITH CHECK (true);

-- Outcomes: opened (the caller's work, created on the first call),
-- unauthenticated (no session), not_found (not an active student of the
-- assignment, or no such assignment: one answer), not_accepting (an active
-- student before acknowledging the current version, or before it opens; no
-- row is written), not_configured (the institution has no single evidence
-- domain, or the work has no document and package). The domain comes from
-- the operator's configuration, never from a migration (4.13 t. 6).
CREATE FUNCTION app.open_student_work(p_assignment_id uuid)
RETURNS TABLE (
  outcome text, document_id text, evidence_profile_id text, current_revision bigint,
  document_hash text, head_segment_hash text, last_sequence_to bigint, snapshot text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor record;
  v_assignment record;
  v_domains uuid[];
  v_project_id text;
  v_document_id text;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RETURN QUERY SELECT 'unauthenticated'::text, NULL::text, NULL::text, NULL::bigint, NULL::text, NULL::text,
      NULL::bigint, NULL::text;
    RETURN;
  END IF;
  -- The assignment and the open membership stay locked FOR SHARE until the
  -- caller commits, as in the acceptance.
  SELECT * INTO v_assignment FROM app.lock_student_assignment(p_assignment_id);
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::text, NULL::bigint, NULL::text, NULL::text,
      NULL::bigint, NULL::text;
    RETURN;
  END IF;
  IF NOT v_assignment.acknowledged OR v_assignment.opens_at > pg_catalog.clock_timestamp() THEN
    RETURN QUERY SELECT 'not_accepting'::text, NULL::text, NULL::text, NULL::bigint, NULL::text, NULL::text,
      NULL::bigint, NULL::text;
    RETURN;
  END IF;

  SELECT p.id INTO v_project_id FROM evidence.project p
   WHERE p.assignment_id = p_assignment_id AND p.institution_id = v_actor.institution_id
     AND p.principal_id = v_actor.user_id;
  IF NOT FOUND THEN
    SELECT pg_catalog.array_agg(d.id) INTO v_domains FROM evidence.domain d
     WHERE d.institution_id = v_actor.institution_id;
    IF pg_catalog.cardinality(v_domains) IS DISTINCT FROM 1 THEN
      RETURN QUERY SELECT 'not_configured'::text, NULL::text, NULL::text, NULL::bigint, NULL::text, NULL::text,
        NULL::bigint, NULL::text;
      RETURN;
    END IF;
    v_project_id := pg_catalog.gen_random_uuid()::text;
    -- A parallel first call waits here for the other one and then creates
    -- nothing: the unique key decides, never the lookup above.
    INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id)
    VALUES (v_project_id, v_actor.institution_id, p_assignment_id, v_actor.user_id)
    ON CONFLICT (assignment_id, institution_id, principal_id) DO NOTHING;
    IF FOUND THEN
      v_document_id := pg_catalog.gen_random_uuid()::text;
      INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_revision, current_content_hash)
      VALUES (v_document_id, v_actor.institution_id, v_project_id, v_actor.user_id, 0,
              pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(evidence.revision_zero_document(), 'UTF8')), 'hex'));
      INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash)
      SELECT d.id, d.institution_id, 0, d.principal_id, d.current_content_hash
        FROM evidence.document d WHERE d.id = v_document_id;
      INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body)
      VALUES (v_document_id, v_actor.institution_id, 0, evidence.revision_zero_document());
      -- The capture profile is one constant shared with the client
      -- (src/domain/forensics/evidence-profile.ts); the payload limit is D-96.
      INSERT INTO evidence.package (
        id, institution_id, evidence_domain_id, document_id, project_id, principal_id, evidence_profile_id,
        max_payload_bytes
      ) VALUES (
        pg_catalog.gen_random_uuid()::text, v_actor.institution_id, v_domains[1], v_document_id, v_project_id,
        v_actor.user_id, 'standard-v1', 2097152
      );
    ELSE
      SELECT p.id INTO STRICT v_project_id FROM evidence.project p
       WHERE p.assignment_id = p_assignment_id AND p.institution_id = v_actor.institution_id
         AND p.principal_id = v_actor.user_id;
    END IF;
  END IF;

  -- The current state, also for reconciliation (ADR 5.4 t. 1). The snapshot
  -- is the current revision's checkpoint; package and institution stay here.
  RETURN QUERY
  SELECT 'opened'::text, d.id, k.evidence_profile_id, d.current_revision, d.current_content_hash,
         k.head_segment_hash, k.last_sequence_to, c.body
    FROM evidence.document d
    JOIN evidence.package k
      ON k.document_id = d.id AND k.institution_id = d.institution_id AND k.principal_id = d.principal_id
    LEFT JOIN evidence.document_checkpoint c
      ON c.document_id = d.id AND c.institution_id = d.institution_id AND c.revision = d.current_revision
   WHERE d.project_id = v_project_id AND d.institution_id = v_actor.institution_id
     AND d.principal_id = v_actor.user_id
   ORDER BY d.created_at, d.id, k.created_at, k.id
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_configured'::text, NULL::text, NULL::text, NULL::bigint, NULL::text, NULL::text,
      NULL::bigint, NULL::text;
  END IF;
END
$$;
REVOKE ALL ON FUNCTION app.open_student_work(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.open_student_work(uuid) TO ductus_app;

-- The ingest route's check before any expensive work (4.13 t. 3.2). Outcomes:
-- ok, unauthenticated (no session), invalid (malformed argument), not_found
-- (no such document, another student's or institution's, a teacher's call, a
-- student no longer active in the assignment: one answer). Writes nothing.
-- transaction_known says whether the idempotency key already has a receipt
-- in the document's package.
CREATE FUNCTION app.evidence_commit_context(p_document_id text, p_client_transaction_id text)
RETURNS TABLE (
  outcome text, evidence_package_id text, institution_id uuid, evidence_domain_id uuid, evidence_profile_id text,
  max_payload_bytes integer, transaction_known boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor record;
  v_package evidence.package%ROWTYPE;
  v_assignment_id uuid;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RETURN QUERY SELECT 'unauthenticated'::text, NULL::text, NULL::uuid, NULL::uuid, NULL::text, NULL::integer,
      NULL::boolean;
    RETURN;
  END IF;
  -- The limits of the columns and of receipt v2: 1 to 256 characters for the
  -- document, 1 to 128 UTF-16 code units for the key, no control characters.
  IF p_document_id IS NULL OR pg_catalog.length(p_document_id) NOT BETWEEN 1 AND 256
     OR p_document_id ~ '[[:cntrl:]]'
     OR p_client_transaction_id IS NULL OR p_client_transaction_id = '' OR p_client_transaction_id ~ '[[:cntrl:]]'
     OR pg_catalog.length(p_client_transaction_id) + (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.regexp_split_to_table(p_client_transaction_id, '') AS codepoint(value)
        WHERE pg_catalog.octet_length(pg_catalog.convert_to(value, 'UTF8')) = 4
     ) > 128 THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text, NULL::uuid, NULL::uuid, NULL::text, NULL::integer,
      NULL::boolean;
    RETURN;
  END IF;

  SELECT k.* INTO v_package
    FROM evidence.document d
    JOIN evidence.package k
      ON k.document_id = d.id AND k.institution_id = d.institution_id AND k.principal_id = d.principal_id
   WHERE d.id = p_document_id AND d.institution_id = v_actor.institution_id AND d.principal_id = v_actor.user_id
   ORDER BY k.created_at, k.id
   LIMIT 1;
  IF FOUND THEN
    SELECT p.assignment_id INTO v_assignment_id FROM evidence.project p
     WHERE p.id = v_package.project_id AND p.institution_id = v_package.institution_id
       AND p.principal_id = v_actor.user_id;
    -- Still an active student of the assignment (same check as the acceptance).
    PERFORM 1 FROM app.lock_student_assignment(v_assignment_id);
  END IF;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::uuid, NULL::uuid, NULL::text, NULL::integer,
      NULL::boolean;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'ok'::text, v_package.id, v_package.institution_id, v_package.evidence_domain_id,
    v_package.evidence_profile_id, v_package.max_payload_bytes,
    EXISTS (
      SELECT 1 FROM evidence.receipt r
       WHERE r.evidence_package_id = v_package.id AND r.institution_id = v_package.institution_id
         AND r.principal_id = v_actor.user_id AND r.client_request_id = p_client_transaction_id
    );
END
$$;
REVOKE ALL ON FUNCTION app.evidence_commit_context(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.evidence_commit_context(text, text) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence, app FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.evidence_commit_context(text, text);
DROP FUNCTION app.open_student_work(uuid);
DROP TABLE evidence.document_checkpoint;
DROP FUNCTION evidence.seal_document_checkpoint();
DROP FUNCTION evidence.revision_zero_document();
ALTER TABLE evidence.project DROP CONSTRAINT evidence_project_one_per_student;
RESET ROLE;

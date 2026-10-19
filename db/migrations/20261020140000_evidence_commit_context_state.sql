-- F-099 / DAN-83 (docs/BACKEND.md 4.13 t. 3.2 and 3.5): the context before a
-- commit also says what the acceptance would refuse before an object is
-- stored. For a key not known yet it answers not_accepting under the
-- acceptance's own conditions, and it returns the document's and package's
-- chain state so the route refuses a stale base or a broken chain before
-- storage. A known key still answers ok: its retry stores nothing and gets
-- its receipt. The acceptance RPC stays the authority; nothing is locked or
-- written here. Arguments, owner, grants and search_path are unchanged.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;

DROP FUNCTION app.evidence_commit_context(text, text);
CREATE FUNCTION app.evidence_commit_context(p_document_id text, p_client_transaction_id text)
RETURNS TABLE (
  outcome text, evidence_package_id text, institution_id uuid, evidence_domain_id uuid, evidence_profile_id text,
  max_payload_bytes integer, transaction_known boolean,
  current_revision bigint, document_hash text, head_segment_hash text, last_sequence_to bigint
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_actor record;
  v_package evidence.package%ROWTYPE;
  v_document evidence.document%ROWTYPE;
  v_assignment record;
  v_assignment_id uuid;
  v_known boolean;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    outcome := 'unauthenticated'; RETURN NEXT; RETURN;
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
    outcome := 'invalid'; RETURN NEXT; RETURN;
  END IF;

  SELECT d.* INTO v_document FROM evidence.document d
   WHERE d.id = p_document_id AND d.institution_id = v_actor.institution_id AND d.principal_id = v_actor.user_id;
  IF FOUND THEN
    SELECT k.* INTO v_package FROM evidence.package k
     WHERE k.document_id = v_document.id AND k.institution_id = v_document.institution_id
       AND k.principal_id = v_actor.user_id
     ORDER BY k.created_at, k.id
     LIMIT 1;
  END IF;
  IF FOUND THEN
    SELECT p.assignment_id INTO v_assignment_id FROM evidence.project p
     WHERE p.id = v_package.project_id AND p.institution_id = v_package.institution_id
       AND p.principal_id = v_actor.user_id;
    -- Still an active student of the assignment (same check as the acceptance).
    SELECT * INTO v_assignment FROM app.lock_student_assignment(v_assignment_id);
  END IF;
  IF NOT FOUND THEN
    outcome := 'not_found'; RETURN NEXT; RETURN;
  END IF;

  v_known := EXISTS (
    SELECT 1 FROM evidence.receipt r
     WHERE r.evidence_package_id = v_package.id AND r.institution_id = v_package.institution_id
       AND r.principal_id = v_actor.user_id AND r.client_request_id = p_client_transaction_id
  );
  -- The acceptance's condition for a new acceptance (ADR 5.3 t. 8), with its clock.
  IF NOT v_known AND (NOT v_package.accepts_evidence OR NOT v_assignment.acknowledged
                      OR v_assignment.opens_at > pg_catalog.clock_timestamp()) THEN
    outcome := 'not_accepting'; RETURN NEXT; RETURN;
  END IF;

  outcome := 'ok';
  evidence_package_id := v_package.id;
  institution_id := v_package.institution_id;
  evidence_domain_id := v_package.evidence_domain_id;
  evidence_profile_id := v_package.evidence_profile_id;
  max_payload_bytes := v_package.max_payload_bytes;
  transaction_known := v_known;
  current_revision := v_document.current_revision;
  document_hash := v_document.current_content_hash;
  head_segment_hash := v_package.head_segment_hash;
  last_sequence_to := v_package.last_sequence_to;
  RETURN NEXT;
END
$$;
REVOKE ALL ON FUNCTION app.evidence_commit_context(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.evidence_commit_context(text, text) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;

DROP FUNCTION app.evidence_commit_context(text, text);
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
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

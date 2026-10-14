-- DAN-189 / B-8: atomic evidence revision + receipt reservation (D-103).
-- Identity and institution are derived from the active session, never arguments.
-- Payload bytes are not stored here; callers provide a verified digest and reference.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app TO ductus_identity, ductus_evidence;
GRANT CREATE ON SCHEMA evidence TO ductus_evidence;
GRANT USAGE ON SCHEMA app TO ductus_evidence;
GRANT ductus_evidence TO ductus_identity WITH INHERIT FALSE, SET TRUE;

SET LOCAL ROLE ductus_identity;
CREATE FUNCTION app.current_assignment_role(p_assignment_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT institution.actor_assignment_role(p_assignment_id) $$;
REVOKE ALL ON FUNCTION app.current_assignment_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_actor() TO ductus_evidence;
GRANT EXECUTE ON FUNCTION app.current_assignment_role(uuid) TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;

-- One entrypoint for the web role. Identity and institution are always read
-- from current_actor(); the descriptor is validated upstream and its hash is
-- independently compared with the byte hash before anything is reserved.
CREATE FUNCTION app.commit_evidence_segment(
  p_evidence_package_id text,
  p_client_request_id text,
  p_expected_revision bigint,
  p_initial_document_hash text,
  p_final_document_hash text,
  p_descriptor jsonb,
  p_payload_sha256 text,
  p_storage_ref text
) RETURNS TABLE (
  outcome text,
  committed_revision bigint,
  receipt_payload text,
  receipt_id uuid,
  expected_previous_segment_hash text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor record;
  v_package evidence.package%ROWTYPE;
  v_project evidence.project%ROWTYPE;
  v_document evidence.document%ROWTYPE;
  v_existing evidence.receipt%ROWTYPE;
  v_previous_receipt uuid;
  v_new_receipt uuid;
  v_revision bigint;
  v_now timestamptz;
  v_accepted_at text;
  v_descriptor record;
  v_receipt jsonb;
  v_receipt_text text;
  v_sequence_from bigint;
  v_sequence_to bigint;
  v_event_count integer;
  v_payload_bytes integer;
  v_previous_hash text;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- Validate scalar RPC arguments before asking the private descriptor helper.
  IF p_evidence_package_id IS NULL OR p_evidence_package_id !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
     OR p_client_request_id IS NULL
     OR pg_catalog.btrim(p_client_request_id,
          ' ' || pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(11) || pg_catalog.chr(12) || pg_catalog.chr(13)
          || pg_catalog.chr(160) || pg_catalog.chr(5760) || pg_catalog.chr(8192) || pg_catalog.chr(8193)
          || pg_catalog.chr(8194) || pg_catalog.chr(8195) || pg_catalog.chr(8196) || pg_catalog.chr(8197)
          || pg_catalog.chr(8198) || pg_catalog.chr(8199) || pg_catalog.chr(8200) || pg_catalog.chr(8201)
          || pg_catalog.chr(8202) || pg_catalog.chr(8232) || pg_catalog.chr(8233) || pg_catalog.chr(8239)
          || pg_catalog.chr(8287) || pg_catalog.chr(12288) || pg_catalog.chr(65279)) = ''
     OR p_client_request_id ~ '[[:cntrl:]]'
     OR length(p_client_request_id) + (
       SELECT count(*)
       FROM pg_catalog.regexp_split_to_table(p_client_request_id, '') AS codepoint(value)
       WHERE pg_catalog.octet_length(pg_catalog.convert_to(value, 'UTF8')) = 4
     ) > 128
     OR p_expected_revision IS NULL OR p_expected_revision < 0 OR p_expected_revision >= 9007199254740991
     OR p_initial_document_hash IS NULL OR p_initial_document_hash !~ '^[0-9a-f]{64}$'
     OR p_final_document_hash IS NULL OR p_final_document_hash !~ '^[0-9a-f]{64}$'
     OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[0-9a-f]{64}$'
     OR p_storage_ref IS NULL OR length(p_storage_ref) NOT BETWEEN 1 AND 2048 OR p_storage_ref ~ '[[:cntrl:]]' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_descriptor
    FROM evidence.validate_segment_descriptor_v2(p_descriptor, p_payload_sha256);
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  v_sequence_from := v_descriptor.sequence_from;
  v_sequence_to := v_descriptor.sequence_to;
  v_event_count := v_descriptor.event_count;
  v_payload_bytes := v_descriptor.payload_bytes;
  -- The app is authorized for this specific student assignment before any
  -- idempotency lookup. Both rows are locked in a fixed order to serialize
  -- concurrent reserves and avoid replaying a request after ownership changes.
  SELECT p.* INTO v_package
    FROM evidence.package p
   WHERE p.id = p_evidence_package_id AND p.institution_id = v_actor.institution_id
     AND p.principal_id = v_actor.user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  SELECT pr.* INTO v_project
    FROM evidence.project pr
   WHERE pr.id = v_package.project_id AND pr.institution_id = v_package.institution_id;
  IF NOT FOUND OR v_project.principal_id <> v_actor.user_id
     OR app.current_assignment_role(v_project.assignment_id) IS DISTINCT FROM 'student' THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF p_descriptor->>'evidencePackageId' <> v_package.id
     OR p_descriptor->>'documentId' <> v_package.document_id
     OR p_descriptor->>'evidenceProfileId' <> v_package.evidence_profile_id THEN
    RETURN QUERY SELECT 'context_mismatch'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT d.* INTO v_document
    FROM evidence.document d
   WHERE d.id = v_package.document_id AND d.institution_id = v_package.institution_id
     AND d.principal_id = v_actor.user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT r.* INTO v_existing
    FROM evidence.receipt r
   WHERE r.evidence_package_id = v_package.id
     AND r.institution_id = v_package.institution_id
     AND r.principal_id = v_actor.user_id
     AND r.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_existing.descriptor <> p_descriptor THEN
      RETURN QUERY SELECT 'idempotency_conflict'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    ELSIF v_existing.payload_sha256 <> p_payload_sha256 OR v_existing.segment_id <> p_descriptor->>'segmentId'
          OR v_existing.evidence_package_id <> p_evidence_package_id THEN
      RETURN QUERY SELECT 'invalid'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    ELSE
      RETURN QUERY SELECT
        CASE v_existing.status WHEN 'signed' THEN 'duplicate_signed' ELSE 'duplicate_pending' END,
        (v_existing.receipt_payload::jsonb->>'revision')::bigint,
        v_existing.receipt_payload,
        v_existing.id,
        NULL::text;
    END IF;
    RETURN;
  END IF;

  IF NOT v_package.accepts_evidence THEN
    RETURN QUERY SELECT 'not_accepting'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF v_payload_bytes > v_package.max_payload_bytes THEN
    RETURN QUERY SELECT 'too_large'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF v_document.current_revision <> p_expected_revision
     OR v_document.current_content_hash <> p_initial_document_hash THEN
    RETURN QUERY SELECT 'concurrent_conflict'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF v_sequence_from <> v_package.last_sequence_to + 1
     OR p_descriptor->>'predecessorSegmentHash' IS DISTINCT FROM v_package.head_segment_hash THEN
    RETURN QUERY SELECT 'chain_conflict'::text, NULL::bigint, NULL::text, NULL::uuid, v_package.head_segment_hash;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM evidence.segment s
     WHERE s.evidence_package_id = v_package.id AND s.institution_id = v_package.institution_id
       AND s.id = p_descriptor->>'segmentId'
  ) THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  v_revision := v_document.current_revision + 1;
  v_previous_receipt := v_package.head_receipt_id;
  v_new_receipt := gen_random_uuid();
  v_now := clock_timestamp();
  v_accepted_at := pg_catalog.to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:00.000"Z"');

  UPDATE evidence.document
     SET current_revision = v_revision, current_content_hash = p_final_document_hash
   WHERE id = v_document.id AND institution_id = v_document.institution_id
     AND current_revision = p_expected_revision AND current_content_hash = p_initial_document_hash;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'concurrent_conflict'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  INSERT INTO evidence.document_revision (
    document_id, institution_id, revision, base_revision, principal_id, content_hash, created_at
  ) VALUES (
    v_document.id, v_document.institution_id, v_revision, p_expected_revision,
    v_actor.user_id, p_final_document_hash, v_now
  );

  INSERT INTO evidence.segment (
    id, evidence_package_id, institution_id, document_id, principal_id, session_id,
    sequence_from, sequence_to, event_count, descriptor, segment_hash, payload_bytes,
    storage_ref, accepted_at
  ) VALUES (
    p_descriptor->>'segmentId', v_package.id, v_package.institution_id, v_document.id,
    v_actor.user_id, p_descriptor->>'sessionId', v_sequence_from, v_sequence_to,
    v_event_count, p_descriptor, p_payload_sha256, v_payload_bytes, p_storage_ref, v_now
  );

  v_receipt := pg_catalog.jsonb_build_object(
    'receiptSchema', 'ductus-evidence-receipt-v2',
    'receiptId', v_new_receipt::text,
    'evidencePackageId', v_package.id,
    'documentId', v_document.id,
    'sessionId', p_descriptor->>'sessionId',
    'segmentId', p_descriptor->>'segmentId',
    'segmentHash', p_payload_sha256,
    'predecessorSegmentHash', CASE WHEN v_package.head_segment_hash IS NULL THEN NULL::text ELSE v_package.head_segment_hash END,
    'previousReceiptId', v_previous_receipt::text,
    'evidenceSchema', 'ductus-evidence-segment-v2',
    'evidenceProfileId', v_package.evidence_profile_id,
    'sequenceFrom', v_sequence_from,
    'sequenceTo', v_sequence_to,
    'eventCount', v_event_count,
    'payloadBytes', v_payload_bytes,
    'acceptedAt', v_accepted_at,
    'revision', v_revision,
    'clientTransactionId', p_client_request_id,
    'evidenceDomainId', v_package.evidence_domain_id::text,
    'principalId', v_actor.user_id::text
  );
  v_receipt_text := evidence.canonical_receipt_v2(v_receipt);

  INSERT INTO evidence.receipt (
    id, evidence_package_id, institution_id, evidence_domain_id, segment_id, principal_id,
    client_request_id, previous_receipt_id, payload_sha256, descriptor, receipt_payload, status
  ) VALUES (
    v_new_receipt, v_package.id, v_package.institution_id, v_package.evidence_domain_id,
    p_descriptor->>'segmentId', v_actor.user_id, p_client_request_id, v_previous_receipt,
    p_payload_sha256, p_descriptor, v_receipt_text, 'pending_signature'
  );

  UPDATE evidence.package
     SET head_segment_hash = p_payload_sha256,
         head_receipt_id = v_new_receipt,
         last_sequence_to = v_sequence_to
   WHERE id = v_package.id AND institution_id = v_package.institution_id;

  RETURN QUERY SELECT 'reserved'::text, v_revision, v_receipt_text, v_new_receipt, NULL::text;
END
$$;

REVOKE ALL ON FUNCTION app.commit_evidence_segment(text, text, bigint, text, text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.commit_evidence_segment(text, text, bigint, text, text, jsonb, text, text)
  TO ductus_app;


RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity, ductus_evidence;
REVOKE CREATE ON SCHEMA evidence FROM ductus_evidence;
REVOKE ductus_evidence FROM ductus_identity;

-- Keep app USAGE and the two narrow identity helper EXECUTE grants while the
-- SECURITY DEFINER entrypoint exists. The down migration removes them.
-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app, evidence TO ductus_evidence;
GRANT ductus_evidence TO ductus_identity WITH INHERIT FALSE, SET TRUE;
SET LOCAL ROLE ductus_identity;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.commit_evidence_segment(text, text, bigint, text, text, jsonb, text, text);

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_identity;
REVOKE EXECUTE ON FUNCTION app.current_actor() FROM ductus_evidence;
REVOKE EXECUTE ON FUNCTION app.current_assignment_role(uuid) FROM ductus_evidence;
DROP FUNCTION app.current_assignment_role(uuid);

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity, ductus_evidence;
REVOKE CREATE ON SCHEMA evidence FROM ductus_evidence;
REVOKE USAGE ON SCHEMA app FROM ductus_evidence;
REVOKE ductus_evidence FROM ductus_identity;

-- DAN-343 (owner decision on #87, "Idemo v3"; contract on #896): the
-- database side of evidence segment format v3. v3 is v2 with one more
-- attributed source, citation-form (text the Literatura form inserted); the
-- segment itself is checked by the web process, the database sees only its
-- descriptor. Two lines change against the live functions, and nothing else:
-- the descriptor validator takes the schema v2 or v3, and the receipt names
-- the schema of the descriptor it accepted instead of a fixed v2. Every v2
-- descriptor valid before is valid after, and its receipt is byte for byte
-- the same. Both bodies are otherwise the live ones of 20261014140000 and
-- 20261019170000 verbatim (tests/unit/evidence-segment-v3-migration.test.ts);
-- signature, owner, grants, SECURITY DEFINER and search_path are unchanged.
-- The web process still refuses a v3 payload before this RPC until its own
-- step (the TypeScript part of #896's contract) is merged.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA evidence, app TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;

-- Returns no row for malformed input so the caller can report "invalid".
CREATE OR REPLACE FUNCTION evidence.validate_segment_descriptor_v2(p_descriptor jsonb, p_payload_sha256 text)
RETURNS TABLE (
  sequence_from bigint, sequence_to bigint, event_count integer, payload_bytes integer,
  observed_started_at timestamptz, observed_ended_at timestamptz
)
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  v_started timestamptz;
  v_ended timestamptz;
BEGIN
  IF pg_catalog.jsonb_typeof(p_descriptor) IS DISTINCT FROM 'object'
     OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(p_descriptor)) <> 16
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_object_keys(p_descriptor) AS k(key)
       WHERE key NOT IN (
         'evidencePackageId', 'documentId', 'sessionId', 'segmentId', 'evidenceSchema',
         'canonicalization', 'hashAlgorithm', 'evidenceProfileId', 'sequenceFrom', 'sequenceTo',
         'eventCount', 'observedStartedAt', 'observedEndedAt', 'segmentHash',
         'predecessorSegmentHash', 'payloadBytes'
       )
     )
     OR EXISTS (
       SELECT 1 FROM (VALUES
         ('evidencePackageId'), ('documentId'), ('sessionId'), ('segmentId'), ('evidenceSchema'),
         ('canonicalization'), ('hashAlgorithm'), ('evidenceProfileId'), ('sequenceFrom'), ('sequenceTo'),
         ('eventCount'), ('observedStartedAt'), ('observedEndedAt'), ('segmentHash'),
         ('predecessorSegmentHash'), ('payloadBytes')
       ) AS required(key) WHERE NOT (p_descriptor ? required.key)
     )
     OR pg_catalog.jsonb_typeof(p_descriptor->'evidencePackageId') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'documentId') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'sessionId') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'segmentId') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'evidenceSchema') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'canonicalization') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'hashAlgorithm') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'evidenceProfileId') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'sequenceFrom') <> 'number'
     OR pg_catalog.jsonb_typeof(p_descriptor->'sequenceTo') <> 'number'
     OR pg_catalog.jsonb_typeof(p_descriptor->'eventCount') <> 'number'
     OR pg_catalog.jsonb_typeof(p_descriptor->'observedStartedAt') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'observedEndedAt') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'segmentHash') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'payloadBytes') <> 'number' THEN
    RETURN;
  END IF;

  IF length(p_descriptor->>'evidencePackageId') NOT BETWEEN 1 AND 128
     OR p_descriptor->>'evidencePackageId' !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
     OR length(p_descriptor->>'documentId') NOT BETWEEN 1 AND 256
     OR p_descriptor->>'documentId' <> pg_catalog.btrim(p_descriptor->>'documentId')
     OR p_descriptor->>'documentId' ~ '[[:cntrl:]]'
     OR length(p_descriptor->>'sessionId') NOT BETWEEN 1 AND 256
     OR p_descriptor->>'sessionId' <> pg_catalog.btrim(p_descriptor->>'sessionId')
     OR p_descriptor->>'sessionId' ~ '[[:cntrl:]]'
     OR length(p_descriptor->>'segmentId') NOT BETWEEN 1 AND 256
     OR p_descriptor->>'segmentId' <> pg_catalog.btrim(p_descriptor->>'segmentId')
     OR p_descriptor->>'segmentId' ~ '[[:cntrl:]]'
     OR p_descriptor->>'evidenceSchema' NOT IN ('ductus-evidence-segment-v2', 'ductus-evidence-segment-v3')
     OR p_descriptor->>'canonicalization' <> 'RFC8785-JCS'
     OR p_descriptor->>'hashAlgorithm' <> 'sha256'
     OR length(p_descriptor->>'evidenceProfileId') NOT BETWEEN 1 AND 120
     OR p_descriptor->>'evidenceProfileId' <> pg_catalog.btrim(p_descriptor->>'evidenceProfileId')
     OR p_descriptor->>'evidenceProfileId' ~ '[[:cntrl:]]'
     OR p_descriptor->>'segmentHash' !~ '^[0-9a-f]{64}$'
     OR p_descriptor->>'segmentHash' <> p_payload_sha256
     OR (p_descriptor->'predecessorSegmentHash' <> 'null'::jsonb
         AND (pg_catalog.jsonb_typeof(p_descriptor->'predecessorSegmentHash') <> 'string'
              OR p_descriptor->>'predecessorSegmentHash' !~ '^[0-9a-f]{64}$'))
     -- jsonb keeps an integral number written with a fraction (1.0) in that
     -- form; only plain digits may reach the bigint/integer casts below.
     OR p_descriptor->>'sequenceFrom' !~ '^[0-9]+$'
     OR p_descriptor->>'sequenceTo' !~ '^[0-9]+$'
     OR p_descriptor->>'eventCount' !~ '^[0-9]+$'
     OR p_descriptor->>'payloadBytes' !~ '^[0-9]+$'
     OR (p_descriptor->>'sequenceFrom')::numeric <> trunc((p_descriptor->>'sequenceFrom')::numeric)
     OR (p_descriptor->>'sequenceTo')::numeric <> trunc((p_descriptor->>'sequenceTo')::numeric)
     OR (p_descriptor->>'eventCount')::numeric <> trunc((p_descriptor->>'eventCount')::numeric)
     OR (p_descriptor->>'payloadBytes')::numeric <> trunc((p_descriptor->>'payloadBytes')::numeric)
     OR (p_descriptor->>'sequenceFrom')::numeric NOT BETWEEN 1 AND 9007199254740991
     OR (p_descriptor->>'sequenceTo')::numeric NOT BETWEEN 1 AND 9007199254740991
     OR (p_descriptor->>'eventCount')::numeric NOT BETWEEN 1 AND 5000
     OR (p_descriptor->>'payloadBytes')::numeric NOT BETWEEN 1 AND 2097152
     OR (p_descriptor->>'sequenceTo')::numeric - (p_descriptor->>'sequenceFrom')::numeric
        <> (p_descriptor->>'eventCount')::numeric - 1
     OR p_descriptor->>'observedStartedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[.]000Z$'
     OR p_descriptor->>'observedEndedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[.]000Z$' THEN
    RETURN;
  END IF;

  BEGIN
    v_started := (p_descriptor->>'observedStartedAt')::timestamptz;
    v_ended := (p_descriptor->>'observedEndedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
  IF pg_catalog.to_char(v_started AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:00.000"Z"') <> p_descriptor->>'observedStartedAt'
     OR pg_catalog.to_char(v_ended AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:00.000"Z"') <> p_descriptor->>'observedEndedAt'
     OR v_ended < v_started THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT (p_descriptor->>'sequenceFrom')::bigint, (p_descriptor->>'sequenceTo')::bigint,
    (p_descriptor->>'eventCount')::integer, (p_descriptor->>'payloadBytes')::integer, v_started, v_ended;
END
$$;

CREATE OR REPLACE FUNCTION app.commit_evidence_segment(
  p_evidence_package_id text,
  p_client_request_id text,
  p_expected_revision bigint,
  p_initial_document_hash text,
  p_final_document_hash text,
  p_descriptor jsonb,
  p_payload_sha256 text,
  p_storage_ref text,
  p_snapshot text
) RETURNS TABLE (
  outcome text,
  committed_revision bigint,
  receipt_payload text,
  receipt_id uuid,
  signature jsonb,
  current_revision bigint,
  document_hash text,
  head_segment_hash text,
  last_sequence_to bigint
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_actor record;
  v_package evidence.package%ROWTYPE;
  v_project evidence.project%ROWTYPE;
  v_document evidence.document%ROWTYPE;
  v_assignment record;
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
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    outcome := 'unauthorized'; RETURN NEXT; RETURN;
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
     OR p_storage_ref IS NULL OR length(p_storage_ref) NOT BETWEEN 1 AND 2048 OR p_storage_ref ~ '[[:cntrl:]]'
     OR p_snapshot IS NULL OR pg_catalog.octet_length(p_snapshot) NOT BETWEEN 1 AND 2097152 THEN
    outcome := 'invalid'; RETURN NEXT; RETURN;
  END IF;
  -- The snapshot is the document the segment ends in (4.10 t. 2): its bytes
  -- hash to the final document hash, or nothing is written.
  IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_snapshot, 'UTF8')), 'hex') <> p_final_document_hash THEN
    outcome := 'invalid'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_descriptor
    FROM evidence.validate_segment_descriptor_v2(p_descriptor, p_payload_sha256);
  IF NOT FOUND THEN
    outcome := 'invalid'; RETURN NEXT; RETURN;
  END IF;
  v_sequence_from := v_descriptor.sequence_from;
  v_sequence_to := v_descriptor.sequence_to;
  v_event_count := v_descriptor.event_count;
  v_payload_bytes := v_descriptor.payload_bytes;
  -- The app is authorized for this specific student assignment before any
  -- idempotency lookup. Rows are locked in one fixed order: package,
  -- assignment, membership, document; this serializes concurrent reserves and
  -- holds the authority rows until commit, in the demo through the signature.
  SELECT p.* INTO v_package
    FROM evidence.package p
   WHERE p.id = p_evidence_package_id AND p.institution_id = v_actor.institution_id
     AND p.principal_id = v_actor.user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    outcome := 'unauthorized'; RETURN NEXT; RETURN;
  END IF;
  SELECT pr.* INTO v_project
    FROM evidence.project pr
   WHERE pr.id = v_package.project_id AND pr.institution_id = v_package.institution_id;
  IF NOT FOUND OR v_project.principal_id <> v_actor.user_id THEN
    outcome := 'unauthorized'; RETURN NEXT; RETURN;
  END IF;
  SELECT * INTO v_assignment FROM app.lock_student_assignment(v_project.assignment_id);
  IF NOT FOUND THEN
    outcome := 'unauthorized'; RETURN NEXT; RETURN;
  END IF;
  IF p_descriptor->>'evidencePackageId' <> v_package.id
     OR p_descriptor->>'documentId' <> v_package.document_id
     OR p_descriptor->>'evidenceProfileId' <> v_package.evidence_profile_id THEN
    outcome := 'context_mismatch'; RETURN NEXT; RETURN;
  END IF;

  SELECT d.* INTO v_document
    FROM evidence.document d
   WHERE d.id = v_package.document_id AND d.institution_id = v_package.institution_id
     AND d.principal_id = v_actor.user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    outcome := 'unauthorized'; RETURN NEXT; RETURN;
  END IF;

  -- t. 8: the authoritative idempotency check. A known key writes nothing.
  SELECT r.* INTO v_existing
    FROM evidence.receipt r
   WHERE r.evidence_package_id = v_package.id
     AND r.institution_id = v_package.institution_id
     AND r.principal_id = v_actor.user_id
     AND r.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_existing.descriptor <> p_descriptor THEN
      outcome := 'idempotency_conflict';
    ELSIF v_existing.payload_sha256 <> p_payload_sha256 OR v_existing.segment_id <> p_descriptor->>'segmentId'
          OR v_existing.evidence_package_id <> p_evidence_package_id THEN
      outcome := 'invalid';
    ELSIF NOT evidence.acceptance_retry_matches(v_existing.id, v_document.id, v_actor.user_id, p_expected_revision, p_initial_document_hash, p_final_document_hash, p_storage_ref) THEN
      outcome := 'idempotency_conflict';
    ELSE
      outcome := CASE v_existing.status WHEN 'signed' THEN 'duplicate_signed' ELSE 'duplicate_pending' END;
      committed_revision := (v_existing.receipt_payload::jsonb->>'revision')::bigint;
      receipt_payload := v_existing.receipt_payload;
      receipt_id := v_existing.id;
      signature := v_existing.signature;
    END IF;
    RETURN NEXT; RETURN;
  END IF;

  -- New acceptance only (ADR 5.3 t. 8, PRODUCT 6 S3): the locked current
  -- version must be acknowledged by the student and open.
  IF NOT v_package.accepts_evidence OR NOT v_assignment.acknowledged
     OR v_assignment.opens_at > pg_catalog.clock_timestamp() THEN
    outcome := 'not_accepting'; RETURN NEXT; RETURN;
  END IF;
  IF v_payload_bytes > v_package.max_payload_bytes THEN
    outcome := 'too_large'; RETURN NEXT; RETURN;
  END IF;
  -- t. 9 to 12, in this order. A sequence going back is never a conflict.
  IF v_document.current_revision <> p_expected_revision THEN
    outcome := 'stale_base';
  ELSIF p_descriptor->>'predecessorSegmentHash' IS DISTINCT FROM v_package.head_segment_hash THEN
    outcome := 'chain_conflict';
  ELSIF v_sequence_from <= v_package.last_sequence_to THEN
    outcome := 'invalid'; RETURN NEXT; RETURN;
  ELSIF v_sequence_from <> v_package.last_sequence_to + 1
        OR v_document.current_content_hash <> p_initial_document_hash THEN
    outcome := 'not_continuous';
  END IF;
  IF outcome IS NOT NULL THEN
    current_revision := v_document.current_revision;
    document_hash := v_document.current_content_hash;
    head_segment_hash := v_package.head_segment_hash;
    last_sequence_to := v_package.last_sequence_to;
    RETURN NEXT; RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM evidence.segment s
     WHERE s.evidence_package_id = v_package.id AND s.institution_id = v_package.institution_id
       AND s.id = p_descriptor->>'segmentId'
  ) THEN
    outcome := 'invalid'; RETURN NEXT; RETURN;
  END IF;

  v_revision := v_document.current_revision + 1;
  v_previous_receipt := v_package.head_receipt_id;
  v_new_receipt := gen_random_uuid();
  v_now := clock_timestamp();
  v_accepted_at := pg_catalog.to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:00.000"Z"');

  -- The document row is locked, so the guarded update always finds it.
  UPDATE evidence.document
     SET current_revision = v_revision, current_content_hash = p_final_document_hash
   WHERE id = v_document.id AND institution_id = v_document.institution_id
     AND current_revision = p_expected_revision AND current_content_hash = p_initial_document_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'evidence document changed under its lock' USING ERRCODE = 'ZD409';
  END IF;
  INSERT INTO evidence.document_revision (
    document_id, institution_id, revision, base_revision, principal_id, content_hash, created_at
  ) VALUES (
    v_document.id, v_document.institution_id, v_revision, p_expected_revision,
    v_actor.user_id, p_final_document_hash, v_now
  );
  -- The checkpoint's own key ties its hash to this revision (20261019150000).
  INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body)
  VALUES (v_document.id, v_document.institution_id, v_revision, p_snapshot);

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
    'predecessorSegmentHash', v_package.head_segment_hash,
    'previousReceiptId', v_previous_receipt::text,
    'evidenceSchema', p_descriptor->>'evidenceSchema',
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

  outcome := 'reserved';
  committed_revision := v_revision;
  receipt_payload := v_receipt_text;
  receipt_id := v_new_receipt;
  RETURN NEXT;
END
$$;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence, app FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA evidence, app TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;

-- The validator of 20261014140000, verbatim.
CREATE OR REPLACE FUNCTION evidence.validate_segment_descriptor_v2(p_descriptor jsonb, p_payload_sha256 text)
RETURNS TABLE (
  sequence_from bigint, sequence_to bigint, event_count integer, payload_bytes integer,
  observed_started_at timestamptz, observed_ended_at timestamptz
)
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  v_started timestamptz;
  v_ended timestamptz;
BEGIN
  IF pg_catalog.jsonb_typeof(p_descriptor) IS DISTINCT FROM 'object'
     OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(p_descriptor)) <> 16
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_object_keys(p_descriptor) AS k(key)
       WHERE key NOT IN (
         'evidencePackageId', 'documentId', 'sessionId', 'segmentId', 'evidenceSchema',
         'canonicalization', 'hashAlgorithm', 'evidenceProfileId', 'sequenceFrom', 'sequenceTo',
         'eventCount', 'observedStartedAt', 'observedEndedAt', 'segmentHash',
         'predecessorSegmentHash', 'payloadBytes'
       )
     )
     OR EXISTS (
       SELECT 1 FROM (VALUES
         ('evidencePackageId'), ('documentId'), ('sessionId'), ('segmentId'), ('evidenceSchema'),
         ('canonicalization'), ('hashAlgorithm'), ('evidenceProfileId'), ('sequenceFrom'), ('sequenceTo'),
         ('eventCount'), ('observedStartedAt'), ('observedEndedAt'), ('segmentHash'),
         ('predecessorSegmentHash'), ('payloadBytes')
       ) AS required(key) WHERE NOT (p_descriptor ? required.key)
     )
     OR pg_catalog.jsonb_typeof(p_descriptor->'evidencePackageId') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'documentId') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'sessionId') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'segmentId') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'evidenceSchema') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'canonicalization') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'hashAlgorithm') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'evidenceProfileId') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'sequenceFrom') <> 'number'
     OR pg_catalog.jsonb_typeof(p_descriptor->'sequenceTo') <> 'number'
     OR pg_catalog.jsonb_typeof(p_descriptor->'eventCount') <> 'number'
     OR pg_catalog.jsonb_typeof(p_descriptor->'observedStartedAt') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'observedEndedAt') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'segmentHash') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'payloadBytes') <> 'number' THEN
    RETURN;
  END IF;

  IF length(p_descriptor->>'evidencePackageId') NOT BETWEEN 1 AND 128
     OR p_descriptor->>'evidencePackageId' !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
     OR length(p_descriptor->>'documentId') NOT BETWEEN 1 AND 256
     OR p_descriptor->>'documentId' <> pg_catalog.btrim(p_descriptor->>'documentId')
     OR p_descriptor->>'documentId' ~ '[[:cntrl:]]'
     OR length(p_descriptor->>'sessionId') NOT BETWEEN 1 AND 256
     OR p_descriptor->>'sessionId' <> pg_catalog.btrim(p_descriptor->>'sessionId')
     OR p_descriptor->>'sessionId' ~ '[[:cntrl:]]'
     OR length(p_descriptor->>'segmentId') NOT BETWEEN 1 AND 256
     OR p_descriptor->>'segmentId' <> pg_catalog.btrim(p_descriptor->>'segmentId')
     OR p_descriptor->>'segmentId' ~ '[[:cntrl:]]'
     OR p_descriptor->>'evidenceSchema' <> 'ductus-evidence-segment-v2'
     OR p_descriptor->>'canonicalization' <> 'RFC8785-JCS'
     OR p_descriptor->>'hashAlgorithm' <> 'sha256'
     OR length(p_descriptor->>'evidenceProfileId') NOT BETWEEN 1 AND 120
     OR p_descriptor->>'evidenceProfileId' <> pg_catalog.btrim(p_descriptor->>'evidenceProfileId')
     OR p_descriptor->>'evidenceProfileId' ~ '[[:cntrl:]]'
     OR p_descriptor->>'segmentHash' !~ '^[0-9a-f]{64}$'
     OR p_descriptor->>'segmentHash' <> p_payload_sha256
     OR (p_descriptor->'predecessorSegmentHash' <> 'null'::jsonb
         AND (pg_catalog.jsonb_typeof(p_descriptor->'predecessorSegmentHash') <> 'string'
              OR p_descriptor->>'predecessorSegmentHash' !~ '^[0-9a-f]{64}$'))
     -- jsonb keeps an integral number written with a fraction (1.0) in that
     -- form; only plain digits may reach the bigint/integer casts below.
     OR p_descriptor->>'sequenceFrom' !~ '^[0-9]+$'
     OR p_descriptor->>'sequenceTo' !~ '^[0-9]+$'
     OR p_descriptor->>'eventCount' !~ '^[0-9]+$'
     OR p_descriptor->>'payloadBytes' !~ '^[0-9]+$'
     OR (p_descriptor->>'sequenceFrom')::numeric <> trunc((p_descriptor->>'sequenceFrom')::numeric)
     OR (p_descriptor->>'sequenceTo')::numeric <> trunc((p_descriptor->>'sequenceTo')::numeric)
     OR (p_descriptor->>'eventCount')::numeric <> trunc((p_descriptor->>'eventCount')::numeric)
     OR (p_descriptor->>'payloadBytes')::numeric <> trunc((p_descriptor->>'payloadBytes')::numeric)
     OR (p_descriptor->>'sequenceFrom')::numeric NOT BETWEEN 1 AND 9007199254740991
     OR (p_descriptor->>'sequenceTo')::numeric NOT BETWEEN 1 AND 9007199254740991
     OR (p_descriptor->>'eventCount')::numeric NOT BETWEEN 1 AND 5000
     OR (p_descriptor->>'payloadBytes')::numeric NOT BETWEEN 1 AND 2097152
     OR (p_descriptor->>'sequenceTo')::numeric - (p_descriptor->>'sequenceFrom')::numeric
        <> (p_descriptor->>'eventCount')::numeric - 1
     OR p_descriptor->>'observedStartedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[.]000Z$'
     OR p_descriptor->>'observedEndedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[.]000Z$' THEN
    RETURN;
  END IF;

  BEGIN
    v_started := (p_descriptor->>'observedStartedAt')::timestamptz;
    v_ended := (p_descriptor->>'observedEndedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
  IF pg_catalog.to_char(v_started AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:00.000"Z"') <> p_descriptor->>'observedStartedAt'
     OR pg_catalog.to_char(v_ended AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:00.000"Z"') <> p_descriptor->>'observedEndedAt'
     OR v_ended < v_started THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT (p_descriptor->>'sequenceFrom')::bigint, (p_descriptor->>'sequenceTo')::bigint,
    (p_descriptor->>'eventCount')::integer, (p_descriptor->>'payloadBytes')::integer, v_started, v_ended;
END
$$;

-- The acceptance of 20261019170000, verbatim.
CREATE OR REPLACE FUNCTION app.commit_evidence_segment(
  p_evidence_package_id text,
  p_client_request_id text,
  p_expected_revision bigint,
  p_initial_document_hash text,
  p_final_document_hash text,
  p_descriptor jsonb,
  p_payload_sha256 text,
  p_storage_ref text,
  p_snapshot text
) RETURNS TABLE (
  outcome text,
  committed_revision bigint,
  receipt_payload text,
  receipt_id uuid,
  signature jsonb,
  current_revision bigint,
  document_hash text,
  head_segment_hash text,
  last_sequence_to bigint
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_actor record;
  v_package evidence.package%ROWTYPE;
  v_project evidence.project%ROWTYPE;
  v_document evidence.document%ROWTYPE;
  v_assignment record;
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
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    outcome := 'unauthorized'; RETURN NEXT; RETURN;
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
     OR p_storage_ref IS NULL OR length(p_storage_ref) NOT BETWEEN 1 AND 2048 OR p_storage_ref ~ '[[:cntrl:]]'
     OR p_snapshot IS NULL OR pg_catalog.octet_length(p_snapshot) NOT BETWEEN 1 AND 2097152 THEN
    outcome := 'invalid'; RETURN NEXT; RETURN;
  END IF;
  -- The snapshot is the document the segment ends in (4.10 t. 2): its bytes
  -- hash to the final document hash, or nothing is written.
  IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_snapshot, 'UTF8')), 'hex') <> p_final_document_hash THEN
    outcome := 'invalid'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_descriptor
    FROM evidence.validate_segment_descriptor_v2(p_descriptor, p_payload_sha256);
  IF NOT FOUND THEN
    outcome := 'invalid'; RETURN NEXT; RETURN;
  END IF;
  v_sequence_from := v_descriptor.sequence_from;
  v_sequence_to := v_descriptor.sequence_to;
  v_event_count := v_descriptor.event_count;
  v_payload_bytes := v_descriptor.payload_bytes;
  -- The app is authorized for this specific student assignment before any
  -- idempotency lookup. Rows are locked in one fixed order: package,
  -- assignment, membership, document; this serializes concurrent reserves and
  -- holds the authority rows until commit, in the demo through the signature.
  SELECT p.* INTO v_package
    FROM evidence.package p
   WHERE p.id = p_evidence_package_id AND p.institution_id = v_actor.institution_id
     AND p.principal_id = v_actor.user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    outcome := 'unauthorized'; RETURN NEXT; RETURN;
  END IF;
  SELECT pr.* INTO v_project
    FROM evidence.project pr
   WHERE pr.id = v_package.project_id AND pr.institution_id = v_package.institution_id;
  IF NOT FOUND OR v_project.principal_id <> v_actor.user_id THEN
    outcome := 'unauthorized'; RETURN NEXT; RETURN;
  END IF;
  SELECT * INTO v_assignment FROM app.lock_student_assignment(v_project.assignment_id);
  IF NOT FOUND THEN
    outcome := 'unauthorized'; RETURN NEXT; RETURN;
  END IF;
  IF p_descriptor->>'evidencePackageId' <> v_package.id
     OR p_descriptor->>'documentId' <> v_package.document_id
     OR p_descriptor->>'evidenceProfileId' <> v_package.evidence_profile_id THEN
    outcome := 'context_mismatch'; RETURN NEXT; RETURN;
  END IF;

  SELECT d.* INTO v_document
    FROM evidence.document d
   WHERE d.id = v_package.document_id AND d.institution_id = v_package.institution_id
     AND d.principal_id = v_actor.user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    outcome := 'unauthorized'; RETURN NEXT; RETURN;
  END IF;

  -- t. 8: the authoritative idempotency check. A known key writes nothing.
  SELECT r.* INTO v_existing
    FROM evidence.receipt r
   WHERE r.evidence_package_id = v_package.id
     AND r.institution_id = v_package.institution_id
     AND r.principal_id = v_actor.user_id
     AND r.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_existing.descriptor <> p_descriptor THEN
      outcome := 'idempotency_conflict';
    ELSIF v_existing.payload_sha256 <> p_payload_sha256 OR v_existing.segment_id <> p_descriptor->>'segmentId'
          OR v_existing.evidence_package_id <> p_evidence_package_id THEN
      outcome := 'invalid';
    ELSIF NOT evidence.acceptance_retry_matches(v_existing.id, v_document.id, v_actor.user_id, p_expected_revision, p_initial_document_hash, p_final_document_hash, p_storage_ref) THEN
      outcome := 'idempotency_conflict';
    ELSE
      outcome := CASE v_existing.status WHEN 'signed' THEN 'duplicate_signed' ELSE 'duplicate_pending' END;
      committed_revision := (v_existing.receipt_payload::jsonb->>'revision')::bigint;
      receipt_payload := v_existing.receipt_payload;
      receipt_id := v_existing.id;
      signature := v_existing.signature;
    END IF;
    RETURN NEXT; RETURN;
  END IF;

  -- New acceptance only (ADR 5.3 t. 8, PRODUCT 6 S3): the locked current
  -- version must be acknowledged by the student and open.
  IF NOT v_package.accepts_evidence OR NOT v_assignment.acknowledged
     OR v_assignment.opens_at > pg_catalog.clock_timestamp() THEN
    outcome := 'not_accepting'; RETURN NEXT; RETURN;
  END IF;
  IF v_payload_bytes > v_package.max_payload_bytes THEN
    outcome := 'too_large'; RETURN NEXT; RETURN;
  END IF;
  -- t. 9 to 12, in this order. A sequence going back is never a conflict.
  IF v_document.current_revision <> p_expected_revision THEN
    outcome := 'stale_base';
  ELSIF p_descriptor->>'predecessorSegmentHash' IS DISTINCT FROM v_package.head_segment_hash THEN
    outcome := 'chain_conflict';
  ELSIF v_sequence_from <= v_package.last_sequence_to THEN
    outcome := 'invalid'; RETURN NEXT; RETURN;
  ELSIF v_sequence_from <> v_package.last_sequence_to + 1
        OR v_document.current_content_hash <> p_initial_document_hash THEN
    outcome := 'not_continuous';
  END IF;
  IF outcome IS NOT NULL THEN
    current_revision := v_document.current_revision;
    document_hash := v_document.current_content_hash;
    head_segment_hash := v_package.head_segment_hash;
    last_sequence_to := v_package.last_sequence_to;
    RETURN NEXT; RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM evidence.segment s
     WHERE s.evidence_package_id = v_package.id AND s.institution_id = v_package.institution_id
       AND s.id = p_descriptor->>'segmentId'
  ) THEN
    outcome := 'invalid'; RETURN NEXT; RETURN;
  END IF;

  v_revision := v_document.current_revision + 1;
  v_previous_receipt := v_package.head_receipt_id;
  v_new_receipt := gen_random_uuid();
  v_now := clock_timestamp();
  v_accepted_at := pg_catalog.to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:00.000"Z"');

  -- The document row is locked, so the guarded update always finds it.
  UPDATE evidence.document
     SET current_revision = v_revision, current_content_hash = p_final_document_hash
   WHERE id = v_document.id AND institution_id = v_document.institution_id
     AND current_revision = p_expected_revision AND current_content_hash = p_initial_document_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'evidence document changed under its lock' USING ERRCODE = 'ZD409';
  END IF;
  INSERT INTO evidence.document_revision (
    document_id, institution_id, revision, base_revision, principal_id, content_hash, created_at
  ) VALUES (
    v_document.id, v_document.institution_id, v_revision, p_expected_revision,
    v_actor.user_id, p_final_document_hash, v_now
  );
  -- The checkpoint's own key ties its hash to this revision (20261019150000).
  INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body)
  VALUES (v_document.id, v_document.institution_id, v_revision, p_snapshot);

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
    'predecessorSegmentHash', v_package.head_segment_hash,
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

  outcome := 'reserved';
  committed_revision := v_revision;
  receipt_payload := v_receipt_text;
  receipt_id := v_new_receipt;
  RETURN NEXT;
END
$$;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence, app FROM ductus_evidence;

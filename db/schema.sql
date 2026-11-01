\restrict dbmate

-- Dumped from database version 17.11 (Debian 17.11-1.pgdg13+2)
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: app; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA app;


--
-- Name: audit; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA audit;


--
-- Name: collaboration; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA collaboration;


--
-- Name: evidence; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA evidence;


--
-- Name: identity; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA identity;


--
-- Name: institution; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA institution;


--
-- Name: assignment_submissions(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.assignment_submissions(p_assignment_id uuid) RETURNS TABLE(student_id uuid, submitted boolean, revision bigint, requested_minute timestamp with time zone, after_deadline boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_actor record;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  -- At most one submission per student and assignment (its unique key), and
  -- one open membership per student and course, so one row per student.
  RETURN QUERY
  SELECT s.student_id, x.id IS NOT NULL, x.revision,
         pg_catalog.date_trunc('minute', x.requested_at, 'UTC'), x.after_deadline
    FROM app.teacher_assignment_students(p_assignment_id) s
    LEFT JOIN evidence.submission x
      ON x.assignment_id = p_assignment_id AND x.institution_id = v_actor.institution_id
     AND x.principal_id = s.student_id
   ORDER BY s.student_id;
END
$$;


--
-- Name: assignment_version_due(uuid, integer); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.assignment_version_due(p_assignment_id uuid, p_version_no integer) RETURNS timestamp with time zone
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT v.due_at
    FROM institution.assignment_version v
    JOIN institution.assignment a ON a.id = v.assignment_id
    JOIN app.current_actor() c ON a.institution_id = c.institution_id
   WHERE v.assignment_id = p_assignment_id AND v.version_no = p_version_no
$$;


--
-- Name: assignment_works(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.assignment_works(p_assignment_id uuid) RETURNS TABLE(student_id uuid, document_id text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_actor record;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  RETURN QUERY
  SELECT d.principal_id, d.id
    FROM app.teacher_assignment_students(p_assignment_id) s
    JOIN evidence.project p
      ON p.assignment_id = p_assignment_id AND p.institution_id = v_actor.institution_id AND p.principal_id = s.student_id
    JOIN evidence.document d
      ON d.project_id = p.id AND d.institution_id = p.institution_id AND d.principal_id = p.principal_id
   ORDER BY d.principal_id, d.id;
END
$$;


--
-- Name: attach_receipt_signature(uuid, text, jsonb); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.attach_receipt_signature(p_receipt_id uuid, p_payload_digest_sha256 text, p_signature jsonb) RETURNS TABLE(outcome text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_actor record;
  v_receipt record;
  v_key evidence.signing_key%ROWTYPE;
  v_accepted_at timestamptz;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RETURN QUERY SELECT 'unauthorized'::text; RETURN;
  END IF;
  -- One check per statement, so no part runs on a value of the wrong type.
  IF p_receipt_id IS NULL OR p_payload_digest_sha256 IS NULL OR p_payload_digest_sha256 !~ '^[0-9a-f]{64}$'
     OR p_signature IS NULL OR pg_catalog.jsonb_typeof(p_signature) <> 'object' THEN
    RETURN QUERY SELECT 'invalid'::text; RETURN;
  END IF;
  -- The envelope of the receipt verifier: exactly these keys, Ed25519, raw,
  -- and 64 signature bytes in canonical unpadded base64url.
  IF (SELECT pg_catalog.array_agg(k ORDER BY k COLLATE "C") FROM pg_catalog.jsonb_object_keys(p_signature) AS k)
     IS DISTINCT FROM ARRAY['algorithm', 'keyId', 'keyVersion', 'signatureBase64Url', 'signatureEncoding'] THEN
    RETURN QUERY SELECT 'invalid'::text; RETURN;
  END IF;
  IF p_signature->'algorithm' <> '"Ed25519"'::jsonb OR p_signature->'signatureEncoding' <> '"raw"'::jsonb
     OR pg_catalog.jsonb_typeof(p_signature->'keyId') <> 'string'
     OR pg_catalog.jsonb_typeof(p_signature->'keyVersion') <> 'string'
     OR pg_catalog.jsonb_typeof(p_signature->'signatureBase64Url') <> 'string'
     OR (p_signature->>'signatureBase64Url') !~ '^[A-Za-z0-9_-]{85}[AQgw]$' THEN
    RETURN QUERY SELECT 'invalid'::text; RETURN;
  END IF;

  SELECT r.id, r.institution_id, r.evidence_domain_id, r.status, r.receipt_payload, r.xmin AS written_by
    INTO v_receipt
    FROM evidence.receipt r
   WHERE r.id = p_receipt_id AND r.institution_id = v_actor.institution_id AND r.principal_id = v_actor.user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text; RETURN;
  END IF;
  IF v_receipt.status <> 'pending_signature' THEN
    RETURN QUERY SELECT 'already_signed'::text; RETURN;
  END IF;
  IF NOT evidence.inserted_by_current_transaction(v_receipt.written_by) THEN
    RETURN QUERY SELECT 'other_transaction'::text; RETURN;
  END IF;
  IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_receipt.receipt_payload, 'UTF8')), 'hex')
     <> p_payload_digest_sha256 THEN
    RETURN QUERY SELECT 'digest_mismatch'::text; RETURN;
  END IF;

  -- Held until commit, so a revocation waits for this signature.
  SELECT k.* INTO v_key FROM evidence.signing_key k WHERE k.key_id = p_signature->>'keyId' FOR SHARE;
  IF NOT FOUND OR v_key.key_version <> p_signature->>'keyVersion' THEN
    RETURN QUERY SELECT 'key_unknown'::text; RETURN;
  END IF;
  IF v_key.algorithm <> 'Ed25519' OR v_key.purpose <> 'receipt'
     OR v_key.evidence_domain_id <> v_receipt.evidence_domain_id OR v_key.institution_id <> v_receipt.institution_id THEN
    RETURN QUERY SELECT 'key_scope'::text; RETURN;
  END IF;
  IF v_key.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'key_revoked'::text; RETURN;
  END IF;
  v_accepted_at := (v_receipt.receipt_payload::jsonb->>'acceptedAt')::timestamptz;
  IF pg_catalog.clock_timestamp() < v_key.valid_from
     OR (v_key.valid_to IS NOT NULL AND v_accepted_at >= v_key.valid_to) THEN
    RETURN QUERY SELECT 'key_not_valid'::text; RETURN;
  END IF;

  UPDATE evidence.receipt
     SET status = 'signed', signature = p_signature, key_id = v_key.key_id
   WHERE id = v_receipt.id AND institution_id = v_receipt.institution_id;
  RETURN QUERY SELECT 'signed'::text;
END
$_$;


--
-- Name: attach_submission_receipt(uuid, text, jsonb); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.attach_submission_receipt(p_issuance_id uuid, p_payload_digest_sha256 text, p_signature jsonb) RETURNS TABLE(outcome text, receipt_payload text, payload_digest_sha256 text, signature jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_actor record;
  v_issuance evidence.submission_receipt_issuance%ROWTYPE;
  v_assignment_id uuid;
  v_key evidence.signing_key%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RETURN QUERY SELECT 'unauthorized'::text,NULL::text,NULL::text,NULL::jsonb; RETURN;
  END IF;
  -- The envelope of attach_receipt_signature: exactly these keys, Ed25519,
  -- raw, and 64 signature bytes in canonical unpadded base64url.
  IF p_issuance_id IS NULL OR p_payload_digest_sha256 IS NULL OR p_payload_digest_sha256 !~ '^[0-9a-f]{64}$'
     OR p_signature IS NULL OR pg_catalog.jsonb_typeof(p_signature)<>'object' THEN
    RETURN QUERY SELECT 'invalid'::text,NULL::text,NULL::text,NULL::jsonb; RETURN;
  END IF;
  IF (SELECT pg_catalog.array_agg(k ORDER BY k COLLATE "C") FROM pg_catalog.jsonb_object_keys(p_signature) AS k)
     IS DISTINCT FROM ARRAY['algorithm','keyId','keyVersion','signatureBase64Url','signatureEncoding'] THEN
    RETURN QUERY SELECT 'invalid'::text,NULL::text,NULL::text,NULL::jsonb; RETURN;
  END IF;
  IF p_signature->'algorithm'<>'"Ed25519"'::jsonb OR p_signature->'signatureEncoding'<>'"raw"'::jsonb
     OR pg_catalog.jsonb_typeof(p_signature->'keyId')<>'string'
     OR pg_catalog.jsonb_typeof(p_signature->'keyVersion')<>'string'
     OR pg_catalog.jsonb_typeof(p_signature->'signatureBase64Url')<>'string'
     OR (p_signature->>'signatureBase64Url') !~ '^[A-Za-z0-9_-]{85}[AQgw]$' THEN
    RETURN QUERY SELECT 'invalid'::text,NULL::text,NULL::text,NULL::jsonb; RETURN;
  END IF;

  SELECT i.* INTO v_issuance FROM evidence.submission_receipt_issuance i
    WHERE i.id=p_issuance_id AND i.institution_id=v_actor.institution_id AND i.principal_id=v_actor.user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text,NULL::text,NULL::text,NULL::jsonb; RETURN;
  END IF;
  SELECT s.assignment_id INTO v_assignment_id FROM evidence.submission s
    WHERE s.id=v_issuance.submission_id AND s.institution_id=v_issuance.institution_id;
  -- prepare_submission_receipt's lock order: membership, then the key. The
  -- submission row in between serializes two binds of the same submission.
  PERFORM 1 FROM app.lock_student_assignment(v_assignment_id);
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text,NULL::text,NULL::text,NULL::jsonb; RETURN;
  END IF;
  PERFORM 1 FROM evidence.submission s
    WHERE s.id=v_issuance.submission_id AND s.institution_id=v_issuance.institution_id FOR NO KEY UPDATE;
  -- Held until commit, so a revocation waits for this bind.
  SELECT k.* INTO v_key FROM evidence.signing_key k WHERE k.key_id=v_issuance.key_id FOR SHARE;

  IF EXISTS (SELECT 1 FROM evidence.submission_receipt r WHERE r.submission_id=v_issuance.submission_id) THEN
    RETURN QUERY SELECT 'existing'::text,r.receipt_payload,r.payload_digest_sha256,r.signature
      FROM evidence.submission_receipt r WHERE r.submission_id=v_issuance.submission_id;
    RETURN;
  END IF;
  IF p_payload_digest_sha256<>v_issuance.payload_digest_sha256 THEN
    RETURN QUERY SELECT 'digest_mismatch'::text,NULL::text,NULL::text,NULL::jsonb; RETURN;
  END IF;
  IF p_signature->>'keyId'<>v_issuance.key_id OR p_signature->>'keyVersion'<>v_issuance.key_version THEN
    RETURN QUERY SELECT 'key_mismatch'::text,NULL::text,NULL::text,NULL::jsonb; RETURN;
  END IF;
  IF v_key.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'key_revoked'::text,NULL::text,NULL::text,NULL::jsonb; RETURN;
  END IF;
  -- Valid at the frozen signedAt and still valid now, by a fresh DB clock.
  IF v_key.valid_from>v_issuance.signed_at
     OR (v_key.valid_to IS NOT NULL AND (v_issuance.signed_at>=v_key.valid_to
         OR pg_catalog.clock_timestamp()>=v_key.valid_to)) THEN
    RETURN QUERY SELECT 'key_not_valid'::text,NULL::text,NULL::text,NULL::jsonb; RETURN;
  END IF;

  RETURN QUERY INSERT INTO evidence.submission_receipt AS r
    (submission_id,institution_id,principal_id,issuance_id,key_id,key_version,signed_at,
     receipt_payload,payload_digest_sha256,signature)
    VALUES(v_issuance.submission_id,v_issuance.institution_id,v_issuance.principal_id,v_issuance.id,
      v_issuance.key_id,v_issuance.key_version,v_issuance.signed_at,v_issuance.receipt_payload,
      v_issuance.payload_digest_sha256,p_signature)
    RETURNING 'attached'::text,r.receipt_payload,r.payload_digest_sha256,r.signature;
END
$_$;


--
-- Name: commit_evidence_segment(text, text, bigint, text, text, jsonb, text, text, text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.commit_evidence_segment(p_evidence_package_id text, p_client_request_id text, p_expected_revision bigint, p_initial_document_hash text, p_final_document_hash text, p_descriptor jsonb, p_payload_sha256 text, p_storage_ref text, p_snapshot text) RETURNS TABLE(outcome text, committed_revision bigint, receipt_payload text, receipt_id uuid, signature jsonb, current_revision bigint, document_hash text, head_segment_hash text, last_sequence_to bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


--
-- Name: current_actor(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.current_actor(OUT user_id uuid, OUT institution_id uuid) RETURNS record
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  WITH t AS (
    SELECT pg_catalog.current_setting('app.session_token', true) AS token
  )
  SELECT s.user_id, s.institution_id
  FROM t
  JOIN identity.session s
    ON s.token_hash = pg_catalog.sha256(pg_catalog.convert_to(t.token, 'UTF8'))
  WHERE t.token ~ '^[A-Za-z0-9_-]{43}$'
    AND s.closed_at IS NULL
    AND s.expires_at > pg_catalog.now()
    AND s.last_seen_at > pg_catalog.now() - interval '2 hours'
$_$;


--
-- Name: current_institution_id(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.current_institution_id() RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$ SELECT (app.current_actor()).institution_id $$;


--
-- Name: current_user_id(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.current_user_id() RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$ SELECT (app.current_actor()).user_id $$;


--
-- Name: document_submitted(text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.document_submitted(p_document_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
      FROM app.current_actor() a
      JOIN evidence.submission_request r ON r.institution_id = a.institution_id
      JOIN evidence.submission s ON s.submission_request_id = r.id AND s.institution_id = r.institution_id
     WHERE r.document_id = p_document_id
  )
$$;


--
-- Name: evidence_commit_context(text, text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.evidence_commit_context(p_document_id text, p_client_transaction_id text) RETURNS TABLE(outcome text, evidence_package_id text, institution_id uuid, evidence_domain_id uuid, evidence_profile_id text, max_payload_bytes integer, transaction_known boolean, current_revision bigint, document_hash text, head_segment_hash text, last_sequence_to bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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


--
-- Name: fast_path_works(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.fast_path_works(p_assignment_id uuid) RETURNS TABLE(student_id uuid, given_name text, family_name text, document_id text, submitted boolean, revision bigint, evidence_package_id text, head_segment_hash text, segment_hashes text[], body text, institution_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
DECLARE
  -- P-03 (docs/DECISIONS.md); a constant, so changing the threshold is cheap.
  c_window CONSTANT interval := interval '5 minutes';
  v_actor record;
  v_window evidence.fast_path_window%ROWTYPE;
  v_works jsonb := '{}'::jsonb;
  v_student record;
  v_doc record;
  v_record record;
  v_count integer;
  v_head record;
  v_entry jsonb;
  v_revision bigint;
  v_document_id text;
  v_package_id text;
  v_head_hash text;
  v_hashes text[];
  v_submitted boolean;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  -- Not the teacher of the assignment, or no students: no rows and no window.
  IF NOT EXISTS (SELECT 1 FROM app.teacher_assignment_students(p_assignment_id)) THEN
    RETURN;
  END IF;

  SELECT w.* INTO v_window FROM evidence.fast_path_window w
   WHERE w.reader_id = v_actor.user_id AND w.assignment_id = p_assignment_id
     AND w.institution_id = v_actor.institution_id
     FOR UPDATE;
  IF NOT FOUND OR v_window.opened_at + c_window <= pg_catalog.now() THEN
    -- A new window: per work, the revision the summary is derived from now.
    FOR v_doc IN
      SELECT d.id, d.institution_id, d.principal_id
        FROM app.teacher_assignment_students(p_assignment_id) s
        JOIN evidence.project p
          ON p.assignment_id = p_assignment_id AND p.institution_id = v_actor.institution_id
         AND p.principal_id = s.student_id
        JOIN evidence.document d
          ON d.project_id = p.id AND d.institution_id = p.institution_id AND d.principal_id = p.principal_id
    LOOP
      -- The submission flag and the cut revision come from one statement, so one
      -- snapshot: process_summary_record is STABLE and sees the caller's snapshot.
      -- Two statements could pair a pre-submission head with submitted = true.
      v_count := 0;
      FOR v_record IN
        SELECT r.head_segment_hash, r.segment_hashes, EXISTS (
                 SELECT 1 FROM evidence.submission b
                  WHERE b.assignment_id = p_assignment_id AND b.institution_id = v_doc.institution_id
                    AND b.principal_id = v_doc.principal_id) AS submitted
          FROM app.process_summary_record(v_doc.id) r
      LOOP
        v_count := v_count + 1;
        v_head_hash := v_record.head_segment_hash;
        v_hashes := v_record.segment_hashes;
        v_submitted := v_record.submitted;
      END LOOP;
      IF v_count <> 1 OR v_head_hash IS DISTINCT FROM v_hashes[pg_catalog.cardinality(v_hashes)] THEN
        RAISE EXCEPTION 'work unavailable' USING ERRCODE = 'ZD503';
      END IF;
      IF v_head_hash IS NULL THEN
        v_entry := pg_catalog.jsonb_build_object('revision', 0);
      ELSE
        SELECT pg_catalog.count(*)::integer, pg_catalog.min((rc.receipt_payload::jsonb ->> 'revision')::bigint)
          INTO v_count, v_revision
          FROM evidence.package k
          JOIN evidence.segment sg ON sg.evidence_package_id = k.id AND sg.institution_id = k.institution_id
          JOIN evidence.receipt rc
            ON rc.segment_id = sg.id AND rc.evidence_package_id = sg.evidence_package_id
           AND rc.institution_id = sg.institution_id
         WHERE k.document_id = v_doc.id AND k.institution_id = v_doc.institution_id
           AND sg.segment_hash = v_head_hash
           AND pg_catalog.jsonb_typeof(rc.receipt_payload::jsonb -> 'revision') = 'number';
        IF v_count <> 1 THEN
          RAISE EXCEPTION 'work unavailable' USING ERRCODE = 'ZD503';
        END IF;
        v_entry := pg_catalog.jsonb_build_object('revision', v_revision);
      END IF;
      v_works := v_works || pg_catalog.jsonb_build_object(v_doc.id, v_entry || pg_catalog.jsonb_build_object(
        'submitted', v_submitted));
    END LOOP;
    -- A concurrent first read of the same teacher may have opened it already.
    INSERT INTO evidence.fast_path_window AS w (reader_id, institution_id, assignment_id, opened_at, works)
    VALUES (v_actor.user_id, v_actor.institution_id, p_assignment_id, pg_catalog.now(), v_works)
    ON CONFLICT (reader_id, assignment_id) DO UPDATE
      SET opened_at = EXCLUDED.opened_at, works = EXCLUDED.works
      WHERE w.opened_at + c_window <= EXCLUDED.opened_at;
    SELECT w.* INTO STRICT v_window FROM evidence.fast_path_window w
     WHERE w.reader_id = v_actor.user_id AND w.assignment_id = p_assignment_id;
  END IF;

  FOR v_student IN
    SELECT n.student_id, n.given_name, n.family_name
      FROM app.teacher_assignment_student_names(p_assignment_id) n
     ORDER BY n.student_id
  LOOP
    student_id := v_student.student_id;
    -- The caller binds evidence payloads to it; the web role cannot read the actor.
    institution_id := v_actor.institution_id;
    given_name := v_student.given_name;
    family_name := v_student.family_name;
    document_id := NULL; submitted := NULL; revision := NULL;
    evidence_package_id := NULL; head_segment_hash := NULL; segment_hashes := NULL; body := NULL;

    SELECT pg_catalog.count(*)::integer, pg_catalog.min(d.id) INTO v_count, v_document_id
      FROM evidence.project p
      JOIN evidence.document d
        ON d.project_id = p.id AND d.institution_id = p.institution_id AND d.principal_id = p.principal_id
     WHERE p.assignment_id = p_assignment_id AND p.institution_id = v_actor.institution_id
       AND p.principal_id = v_student.student_id;
    IF v_count > 1 THEN
      RAISE EXCEPTION 'work unavailable' USING ERRCODE = 'ZD503';
    END IF;
    v_entry := v_window.works -> v_document_id;
    IF v_entry IS NULL THEN
      -- No work, or one created within the window: no record yet.
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_revision := (v_entry ->> 'revision')::bigint;
    SELECT pg_catalog.count(*)::integer, pg_catalog.min(k.id) INTO v_count, v_package_id
      FROM evidence.package k
     WHERE k.document_id = v_document_id AND k.institution_id = v_actor.institution_id;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'work unavailable' USING ERRCODE = 'ZD503';
    END IF;
    document_id := v_document_id;
    submitted := (v_entry ->> 'submitted')::boolean;
    revision := v_revision;
    evidence_package_id := v_package_id;
    IF v_revision = 0 THEN
      segment_hashes := ARRAY[]::text[];
    ELSE
      -- The segment whose receipt names the window's revision, and the
      -- listing up to it, as read_submission_record cuts at a revision.
      SELECT pg_catalog.count(*)::integer AS n, pg_catalog.min(sg.segment_hash) AS hash,
             pg_catalog.min(sg.sequence_from) AS sequence_from
        INTO v_head
        FROM evidence.segment sg
        JOIN evidence.receipt rc
          ON rc.segment_id = sg.id AND rc.evidence_package_id = sg.evidence_package_id
         AND rc.institution_id = sg.institution_id
       WHERE sg.evidence_package_id = v_package_id AND sg.institution_id = v_actor.institution_id
         AND pg_catalog.jsonb_typeof(rc.receipt_payload::jsonb -> 'revision') = 'number'
         AND (rc.receipt_payload::jsonb ->> 'revision')::numeric = v_revision;
      IF v_head.n <> 1 THEN
        RAISE EXCEPTION 'work unavailable' USING ERRCODE = 'ZD503';
      END IF;
      head_segment_hash := v_head.hash;
      SELECT pg_catalog.array_agg(sg.segment_hash ORDER BY sg.sequence_from) INTO segment_hashes
        FROM evidence.segment sg
       WHERE sg.evidence_package_id = v_package_id AND sg.institution_id = v_actor.institution_id
         AND sg.sequence_from <= v_head.sequence_from;
    END IF;
    SELECT c.body INTO body FROM evidence.document_checkpoint c
     WHERE c.document_id = v_document_id AND c.institution_id = v_actor.institution_id
       AND c.revision = v_revision;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'work unavailable' USING ERRCODE = 'ZD503';
    END IF;
    PERFORM app.record_fast_path_opening(v_document_id);
    RETURN NEXT;
  END LOOP;
END
$$;


--
-- Name: lock_student_assignment(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.lock_student_assignment(p_assignment_id uuid) RETURNS TABLE(current_version integer, opens_at timestamp with time zone, acknowledged boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_actor record;
  v_assignment institution.assignment%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RETURN;
  END IF;
  SELECT a.* INTO v_assignment FROM institution.assignment a
   WHERE a.id = p_assignment_id AND a.institution_id = v_actor.institution_id
   FOR SHARE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_assignment.course_id IS NOT NULL THEN
    PERFORM 1 FROM institution.course_member m
     WHERE m.course_id = v_assignment.course_id AND m.institution_id = v_actor.institution_id
       AND m.user_id = v_actor.user_id AND m.role = 'student' AND m.member_to IS NULL
     FOR SHARE;
  ELSE
    -- Only while the mentor holds the teacher role, confirmed and not revoked
    -- (#916, invariant 3): a mentor without it closes the student's path as
    -- it closes the mentor's lists. The role row is held FOR SHARE with the
    -- mentorship, so revoking the role waits for an acceptance in progress.
    PERFORM 1 FROM institution.mentorship s
      JOIN institution.institution_role r
        ON r.user_id = s.mentor_id AND r.institution_id = s.institution_id AND r.role = 'teacher'
       AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
     WHERE s.id = v_assignment.mentorship_id AND s.institution_id = v_actor.institution_id
       AND s.student_id = v_actor.user_id AND s.ended_at IS NULL
     FOR SHARE;
  END IF;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT v.version_no, v.opens_at, EXISTS (
           SELECT 1 FROM institution.notice_acknowledgment n
            WHERE n.assignment_id = v.assignment_id AND n.version_no = v.version_no
              AND n.student_id = v_actor.user_id AND n.institution_id = v_actor.institution_id)
    FROM institution.assignment_version v
   WHERE v.assignment_id = v_assignment.id AND v.version_no = v_assignment.current_version;
END
$$;


--
-- Name: open_student_work(uuid, boolean); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.open_student_work(p_assignment_id uuid, p_start boolean DEFAULT true) RETURNS TABLE(outcome text, document_id text, evidence_profile_id text, current_revision bigint, document_hash text, head_segment_hash text, last_sequence_to bigint, snapshot text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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
    -- F-137: only a request that asks to start makes the work; any other
    -- call opens an existing work and writes nothing.
    IF p_start IS NOT TRUE THEN
      RETURN QUERY SELECT 'not_started'::text, NULL::text, NULL::text, NULL::bigint, NULL::text, NULL::text,
        NULL::bigint, NULL::text;
      RETURN;
    END IF;
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


--
-- Name: prepare_submission_receipt(uuid, text, text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.prepare_submission_receipt(p_submission_id uuid, p_key_id text, p_key_version text) RETURNS TABLE(outcome text, issuance_id uuid, receipt_payload text, payload_digest_sha256 text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_actor record;
  v_submission evidence.submission%ROWTYPE;
  v_record record;
  v_key evidence.signing_key%ROWTYPE;
  v_time timestamptz;
  v_payload text;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RETURN QUERY SELECT 'unauthorized'::text,NULL::uuid,NULL::text,NULL::text; RETURN;
  END IF;
  IF p_submission_id IS NULL OR p_key_id IS NULL OR p_key_version IS NULL
     OR length(p_key_id) NOT BETWEEN 1 AND 256 OR length(p_key_version) NOT BETWEEN 1 AND 256 THEN
    RETURN QUERY SELECT 'invalid'::text,NULL::uuid,NULL::text,NULL::text; RETURN;
  END IF;
  SELECT s.* INTO v_submission FROM evidence.submission s
    WHERE s.id=p_submission_id AND s.institution_id=v_actor.institution_id AND s.principal_id=v_actor.user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unauthorized'::text,NULL::uuid,NULL::text,NULL::text; RETURN;
  END IF;
  -- Match record_submission's lock order: membership before the key.
  PERFORM 1 FROM app.lock_student_assignment(v_submission.assignment_id);
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unauthorized'::text,NULL::uuid,NULL::text,NULL::text; RETURN;
  END IF;
  SELECT * INTO v_record FROM app.read_submission_record(v_submission.submission_request_id);
  IF v_record.outcome IS DISTINCT FROM 'found' OR v_record.revision IS DISTINCT FROM v_submission.revision
     OR v_record.content_hash IS DISTINCT FROM v_submission.artifact_hash
     OR v_submission.revision NOT BETWEEN 1 AND 9007199254740991 THEN
    RETURN QUERY SELECT 'unavailable'::text,NULL::uuid,NULL::text,NULL::text; RETURN;
  END IF;
  SELECT k.* INTO v_key FROM evidence.signing_key k WHERE k.key_id=p_key_id FOR SHARE;
  -- clock_timestamp, after reconstruction/record and while holding the key:
  -- transaction-start now() would backdate an issuance that waited on locks.
  v_time:=pg_catalog.clock_timestamp();
  IF NOT FOUND OR v_key.key_version<>p_key_version OR v_key.purpose<>'receipt' OR v_key.algorithm<>'Ed25519'
     OR v_key.institution_id<>v_actor.institution_id OR v_key.evidence_domain_id<>v_record.evidence_domain_id
     OR v_key.revoked_at IS NOT NULL OR v_time<v_key.valid_from
     OR (v_key.valid_to IS NOT NULL AND v_time>=v_key.valid_to) OR v_time<v_submission.requested_at THEN
    RETURN QUERY SELECT 'key_unavailable'::text,NULL::uuid,NULL::text,NULL::text; RETURN;
  END IF;
  -- Flat, fixed ASCII keys in UTF16 order; to_json escapes each string without
  -- whitespace or Unicode normalization. UTC6 preserves database microseconds.
  v_payload:=pg_catalog.format(
    '{"afterDeadline":%s,"artifactSha256":%s,"assignmentId":%s,"assignmentVersion":%s,"documentId":%s,'
    '"dueAt":%s,"evidenceDomainId":%s,"evidenceHeadSegmentHash":%s,"evidencePackageId":%s,'
    '"evidenceRecord":"continuous","principalId":%s,"receiptSchema":"ductus-submission-receipt-v2",'
    '"requestedAt":%s,"revision":%s,"signedAt":%s,"submissionId":%s}',
    v_submission.after_deadline::text,pg_catalog.to_json(v_submission.artifact_hash)::text,
    pg_catalog.to_json(v_submission.assignment_id)::text,v_submission.assignment_version,
    pg_catalog.to_json(v_record.document_id)::text,
    pg_catalog.to_json(pg_catalog.to_char(v_submission.due_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,
    pg_catalog.to_json(v_record.evidence_domain_id)::text,pg_catalog.to_json(v_record.head_segment_hash)::text,
    pg_catalog.to_json(v_record.evidence_package_id)::text,pg_catalog.to_json(v_submission.principal_id)::text,
    pg_catalog.to_json(pg_catalog.to_char(v_submission.requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,
    v_submission.revision,pg_catalog.to_json(pg_catalog.to_char(v_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,
    pg_catalog.to_json(v_submission.id)::text);
  RETURN QUERY INSERT INTO evidence.submission_receipt_issuance AS i
    (submission_id,institution_id,principal_id,key_id,key_version,signed_at,receipt_payload,payload_digest_sha256)
    VALUES(v_submission.id,v_actor.institution_id,v_actor.user_id,v_key.key_id,v_key.key_version,v_time,v_payload,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_payload,'UTF8')),'hex'))
    RETURNING 'prepared'::text,i.id,i.receipt_payload,i.payload_digest_sha256;
END
$$;


--
-- Name: process_summary_record(text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.process_summary_record(p_document_id text) RETURNS TABLE(evidence_package_id text, head_segment_hash text, segment_hashes text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p.id,
         CASE WHEN sub.revision IS NULL THEN p.head_segment_hash ELSE coalesce(cut.segment_hash, '') END,
         coalesce((
           SELECT array_agg(s.segment_hash ORDER BY s.sequence_from)
             FROM evidence.segment s
            WHERE s.evidence_package_id = p.id AND s.institution_id = p.institution_id
              AND (sub.revision IS NULL OR cut.sequence_from IS NULL OR s.sequence_from <= cut.sequence_from)),
           ARRAY[]::text[])
    FROM evidence.package p
    -- The submission of this document, if any (one per student and assignment).
    LEFT JOIN LATERAL (
      SELECT s.revision
        FROM evidence.submission s
        JOIN evidence.submission_request r ON r.id = s.submission_request_id AND r.institution_id = s.institution_id
       WHERE r.document_id = p.document_id AND r.institution_id = p.institution_id
    ) sub ON true
    -- The last segment whose receipt names the submitted revision.
    LEFT JOIN LATERAL (
      SELECT s.segment_hash, s.sequence_from
        FROM evidence.segment s
        JOIN evidence.receipt r
          ON r.segment_id = s.id AND r.evidence_package_id = s.evidence_package_id AND r.institution_id = s.institution_id
       WHERE sub.revision IS NOT NULL
         AND s.evidence_package_id = p.id AND s.institution_id = p.institution_id
         AND pg_catalog.jsonb_typeof(r.receipt_payload::jsonb -> 'revision') = 'number'
         AND (r.receipt_payload::jsonb ->> 'revision')::numeric = sub.revision
       ORDER BY s.sequence_from DESC
       LIMIT 1
    ) cut ON true
   WHERE p.document_id = p_document_id
$$;


--
-- Name: read_process_summary_source(text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.read_process_summary_source(p_document_id text) RETURNS TABLE(outcome text, institution_id uuid, evidence_package_id text, segment_hashes text[])
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_scope record;
  v_role text;
  v_record record;
  v_head text;
  v_packages integer := 0;
BEGIN
  -- The session first, before the input: no session is ZD401 whatever is asked.
  PERFORM institution.require_actor();
  IF p_document_id IS NULL OR length(p_document_id) NOT BETWEEN 1 AND 256
     OR p_document_id ~ '[[:cntrl:]]' OR p_document_id <> pg_catalog.btrim(p_document_id) THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::text[];
    RETURN;
  END IF;
  SELECT * INTO v_scope FROM collaboration.document_scope(p_document_id);
  v_role := collaboration.actor_role(v_scope.institution_id, v_scope.assignment_id, v_scope.principal_id);
  IF v_scope.institution_id IS NULL OR v_role IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::text[];
    RETURN;
  END IF;
  IF v_role = 'teacher' THEN
    PERFORM audit.record_work_opening(v_scope.institution_id, p_document_id, v_scope.assignment_id,
                                      v_scope.principal_id, 'process_summary');
  END IF;

  FOR v_record IN
    SELECT r.evidence_package_id, r.head_segment_hash, r.segment_hashes
      FROM app.process_summary_record(p_document_id) r
  LOOP
    v_packages := v_packages + 1;
    IF v_packages > 1 THEN
      EXIT;
    END IF;
    evidence_package_id := v_record.evidence_package_id;
    v_head := v_record.head_segment_hash;
    segment_hashes := v_record.segment_hashes;
  END LOOP;
  IF v_packages <> 1
     OR v_head IS DISTINCT FROM segment_hashes[pg_catalog.cardinality(segment_hashes)] THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::text, NULL::text[];
    RETURN;
  END IF;
  RETURN QUERY SELECT 'found'::text, v_scope.institution_id::uuid, evidence_package_id, segment_hashes;
END
$$;


--
-- Name: read_replay_checkpoints(text, text[]); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.read_replay_checkpoints(p_document_id text, p_content_hashes text[]) RETURNS TABLE(content_hash text, body text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_scope record;
  v_role text;
BEGIN
  PERFORM institution.require_actor();
  IF p_content_hashes IS NULL OR pg_catalog.cardinality(p_content_hashes) NOT BETWEEN 1 AND 512
     OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_content_hashes) AS h (hash)
                 WHERE h.hash IS NULL OR h.hash !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF p_document_id IS NULL OR length(p_document_id) NOT BETWEEN 1 AND 256
     OR p_document_id ~ '[[:cntrl:]]' OR p_document_id <> pg_catalog.btrim(p_document_id) THEN
    RETURN;
  END IF;
  SELECT * INTO v_scope FROM collaboration.document_scope(p_document_id);
  v_role := collaboration.actor_role(v_scope.institution_id, v_scope.assignment_id, v_scope.principal_id);
  IF v_scope.institution_id IS NULL OR v_role IS NULL THEN
    RETURN;
  END IF;
  IF v_role = 'teacher' THEN
    PERFORM audit.record_work_opening(v_scope.institution_id, p_document_id, v_scope.assignment_id,
                                      v_scope.principal_id, 'replay');
  END IF;
  RETURN QUERY SELECT c.content_hash, c.body FROM app.replay_document_checkpoints(p_document_id, p_content_hashes) c;
END
$_$;


--
-- Name: read_replay_source(text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.read_replay_source(p_document_id text) RETURNS TABLE(outcome text, institution_id uuid, evidence_package_id text, segment_hashes text[])
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_scope record;
  v_role text;
  v_record record;
  v_head text;
  v_packages integer := 0;
BEGIN
  -- The session first, before the input: no session is ZD401 whatever is asked.
  PERFORM institution.require_actor();
  IF p_document_id IS NULL OR length(p_document_id) NOT BETWEEN 1 AND 256
     OR p_document_id ~ '[[:cntrl:]]' OR p_document_id <> pg_catalog.btrim(p_document_id) THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::text[];
    RETURN;
  END IF;
  SELECT * INTO v_scope FROM collaboration.document_scope(p_document_id);
  v_role := collaboration.actor_role(v_scope.institution_id, v_scope.assignment_id, v_scope.principal_id);
  IF v_scope.institution_id IS NULL OR v_role IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::text[];
    RETURN;
  END IF;
  IF v_role = 'teacher' THEN
    PERFORM audit.record_work_opening(v_scope.institution_id, p_document_id, v_scope.assignment_id,
                                      v_scope.principal_id, 'replay');
  END IF;

  FOR v_record IN
    SELECT r.evidence_package_id, r.head_segment_hash, r.segment_hashes
      FROM app.process_summary_record(p_document_id) r
  LOOP
    v_packages := v_packages + 1;
    IF v_packages > 1 THEN
      EXIT;
    END IF;
    evidence_package_id := v_record.evidence_package_id;
    v_head := v_record.head_segment_hash;
    segment_hashes := v_record.segment_hashes;
  END LOOP;
  IF v_packages <> 1
     OR v_head IS DISTINCT FROM segment_hashes[pg_catalog.cardinality(segment_hashes)] THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::text, NULL::text[];
    RETURN;
  END IF;
  RETURN QUERY SELECT 'found'::text, v_scope.institution_id::uuid, evidence_package_id, segment_hashes;
END
$$;


--
-- Name: read_submission_receipt(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.read_submission_receipt(p_submission_id uuid) RETURNS TABLE(outcome text, receipt_payload text, payload_digest_sha256 text, signature jsonb)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_actor record;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RETURN QUERY SELECT 'unauthorized'::text,NULL::text,NULL::text,NULL::jsonb; RETURN;
  END IF;
  PERFORM 1 FROM evidence.submission s
    WHERE s.id=p_submission_id AND s.institution_id=v_actor.institution_id AND s.principal_id=v_actor.user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text,NULL::text,NULL::text,NULL::jsonb; RETURN;
  END IF;
  RETURN QUERY SELECT 'found'::text,r.receipt_payload,r.payload_digest_sha256,r.signature
    FROM evidence.submission_receipt r
    WHERE r.submission_id=p_submission_id AND r.institution_id=v_actor.institution_id
      AND r.principal_id=v_actor.user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'none'::text,NULL::text,NULL::text,NULL::jsonb;
  END IF;
END
$$;


--
-- Name: read_submission_record(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.read_submission_record(p_submission_request_id uuid) RETURNS TABLE(outcome text, institution_id uuid, evidence_package_id text, evidence_domain_id uuid, document_id text, principal_id uuid, revision bigint, content_hash text, head_segment_hash text, segment_count integer, segments jsonb)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_actor record;
  v_request evidence.submission_request%ROWTYPE;
  v_package evidence.package%ROWTYPE;
  v_packages integer;
  v_head record;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RETURN QUERY SELECT 'unauthenticated'::text, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::uuid,
      NULL::bigint, NULL::text, NULL::text, NULL::integer, NULL::jsonb;
    RETURN;
  END IF;
  SELECT s.* INTO v_request
    FROM evidence.submission_request s
   WHERE s.id = p_submission_request_id AND s.institution_id = v_actor.institution_id
     AND s.principal_id = v_actor.user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::uuid,
      NULL::bigint, NULL::text, NULL::text, NULL::integer, NULL::jsonb;
    RETURN;
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_packages
    FROM evidence.package k
   WHERE k.document_id = v_request.document_id AND k.institution_id = v_request.institution_id;
  SELECT k.* INTO v_package
    FROM evidence.package k
   WHERE k.document_id = v_request.document_id AND k.institution_id = v_request.institution_id
     AND k.principal_id = v_request.principal_id;
  -- The last segment whose receipt names the requested revision.
  SELECT s.segment_hash, s.sequence_from INTO v_head
    FROM evidence.segment s
    JOIN evidence.receipt r
      ON r.segment_id = s.id AND r.evidence_package_id = s.evidence_package_id AND r.institution_id = s.institution_id
   WHERE s.evidence_package_id = v_package.id AND s.institution_id = v_package.institution_id
     AND pg_catalog.jsonb_typeof(r.receipt_payload::jsonb -> 'revision') = 'number'
     AND (r.receipt_payload::jsonb ->> 'revision')::numeric = v_request.revision
   ORDER BY s.sequence_from DESC
   LIMIT 1;
  IF v_packages <> 1 OR v_package.id IS NULL OR v_head.segment_hash IS NULL THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::uuid,
      NULL::bigint, NULL::text, NULL::text, NULL::integer, NULL::jsonb;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 'found'::text, v_package.institution_id, v_package.id, v_package.evidence_domain_id, v_request.document_id,
         v_request.principal_id, v_request.revision, v_request.content_hash, v_head.segment_hash,
         pg_catalog.count(*)::integer,
         pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'segmentHash', s.segment_hash, 'receiptPayload', r.receipt_payload, 'signature', r.signature)
           ORDER BY s.sequence_from)
    FROM evidence.segment s
    JOIN evidence.receipt r
      ON r.segment_id = s.id AND r.evidence_package_id = s.evidence_package_id AND r.institution_id = s.institution_id
   WHERE s.evidence_package_id = v_package.id AND s.institution_id = v_package.institution_id
     AND s.sequence_from <= v_head.sequence_from;
END
$$;


--
-- Name: record_fast_path_opening(text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.record_fast_path_opening(p_document_id text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_scope record;
BEGIN
  SELECT * INTO v_scope FROM collaboration.document_scope(p_document_id);
  IF v_scope.institution_id IS NULL
     OR collaboration.actor_role(v_scope.institution_id, v_scope.assignment_id, v_scope.principal_id)
        IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  PERFORM audit.record_work_opening(v_scope.institution_id, p_document_id, v_scope.assignment_id,
                                    v_scope.principal_id, 'fast_path');
END
$$;


--
-- Name: record_submission(uuid, text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.record_submission(p_submission_request_id uuid, p_artifact_hash text) RETURNS TABLE(outcome text, submission_id uuid, requested_at timestamp with time zone, due_at timestamp with time zone, after_deadline boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


--
-- Name: replay_document_checkpoints(text, text[]); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.replay_document_checkpoints(p_document_id text, p_content_hashes text[]) RETURNS TABLE(content_hash text, body text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT DISTINCT ON (c.content_hash) c.content_hash, c.body
    FROM app.current_actor() a
    JOIN evidence.document_checkpoint c ON c.institution_id = a.institution_id
   WHERE c.document_id = p_document_id
     AND c.content_hash = ANY (p_content_hashes)
     AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(c.body, 'UTF8')), 'hex') = c.content_hash
     AND NOT EXISTS (
       SELECT 1
         FROM evidence.submission s
         JOIN evidence.submission_request r ON r.id = s.submission_request_id AND r.institution_id = s.institution_id
        WHERE r.document_id = c.document_id AND r.institution_id = c.institution_id
          AND c.revision > s.revision)
   ORDER BY c.content_hash, c.revision
$$;


--
-- Name: request_submission(text, bigint); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.request_submission(p_document_id text, p_revision bigint) RETURNS TABLE(outcome text, submission_request_id uuid, requested_at timestamp with time zone, revision bigint, assignment_version integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  -- The click, read before any lock wait (4.6: before reconstruction).
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_actor record;
  v_document evidence.document%ROWTYPE;
  v_project evidence.project%ROWTYPE;
  v_assignment record;
  v_named evidence.document_revision%ROWTYPE;
  v_existing evidence.submission_request%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::timestamptz, NULL::bigint, NULL::integer;
    RETURN;
  END IF;
  IF p_document_id IS NULL OR length(p_document_id) NOT BETWEEN 1 AND 256
     OR p_document_id ~ '[[:cntrl:]]' OR p_document_id <> pg_catalog.btrim(p_document_id)
     OR p_revision IS NULL OR p_revision < 0 OR p_revision > 9007199254740991 THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::timestamptz, NULL::bigint, NULL::integer;
    RETURN;
  END IF;

  SELECT pr.* INTO v_project
    FROM evidence.document d
    JOIN evidence.project pr ON pr.id = d.project_id AND pr.institution_id = d.institution_id
   WHERE d.id = p_document_id AND d.institution_id = v_actor.institution_id
     AND d.principal_id = v_actor.user_id AND pr.principal_id = v_actor.user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::timestamptz, NULL::bigint, NULL::integer;
    RETURN;
  END IF;
  -- Lock order as in commit_evidence_segment: assignment and membership
  -- (FOR SHARE), then the document (FOR UPDATE).
  SELECT * INTO v_assignment FROM app.lock_student_assignment(v_project.assignment_id);
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::timestamptz, NULL::bigint, NULL::integer;
    RETURN;
  END IF;
  SELECT d.* INTO v_document
    FROM evidence.document d
   WHERE d.id = p_document_id AND d.institution_id = v_actor.institution_id
     AND d.principal_id = v_actor.user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::uuid, NULL::timestamptz, NULL::bigint, NULL::integer;
    RETURN;
  END IF;

  SELECT s.* INTO v_existing
    FROM evidence.submission_request s
   WHERE s.assignment_id = v_project.assignment_id AND s.institution_id = v_actor.institution_id
     AND s.principal_id = v_actor.user_id;
  IF FOUND THEN
    RETURN QUERY SELECT 'existing'::text, v_existing.id, v_existing.requested_at, v_existing.revision,
      v_existing.assignment_version;
    RETURN;
  END IF;
  IF NOT v_assignment.acknowledged THEN
    RETURN QUERY SELECT 'not_acknowledged'::text, NULL::uuid, NULL::timestamptz, NULL::bigint, NULL::integer;
    RETURN;
  END IF;
  IF v_assignment.opens_at > v_now THEN
    RETURN QUERY SELECT 'not_open'::text, NULL::uuid, NULL::timestamptz, NULL::bigint, NULL::integer;
    RETURN;
  END IF;
  IF p_revision = 0 OR v_document.current_revision = 0 THEN
    RETURN QUERY SELECT
      CASE WHEN p_revision = v_document.current_revision THEN 'no_evidence' ELSE 'stale_revision' END,
      NULL::uuid, NULL::timestamptz,
      CASE WHEN p_revision = v_document.current_revision THEN NULL::bigint ELSE v_document.current_revision END,
      NULL::integer;
    RETURN;
  END IF;
  -- The named revision must have been the current one at the click: it was
  -- accepted no later than v_now, and it is the current one now or its
  -- successor was accepted after v_now (a commit that held the document while
  -- this request waited for it).
  SELECT r.* INTO v_named
    FROM evidence.document_revision r
   WHERE r.document_id = v_document.id AND r.institution_id = v_document.institution_id
     AND r.revision = p_revision;
  IF NOT FOUND OR v_named.created_at > v_now OR (p_revision <> v_document.current_revision AND NOT EXISTS (
       SELECT 1 FROM evidence.document_revision n
        WHERE n.document_id = v_document.id AND n.institution_id = v_document.institution_id
          AND n.revision = p_revision + 1 AND n.created_at > v_now)) THEN
    RETURN QUERY SELECT 'stale_revision'::text, NULL::uuid, NULL::timestamptz, v_document.current_revision,
      NULL::integer;
    RETURN;
  END IF;

  -- A second document of the same student and assignment can race past the
  -- lookup above; the unique key decides and the loser returns the winner.
  INSERT INTO evidence.submission_request (
    institution_id, assignment_id, assignment_version, project_id, document_id, principal_id,
    revision, content_hash, requested_at
  ) VALUES (
    v_actor.institution_id, v_project.assignment_id, v_assignment.current_version, v_project.id,
    v_document.id, v_actor.user_id, v_named.revision, v_named.content_hash, v_now
  )
  ON CONFLICT (assignment_id, institution_id, principal_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT s.* INTO STRICT v_existing
      FROM evidence.submission_request s
     WHERE s.assignment_id = v_project.assignment_id AND s.institution_id = v_actor.institution_id
       AND s.principal_id = v_actor.user_id;
    RETURN QUERY SELECT 'existing'::text, v_existing.id, v_existing.requested_at, v_existing.revision,
      v_existing.assignment_version;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'requested'::text, v_id, v_now, v_named.revision, v_assignment.current_version;
END
$$;


--
-- Name: submitted_document_text(text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.submitted_document_text(p_document_id text) RETURNS TABLE(content_hash text, body text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT s.artifact_hash, c.body
    FROM app.current_actor() a
    JOIN evidence.submission_request r ON r.institution_id = a.institution_id
    JOIN evidence.submission s ON s.submission_request_id = r.id AND s.institution_id = r.institution_id
    LEFT JOIN evidence.document_checkpoint c
      ON c.document_id = r.document_id AND c.institution_id = r.institution_id AND c.revision = s.revision
     AND c.content_hash = s.artifact_hash
     AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(c.body, 'UTF8')), 'hex') = s.artifact_hash
   WHERE r.document_id = p_document_id
$$;


--
-- Name: teacher_assignment_names(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.teacher_assignment_names(p_assignment_id uuid) RETURNS TABLE(student_id uuid, given_name text, family_name text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_actor record;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  RETURN QUERY
  SELECT n.student_id, n.given_name, n.family_name
    FROM app.teacher_assignment_student_names(p_assignment_id) n
   ORDER BY n.student_id;
END
$$;


--
-- Name: teacher_assignment_student_names(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.teacher_assignment_student_names(p_assignment_id uuid) RETURNS TABLE(student_id uuid, given_name text, family_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT s.student_id, n.given_name, n.family_name
    FROM app.teacher_assignment_students(p_assignment_id) s
    LEFT JOIN identity.person_name n ON n.user_id = s.student_id
$$;


--
-- Name: teacher_assignment_students(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.teacher_assignment_students(p_assignment_id uuid) RETURNS TABLE(student_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT m.user_id
    FROM app.current_actor() a
    JOIN institution.assignment s ON s.id = p_assignment_id AND s.institution_id = a.institution_id
    JOIN institution.course_member m ON m.course_id = s.course_id AND m.institution_id = s.institution_id
   WHERE m.role = 'student' AND m.member_to IS NULL
     AND institution.actor_assignment_role(p_assignment_id) = 'teacher'
  UNION ALL
  SELECT t.student_id
    FROM app.current_actor() a
    JOIN institution.assignment s ON s.id = p_assignment_id AND s.institution_id = a.institution_id
    JOIN institution.mentorship t ON t.id = s.mentorship_id AND t.institution_id = s.institution_id
   WHERE t.ended_at IS NULL
     AND institution.actor_assignment_role(p_assignment_id) = 'teacher'
$$;


--
-- Name: teacher_course_students(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.teacher_course_students(p_course_id uuid) RETURNS TABLE(student_id uuid, given_name text, family_name text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_actor record;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  -- Decided once per call, in the session's institution (actor_course_role).
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RETURN;
  END IF;
  -- One open membership per student and course, so one row per student.
  RETURN QUERY
  SELECT m.user_id, n.given_name, n.family_name
    FROM institution.course_member m
    LEFT JOIN identity.person_name n ON n.user_id = m.user_id AND n.institution_id = m.institution_id
   WHERE m.course_id = p_course_id AND m.institution_id = v_actor.institution_id
     AND m.role = 'student' AND m.member_to IS NULL
   ORDER BY m.user_id;
END
$$;


--
-- Name: work_document_in_assignment(text, uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.work_document_in_assignment(p_document_id text, p_assignment_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
BEGIN
  -- PL/pgSQL, so the names resolve when the caller runs it, with the caller's
  -- rights; the creating role needs no access to institution or evidence.
  RETURN coalesce(
    institution.actor_assignment_role(p_assignment_id) = 'student'
    AND EXISTS (
      SELECT 1
        FROM evidence.document d
        JOIN evidence.project p
          ON p.id = d.project_id AND p.institution_id = d.institution_id AND p.principal_id = d.principal_id
       WHERE d.id = p_document_id
         AND p.assignment_id = p_assignment_id
         AND d.principal_id = (SELECT app.current_user_id())
         AND d.institution_id = (SELECT app.current_institution_id())
    ),
    false);
END
$$;


--
-- Name: work_submitted(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.work_submitted(p_assignment_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
      FROM app.current_actor() a
      JOIN evidence.submission s
        ON s.principal_id = a.user_id AND s.institution_id = a.institution_id
     WHERE s.assignment_id = p_assignment_id
  )
$$;


--
-- Name: worker_attach_receipt_signature(uuid, text, jsonb); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.worker_attach_receipt_signature(p_receipt_id uuid, p_payload_digest_sha256 text, p_signature jsonb) RETURNS TABLE(outcome text, signature jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_receipt record;
  v_key evidence.signing_key%ROWTYPE;
  v_accepted_at timestamptz;
BEGIN
  -- One check per statement, so no part runs on a value of the wrong type.
  IF p_receipt_id IS NULL OR p_payload_digest_sha256 IS NULL OR p_payload_digest_sha256 !~ '^[0-9a-f]{64}$'
     OR p_signature IS NULL OR pg_catalog.jsonb_typeof(p_signature) <> 'object' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::jsonb; RETURN;
  END IF;
  IF (SELECT pg_catalog.array_agg(k ORDER BY k COLLATE "C") FROM pg_catalog.jsonb_object_keys(p_signature) AS k)
     IS DISTINCT FROM ARRAY['algorithm', 'keyId', 'keyVersion', 'signatureBase64Url', 'signatureEncoding'] THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::jsonb; RETURN;
  END IF;
  IF p_signature->'algorithm' <> '"Ed25519"'::jsonb OR p_signature->'signatureEncoding' <> '"raw"'::jsonb
     OR pg_catalog.jsonb_typeof(p_signature->'keyId') <> 'string'
     OR pg_catalog.jsonb_typeof(p_signature->'keyVersion') <> 'string'
     OR pg_catalog.jsonb_typeof(p_signature->'signatureBase64Url') <> 'string'
     OR (p_signature->>'signatureBase64Url') !~ '^[A-Za-z0-9_-]{85}[AQgw]$' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::jsonb; RETURN;
  END IF;

  SELECT r.id, r.institution_id, r.evidence_domain_id, r.status, r.receipt_payload, r.signature
    INTO v_receipt
    FROM evidence.receipt r
   WHERE r.id = p_receipt_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::jsonb; RETURN;
  END IF;
  IF v_receipt.status <> 'pending_signature' THEN
    RETURN QUERY SELECT 'already_signed'::text, v_receipt.signature; RETURN;
  END IF;
  IF (v_receipt.receipt_payload::jsonb ->> 'receiptSchema') IS DISTINCT FROM 'ductus-evidence-receipt-v2' THEN
    RETURN QUERY SELECT 'unsupported_schema'::text, NULL::jsonb; RETURN;
  END IF;
  IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_receipt.receipt_payload, 'UTF8')), 'hex')
     <> p_payload_digest_sha256 THEN
    RETURN QUERY SELECT 'digest_mismatch'::text, NULL::jsonb; RETURN;
  END IF;

  -- Held until commit, so a revocation waits for this signature.
  SELECT k.* INTO v_key FROM evidence.signing_key k WHERE k.key_id = p_signature->>'keyId' FOR SHARE;
  IF NOT FOUND OR v_key.key_version <> p_signature->>'keyVersion' THEN
    RETURN QUERY SELECT 'key_unknown'::text, NULL::jsonb; RETURN;
  END IF;
  IF v_key.algorithm <> 'Ed25519' OR v_key.purpose <> 'receipt'
     OR v_key.evidence_domain_id <> v_receipt.evidence_domain_id OR v_key.institution_id <> v_receipt.institution_id THEN
    RETURN QUERY SELECT 'key_scope'::text, NULL::jsonb; RETURN;
  END IF;
  IF v_key.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'key_revoked'::text, NULL::jsonb; RETURN;
  END IF;
  -- valid_from is compared with the time of signing, never with acceptedAt:
  -- a receipt reserved before a rotation is signed by the new key (N-7).
  -- valid_to binds both: the verifier refuses acceptedAt >= valid_to, and a
  -- retired key never signs again, whatever acceptedAt says, since the
  -- verifier cannot tell that case apart (evidence-receipt-verifier.ts, "a
  -- retired key used after its retirement"; the server rule closes it).
  v_accepted_at := (v_receipt.receipt_payload::jsonb->>'acceptedAt')::timestamptz;
  IF pg_catalog.clock_timestamp() < v_key.valid_from
     OR (v_key.valid_to IS NOT NULL
         AND (v_accepted_at >= v_key.valid_to OR pg_catalog.clock_timestamp() >= v_key.valid_to)) THEN
    RETURN QUERY SELECT 'key_not_valid'::text, NULL::jsonb; RETURN;
  END IF;

  UPDATE evidence.receipt AS r
     SET status = 'signed', signature = p_signature, key_id = v_key.key_id
   WHERE r.id = v_receipt.id AND r.institution_id = v_receipt.institution_id;
  RETURN QUERY SELECT 'signed'::text, p_signature;
END
$_$;


--
-- Name: worker_pending_receipts(uuid, integer); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.worker_pending_receipts(p_evidence_domain_id uuid, p_limit integer) RETURNS TABLE(receipt_id uuid, receipt_payload text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF p_evidence_domain_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid worker request' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT r.id, r.receipt_payload
      FROM evidence.receipt r
     WHERE r.evidence_domain_id = p_evidence_domain_id AND r.status = 'pending_signature'
       AND (r.receipt_payload::jsonb ->> 'receiptSchema') = 'ductus-evidence-receipt-v2'
     ORDER BY r.created_at, r.id
     LIMIT p_limit;
END
$$;


--
-- Name: worker_receipt_keys(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.worker_receipt_keys(p_evidence_domain_id uuid) RETURNS TABLE(key_id text, key_version text, key_base64url text, valid_from timestamp with time zone, valid_to timestamp with time zone, revoked_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF p_evidence_domain_id IS NULL THEN
    RAISE EXCEPTION 'invalid worker request' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT k.key_id, k.key_version, k.key_base64url, k.valid_from, k.valid_to, k.revoked_at
      FROM evidence.signing_key k
     WHERE k.evidence_domain_id = p_evidence_domain_id AND k.purpose = 'receipt' AND k.algorithm = 'Ed25519'
     ORDER BY k.key_id;
END
$$;


--
-- Name: record_work_opening(uuid, text, uuid, uuid, text); Type: FUNCTION; Schema: audit; Owner: -
--

CREATE FUNCTION audit.record_work_opening(p_institution_id uuid, p_document_id text, p_assignment_id uuid, p_owner_id uuid, p_surface text) RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  INSERT INTO audit.access_log (institution_id, document_id, assignment_id, owner_id, reader_id, reader_role, surface, opened_at)
  SELECT p_institution_id, p_document_id, p_assignment_id, p_owner_id, a.user_id, 'teacher', p_surface,
         date_bin('5 minutes', now(), timestamptz '2000-01-01 00:00:00+00')
  FROM app.current_actor() a
  ON CONFLICT (document_id, institution_id, reader_id, surface, opened_at) DO NOTHING
$$;


--
-- Name: reject_change(); Type: FUNCTION; Schema: audit; Owner: -
--

CREATE FUNCTION audit.reject_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  RAISE EXCEPTION 'append-only row' USING ERRCODE = 'ZD403';
END
$$;


--
-- Name: actor_role(uuid, uuid, uuid); Type: FUNCTION; Schema: collaboration; Owner: -
--

CREATE FUNCTION collaboration.actor_role(p_institution_id uuid, p_assignment_id uuid, p_owner_id uuid) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT CASE
    WHEN p_institution_id IS DISTINCT FROM a.institution_id THEN NULL
    WHEN institution.actor_assignment_role(p_assignment_id) = 'teacher' THEN 'teacher'
    WHEN institution.actor_assignment_role(p_assignment_id) = 'student' AND p_owner_id = a.user_id THEN 'student'
  END
  FROM app.current_actor() a
$$;


--
-- Name: create_comment(text, text, jsonb); Type: FUNCTION; Schema: collaboration; Owner: -
--

CREATE FUNCTION collaboration.create_comment(p_document_id text, p_body text, p_anchor jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  actor record;
  scope record;
  v_thread uuid;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT * INTO scope FROM collaboration.document_scope(p_document_id);
  IF collaboration.actor_role(scope.institution_id, scope.assignment_id, scope.principal_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- Checked before the table constraints, whose errors would quote the row.
  IF NOT coalesce(collaboration.is_comment_body(p_body), false)
     OR NOT coalesce(collaboration.is_text_anchor(p_anchor), false) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  INSERT INTO collaboration.comment_thread (institution_id, document_id, assignment_id, owner_id, anchor, created_by)
  VALUES (scope.institution_id, p_document_id, scope.assignment_id, scope.principal_id, p_anchor, actor.user_id)
  RETURNING id INTO v_thread;
  INSERT INTO collaboration.comment (thread_id, institution_id, position, author_id, author_role, body)
  VALUES (v_thread, scope.institution_id, 1, actor.user_id, 'teacher', p_body);
  RETURN v_thread;
END
$$;


--
-- Name: delete_live_state(text, uuid); Type: FUNCTION; Schema: collaboration; Owner: -
--

CREATE FUNCTION collaboration.delete_live_state(p_document_id text, p_institution_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  DELETE FROM collaboration.live_state l WHERE l.document_id = p_document_id AND l.institution_id = p_institution_id
$$;


--
-- Name: document_scope(text); Type: FUNCTION; Schema: collaboration; Owner: -
--

CREATE FUNCTION collaboration.document_scope(p_document_id text, OUT institution_id uuid, OUT assignment_id uuid, OUT principal_id uuid) RETURNS record
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT d.institution_id, p.assignment_id, d.principal_id
  FROM evidence.document d
  JOIN evidence.project p ON p.id = d.project_id AND p.institution_id = d.institution_id
  WHERE d.id = p_document_id
$$;


--
-- Name: is_comment_body(text); Type: FUNCTION; Schema: collaboration; Owner: -
--

CREATE FUNCTION collaboration.is_comment_body(p_body text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT p_body IS NOT NULL AND p_body IS NFC NORMALIZED
    AND char_length(p_body) BETWEEN 1 AND 2000
    AND p_body ~ '[^[:space:]]'
    AND translate(p_body, E'\n\t', '') !~ '[[:cntrl:]]'
    AND p_body !~ E'[\u202A-\u202E\u2066-\u2069]'
$$;


--
-- Name: is_text_anchor(jsonb); Type: FUNCTION; Schema: collaboration; Owner: -
--

CREATE FUNCTION collaboration.is_text_anchor(p_anchor jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
DECLARE
  v_text text;
  v_limit integer;
BEGIN
  IF jsonb_typeof(p_anchor) IS DISTINCT FROM 'object'
     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_anchor) k)
        IS DISTINCT FROM ARRAY['endHint', 'nodeId', 'prefix', 'quote', 'startHint', 'suffix'] THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_anchor->'nodeId') <> 'string'
     OR p_anchor->>'nodeId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  FOREACH v_text IN ARRAY ARRAY['quote', 'prefix', 'suffix'] LOOP
    v_limit := CASE v_text WHEN 'quote' THEN 500 ELSE 64 END;
    IF jsonb_typeof(p_anchor->v_text) <> 'string'
       OR char_length(p_anchor->>v_text) > v_limit
       OR translate(p_anchor->>v_text, E'\n\t', '') ~ '[[:cntrl:]]'
       OR (p_anchor->>v_text) ~ E'[\u202A-\u202E\u2066-\u2069]' THEN
      RETURN false;
    END IF;
  END LOOP;
  IF char_length(p_anchor->>'quote') = 0
     OR jsonb_typeof(p_anchor->'startHint') <> 'number' OR jsonb_typeof(p_anchor->'endHint') <> 'number' THEN
    RETURN false;
  END IF;
  RETURN (p_anchor->>'startHint')::numeric = trunc((p_anchor->>'startHint')::numeric)
    AND (p_anchor->>'endHint')::numeric = trunc((p_anchor->>'endHint')::numeric)
    AND (p_anchor->>'startHint')::numeric >= 0
    AND (p_anchor->>'startHint')::numeric < (p_anchor->>'endHint')::numeric
    AND (p_anchor->>'endHint')::numeric <= 1000000;
END
$_$;


--
-- Name: list_comments(text); Type: FUNCTION; Schema: collaboration; Owner: -
--

CREATE FUNCTION collaboration.list_comments(p_document_id text) RETURNS TABLE(thread_id uuid, comment_id uuid, comment_position integer, author_role text, is_own boolean, body text, anchor jsonb, state text, created_window timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
    SELECT t.id, c.id, c.position, c.author_role, c.author_id = actor.user_id, c.body,
           CASE WHEN c.position = 1 THEN t.anchor END, t.state,
           date_bin('5 minutes', c.created_at, timestamptz '2000-01-01 00:00:00+00')
    FROM collaboration.comment_thread t
    JOIN collaboration.comment c ON c.thread_id = t.id AND c.institution_id = t.institution_id
    WHERE t.document_id = p_document_id AND t.institution_id = scope.institution_id
    ORDER BY t.created_at, t.id, c.position;
END
$$;


--
-- Name: publish_live_state(text, uuid, text); Type: FUNCTION; Schema: collaboration; Owner: -
--

CREATE FUNCTION collaboration.publish_live_state(p_document_id text, p_expected_token uuid, p_body text) RETURNS TABLE(outcome text, write_token uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  scope record;
  v_hash text;
  v_new uuid := gen_random_uuid();
  v_current record;
BEGIN
  PERFORM institution.require_actor();
  SELECT * INTO scope FROM collaboration.document_scope(p_document_id);
  IF collaboration.actor_role(scope.institution_id, scope.assignment_id, scope.principal_id) IS DISTINCT FROM 'student'
     OR NOT institution.has_acknowledged_current(scope.assignment_id)
     OR app.document_submitted(p_document_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- Checked before the table constraints, whose errors would quote the row.
  IF p_body IS NULL OR octet_length(p_body) NOT BETWEEN 1 AND 2097152 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  v_hash := encode(sha256(convert_to(p_body, 'UTF8')), 'hex');

  SELECT l.content_hash, l.write_token INTO v_current FROM collaboration.live_state l
  WHERE l.document_id = p_document_id AND l.institution_id = scope.institution_id
  FOR UPDATE;
  IF NOT FOUND THEN
    IF p_expected_token IS NOT NULL THEN
      RETURN QUERY SELECT 'conflict'::text, NULL::uuid;
      RETURN;
    END IF;
    INSERT INTO collaboration.live_state (document_id, institution_id, assignment_id, owner_id, body, content_hash, write_token)
    VALUES (p_document_id, scope.institution_id, scope.assignment_id, scope.principal_id, p_body, v_hash, v_new)
    ON CONFLICT ON CONSTRAINT live_state_pkey DO NOTHING;
    IF FOUND THEN
      RETURN QUERY SELECT 'accepted'::text, v_new;
      RETURN;
    END IF;
    -- A first write of another request won the race; decide against it.
    SELECT l.content_hash, l.write_token INTO v_current FROM collaboration.live_state l
    WHERE l.document_id = p_document_id AND l.institution_id = scope.institution_id
    FOR UPDATE;
  END IF;

  IF v_current.content_hash = v_hash THEN
    RETURN QUERY SELECT 'unchanged'::text, v_current.write_token;
  ELSIF p_expected_token = v_current.write_token THEN
    UPDATE collaboration.live_state l SET body = p_body, content_hash = v_hash, write_token = v_new
    WHERE l.document_id = p_document_id AND l.institution_id = scope.institution_id;
    RETURN QUERY SELECT 'accepted'::text, v_new;
  ELSE
    RETURN QUERY SELECT 'conflict'::text, v_current.write_token;
  END IF;
END
$$;


--
-- Name: read_live_state(text, text); Type: FUNCTION; Schema: collaboration; Owner: -
--

CREATE FUNCTION collaboration.read_live_state(p_document_id text, p_known_hash text) RETURNS TABLE(outcome text, content_hash text, body text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  scope record;
  v_role text;
  v_current record;
  v_submitted record;
BEGIN
  PERFORM institution.require_actor();
  SELECT * INTO scope FROM collaboration.document_scope(p_document_id);
  v_role := collaboration.actor_role(scope.institution_id, scope.assignment_id, scope.principal_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF p_known_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF v_role = 'teacher' THEN
    PERFORM audit.record_work_opening(scope.institution_id, p_document_id, scope.assignment_id, scope.principal_id, 'live_view');
  END IF;
  SELECT t.content_hash, t.body INTO v_submitted FROM app.submitted_document_text(p_document_id) t;
  IF FOUND THEN
    IF v_submitted.body IS NULL THEN
      RETURN QUERY SELECT 'unavailable'::text, NULL::text, NULL::text;
    ELSIF v_submitted.content_hash = p_known_hash THEN
      RETURN QUERY SELECT 'submitted'::text, v_submitted.content_hash, NULL::text;
    ELSE
      RETURN QUERY SELECT 'submitted'::text, v_submitted.content_hash, v_submitted.body;
    END IF;
    RETURN;
  END IF;
  SELECT l.content_hash, l.body INTO v_current FROM collaboration.live_state l
  WHERE l.document_id = p_document_id AND l.institution_id = scope.institution_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'empty'::text, NULL::text, NULL::text;
  ELSIF v_current.content_hash = p_known_hash THEN
    RETURN QUERY SELECT 'unchanged'::text, v_current.content_hash, NULL::text;
  ELSE
    RETURN QUERY SELECT 'state'::text, v_current.content_hash, v_current.body;
  END IF;
END
$_$;


--
-- Name: reopen_thread(uuid); Type: FUNCTION; Schema: collaboration; Owner: -
--

CREATE FUNCTION collaboration.reopen_thread(p_thread_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$ SELECT collaboration.set_thread_state(p_thread_id, 'open') $$;


--
-- Name: reply_comment(uuid, text); Type: FUNCTION; Schema: collaboration; Owner: -
--

CREATE FUNCTION collaboration.reply_comment(p_thread_id uuid, p_body text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  actor record;
  t record;
  v_last integer;
  v_comment uuid;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT * INTO t FROM collaboration.thread_for_actor(p_thread_id, true);
  IF NOT coalesce(collaboration.is_comment_body(p_body), false) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF t.state = 'resolved' THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  SELECT max(c.position) INTO v_last FROM collaboration.comment c WHERE c.thread_id = t.thread_id;
  IF v_last >= 10000 THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  INSERT INTO collaboration.comment (thread_id, institution_id, position, author_id, author_role, body)
  VALUES (t.thread_id, actor.institution_id, v_last + 1, actor.user_id, t.role, p_body)
  RETURNING id INTO v_comment;
  UPDATE collaboration.comment_thread c
  SET state = CASE WHEN t.role = 'student' THEN 'answered' ELSE 'open' END, updated_at = now()
  WHERE c.id = t.thread_id AND (t.role, c.state) IN (('student', 'open'), ('teacher', 'answered'));
  RETURN v_comment;
END
$$;


--
-- Name: resolve_thread(uuid); Type: FUNCTION; Schema: collaboration; Owner: -
--

CREATE FUNCTION collaboration.resolve_thread(p_thread_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$ SELECT collaboration.set_thread_state(p_thread_id, 'resolved') $$;


--
-- Name: set_thread_state(uuid, text); Type: FUNCTION; Schema: collaboration; Owner: -
--

CREATE FUNCTION collaboration.set_thread_state(p_thread_id uuid, p_to text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  t record;
BEGIN
  SELECT * INTO t FROM collaboration.thread_for_actor(p_thread_id, true);
  IF t.role <> 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF (p_to = 'resolved' AND t.state = 'resolved') OR (p_to = 'open' AND t.state <> 'resolved') THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  UPDATE collaboration.comment_thread c SET state = p_to, updated_at = now() WHERE c.id = t.thread_id;
END
$$;


--
-- Name: thread_for_actor(uuid, boolean); Type: FUNCTION; Schema: collaboration; Owner: -
--

CREATE FUNCTION collaboration.thread_for_actor(p_thread_id uuid, p_lock boolean, OUT thread_id uuid, OUT state text, OUT role text) RETURNS record
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  actor record;
  t record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT * INTO t FROM collaboration.comment_thread c WHERE c.id = p_thread_id AND c.institution_id = actor.institution_id;
  role := collaboration.actor_role(t.institution_id, t.assignment_id, t.owner_id);
  IF t.id IS NULL OR role IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF p_lock THEN
    SELECT c.state INTO t.state FROM collaboration.comment_thread c WHERE c.id = t.id FOR UPDATE;
  END IF;
  thread_id := t.id;
  state := t.state;
END
$$;


--
-- Name: acceptance_retry_matches(uuid, text, uuid, bigint, text, text, text); Type: FUNCTION; Schema: evidence; Owner: -
--

CREATE FUNCTION evidence.acceptance_retry_matches(p_receipt_id uuid, p_document_id text, p_principal_id uuid, p_expected_revision bigint, p_initial_document_hash text, p_final_document_hash text, p_storage_ref text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
      FROM evidence.receipt r
      JOIN evidence.package p
        ON p.id = r.evidence_package_id AND p.institution_id = r.institution_id
       AND p.document_id = p_document_id AND p.principal_id = p_principal_id
      JOIN evidence.document_revision committed
        ON committed.document_id = p.document_id AND committed.institution_id = p.institution_id
       AND committed.revision = (r.receipt_payload::jsonb->>'revision')::bigint
       AND committed.base_revision = p_expected_revision AND committed.principal_id = p_principal_id
       AND committed.content_hash = p_final_document_hash
      JOIN evidence.document_revision initial
        ON initial.document_id = committed.document_id AND initial.institution_id = committed.institution_id
       AND initial.revision = committed.base_revision AND initial.principal_id = p_principal_id
       AND initial.content_hash = p_initial_document_hash
      JOIN evidence.segment s
        ON s.id = r.segment_id AND s.evidence_package_id = r.evidence_package_id
       AND s.institution_id = r.institution_id AND s.document_id = p.document_id
       AND s.principal_id = p_principal_id AND s.storage_ref = p_storage_ref
     WHERE r.id = p_receipt_id AND r.principal_id = p_principal_id
  )
$$;


--
-- Name: canonical_receipt_v2(jsonb); Type: FUNCTION; Schema: evidence; Owner: -
--

CREATE FUNCTION evidence.canonical_receipt_v2(p_payload jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE v_result text;
BEGIN
  IF pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_each(p_payload) AS e(key, value)
       WHERE pg_catalog.jsonb_typeof(value) NOT IN ('string', 'number', 'null')
     ) THEN
    RAISE EXCEPTION 'invalid receipt payload' USING ERRCODE = 'ZD422';
  END IF;
  SELECT '{' || pg_catalog.string_agg(
           pg_catalog.to_json(e.key)::text || ':' ||
           CASE pg_catalog.jsonb_typeof(e.value)
             WHEN 'string' THEN pg_catalog.to_json(e.value #>> '{}')::text
             WHEN 'number' THEN e.value::text
             WHEN 'null' THEN 'null'
           END,
           ',' ORDER BY e.key COLLATE "C"
         ) || '}'
    INTO v_result
    FROM pg_catalog.jsonb_each(p_payload) AS e(key, value);
  RETURN v_result;
END
$$;


--
-- Name: close_submitted_packages(); Type: FUNCTION; Schema: evidence; Owner: -
--

CREATE FUNCTION evidence.close_submitted_packages() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  UPDATE evidence.package k
     SET accepts_evidence = false
    FROM evidence.submission_request r
   WHERE r.id = NEW.submission_request_id AND r.institution_id = NEW.institution_id
     AND k.document_id = r.document_id AND k.institution_id = r.institution_id
     AND k.accepts_evidence;
  RETURN NULL;
END
$$;


--
-- Name: guard_receipt_transition(); Type: FUNCTION; Schema: evidence; Owner: -
--

CREATE FUNCTION evidence.guard_receipt_transition() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'receipt is immutable' USING ERRCODE = 'ZD403';
  END IF;
  IF OLD.status = 'pending_signature' AND NEW.status = 'signed'
     AND NEW.id = OLD.id
     AND NEW.evidence_package_id = OLD.evidence_package_id
     AND NEW.institution_id = OLD.institution_id
     AND NEW.evidence_domain_id = OLD.evidence_domain_id
     AND NEW.segment_id = OLD.segment_id
     AND NEW.principal_id = OLD.principal_id
     AND NEW.client_request_id = OLD.client_request_id
     AND NEW.previous_receipt_id IS NOT DISTINCT FROM OLD.previous_receipt_id
     AND NEW.payload_sha256 = OLD.payload_sha256
     AND NEW.descriptor = OLD.descriptor
     AND NEW.receipt_payload = OLD.receipt_payload
     AND NEW.created_at = OLD.created_at
     AND NEW.signature IS NOT NULL AND NEW.key_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'receipt is immutable' USING ERRCODE = 'ZD403';
END
$$;


--
-- Name: guard_signing_key_change(); Type: FUNCTION; Schema: evidence; Owner: -
--

CREATE FUNCTION evidence.guard_signing_key_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.key_id = OLD.key_id AND NEW.key_version = OLD.key_version
     AND NEW.evidence_domain_id = OLD.evidence_domain_id AND NEW.institution_id = OLD.institution_id
     AND NEW.purpose = OLD.purpose AND NEW.algorithm = OLD.algorithm
     AND NEW.key_base64url = OLD.key_base64url AND NEW.valid_from = OLD.valid_from
     AND NEW.created_at = OLD.created_at
     AND (NEW.valid_to IS NOT DISTINCT FROM OLD.valid_to
          OR (OLD.valid_to IS NULL AND NEW.valid_to > pg_catalog.clock_timestamp()))
     AND (NEW.revoked_at IS NOT DISTINCT FROM OLD.revoked_at OR OLD.revoked_at IS NULL) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'signing key is immutable' USING ERRCODE = 'ZD403';
END
$$;


--
-- Name: inserted_by_current_transaction(xid); Type: FUNCTION; Schema: evidence; Owner: -
--

CREATE FUNCTION evidence.inserted_by_current_transaction(p_xmin xid) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_top bigint := pg_catalog.pg_current_xact_id()::text::bigint;
  v_delta bigint;
BEGIN
  v_delta := (p_xmin::text::bigint - (v_top & 4294967295) + 4294967296) % 4294967296;
  IF v_delta >= 2147483648 THEN
    v_delta := v_delta - 4294967296;
  END IF;
  RETURN v_top + v_delta >= 3
     AND pg_catalog.pg_xact_status((v_top + v_delta)::text::xid8) IS NOT DISTINCT FROM 'in progress';
END
$$;


--
-- Name: keep_submitted_package_closed(); Type: FUNCTION; Schema: evidence; Owner: -
--

CREATE FUNCTION evidence.keep_submitted_package_closed() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.accepts_evidence AND EXISTS (
    SELECT 1
      FROM evidence.submission s
      JOIN evidence.submission_request r ON r.id = s.submission_request_id AND r.institution_id = s.institution_id
     WHERE r.document_id = NEW.document_id AND r.institution_id = NEW.institution_id
  ) THEN
    RAISE EXCEPTION 'a package of a submitted document stays closed' USING ERRCODE = 'ZD403';
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: reject_append_only_change(); Type: FUNCTION; Schema: evidence; Owner: -
--

CREATE FUNCTION evidence.reject_append_only_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  RAISE EXCEPTION 'append-only row' USING ERRCODE = 'ZD403';
END
$$;


--
-- Name: revision_zero_document(); Type: FUNCTION; Schema: evidence; Owner: -
--

CREATE FUNCTION evidence.revision_zero_document() RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT '{"nodes":[{"children":[],"id":"00000000-0000-4000-8000-000000000000","type":"paragraph"}],"schemaVersion":1}'::text
$$;


--
-- Name: seal_document_checkpoint(); Type: FUNCTION; Schema: evidence; Owner: -
--

CREATE FUNCTION evidence.seal_document_checkpoint() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  NEW.content_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(NEW.body, 'UTF8')), 'hex');
  NEW.created_at := pg_catalog.now();
  RETURN NEW;
END
$$;


--
-- Name: validate_segment_descriptor_v2(jsonb, text); Type: FUNCTION; Schema: evidence; Owner: -
--

CREATE FUNCTION evidence.validate_segment_descriptor_v2(p_descriptor jsonb, p_payload_sha256 text) RETURNS TABLE(sequence_from bigint, sequence_to bigint, event_count integer, payload_bytes integer, observed_started_at timestamp with time zone, observed_ended_at timestamp with time zone)
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
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
$_$;


--
-- Name: close_all_sessions_for_identity(); Type: FUNCTION; Schema: identity; Owner: -
--

CREATE FUNCTION identity.close_all_sessions_for_identity() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user uuid;
BEGIN
  SELECT a.user_id INTO v_user FROM app.current_actor() a;
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  UPDATE identity.session
  SET closed_at = pg_catalog.now(), close_reason = 'logout_all'
  WHERE user_id = v_user
    AND closed_at IS NULL
    AND expires_at > pg_catalog.now()
    AND last_seen_at > pg_catalog.now() - interval '2 hours';
END
$$;


--
-- Name: close_current_session(); Type: FUNCTION; Schema: identity; Owner: -
--

CREATE FUNCTION identity.close_current_session() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  token text := pg_catalog.current_setting('app.session_token', true);
  closed integer;
BEGIN
  IF token IS NULL OR token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN false;
  END IF;
  UPDATE identity.session
     SET closed_at = pg_catalog.now(), close_reason = 'logout'
   WHERE token_hash = pg_catalog.sha256(pg_catalog.convert_to(token, 'UTF8'))
     AND closed_at IS NULL;
  GET DIAGNOSTICS closed = ROW_COUNT;
  RETURN closed > 0;
END
$_$;


--
-- Name: open_session(text, text, text, text, bytea); Type: FUNCTION; Schema: identity; Owner: -
--

CREATE FUNCTION identity.open_session(p_issuer text, p_subject text, p_unique_id text, p_home_org text, p_token_hash bytea) RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_institution uuid;
  v_user uuid;
  v_user_institution uuid;
  v_subject text;
  v_expires timestamptz := pg_catalog.now() + interval '12 hours';
  -- Lower case under "C" folds ASCII alone, so a look-alike character such
  -- as the Kelvin sign stays what it is and matches nothing.
  v_home_org text := pg_catalog.lower(pg_catalog.btrim(p_home_org, E' \t\r\n') COLLATE "C");
  -- Characters from the end of the unique id to its last "@"; 0 when none.
  v_at integer := pg_catalog.strpos(pg_catalog.reverse(p_unique_id), '@');
  v_local text;
  v_realm text;
  v_shape_ok boolean;
  v_issuer_ok boolean;
BEGIN
  IF p_issuer IS NULL OR pg_catalog.length(p_issuer) NOT BETWEEN 1 AND 255
     OR p_subject IS NULL OR pg_catalog.length(p_subject) NOT BETWEEN 1 AND 255
     OR p_unique_id IS NULL OR pg_catalog.length(p_unique_id) NOT BETWEEN 1 AND 255
     OR p_token_hash IS NULL OR pg_catalog.octet_length(p_token_hash) <> 32 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;

  -- A unique id is local@realm with exactly one "@". The local part is not
  -- empty and holds no "@", no space or separator (Zs, Zl, Zp), no control
  -- (Cc) and no invisible format character (Cf); text cannot hold a surrogate
  -- (Cs). This is stricter than claims.ts, which lets Zs spaces through. Any
  -- other character passes.
  IF v_at > 0 THEN
    v_local := pg_catalog."left"(p_unique_id, -v_at);
    v_realm := pg_catalog.lower(pg_catalog.btrim(pg_catalog."right"(p_unique_id, v_at - 1), E' \t\r\n') COLLATE "C");
  END IF;
  v_shape_ok := v_home_org ~ '^[a-z0-9.-]{1,255}$'
    AND v_local ~ ('^[^@\u0001-\u0020\u007F-\u00A0\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890\u0891\u08E2'
                   '\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u2066-\u206F\u3000\uFEFF\uFFF9-\uFFFB'
                   '\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A'
                   '\U000E0001\U000E0020-\U000E007F]+$' COLLATE "C")
    AND v_realm = v_home_org COLLATE "C";

  -- Both lookups run on every path, so a refused shape or realm, an unknown
  -- institution and an issuer not recorded for it run the same queries
  -- before the same ZD503. That is the boundary: equal outcome and equal
  -- queries, not equal duration. With no institution the issuer lookup
  -- still reads the table, under the nil id that gen_random_uuid never
  -- gives; a match there could not open a session anyway.
  SELECT i.id INTO v_institution FROM identity.institution i WHERE i.aai_home_org = v_home_org;
  v_issuer_ok := EXISTS (
    SELECT 1 FROM identity.institution_issuer ii
    WHERE ii.institution_id = coalesce(v_institution, '00000000-0000-0000-0000-000000000000'::uuid)
      AND ii.oidc_issuer = p_issuer COLLATE "C"
  );
  IF v_institution IS NULL OR v_shape_ok IS NOT TRUE OR v_issuer_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'institution not set up' USING ERRCODE = 'ZD503';
  END IF;

  -- First login creates the account. A conflict on either identifier leaves
  -- the existing row, and the check below decides. ON CONFLICT waits for a
  -- concurrent first login, whose row the next statement then sees.
  INSERT INTO identity.user_account (institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
  VALUES (v_institution, p_issuer, p_subject, p_unique_id)
  ON CONFLICT DO NOTHING;

  SELECT u.id, u.institution_id, u.oidc_subject
    INTO v_user, v_user_institution, v_subject
  FROM identity.user_account u
  WHERE u.oidc_issuer = p_issuer AND u.hr_edu_person_unique_id = p_unique_id;

  -- Not found means the subject belongs to another unique id. A changed
  -- subject or home institution is refused rather than merged: which of the
  -- two identifiers Srce never reassigns is not confirmed yet.
  IF v_user IS NULL OR v_subject <> p_subject OR v_user_institution <> v_institution THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;

  BEGIN
    INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
    VALUES (p_token_hash, v_user, v_institution, v_expires);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END;
  RETURN v_expires;
END
$_$;


--
-- Name: open_session(text, text, text, text, bytea, text, text); Type: FUNCTION; Schema: identity; Owner: -
--

CREATE FUNCTION identity.open_session(p_issuer text, p_subject text, p_unique_id text, p_home_org text, p_token_hash bytea, p_given_name text, p_family_name text) RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_expires timestamptz;
  v_user uuid;
  v_institution uuid;
  -- Every space separator (Zs) is trimmed, so a name of non-breaking spaces
  -- is as blank as one of ASCII spaces.
  v_trim constant text := E' \t\r\n\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000';
  -- The characters src/server/auth/claims.ts refuses in a name (Cc, Cf, Zl,
  -- Zp; NUL and surrogates cannot occur in text), so a direct call stores
  -- nothing the login path would have dropped.
  v_unsafe constant text := '[\u0001-\u001F\u007F-\u009F\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890\u0891\u08E2'
    '\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB'
    '\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A'
    '\U000E0001\U000E0020-\U000E007F]';
  v_given text := pg_catalog.btrim(p_given_name, v_trim);
  v_family text := pg_catalog.btrim(p_family_name, v_trim);
BEGIN
  v_expires := identity.open_session(p_issuer, p_subject, p_unique_id, p_home_org, p_token_hash);

  SELECT u.id, u.institution_id INTO STRICT v_user, v_institution
  FROM identity.user_account u
  WHERE u.oidc_issuer = p_issuer AND u.hr_edu_person_unique_id = p_unique_id;

  -- A name with a control or invisible format character is not a name; it
  -- is dropped, never refused, so a bad attribute costs the name and not the
  -- login.
  IF pg_catalog.length(v_given) BETWEEN 1 AND 255 AND v_given !~ (v_unsafe COLLATE "C")
     AND pg_catalog.length(v_family) BETWEEN 1 AND 255 AND v_family !~ (v_unsafe COLLATE "C") THEN
    INSERT INTO identity.person_name (user_id, institution_id, given_name, family_name)
    VALUES (v_user, v_institution, v_given, v_family)
    ON CONFLICT (user_id) DO UPDATE
      SET given_name = EXCLUDED.given_name, family_name = EXCLUDED.family_name, updated_at = pg_catalog.now();
  ELSE
    DELETE FROM identity.person_name WHERE user_id = v_user;
  END IF;
  RETURN v_expires;
END
$$;


--
-- Name: purge_ended_sessions(); Type: FUNCTION; Schema: identity; Owner: -
--

CREATE FUNCTION identity.purge_ended_sessions() RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  WITH gone AS (
    DELETE FROM identity.session
    WHERE LEAST(closed_at, expires_at, last_seen_at + interval '2 hours')
          < pg_catalog.now() - interval '30 days'
    RETURNING 1
  )
  SELECT pg_catalog.count(*) FROM gone
$$;


--
-- Name: touch_current_session(); Type: FUNCTION; Schema: identity; Owner: -
--

CREATE FUNCTION identity.touch_current_session() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_token text := pg_catalog.current_setting('app.session_token', true);
BEGIN
  IF v_token IS NULL OR v_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN false;
  END IF;
  UPDATE identity.session s
  SET last_seen_at = pg_catalog.now()
  WHERE s.id = (
    SELECT c.id FROM identity.session c
    WHERE c.token_hash = pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8'))
      AND c.closed_at IS NULL
      AND c.expires_at > pg_catalog.now()
      AND c.last_seen_at > pg_catalog.now() - interval '2 hours'
      AND c.last_seen_at <= pg_catalog.now() - interval '60 seconds'
    FOR UPDATE SKIP LOCKED
  );
  RETURN FOUND;
END
$_$;


--
-- Name: acknowledge_notice(uuid, integer); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.acknowledge_notice(p_assignment_id uuid, p_version_no integer) RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  actor record;
  v_current integer;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_assignment_role(p_assignment_id) IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  SELECT a.current_version INTO v_current FROM institution.assignment a WHERE a.id = p_assignment_id FOR SHARE;
  IF v_current IS DISTINCT FROM p_version_no THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
  VALUES (p_assignment_id, v_current, actor.user_id, actor.institution_id)
  ON CONFLICT (assignment_id, version_no, student_id) DO NOTHING;
  RETURN (SELECT n.acknowledged_at FROM institution.notice_acknowledgment n
           WHERE n.assignment_id = p_assignment_id AND n.version_no = v_current AND n.student_id = actor.user_id);
END
$$;


--
-- Name: actor_assignment_role(uuid); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.actor_assignment_role(p_assignment_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT CASE
           WHEN a.course_id IS NOT NULL THEN institution.actor_course_role(a.course_id)
           ELSE institution.actor_mentorship_role(a.mentorship_id)
         END
  FROM institution.assignment a
  WHERE a.id = p_assignment_id
$$;


--
-- Name: actor_course_role(uuid); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.actor_course_role(p_course_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT m.role
  FROM app.current_actor() a
  JOIN institution.course_member m ON m.user_id = a.user_id AND m.institution_id = a.institution_id
  WHERE m.course_id = p_course_id AND m.member_to IS NULL
    AND (m.role = 'student' OR institution.actor_has_role('teacher'))
$$;


--
-- Name: actor_has_role(text); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.actor_has_role(p_role text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.current_actor() a
    JOIN institution.institution_role r ON r.user_id = a.user_id AND r.institution_id = a.institution_id
    WHERE r.role = p_role AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
  )
$$;


--
-- Name: actor_mentorship_role(uuid); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.actor_mentorship_role(p_mentorship_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT CASE
           WHEN m.mentor_id = a.user_id AND institution.actor_has_role('teacher') THEN 'teacher'
           WHEN m.student_id = a.user_id THEN 'student'
         END
  FROM app.current_actor() a
  JOIN institution.mentorship m ON m.institution_id = a.institution_id
  WHERE m.id = p_mentorship_id AND m.ended_at IS NULL
$$;


--
-- Name: ai_policy_rank(text); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.ai_policy_rank(p_ai_policy text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$ SELECT array_position(ARRAY['prohibited', 'partially_allowed', 'encouraged'], p_ai_policy) $$;


--
-- Name: allow_student_return(uuid, uuid); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.allow_student_return(p_course_id uuid, p_student_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  actor record;
  v_written integer;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  WITH allowed AS (
    UPDATE institution.course_member m SET return_allowed_at = now()
     WHERE m.course_id = p_course_id AND m.user_id = p_student_id
       AND m.removed_by IS NOT NULL AND m.return_allowed_at IS NULL
    RETURNING m.id, m.course_id, m.user_id
  )
  INSERT INTO audit.course_member_event (institution_id, course_id, membership_id, student_id, kind, actor_id, occurred_at)
  SELECT actor.institution_id, allowed.course_id, allowed.id, allowed.user_id, 'return_allowed', actor.user_id, now() FROM allowed;
  GET DIAGNOSTICS v_written = ROW_COUNT;
  RETURN v_written > 0;
END
$$;


--
-- Name: check_mentorship_version(); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.check_mentorship_version() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_work record;
  v_rule record;
BEGIN
  SELECT m.institution_id, m.work_type INTO v_work
    FROM institution.assignment a
    JOIN institution.mentorship m ON m.id = a.mentorship_id AND m.institution_id = a.institution_id
   WHERE a.id = NEW.assignment_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  SELECT r.ai_policy, r.ai_purposes, r.evidence_profile, r.import_allowed INTO v_rule
    FROM institution.faculty_work_rule r
   WHERE r.institution_id = v_work.institution_id AND r.work_type = v_work.work_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not set up' USING ERRCODE = 'ZD503';
  END IF;
  IF NOT coalesce(
       NEW.work_type = v_work.work_type
       AND institution.ai_policy_rank(NEW.ai_policy) <= institution.ai_policy_rank(v_rule.ai_policy)
       AND NEW.ai_purposes <@ v_rule.ai_purposes
       AND (NEW.evidence_profile = 'basic' OR v_rule.evidence_profile = 'extended')
       AND (NOT NEW.import_allowed OR v_rule.import_allowed),
       false) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: confirm_teacher_role(uuid); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.confirm_teacher_role(p_candidate_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF NOT institution.actor_has_role('admin')
     OR p_candidate_id IS NOT DISTINCT FROM actor.user_id
     OR NOT EXISTS (
       SELECT 1 FROM identity.user_account u
       WHERE u.id = p_candidate_id AND u.institution_id = actor.institution_id
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  INSERT INTO institution.institution_role AS r (institution_id, user_id, role, confirmed_by, confirmed_at)
  VALUES (actor.institution_id, p_candidate_id, 'teacher', actor.user_id, now())
  ON CONFLICT (institution_id, user_id, role) WHERE revoked_at IS NULL
  DO UPDATE SET confirmed_by = EXCLUDED.confirmed_by, confirmed_at = EXCLUDED.confirmed_at
  WHERE r.confirmed_at IS NULL;
END
$$;


--
-- Name: create_assignment(uuid, text, text, text, timestamp with time zone, timestamp with time zone, text, text[], text, boolean, integer, integer); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.create_assignment(p_course_id uuid, p_title text, p_instructions text, p_work_type text, p_opens_at timestamp with time zone, p_due_at timestamp with time zone, p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_import_allowed boolean, p_word_min integer, p_word_max integer) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  actor record;
  v_assignment uuid;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- Checked here, before the table constraint, whose error quotes the row.
  IF NOT institution.is_assignment_content(p_title, p_instructions, p_work_type, p_opens_at, p_due_at,
                                           p_ai_policy, p_ai_purposes, p_evidence_profile, p_import_allowed)
     OR NOT institution.is_word_range(p_word_min, p_word_max)
     OR institution.ai_policy_rank(p_ai_policy)
        > (SELECT institution.ai_policy_rank(c.ai_policy) FROM institution.course c WHERE c.id = p_course_id) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  INSERT INTO institution.assignment (course_id, institution_id, created_by)
  VALUES (p_course_id, actor.institution_id, actor.user_id)
  RETURNING id INTO v_assignment;
  INSERT INTO institution.assignment_version (
    assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
    ai_purposes, evidence_profile, import_allowed, word_min, word_max, created_by
  )
  VALUES (v_assignment, 1, p_title, p_instructions, p_work_type, p_opens_at, p_due_at, p_ai_policy,
          p_ai_purposes, p_evidence_profile, p_import_allowed, p_word_min, p_word_max, actor.user_id);
  RETURN v_assignment;
END
$$;


--
-- Name: create_assignment(uuid, uuid, text, text, text, timestamp with time zone, timestamp with time zone, text, text[], text, boolean, integer, integer); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.create_assignment(p_course_id uuid, p_request_id uuid, p_title text, p_instructions text, p_work_type text, p_opens_at timestamp with time zone, p_due_at timestamp with time zone, p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_import_allowed boolean, p_word_min integer, p_word_max integer) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  actor record;
  v_assignment uuid;
  existing record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF p_request_id IS NULL
     OR NOT institution.is_assignment_content(p_title, p_instructions, p_work_type, p_opens_at, p_due_at,
                                              p_ai_policy, p_ai_purposes, p_evidence_profile, p_import_allowed)
     OR NOT institution.is_word_range(p_word_min, p_word_max)
     OR institution.ai_policy_rank(p_ai_policy)
        > (SELECT institution.ai_policy_rank(c.ai_policy) FROM institution.course c WHERE c.id = p_course_id) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;

  INSERT INTO institution.assignment (course_id, institution_id, created_by, request_id)
  VALUES (p_course_id, actor.institution_id, actor.user_id, p_request_id)
  ON CONFLICT (created_by, request_id) WHERE request_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_assignment;

  IF v_assignment IS NOT NULL THEN
    INSERT INTO institution.assignment_version (
      assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
      ai_purposes, evidence_profile, import_allowed, word_min, word_max, created_by
    )
    VALUES (v_assignment, 1, p_title, p_instructions, p_work_type, p_opens_at, p_due_at, p_ai_policy,
            p_ai_purposes, p_evidence_profile, p_import_allowed, p_word_min, p_word_max, actor.user_id);
    RETURN v_assignment;
  END IF;

  -- A key belongs to one creator. Replays return the original assignment only
  -- when every field of its immutable first version and its course match.
  SELECT a.id, a.course_id, v.title, v.instructions, v.work_type, v.opens_at, v.due_at,
         v.ai_policy, v.ai_purposes, v.evidence_profile, v.import_allowed, v.word_min, v.word_max
    INTO existing
    FROM institution.assignment a
    JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = 1
   WHERE a.created_by = actor.user_id AND a.request_id = p_request_id;
  IF existing.id IS NULL
     OR existing.course_id IS DISTINCT FROM p_course_id
     OR existing.title IS DISTINCT FROM p_title
     OR existing.instructions IS DISTINCT FROM p_instructions
     OR existing.work_type IS DISTINCT FROM p_work_type
     OR existing.opens_at IS DISTINCT FROM p_opens_at
     OR existing.due_at IS DISTINCT FROM p_due_at
     OR existing.ai_policy IS DISTINCT FROM p_ai_policy
     OR existing.ai_purposes IS DISTINCT FROM p_ai_purposes
     OR existing.evidence_profile IS DISTINCT FROM p_evidence_profile
     OR existing.import_allowed IS DISTINCT FROM p_import_allowed
     OR existing.word_min IS DISTINCT FROM p_word_min
     OR existing.word_max IS DISTINCT FROM p_word_max THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  RETURN existing.id;
END
$$;


--
-- Name: create_course(text, text, text); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.create_course(p_name text, p_academic_year text, p_ai_policy text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  actor record;
  v_course uuid;
  v_ai_policy text;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF NOT institution.actor_has_role('teacher') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- Checked here, before the table constraints, whose errors quote the row.
  IF NOT coalesce(
       institution.is_plain_label(p_name)
       AND p_ai_policy IN ('prohibited', 'partially_allowed', 'encouraged')
       AND CASE WHEN p_academic_year ~ '^[0-9]{4}/[0-9]{4}$'
                THEN right(p_academic_year, 4)::integer = left(p_academic_year, 4)::integer + 1
                ELSE false END,
       false) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;

  INSERT INTO institution.course (institution_id, name, academic_year, ai_policy, created_by)
  VALUES (actor.institution_id, p_name, p_academic_year, p_ai_policy, actor.user_id)
  ON CONFLICT (institution_id, created_by, academic_year, name) DO NOTHING
  RETURNING id INTO v_course;
  IF v_course IS NULL THEN
    SELECT c.id, c.ai_policy INTO v_course, v_ai_policy
      FROM institution.course c
     WHERE c.institution_id = actor.institution_id AND c.created_by = actor.user_id
       AND c.academic_year = p_academic_year AND c.name = p_name;
    IF v_ai_policy <> p_ai_policy THEN
      RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
    END IF;
    RETURN v_course;
  END IF;
  INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
  VALUES (v_course, actor.institution_id, actor.user_id, 'teacher');
  RETURN v_course;
END
$_$;


--
-- Name: create_enrollment_code(uuid, timestamp with time zone); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.create_enrollment_code(p_course_id uuid, p_valid_until timestamp with time zone) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  actor record;
  v_code text;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF NOT coalesce(p_valid_until > now() AND p_valid_until <= now() + interval '1 year', false) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  -- Two teachers at once: the second waits here, then replaces the first code.
  PERFORM 1 FROM institution.course c WHERE c.id = p_course_id FOR UPDATE;
  WITH ended AS (
    UPDATE institution.course_enrollment_code e SET active = false
     WHERE e.course_id = p_course_id AND e.active
    RETURNING e.id
  )
  INSERT INTO audit.enrollment_code_event (institution_id, course_id, code_id, kind, actor_id, occurred_at)
  SELECT actor.institution_id, p_course_id, ended.id, 'replaced', actor.user_id, now() FROM ended;
  v_code := upper(encode(
    substring(sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())) FROM 1 FOR 8), 'hex'
  ));
  INSERT INTO institution.course_enrollment_code (course_id, code_hash, valid_until, created_by)
  VALUES (p_course_id, sha256(convert_to(v_code, 'UTF8')), p_valid_until, actor.user_id);
  RETURN concat_ws('-', substr(v_code, 1, 4), substr(v_code, 5, 4), substr(v_code, 9, 4), substr(v_code, 13, 4));
END
$$;


--
-- Name: enroll_with_code(text); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.enroll_with_code(p_code text, OUT outcome text, OUT enrolled_course_id uuid) RETURNS record
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  actor record;
  settings record;
  v_code text;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  -- The count below must see what a parallel request has just committed.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE = 'ZD500';
  END IF;
  SELECT s.enrollment_attempt_limit AS attempt_limit, s.enrollment_attempt_window AS attempt_window
    INTO settings
    FROM institution.institution_settings s WHERE s.institution_id = actor.institution_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'institution is not configured' USING ERRCODE = 'ZD503';
  END IF;

  -- One attempt of a user at a time, so parallel requests cannot pass the limit.
  PERFORM pg_advisory_xact_lock(hashtextextended('institution.enroll_with_code:' || actor.user_id, 0));
  DELETE FROM institution.enrollment_attempt t
   WHERE t.user_id = actor.user_id AND t.attempted_at <= now() - settings.attempt_window;
  IF (SELECT count(*) FROM institution.enrollment_attempt t WHERE t.user_id = actor.user_id)
     >= settings.attempt_limit THEN
    outcome := 'too_many_attempts';
    RETURN;
  END IF;

  -- Spaces, hyphens and letter case do not matter; only the hash is compared.
  IF length(p_code) <= 64 THEN
    v_code := regexp_replace(p_code, '[\s-]', '', 'g');
  END IF;
  IF v_code ~ '^[0-9A-Za-z]{8,32}$' THEN
    SELECT c.id INTO enrolled_course_id
      FROM institution.course_enrollment_code e
      JOIN institution.course c ON c.id = e.course_id
     WHERE e.code_hash = sha256(convert_to(upper(v_code), 'UTF8'))
       AND e.active AND e.valid_until > now()
       AND c.institution_id = actor.institution_id
       AND NOT EXISTS (
         SELECT 1 FROM institution.course_member m
          WHERE m.course_id = c.id AND m.user_id = actor.user_id
            AND m.removed_by IS NOT NULL AND m.return_allowed_at IS NULL
       );
  END IF;
  IF enrolled_course_id IS NOT NULL THEN
    INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
    VALUES (enrolled_course_id, actor.institution_id, actor.user_id, 'student')
    ON CONFLICT (course_id, user_id) WHERE member_to IS NULL DO NOTHING;
    IF institution.actor_course_role(enrolled_course_id) IS NOT NULL THEN
      outcome := 'enrolled';
      RETURN;
    END IF;
  END IF;
  enrolled_course_id := NULL;
  INSERT INTO institution.enrollment_attempt (user_id) VALUES (actor.user_id);
  outcome := 'refused';
END
$_$;


--
-- Name: has_acknowledged_current(uuid); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.has_acknowledged_current(p_assignment_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.current_actor() c
    JOIN institution.notice_acknowledgment n ON n.student_id = c.user_id
    JOIN institution.assignment a ON a.id = n.assignment_id AND a.current_version = n.version_no
    WHERE a.id = p_assignment_id AND institution.actor_assignment_role(a.id) = 'student'
  )
$$;


--
-- Name: is_assignment_content(text, text, text, timestamp with time zone, timestamp with time zone, text, text[], text, boolean); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.is_assignment_content(p_title text, p_instructions text, p_work_type text, p_opens_at timestamp with time zone, p_due_at timestamp with time zone, p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_import_allowed boolean) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT coalesce(
    institution.is_plain_label(p_title)
    AND length(p_instructions) <= 20000
    AND p_instructions !~ '[\x0001-\x0008\x000B\x000C\x000E-\x001F\x007F-\x009F\x202A-\x202E\x2066-\x2069]'
    AND p_work_type IN ('short_paper', 'essay', 'seminar_paper', 'bachelor_thesis', 'master_thesis',
                        'specialist_thesis', 'doctoral_thesis')
    AND isfinite(p_opens_at) AND isfinite(p_due_at) AND p_opens_at < p_due_at
    AND institution.ai_policy_rank(p_ai_policy) IS NOT NULL
    AND p_ai_purposes <@ ARRAY['formatting', 'proofreading', 'literature_search', 'transcription', 'translation']
    AND cardinality(p_ai_purposes) <= 5 AND coalesce(array_ndims(p_ai_purposes), 1) = 1
    AND (p_ai_policy <> 'prohibited' OR cardinality(p_ai_purposes) = 0)
    AND p_evidence_profile IN ('basic', 'extended')
    AND p_import_allowed IS NOT NULL,
    false)
$$;


--
-- Name: is_plain_label(text); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.is_plain_label(p_text text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT length(p_text) BETWEEN 1 AND 200
     AND p_text !~ '[\x0001-\x001F\x007F-\x009F\x00AD\x034F\x061C\x180E\x200B-\x200F\x2028-\x202E\x2060-\x206F\xFEFF\xFFF9-\xFFFB\U000E0000-\U000E007F]'
     AND p_text ~ '[^\s\x00A0\x034F\x115F\x1160\x1680\x17B4\x17B5\x180B-\x180D\x2000-\x200A\x202F\x205F\x2800\x3000\x3164\xFE00-\xFE0F\xFFA0\U000E0000-\U000E0FFF]'
$$;


--
-- Name: is_word_range(integer, integer); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.is_word_range(p_word_min integer, p_word_max integer) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT (p_word_min IS NULL OR p_word_min BETWEEN 1 AND 1000000)
     AND (p_word_max IS NULL OR p_word_max BETWEEN 1 AND 1000000)
     AND (p_word_min IS NULL OR p_word_max IS NULL OR p_word_min <= p_word_max)
$$;


--
-- Name: list_teacher_courses(); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.list_teacher_courses() RETURNS TABLE(course_id uuid, course_name text, academic_year text, assignment_id uuid, title text, work_type text, opens_at timestamp with time zone, due_at timestamp with time zone, current_version integer, enrolled_students integer, ai_policy text)
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
BEGIN
  IF app.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  IF NOT institution.actor_has_role('teacher') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  RETURN QUERY
  SELECT c.id, c.name, c.academic_year,
         a.id, v.title, v.work_type, v.opens_at, v.due_at, a.current_version,
         (SELECT count(*)::integer FROM institution.course_member m
           WHERE m.course_id = c.id AND m.role = 'student' AND m.member_to IS NULL),
         c.ai_policy
    FROM institution.course c
    LEFT JOIN institution.assignment a ON a.course_id = c.id AND a.institution_id = c.institution_id
    LEFT JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = a.current_version
   WHERE c.institution_id = app.current_institution_id()
     AND institution.actor_course_role(c.id) = 'teacher';
END
$$;


--
-- Name: notify_assignment_version(); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.notify_assignment_version() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
  SELECT a.institution_id, m.user_id, 'assignment_version',
         'assignment_version:' || a.id::text || ':' || NEW.version_no::text, a.id
  FROM institution.assignment a
  JOIN institution.course_member m ON m.course_id = a.course_id AND m.institution_id = a.institution_id
  WHERE a.id = NEW.assignment_id AND a.course_id IS NOT NULL
    AND m.role = 'student' AND m.member_to IS NULL
  ON CONFLICT (recipient_id, event_key) DO NOTHING;
  RETURN NEW;
END
$$;


--
-- Name: publish_assignment_version(uuid, integer, text, text, text, timestamp with time zone, timestamp with time zone, text, text[], text, boolean, integer, integer); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.publish_assignment_version(p_assignment_id uuid, p_expected_version integer, p_title text, p_instructions text, p_work_type text, p_opens_at timestamp with time zone, p_due_at timestamp with time zone, p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_import_allowed boolean, p_word_min integer, p_word_max integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  actor record;
  cur record;
  v_current integer;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_assignment_role(p_assignment_id) IS DISTINCT FROM 'teacher'
     OR EXISTS (SELECT 1 FROM institution.assignment a WHERE a.id = p_assignment_id AND a.mentorship_id IS NOT NULL) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF NOT institution.is_assignment_content(p_title, p_instructions, p_work_type, p_opens_at, p_due_at,
                                           p_ai_policy, p_ai_purposes, p_evidence_profile, p_import_allowed)
     OR NOT institution.is_word_range(p_word_min, p_word_max) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  -- Two teachers at once: the second waits here, then fails the comparison.
  SELECT a.current_version INTO v_current FROM institution.assignment a WHERE a.id = p_assignment_id FOR UPDATE;
  IF v_current IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  SELECT v.* INTO cur FROM institution.assignment_version v
   WHERE v.assignment_id = p_assignment_id AND v.version_no = v_current;
  IF institution.ai_policy_rank(p_ai_policy) > institution.ai_policy_rank(cur.ai_policy)
     OR NOT p_ai_purposes <@ cur.ai_purposes
     OR (p_evidence_profile = 'extended' AND cur.evidence_profile = 'basic')
     OR (p_import_allowed AND NOT cur.import_allowed)
     -- Rule 14: a bound may be dropped or relaxed, never added or tightened.
     OR (p_word_min IS NOT NULL AND (cur.word_min IS NULL OR p_word_min > cur.word_min))
     OR (p_word_max IS NOT NULL AND (cur.word_max IS NULL OR p_word_max < cur.word_max)) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  INSERT INTO institution.assignment_version (
    assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
    ai_purposes, evidence_profile, import_allowed, word_min, word_max, created_by
  )
  VALUES (p_assignment_id, v_current + 1, p_title, p_instructions, p_work_type, p_opens_at, p_due_at, p_ai_policy,
          p_ai_purposes, p_evidence_profile, p_import_allowed, p_word_min, p_word_max, actor.user_id);
  UPDATE institution.assignment a SET current_version = v_current + 1 WHERE a.id = p_assignment_id;
  RETURN v_current + 1;
END
$$;


--
-- Name: refuse_change(); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.refuse_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  RAISE EXCEPTION 'assignment version is immutable' USING ERRCODE = 'ZD403';
END
$$;


--
-- Name: remove_student(uuid, uuid); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.remove_student(p_course_id uuid, p_student_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  actor record;
  v_written integer;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('institution.enroll_with_code:' || p_student_id, 0));
  WITH ended AS (
    UPDATE institution.course_member m
       SET member_to = greatest(now(), m.member_from), removed_by = actor.user_id
     WHERE m.course_id = p_course_id AND m.user_id = p_student_id AND m.role = 'student' AND m.member_to IS NULL
    RETURNING m.id, m.course_id, m.user_id
  )
  INSERT INTO audit.course_member_event (institution_id, course_id, membership_id, student_id, kind, actor_id, occurred_at)
  SELECT actor.institution_id, ended.course_id, ended.id, ended.user_id, 'removed', actor.user_id, now() FROM ended;
  GET DIAGNOSTICS v_written = ROW_COUNT;
  RETURN v_written > 0;
END
$$;


--
-- Name: require_actor(); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.require_actor(OUT user_id uuid, OUT institution_id uuid) RETURNS record
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
BEGIN
  SELECT a.user_id, a.institution_id INTO user_id, institution_id FROM app.current_actor() a;
  IF user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
END
$$;


--
-- Name: revoke_enrollment_code(uuid); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.revoke_enrollment_code(p_course_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  actor record;
  v_written integer;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- The same lock, taken first, as create_enrollment_code: the audit row's
  -- foreign key needs a share lock on the course, so without it a revocation
  -- holding the code and an issue holding the course would wait on each other.
  PERFORM 1 FROM institution.course c WHERE c.id = p_course_id FOR UPDATE;
  WITH ended AS (
    UPDATE institution.course_enrollment_code e SET active = false
     WHERE e.course_id = p_course_id AND e.active
    RETURNING e.id
  )
  INSERT INTO audit.enrollment_code_event (institution_id, course_id, code_id, kind, actor_id, occurred_at)
  SELECT actor.institution_id, p_course_id, ended.id, 'revoked', actor.user_id, now() FROM ended;
  GET DIAGNOSTICS v_written = ROW_COUNT;
  RETURN v_written > 0;
END
$$;


--
-- Name: revoke_teacher_role(uuid); Type: FUNCTION; Schema: institution; Owner: -
--

CREATE FUNCTION institution.revoke_teacher_role(p_teacher_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF NOT institution.actor_has_role('admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  UPDATE institution.institution_role r SET revoked_at = now()
   WHERE r.institution_id = actor.institution_id AND r.user_id = p_teacher_id
     AND r.role = 'teacher' AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL;
  RETURN FOUND;
END
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: access_log; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.access_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    institution_id uuid NOT NULL,
    document_id text NOT NULL,
    assignment_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    reader_id uuid NOT NULL,
    reader_role text NOT NULL,
    surface text NOT NULL,
    opened_at timestamp with time zone NOT NULL,
    CONSTRAINT access_log_check CHECK ((reader_id <> owner_id)),
    CONSTRAINT access_log_document_id_check CHECK (((length(document_id) >= 1) AND (length(document_id) <= 256))),
    CONSTRAINT access_log_interval_check CHECK ((opened_at = date_bin('00:05:00'::interval, opened_at, '2000-01-01 00:00:00+00'::timestamp with time zone))),
    CONSTRAINT access_log_opened_at_check CHECK ((opened_at = date_bin('00:01:00'::interval, opened_at, '2000-01-01 00:00:00+00'::timestamp with time zone))),
    CONSTRAINT access_log_reader_role_check CHECK ((reader_role = 'teacher'::text)),
    CONSTRAINT access_log_surface_check CHECK ((surface = ANY (ARRAY['live_view'::text, 'process_summary'::text, 'fast_path'::text, 'replay'::text])))
);

ALTER TABLE ONLY audit.access_log FORCE ROW LEVEL SECURITY;


--
-- Name: course_member_event; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.course_member_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    institution_id uuid NOT NULL,
    course_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    student_id uuid NOT NULL,
    kind text NOT NULL,
    actor_id uuid NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    CONSTRAINT course_member_event_kind_check CHECK ((kind = ANY (ARRAY['removed'::text, 'return_allowed'::text])))
);

ALTER TABLE ONLY audit.course_member_event FORCE ROW LEVEL SECURITY;


--
-- Name: enrollment_code_event; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.enrollment_code_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    institution_id uuid NOT NULL,
    course_id uuid NOT NULL,
    code_id uuid NOT NULL,
    kind text NOT NULL,
    actor_id uuid NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    CONSTRAINT enrollment_code_event_kind_check CHECK ((kind = ANY (ARRAY['revoked'::text, 'replaced'::text])))
);

ALTER TABLE ONLY audit.enrollment_code_event FORCE ROW LEVEL SECURITY;


--
-- Name: comment; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.comment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    institution_id uuid NOT NULL,
    "position" integer NOT NULL,
    author_id uuid NOT NULL,
    author_role text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT comment_author_role_check CHECK ((author_role = ANY (ARRAY['teacher'::text, 'student'::text]))),
    CONSTRAINT comment_body_check CHECK (collaboration.is_comment_body(body)),
    CONSTRAINT comment_position_check CHECK ((("position" >= 1) AND ("position" <= 10000)))
);

ALTER TABLE ONLY collaboration.comment FORCE ROW LEVEL SECURITY;


--
-- Name: comment_thread; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.comment_thread (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    institution_id uuid NOT NULL,
    document_id text NOT NULL,
    assignment_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    anchor jsonb NOT NULL,
    state text DEFAULT 'open'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT comment_thread_anchor_check CHECK (collaboration.is_text_anchor(anchor)),
    CONSTRAINT comment_thread_document_id_check CHECK (((length(document_id) >= 1) AND (length(document_id) <= 256))),
    CONSTRAINT comment_thread_state_check CHECK ((state = ANY (ARRAY['open'::text, 'answered'::text, 'resolved'::text])))
);

ALTER TABLE ONLY collaboration.comment_thread FORCE ROW LEVEL SECURITY;


--
-- Name: live_state; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.live_state (
    document_id text NOT NULL,
    institution_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    body text NOT NULL,
    content_hash text NOT NULL,
    write_token uuid NOT NULL,
    CONSTRAINT live_state_body_check CHECK (((octet_length(body) >= 1) AND (octet_length(body) <= 2097152))),
    CONSTRAINT live_state_check CHECK ((content_hash = encode(sha256(convert_to(body, 'UTF8'::name)), 'hex'::text))),
    CONSTRAINT live_state_document_id_check CHECK (((length(document_id) >= 1) AND (length(document_id) <= 256)))
);

ALTER TABLE ONLY collaboration.live_state FORCE ROW LEVEL SECURITY;


--
-- Name: document; Type: TABLE; Schema: evidence; Owner: -
--

CREATE TABLE evidence.document (
    id text NOT NULL,
    institution_id uuid NOT NULL,
    project_id text NOT NULL,
    principal_id uuid NOT NULL,
    current_revision bigint DEFAULT 0 NOT NULL,
    current_content_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_current_content_hash_check CHECK ((current_content_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT document_current_revision_check CHECK (((current_revision >= 0) AND (current_revision <= '9007199254740991'::bigint))),
    CONSTRAINT document_id_check CHECK ((((length(id) >= 1) AND (length(id) <= 256)) AND (id = btrim(id)) AND (id !~ '[[:cntrl:]]'::text)))
);

ALTER TABLE ONLY evidence.document FORCE ROW LEVEL SECURITY;


--
-- Name: document_checkpoint; Type: TABLE; Schema: evidence; Owner: -
--

CREATE TABLE evidence.document_checkpoint (
    document_id text NOT NULL,
    institution_id uuid NOT NULL,
    revision bigint NOT NULL,
    body text NOT NULL,
    content_hash text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT document_checkpoint_body_check CHECK (((octet_length(body) >= 1) AND (octet_length(body) <= 2097152))),
    CONSTRAINT document_checkpoint_content_hash_check CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE ONLY evidence.document_checkpoint FORCE ROW LEVEL SECURITY;


--
-- Name: document_revision; Type: TABLE; Schema: evidence; Owner: -
--

CREATE TABLE evidence.document_revision (
    document_id text NOT NULL,
    institution_id uuid NOT NULL,
    revision bigint NOT NULL,
    base_revision bigint,
    principal_id uuid NOT NULL,
    content_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_revision_check CHECK ((((revision = 0) AND (base_revision IS NULL)) OR ((revision > 0) AND (base_revision IS NOT NULL) AND (base_revision = (revision - 1))))),
    CONSTRAINT document_revision_content_hash_check CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT document_revision_revision_check CHECK (((revision >= 0) AND (revision <= '9007199254740991'::bigint)))
);

ALTER TABLE ONLY evidence.document_revision FORCE ROW LEVEL SECURITY;


--
-- Name: domain; Type: TABLE; Schema: evidence; Owner: -
--

CREATE TABLE evidence.domain (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    institution_id uuid NOT NULL,
    region text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT domain_id_check CHECK (((id)::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'::text)),
    CONSTRAINT domain_region_check CHECK ((region ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))
);

ALTER TABLE ONLY evidence.domain FORCE ROW LEVEL SECURITY;


--
-- Name: fast_path_window; Type: TABLE; Schema: evidence; Owner: -
--

CREATE TABLE evidence.fast_path_window (
    reader_id uuid NOT NULL,
    institution_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    opened_at timestamp with time zone NOT NULL,
    works jsonb NOT NULL,
    CONSTRAINT fast_path_window_works_check CHECK ((jsonb_typeof(works) = 'object'::text))
);

ALTER TABLE ONLY evidence.fast_path_window FORCE ROW LEVEL SECURITY;


--
-- Name: package; Type: TABLE; Schema: evidence; Owner: -
--

CREATE TABLE evidence.package (
    id text NOT NULL,
    institution_id uuid NOT NULL,
    evidence_domain_id uuid NOT NULL,
    document_id text NOT NULL,
    project_id text NOT NULL,
    principal_id uuid NOT NULL,
    evidence_profile_id text NOT NULL,
    max_payload_bytes integer NOT NULL,
    accepts_evidence boolean DEFAULT true NOT NULL,
    head_segment_hash text,
    head_receipt_id uuid,
    last_sequence_to bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT package_check CHECK (((head_receipt_id IS NULL) = (head_segment_hash IS NULL))),
    CONSTRAINT package_check1 CHECK (((head_receipt_id IS NULL) = (last_sequence_to = 0))),
    CONSTRAINT package_evidence_profile_id_check CHECK (((length(evidence_profile_id) >= 1) AND (length(evidence_profile_id) <= 120))),
    CONSTRAINT package_head_segment_hash_check CHECK ((head_segment_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT package_id_check CHECK ((id ~ '^[a-z0-9][a-z0-9_-]{0,127}$'::text)),
    CONSTRAINT package_last_sequence_to_check CHECK (((last_sequence_to >= 0) AND (last_sequence_to <= '9007199254740991'::bigint))),
    CONSTRAINT package_max_payload_bytes_check CHECK (((max_payload_bytes >= 1) AND (max_payload_bytes <= 2097152)))
);

ALTER TABLE ONLY evidence.package FORCE ROW LEVEL SECURITY;


--
-- Name: project; Type: TABLE; Schema: evidence; Owner: -
--

CREATE TABLE evidence.project (
    id text NOT NULL,
    institution_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_id_check CHECK ((((length(id) >= 1) AND (length(id) <= 256)) AND (id = btrim(id)) AND (id !~ '[[:cntrl:]]'::text)))
);

ALTER TABLE ONLY evidence.project FORCE ROW LEVEL SECURITY;


--
-- Name: receipt; Type: TABLE; Schema: evidence; Owner: -
--

CREATE TABLE evidence.receipt (
    id uuid NOT NULL,
    evidence_package_id text NOT NULL,
    institution_id uuid NOT NULL,
    evidence_domain_id uuid NOT NULL,
    segment_id text NOT NULL,
    principal_id uuid NOT NULL,
    client_request_id text NOT NULL,
    previous_receipt_id uuid,
    payload_sha256 text NOT NULL,
    descriptor jsonb NOT NULL,
    receipt_payload text NOT NULL,
    status text NOT NULL,
    signature jsonb,
    key_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT receipt_check CHECK ((((status = 'pending_signature'::text) AND (signature IS NULL) AND (key_id IS NULL)) OR ((status = 'signed'::text) AND (signature IS NOT NULL) AND (key_id IS NOT NULL)))),
    CONSTRAINT receipt_client_request_id_check CHECK ((((length(client_request_id) >= 1) AND (length(client_request_id) <= 128)) AND (client_request_id !~ '[[:cntrl:]]'::text))),
    CONSTRAINT receipt_descriptor_check CHECK ((jsonb_typeof(descriptor) = 'object'::text)),
    CONSTRAINT receipt_payload_sha256_check CHECK ((payload_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT receipt_receipt_payload_check CHECK ((receipt_payload <> ''::text)),
    CONSTRAINT receipt_status_check CHECK ((status = ANY (ARRAY['pending_signature'::text, 'signed'::text])))
);

ALTER TABLE ONLY evidence.receipt FORCE ROW LEVEL SECURITY;


--
-- Name: segment; Type: TABLE; Schema: evidence; Owner: -
--

CREATE TABLE evidence.segment (
    id text NOT NULL,
    evidence_package_id text NOT NULL,
    institution_id uuid NOT NULL,
    document_id text NOT NULL,
    principal_id uuid NOT NULL,
    session_id text NOT NULL,
    sequence_from bigint NOT NULL,
    sequence_to bigint NOT NULL,
    event_count integer NOT NULL,
    descriptor jsonb NOT NULL,
    segment_hash text NOT NULL,
    payload_bytes integer NOT NULL,
    storage_ref text NOT NULL,
    accepted_at timestamp with time zone NOT NULL,
    CONSTRAINT segment_check CHECK (((sequence_to >= sequence_from) AND (sequence_to <= '9007199254740991'::bigint))),
    CONSTRAINT segment_check1 CHECK (((sequence_to - sequence_from) = (event_count - 1))),
    CONSTRAINT segment_check2 CHECK ((NOT ((descriptor ->> 'segmentHash'::text) IS DISTINCT FROM segment_hash))),
    CONSTRAINT segment_check3 CHECK ((NOT ((descriptor ->> 'payloadBytes'::text) IS DISTINCT FROM (payload_bytes)::text))),
    CONSTRAINT segment_descriptor_check CHECK ((jsonb_typeof(descriptor) = 'object'::text)),
    CONSTRAINT segment_event_count_check CHECK (((event_count >= 1) AND (event_count <= 5000))),
    CONSTRAINT segment_id_check CHECK ((((length(id) >= 1) AND (length(id) <= 256)) AND (id = btrim(id)) AND (id !~ '[[:cntrl:]]'::text))),
    CONSTRAINT segment_payload_bytes_check CHECK (((payload_bytes >= 1) AND (payload_bytes <= 2097152))),
    CONSTRAINT segment_segment_hash_check CHECK ((segment_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT segment_sequence_from_check CHECK (((sequence_from >= 1) AND (sequence_from <= '9007199254740991'::bigint))),
    CONSTRAINT segment_session_id_check CHECK ((((length(session_id) >= 1) AND (length(session_id) <= 256)) AND (session_id = btrim(session_id)) AND (session_id !~ '[[:cntrl:]]'::text))),
    CONSTRAINT segment_storage_ref_check CHECK ((((length(storage_ref) >= 1) AND (length(storage_ref) <= 2048)) AND (storage_ref !~ '[[:cntrl:]]'::text)))
);

ALTER TABLE ONLY evidence.segment FORCE ROW LEVEL SECURITY;


--
-- Name: signing_key; Type: TABLE; Schema: evidence; Owner: -
--

CREATE TABLE evidence.signing_key (
    key_id text NOT NULL,
    key_version text NOT NULL,
    evidence_domain_id uuid NOT NULL,
    institution_id uuid NOT NULL,
    purpose text NOT NULL,
    algorithm text NOT NULL,
    key_base64url text NOT NULL,
    valid_from timestamp with time zone NOT NULL,
    valid_to timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT signing_key_algorithm_check CHECK ((algorithm = 'Ed25519'::text)),
    CONSTRAINT signing_key_check CHECK ((valid_to > valid_from)),
    CONSTRAINT signing_key_key_base64url_check CHECK ((key_base64url ~ '^MCowBQYDK2VwAyEA[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text)),
    CONSTRAINT signing_key_key_id_check CHECK ((((length(key_id) >= 1) AND (length(key_id) <= 256)) AND (key_id = btrim(key_id)) AND (key_id !~ '[[:cntrl:]]'::text))),
    CONSTRAINT signing_key_key_version_check CHECK ((((length(key_version) >= 1) AND (length(key_version) <= 256)) AND (key_version = btrim(key_version)) AND (key_version !~ '[[:cntrl:]]'::text))),
    CONSTRAINT signing_key_purpose_check CHECK ((purpose = ANY (ARRAY['receipt'::text, 'checkpoint'::text]))),
    CONSTRAINT signing_key_valid_from_check CHECK ((date_trunc('minute'::text, (valid_from AT TIME ZONE 'UTC'::text)) = (valid_from AT TIME ZONE 'UTC'::text))),
    CONSTRAINT signing_key_valid_to_check CHECK ((date_trunc('minute'::text, (valid_to AT TIME ZONE 'UTC'::text)) = (valid_to AT TIME ZONE 'UTC'::text)))
);

ALTER TABLE ONLY evidence.signing_key FORCE ROW LEVEL SECURITY;


--
-- Name: submission; Type: TABLE; Schema: evidence; Owner: -
--

CREATE TABLE evidence.submission (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_request_id uuid NOT NULL,
    institution_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    assignment_version integer NOT NULL,
    revision bigint NOT NULL,
    artifact_hash text NOT NULL,
    requested_at timestamp with time zone NOT NULL,
    due_at timestamp with time zone NOT NULL,
    after_deadline boolean GENERATED ALWAYS AS ((requested_at > due_at)) STORED,
    recorded_at timestamp with time zone NOT NULL,
    CONSTRAINT submission_artifact_hash_check CHECK ((artifact_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT submission_check CHECK ((recorded_at >= requested_at))
);

ALTER TABLE ONLY evidence.submission FORCE ROW LEVEL SECURITY;


--
-- Name: submission_receipt; Type: TABLE; Schema: evidence; Owner: -
--

CREATE TABLE evidence.submission_receipt (
    submission_id uuid NOT NULL,
    institution_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    issuance_id uuid NOT NULL,
    key_id text NOT NULL,
    key_version text NOT NULL,
    signed_at timestamp with time zone NOT NULL,
    receipt_payload text NOT NULL,
    payload_digest_sha256 text NOT NULL,
    signature jsonb NOT NULL,
    CONSTRAINT submission_receipt_check CHECK ((payload_digest_sha256 = encode(sha256(convert_to(receipt_payload, 'UTF8'::name)), 'hex'::text))),
    CONSTRAINT submission_receipt_check1 CHECK ((((signature ->> 'keyId'::text) = key_id) AND ((signature ->> 'keyVersion'::text) = key_version)))
);

ALTER TABLE ONLY evidence.submission_receipt FORCE ROW LEVEL SECURITY;


--
-- Name: submission_receipt_issuance; Type: TABLE; Schema: evidence; Owner: -
--

CREATE TABLE evidence.submission_receipt_issuance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    institution_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    key_id text NOT NULL,
    key_version text NOT NULL,
    signed_at timestamp with time zone NOT NULL,
    receipt_payload text NOT NULL,
    payload_digest_sha256 text NOT NULL,
    CONSTRAINT submission_receipt_issuance_check CHECK ((payload_digest_sha256 = encode(sha256(convert_to(receipt_payload, 'UTF8'::name)), 'hex'::text)))
);

ALTER TABLE ONLY evidence.submission_receipt_issuance FORCE ROW LEVEL SECURITY;


--
-- Name: submission_request; Type: TABLE; Schema: evidence; Owner: -
--

CREATE TABLE evidence.submission_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    institution_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    assignment_version integer NOT NULL,
    project_id text NOT NULL,
    document_id text NOT NULL,
    principal_id uuid NOT NULL,
    revision bigint NOT NULL,
    content_hash text NOT NULL,
    requested_at timestamp with time zone NOT NULL,
    CONSTRAINT submission_request_content_hash_check CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT submission_request_revision_check CHECK (((revision >= 1) AND (revision <= '9007199254740991'::bigint)))
);

ALTER TABLE ONLY evidence.submission_request FORCE ROW LEVEL SECURITY;


--
-- Name: institution; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.institution (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    aai_home_org text,
    CONSTRAINT institution_aai_home_org_check CHECK (((char_length(aai_home_org) <= 253) AND (aai_home_org ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'::text))),
    CONSTRAINT institution_slug_check CHECK ((slug ~ '^[a-z0-9-]{2,32}$'::text))
);

ALTER TABLE ONLY identity.institution FORCE ROW LEVEL SECURITY;


--
-- Name: institution_issuer; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.institution_issuer (
    institution_id uuid NOT NULL,
    oidc_issuer text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT institution_issuer_oidc_issuer_check CHECK (((char_length(oidc_issuer) <= 255) AND (oidc_issuer ~ ('^https?://[!-~]+$'::text COLLATE "C"))))
);

ALTER TABLE ONLY identity.institution_issuer FORCE ROW LEVEL SECURITY;


--
-- Name: person_name; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.person_name (
    user_id uuid NOT NULL,
    institution_id uuid NOT NULL,
    given_name text NOT NULL,
    family_name text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT person_name_family_name_check CHECK (((length(family_name) >= 1) AND (length(family_name) <= 255))),
    CONSTRAINT person_name_given_name_check CHECK (((length(given_name) >= 1) AND (length(given_name) <= 255)))
);

ALTER TABLE ONLY identity.person_name FORCE ROW LEVEL SECURITY;


--
-- Name: session; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash bytea NOT NULL,
    user_id uuid NOT NULL,
    institution_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    close_reason text,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT session_check CHECK ((expires_at > created_at)),
    CONSTRAINT session_check1 CHECK (((closed_at IS NULL) = (close_reason IS NULL))),
    CONSTRAINT session_close_reason_check CHECK ((close_reason = ANY (ARRAY['logout'::text, 'backchannel_logout'::text, 'logout_all'::text]))),
    CONSTRAINT session_last_seen_check CHECK ((last_seen_at >= created_at)),
    CONSTRAINT session_token_hash_check CHECK ((octet_length(token_hash) = 32))
);

ALTER TABLE ONLY identity.session FORCE ROW LEVEL SECURITY;


--
-- Name: user_account; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.user_account (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    institution_id uuid NOT NULL,
    oidc_issuer text NOT NULL,
    oidc_subject text NOT NULL,
    hr_edu_person_unique_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_account_hr_edu_person_unique_id_check CHECK (((length(hr_edu_person_unique_id) >= 1) AND (length(hr_edu_person_unique_id) <= 255))),
    CONSTRAINT user_account_oidc_issuer_check CHECK (((length(oidc_issuer) >= 1) AND (length(oidc_issuer) <= 255))),
    CONSTRAINT user_account_oidc_subject_check CHECK (((length(oidc_subject) >= 1) AND (length(oidc_subject) <= 255)))
);

ALTER TABLE ONLY identity.user_account FORCE ROW LEVEL SECURITY;


--
-- Name: assignment; Type: TABLE; Schema: institution; Owner: -
--

CREATE TABLE institution.assignment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid,
    current_version integer DEFAULT 1 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    institution_id uuid NOT NULL,
    request_id uuid,
    mentorship_id uuid,
    CONSTRAINT assignment_course_or_mentorship_check CHECK ((num_nonnulls(course_id, mentorship_id) = 1))
);

ALTER TABLE ONLY institution.assignment FORCE ROW LEVEL SECURITY;


--
-- Name: assignment_version; Type: TABLE; Schema: institution; Owner: -
--

CREATE TABLE institution.assignment_version (
    assignment_id uuid NOT NULL,
    version_no integer NOT NULL,
    title text NOT NULL,
    instructions text NOT NULL,
    work_type text NOT NULL,
    opens_at timestamp with time zone NOT NULL,
    due_at timestamp with time zone NOT NULL,
    ai_policy text NOT NULL,
    ai_purposes text[] NOT NULL,
    evidence_profile text NOT NULL,
    import_allowed boolean NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    word_min integer,
    word_max integer,
    CONSTRAINT assignment_version_check CHECK (institution.is_assignment_content(title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes, evidence_profile, import_allowed)),
    CONSTRAINT assignment_version_version_no_check CHECK ((version_no >= 1)),
    CONSTRAINT assignment_version_word_range_check CHECK (institution.is_word_range(word_min, word_max))
);

ALTER TABLE ONLY institution.assignment_version FORCE ROW LEVEL SECURITY;


--
-- Name: course; Type: TABLE; Schema: institution; Owner: -
--

CREATE TABLE institution.course (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    institution_id uuid NOT NULL,
    name text NOT NULL,
    academic_year text NOT NULL,
    ai_policy text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT course_academic_year_check CHECK ((academic_year ~ '^[0-9]{4}/[0-9]{4}$'::text)),
    CONSTRAINT course_ai_policy_check CHECK ((ai_policy = ANY (ARRAY['prohibited'::text, 'partially_allowed'::text, 'encouraged'::text]))),
    CONSTRAINT course_name_check CHECK (institution.is_plain_label(name))
);

ALTER TABLE ONLY institution.course FORCE ROW LEVEL SECURITY;


--
-- Name: course_enrollment_code; Type: TABLE; Schema: institution; Owner: -
--

CREATE TABLE institution.course_enrollment_code (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    code_hash bytea NOT NULL,
    valid_until timestamp with time zone NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT course_enrollment_code_code_hash_check CHECK ((octet_length(code_hash) = 32))
);

ALTER TABLE ONLY institution.course_enrollment_code FORCE ROW LEVEL SECURITY;


--
-- Name: course_member; Type: TABLE; Schema: institution; Owner: -
--

CREATE TABLE institution.course_member (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    institution_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    member_from timestamp with time zone DEFAULT now() NOT NULL,
    member_to timestamp with time zone,
    removed_by uuid,
    return_allowed_at timestamp with time zone,
    CONSTRAINT course_member_check CHECK ((member_to >= member_from)),
    CONSTRAINT course_member_removal_check CHECK ((((removed_by IS NULL) OR ((role = 'student'::text) AND (member_to IS NOT NULL))) AND ((return_allowed_at IS NULL) OR (removed_by IS NOT NULL)))),
    CONSTRAINT course_member_role_check CHECK ((role = ANY (ARRAY['teacher'::text, 'student'::text])))
);

ALTER TABLE ONLY institution.course_member FORCE ROW LEVEL SECURITY;


--
-- Name: enrollment_attempt; Type: TABLE; Schema: institution; Owner: -
--

CREATE TABLE institution.enrollment_attempt (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY institution.enrollment_attempt FORCE ROW LEVEL SECURITY;


--
-- Name: faculty_work_rule; Type: TABLE; Schema: institution; Owner: -
--

CREATE TABLE institution.faculty_work_rule (
    institution_id uuid NOT NULL,
    work_type text NOT NULL,
    ai_policy text NOT NULL,
    ai_purposes text[] NOT NULL,
    evidence_profile text NOT NULL,
    import_allowed boolean NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT faculty_work_rule_ai_policy_check CHECK ((institution.ai_policy_rank(ai_policy) IS NOT NULL)),
    CONSTRAINT faculty_work_rule_ai_purposes_check CHECK (((ai_purposes <@ ARRAY['formatting'::text, 'proofreading'::text, 'literature_search'::text, 'transcription'::text, 'translation'::text]) AND (cardinality(ai_purposes) <= 5) AND (COALESCE(array_ndims(ai_purposes), 1) = 1))),
    CONSTRAINT faculty_work_rule_check CHECK (((ai_policy <> 'prohibited'::text) OR (cardinality(ai_purposes) = 0))),
    CONSTRAINT faculty_work_rule_evidence_profile_check CHECK ((evidence_profile = ANY (ARRAY['basic'::text, 'extended'::text]))),
    CONSTRAINT faculty_work_rule_work_type_check CHECK ((work_type = ANY (ARRAY['short_paper'::text, 'essay'::text, 'seminar_paper'::text, 'bachelor_thesis'::text, 'master_thesis'::text, 'specialist_thesis'::text, 'doctoral_thesis'::text])))
);

ALTER TABLE ONLY institution.faculty_work_rule FORCE ROW LEVEL SECURITY;


--
-- Name: institution_role; Type: TABLE; Schema: institution; Owner: -
--

CREATE TABLE institution.institution_role (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    institution_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    confirmed_by uuid,
    confirmed_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT institution_role_check CHECK (((confirmed_by IS NULL) OR (confirmed_at IS NOT NULL))),
    CONSTRAINT institution_role_role_check CHECK ((role = ANY (ARRAY['teacher'::text, 'admin'::text])))
);

ALTER TABLE ONLY institution.institution_role FORCE ROW LEVEL SECURITY;


--
-- Name: institution_settings; Type: TABLE; Schema: institution; Owner: -
--

CREATE TABLE institution.institution_settings (
    institution_id uuid NOT NULL,
    display_name text NOT NULL,
    enrollment_attempt_limit integer DEFAULT 5 NOT NULL,
    enrollment_attempt_window interval DEFAULT '00:15:00'::interval NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT institution_settings_display_name_check CHECK (institution.is_plain_label(display_name)),
    CONSTRAINT institution_settings_enrollment_attempt_limit_check CHECK (((enrollment_attempt_limit >= 1) AND (enrollment_attempt_limit <= 100))),
    CONSTRAINT institution_settings_enrollment_attempt_window_check CHECK ((((enrollment_attempt_window >= '00:01:00'::interval) AND (enrollment_attempt_window <= '24:00:00'::interval)) AND (EXTRACT(day FROM enrollment_attempt_window) = (0)::numeric)))
);

ALTER TABLE ONLY institution.institution_settings FORCE ROW LEVEL SECURITY;


--
-- Name: mentorship; Type: TABLE; Schema: institution; Owner: -
--

CREATE TABLE institution.mentorship (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    institution_id uuid NOT NULL,
    mentor_id uuid NOT NULL,
    student_id uuid NOT NULL,
    work_type text NOT NULL,
    confirmed_by uuid,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    CONSTRAINT mentorship_check CHECK ((mentor_id <> student_id)),
    CONSTRAINT mentorship_check1 CHECK ((ended_at >= started_at)),
    CONSTRAINT mentorship_work_type_check CHECK ((work_type = ANY (ARRAY['bachelor_thesis'::text, 'master_thesis'::text, 'specialist_thesis'::text, 'doctoral_thesis'::text])))
);

ALTER TABLE ONLY institution.mentorship FORCE ROW LEVEL SECURITY;


--
-- Name: notice_acknowledgment; Type: TABLE; Schema: institution; Owner: -
--

CREATE TABLE institution.notice_acknowledgment (
    assignment_id uuid NOT NULL,
    version_no integer NOT NULL,
    student_id uuid NOT NULL,
    acknowledged_at timestamp with time zone DEFAULT now() NOT NULL,
    institution_id uuid NOT NULL
);

ALTER TABLE ONLY institution.notice_acknowledgment FORCE ROW LEVEL SECURITY;


--
-- Name: notification; Type: TABLE; Schema: institution; Owner: -
--

CREATE TABLE institution.notification (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    institution_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    kind text NOT NULL,
    event_key text NOT NULL,
    target_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    CONSTRAINT notification_check CHECK (((event_key ~ '^(comment_posted|assignment_version|submission_recorded):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:[1-9][0-9]{0,9})?$'::text) AND (event_key ~~ (kind || ':%'::text)) AND ((kind = 'assignment_version'::text) = (event_key ~ ':[1-9][0-9]{0,9}$'::text)))),
    CONSTRAINT notification_kind_check CHECK ((kind = ANY (ARRAY['comment_posted'::text, 'assignment_version'::text, 'submission_recorded'::text])))
);

ALTER TABLE ONLY institution.notification FORCE ROW LEVEL SECURITY;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: access_log access_log_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.access_log
    ADD CONSTRAINT access_log_pkey PRIMARY KEY (id);


--
-- Name: course_member_event course_member_event_membership_id_kind_key; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.course_member_event
    ADD CONSTRAINT course_member_event_membership_id_kind_key UNIQUE (membership_id, kind);


--
-- Name: course_member_event course_member_event_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.course_member_event
    ADD CONSTRAINT course_member_event_pkey PRIMARY KEY (id);


--
-- Name: enrollment_code_event enrollment_code_event_code_id_key; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.enrollment_code_event
    ADD CONSTRAINT enrollment_code_event_code_id_key UNIQUE (code_id);


--
-- Name: enrollment_code_event enrollment_code_event_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.enrollment_code_event
    ADD CONSTRAINT enrollment_code_event_pkey PRIMARY KEY (id);


--
-- Name: comment comment_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.comment
    ADD CONSTRAINT comment_pkey PRIMARY KEY (id);


--
-- Name: comment_thread comment_thread_id_institution_id_key; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.comment_thread
    ADD CONSTRAINT comment_thread_id_institution_id_key UNIQUE (id, institution_id);


--
-- Name: comment comment_thread_id_position_key; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.comment
    ADD CONSTRAINT comment_thread_id_position_key UNIQUE (thread_id, "position");


--
-- Name: comment_thread comment_thread_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.comment_thread
    ADD CONSTRAINT comment_thread_pkey PRIMARY KEY (id);


--
-- Name: live_state live_state_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.live_state
    ADD CONSTRAINT live_state_pkey PRIMARY KEY (document_id, institution_id);


--
-- Name: document_checkpoint document_checkpoint_pkey; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.document_checkpoint
    ADD CONSTRAINT document_checkpoint_pkey PRIMARY KEY (document_id, institution_id, revision);


--
-- Name: document document_id_institution_id_current_revision_current_content_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.document
    ADD CONSTRAINT document_id_institution_id_current_revision_current_content_key UNIQUE (id, institution_id, current_revision, current_content_hash);


--
-- Name: document document_id_institution_id_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.document
    ADD CONSTRAINT document_id_institution_id_key UNIQUE (id, institution_id);


--
-- Name: document document_id_institution_id_principal_id_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.document
    ADD CONSTRAINT document_id_institution_id_principal_id_key UNIQUE (id, institution_id, principal_id);


--
-- Name: document document_id_institution_id_project_id_principal_id_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.document
    ADD CONSTRAINT document_id_institution_id_project_id_principal_id_key UNIQUE (id, institution_id, project_id, principal_id);


--
-- Name: document document_pkey; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.document
    ADD CONSTRAINT document_pkey PRIMARY KEY (id);


--
-- Name: document_revision document_revision_document_id_institution_id_revision_conte_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.document_revision
    ADD CONSTRAINT document_revision_document_id_institution_id_revision_conte_key UNIQUE (document_id, institution_id, revision, content_hash);


--
-- Name: document_revision document_revision_pkey; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.document_revision
    ADD CONSTRAINT document_revision_pkey PRIMARY KEY (document_id, institution_id, revision);


--
-- Name: domain domain_id_institution_id_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.domain
    ADD CONSTRAINT domain_id_institution_id_key UNIQUE (id, institution_id);


--
-- Name: domain domain_institution_id_region_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.domain
    ADD CONSTRAINT domain_institution_id_region_key UNIQUE (institution_id, region);


--
-- Name: domain domain_pkey; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.domain
    ADD CONSTRAINT domain_pkey PRIMARY KEY (id);


--
-- Name: project evidence_project_assignment_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.project
    ADD CONSTRAINT evidence_project_assignment_key UNIQUE (id, institution_id, principal_id, assignment_id);


--
-- Name: project evidence_project_one_per_student; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.project
    ADD CONSTRAINT evidence_project_one_per_student UNIQUE (assignment_id, institution_id, principal_id);


--
-- Name: submission_request evidence_submission_request_pinned_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission_request
    ADD CONSTRAINT evidence_submission_request_pinned_key UNIQUE (id, institution_id, principal_id, assignment_id, assignment_version, revision, content_hash, requested_at);


--
-- Name: fast_path_window fast_path_window_pkey; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.fast_path_window
    ADD CONSTRAINT fast_path_window_pkey PRIMARY KEY (reader_id, assignment_id);


--
-- Name: package package_id_institution_id_document_id_principal_id_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.package
    ADD CONSTRAINT package_id_institution_id_document_id_principal_id_key UNIQUE (id, institution_id, document_id, principal_id);


--
-- Name: package package_id_institution_id_evidence_domain_id_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.package
    ADD CONSTRAINT package_id_institution_id_evidence_domain_id_key UNIQUE (id, institution_id, evidence_domain_id);


--
-- Name: package package_id_institution_id_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.package
    ADD CONSTRAINT package_id_institution_id_key UNIQUE (id, institution_id);


--
-- Name: package package_pkey; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.package
    ADD CONSTRAINT package_pkey PRIMARY KEY (id);


--
-- Name: project project_id_institution_id_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.project
    ADD CONSTRAINT project_id_institution_id_key UNIQUE (id, institution_id);


--
-- Name: project project_id_institution_id_principal_id_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.project
    ADD CONSTRAINT project_id_institution_id_principal_id_key UNIQUE (id, institution_id, principal_id);


--
-- Name: project project_pkey; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.project
    ADD CONSTRAINT project_pkey PRIMARY KEY (id);


--
-- Name: receipt receipt_evidence_package_id_institution_id_principal_id_cli_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.receipt
    ADD CONSTRAINT receipt_evidence_package_id_institution_id_principal_id_cli_key UNIQUE (evidence_package_id, institution_id, principal_id, client_request_id);


--
-- Name: receipt receipt_id_evidence_package_id_institution_id_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.receipt
    ADD CONSTRAINT receipt_id_evidence_package_id_institution_id_key UNIQUE (id, evidence_package_id, institution_id);


--
-- Name: receipt receipt_pkey; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.receipt
    ADD CONSTRAINT receipt_pkey PRIMARY KEY (id);


--
-- Name: segment segment_evidence_package_id_institution_id_sequence_from_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.segment
    ADD CONSTRAINT segment_evidence_package_id_institution_id_sequence_from_key UNIQUE (evidence_package_id, institution_id, sequence_from);


--
-- Name: segment segment_id_evidence_package_id_institution_id_principal_id_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.segment
    ADD CONSTRAINT segment_id_evidence_package_id_institution_id_principal_id_key UNIQUE (id, evidence_package_id, institution_id, principal_id);


--
-- Name: segment segment_pkey; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.segment
    ADD CONSTRAINT segment_pkey PRIMARY KEY (id, evidence_package_id, institution_id);


--
-- Name: signing_key signing_key_key_base64url_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.signing_key
    ADD CONSTRAINT signing_key_key_base64url_key UNIQUE (key_base64url);


--
-- Name: signing_key signing_key_pkey; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.signing_key
    ADD CONSTRAINT signing_key_pkey PRIMARY KEY (key_id);


--
-- Name: submission submission_assignment_id_institution_id_principal_id_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission
    ADD CONSTRAINT submission_assignment_id_institution_id_principal_id_key UNIQUE (assignment_id, institution_id, principal_id);


--
-- Name: submission submission_issuance_identity_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission
    ADD CONSTRAINT submission_issuance_identity_key UNIQUE (id, institution_id, principal_id);


--
-- Name: submission submission_pkey; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission
    ADD CONSTRAINT submission_pkey PRIMARY KEY (id);


--
-- Name: submission_receipt_issuance submission_receipt_issuance_binding_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission_receipt_issuance
    ADD CONSTRAINT submission_receipt_issuance_binding_key UNIQUE (id, submission_id, institution_id, principal_id);


--
-- Name: submission_receipt submission_receipt_issuance_id_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission_receipt
    ADD CONSTRAINT submission_receipt_issuance_id_key UNIQUE (issuance_id);


--
-- Name: submission_receipt_issuance submission_receipt_issuance_pkey; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission_receipt_issuance
    ADD CONSTRAINT submission_receipt_issuance_pkey PRIMARY KEY (id);


--
-- Name: submission_receipt submission_receipt_pkey; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission_receipt
    ADD CONSTRAINT submission_receipt_pkey PRIMARY KEY (submission_id);


--
-- Name: submission_request submission_request_assignment_id_institution_id_principal_i_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission_request
    ADD CONSTRAINT submission_request_assignment_id_institution_id_principal_i_key UNIQUE (assignment_id, institution_id, principal_id);


--
-- Name: submission_request submission_request_id_institution_id_principal_id_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission_request
    ADD CONSTRAINT submission_request_id_institution_id_principal_id_key UNIQUE (id, institution_id, principal_id);


--
-- Name: submission_request submission_request_pkey; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission_request
    ADD CONSTRAINT submission_request_pkey PRIMARY KEY (id);


--
-- Name: submission submission_submission_request_id_key; Type: CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission
    ADD CONSTRAINT submission_submission_request_id_key UNIQUE (submission_request_id);


--
-- Name: institution institution_aai_home_org_key; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.institution
    ADD CONSTRAINT institution_aai_home_org_key UNIQUE (aai_home_org);


--
-- Name: institution_issuer institution_issuer_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.institution_issuer
    ADD CONSTRAINT institution_issuer_pkey PRIMARY KEY (institution_id, oidc_issuer);


--
-- Name: institution institution_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.institution
    ADD CONSTRAINT institution_pkey PRIMARY KEY (id);


--
-- Name: institution institution_slug_key; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.institution
    ADD CONSTRAINT institution_slug_key UNIQUE (slug);


--
-- Name: person_name person_name_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.person_name
    ADD CONSTRAINT person_name_pkey PRIMARY KEY (user_id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: session session_token_hash_key; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.session
    ADD CONSTRAINT session_token_hash_key UNIQUE (token_hash);


--
-- Name: user_account user_account_id_institution_id_key; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_account
    ADD CONSTRAINT user_account_id_institution_id_key UNIQUE (id, institution_id);


--
-- Name: user_account user_account_oidc_issuer_hr_edu_person_unique_id_key; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_account
    ADD CONSTRAINT user_account_oidc_issuer_hr_edu_person_unique_id_key UNIQUE (oidc_issuer, hr_edu_person_unique_id);


--
-- Name: user_account user_account_oidc_issuer_oidc_subject_key; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_account
    ADD CONSTRAINT user_account_oidc_issuer_oidc_subject_key UNIQUE (oidc_issuer, oidc_subject);


--
-- Name: user_account user_account_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_account
    ADD CONSTRAINT user_account_pkey PRIMARY KEY (id);


--
-- Name: assignment assignment_id_institution_key; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.assignment
    ADD CONSTRAINT assignment_id_institution_key UNIQUE (id, institution_id);


--
-- Name: assignment assignment_pkey; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.assignment
    ADD CONSTRAINT assignment_pkey PRIMARY KEY (id);


--
-- Name: assignment_version assignment_version_due_key; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.assignment_version
    ADD CONSTRAINT assignment_version_due_key UNIQUE (assignment_id, version_no, due_at);


--
-- Name: assignment_version assignment_version_pkey; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.assignment_version
    ADD CONSTRAINT assignment_version_pkey PRIMARY KEY (assignment_id, version_no);


--
-- Name: course_enrollment_code course_enrollment_code_code_hash_key; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.course_enrollment_code
    ADD CONSTRAINT course_enrollment_code_code_hash_key UNIQUE (code_hash);


--
-- Name: course_enrollment_code course_enrollment_code_pkey; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.course_enrollment_code
    ADD CONSTRAINT course_enrollment_code_pkey PRIMARY KEY (id);


--
-- Name: course course_id_institution_id_key; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.course
    ADD CONSTRAINT course_id_institution_id_key UNIQUE (id, institution_id);


--
-- Name: course course_institution_id_created_by_academic_year_name_key; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.course
    ADD CONSTRAINT course_institution_id_created_by_academic_year_name_key UNIQUE (institution_id, created_by, academic_year, name);


--
-- Name: course_member course_member_binding_key; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.course_member
    ADD CONSTRAINT course_member_binding_key UNIQUE (id, course_id, user_id, institution_id);


--
-- Name: course_member course_member_pkey; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.course_member
    ADD CONSTRAINT course_member_pkey PRIMARY KEY (id);


--
-- Name: course course_pkey; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.course
    ADD CONSTRAINT course_pkey PRIMARY KEY (id);


--
-- Name: enrollment_attempt enrollment_attempt_pkey; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.enrollment_attempt
    ADD CONSTRAINT enrollment_attempt_pkey PRIMARY KEY (id);


--
-- Name: faculty_work_rule faculty_work_rule_pkey; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.faculty_work_rule
    ADD CONSTRAINT faculty_work_rule_pkey PRIMARY KEY (institution_id, work_type);


--
-- Name: institution_role institution_role_pkey; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.institution_role
    ADD CONSTRAINT institution_role_pkey PRIMARY KEY (id);


--
-- Name: institution_settings institution_settings_pkey; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.institution_settings
    ADD CONSTRAINT institution_settings_pkey PRIMARY KEY (institution_id);


--
-- Name: mentorship mentorship_id_institution_id_key; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.mentorship
    ADD CONSTRAINT mentorship_id_institution_id_key UNIQUE (id, institution_id);


--
-- Name: mentorship mentorship_pkey; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.mentorship
    ADD CONSTRAINT mentorship_pkey PRIMARY KEY (id);


--
-- Name: notice_acknowledgment notice_acknowledgment_pkey; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.notice_acknowledgment
    ADD CONSTRAINT notice_acknowledgment_pkey PRIMARY KEY (assignment_id, version_no, student_id);


--
-- Name: notification notification_pkey; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.notification
    ADD CONSTRAINT notification_pkey PRIMARY KEY (id);


--
-- Name: notification notification_recipient_id_event_key_key; Type: CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.notification
    ADD CONSTRAINT notification_recipient_id_event_key_key UNIQUE (recipient_id, event_key);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: access_log_document_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX access_log_document_idx ON audit.access_log USING btree (document_id, institution_id, opened_at);


--
-- Name: access_log_opening_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE UNIQUE INDEX access_log_opening_idx ON audit.access_log USING btree (document_id, institution_id, reader_id, surface, opened_at);


--
-- Name: course_member_event_course_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX course_member_event_course_idx ON audit.course_member_event USING btree (course_id, occurred_at);


--
-- Name: enrollment_code_event_course_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX enrollment_code_event_course_idx ON audit.enrollment_code_event USING btree (course_id, occurred_at);


--
-- Name: comment_thread_document_idx; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX comment_thread_document_idx ON collaboration.comment_thread USING btree (document_id, institution_id);


--
-- Name: evidence_document_project_idx; Type: INDEX; Schema: evidence; Owner: -
--

CREATE INDEX evidence_document_project_idx ON evidence.document USING btree (project_id, institution_id);


--
-- Name: evidence_package_document_idx; Type: INDEX; Schema: evidence; Owner: -
--

CREATE INDEX evidence_package_document_idx ON evidence.package USING btree (document_id, institution_id);


--
-- Name: evidence_project_assignment_idx; Type: INDEX; Schema: evidence; Owner: -
--

CREATE INDEX evidence_project_assignment_idx ON evidence.project USING btree (assignment_id, institution_id);


--
-- Name: evidence_receipt_pending_idx; Type: INDEX; Schema: evidence; Owner: -
--

CREATE INDEX evidence_receipt_pending_idx ON evidence.receipt USING btree (evidence_domain_id, created_at, id) WHERE (status = 'pending_signature'::text);


--
-- Name: evidence_receipt_principal_idx; Type: INDEX; Schema: evidence; Owner: -
--

CREATE INDEX evidence_receipt_principal_idx ON evidence.receipt USING btree (principal_id, institution_id, evidence_package_id);


--
-- Name: evidence_revision_principal_idx; Type: INDEX; Schema: evidence; Owner: -
--

CREATE INDEX evidence_revision_principal_idx ON evidence.document_revision USING btree (principal_id, institution_id, document_id);


--
-- Name: evidence_segment_principal_idx; Type: INDEX; Schema: evidence; Owner: -
--

CREATE INDEX evidence_segment_principal_idx ON evidence.segment USING btree (principal_id, institution_id, evidence_package_id);


--
-- Name: evidence_signing_key_domain_idx; Type: INDEX; Schema: evidence; Owner: -
--

CREATE INDEX evidence_signing_key_domain_idx ON evidence.signing_key USING btree (evidence_domain_id, institution_id);


--
-- Name: evidence_submission_principal_idx; Type: INDEX; Schema: evidence; Owner: -
--

CREATE INDEX evidence_submission_principal_idx ON evidence.submission USING btree (principal_id, institution_id);


--
-- Name: evidence_submission_request_document_idx; Type: INDEX; Schema: evidence; Owner: -
--

CREATE INDEX evidence_submission_request_document_idx ON evidence.submission_request USING btree (document_id, institution_id, revision, content_hash);


--
-- Name: evidence_submission_request_pin_idx; Type: INDEX; Schema: evidence; Owner: -
--

CREATE INDEX evidence_submission_request_pin_idx ON evidence.submission USING btree (submission_request_id, institution_id, principal_id, assignment_id, assignment_version, revision, artifact_hash, requested_at);


--
-- Name: evidence_submission_request_principal_idx; Type: INDEX; Schema: evidence; Owner: -
--

CREATE INDEX evidence_submission_request_principal_idx ON evidence.submission_request USING btree (principal_id, institution_id);


--
-- Name: evidence_submission_version_idx; Type: INDEX; Schema: evidence; Owner: -
--

CREATE INDEX evidence_submission_version_idx ON evidence.submission USING btree (assignment_id, assignment_version, due_at);


--
-- Name: submission_receipt_issuance_submission_idx; Type: INDEX; Schema: evidence; Owner: -
--

CREATE INDEX submission_receipt_issuance_submission_idx ON evidence.submission_receipt_issuance USING btree (submission_id);


--
-- Name: session_user_id_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX session_user_id_idx ON identity.session USING btree (user_id);


--
-- Name: assignment_course_idx; Type: INDEX; Schema: institution; Owner: -
--

CREATE INDEX assignment_course_idx ON institution.assignment USING btree (course_id);


--
-- Name: assignment_created_by_request_id_idx; Type: INDEX; Schema: institution; Owner: -
--

CREATE UNIQUE INDEX assignment_created_by_request_id_idx ON institution.assignment USING btree (created_by, request_id) WHERE (request_id IS NOT NULL);


--
-- Name: assignment_mentorship_idx; Type: INDEX; Schema: institution; Owner: -
--

CREATE UNIQUE INDEX assignment_mentorship_idx ON institution.assignment USING btree (mentorship_id) WHERE (mentorship_id IS NOT NULL);


--
-- Name: course_enrollment_code_active_idx; Type: INDEX; Schema: institution; Owner: -
--

CREATE UNIQUE INDEX course_enrollment_code_active_idx ON institution.course_enrollment_code USING btree (course_id) WHERE active;


--
-- Name: course_member_open_idx; Type: INDEX; Schema: institution; Owner: -
--

CREATE UNIQUE INDEX course_member_open_idx ON institution.course_member USING btree (course_id, user_id) WHERE (member_to IS NULL);


--
-- Name: course_member_user_idx; Type: INDEX; Schema: institution; Owner: -
--

CREATE INDEX course_member_user_idx ON institution.course_member USING btree (user_id);


--
-- Name: enrollment_attempt_user_idx; Type: INDEX; Schema: institution; Owner: -
--

CREATE INDEX enrollment_attempt_user_idx ON institution.enrollment_attempt USING btree (user_id, attempted_at);


--
-- Name: institution_role_open_idx; Type: INDEX; Schema: institution; Owner: -
--

CREATE UNIQUE INDEX institution_role_open_idx ON institution.institution_role USING btree (institution_id, user_id, role) WHERE (revoked_at IS NULL);


--
-- Name: mentorship_mentor_open_idx; Type: INDEX; Schema: institution; Owner: -
--

CREATE INDEX mentorship_mentor_open_idx ON institution.mentorship USING btree (mentor_id) WHERE (ended_at IS NULL);


--
-- Name: mentorship_open_idx; Type: INDEX; Schema: institution; Owner: -
--

CREATE UNIQUE INDEX mentorship_open_idx ON institution.mentorship USING btree (institution_id, student_id, work_type) WHERE (ended_at IS NULL);


--
-- Name: mentorship_student_idx; Type: INDEX; Schema: institution; Owner: -
--

CREATE INDEX mentorship_student_idx ON institution.mentorship USING btree (student_id);


--
-- Name: notice_acknowledgment_student_idx; Type: INDEX; Schema: institution; Owner: -
--

CREATE INDEX notice_acknowledgment_student_idx ON institution.notice_acknowledgment USING btree (student_id);


--
-- Name: notification_recipient_order_idx; Type: INDEX; Schema: institution; Owner: -
--

CREATE INDEX notification_recipient_order_idx ON institution.notification USING btree (recipient_id, created_at DESC, id DESC);


--
-- Name: access_log access_log_append_only; Type: TRIGGER; Schema: audit; Owner: -
--

CREATE TRIGGER access_log_append_only BEFORE DELETE OR UPDATE ON audit.access_log FOR EACH ROW EXECUTE FUNCTION audit.reject_change();


--
-- Name: access_log access_log_no_truncate; Type: TRIGGER; Schema: audit; Owner: -
--

CREATE TRIGGER access_log_no_truncate BEFORE TRUNCATE ON audit.access_log FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_change();


--
-- Name: course_member_event course_member_event_append_only; Type: TRIGGER; Schema: audit; Owner: -
--

CREATE TRIGGER course_member_event_append_only BEFORE DELETE OR UPDATE ON audit.course_member_event FOR EACH ROW EXECUTE FUNCTION audit.reject_change();


--
-- Name: course_member_event course_member_event_no_truncate; Type: TRIGGER; Schema: audit; Owner: -
--

CREATE TRIGGER course_member_event_no_truncate BEFORE TRUNCATE ON audit.course_member_event FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_change();


--
-- Name: enrollment_code_event enrollment_code_event_append_only; Type: TRIGGER; Schema: audit; Owner: -
--

CREATE TRIGGER enrollment_code_event_append_only BEFORE DELETE OR UPDATE ON audit.enrollment_code_event FOR EACH ROW EXECUTE FUNCTION audit.reject_change();


--
-- Name: enrollment_code_event enrollment_code_event_no_truncate; Type: TRIGGER; Schema: audit; Owner: -
--

CREATE TRIGGER enrollment_code_event_no_truncate BEFORE TRUNCATE ON audit.enrollment_code_event FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_change();


--
-- Name: document_checkpoint evidence_checkpoint_immutable; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER evidence_checkpoint_immutable BEFORE UPDATE ON evidence.document_checkpoint FOR EACH ROW EXECUTE FUNCTION evidence.reject_append_only_change();


--
-- Name: document_checkpoint evidence_checkpoint_no_truncate; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER evidence_checkpoint_no_truncate BEFORE TRUNCATE ON evidence.document_checkpoint FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();


--
-- Name: document_checkpoint evidence_checkpoint_seal; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER evidence_checkpoint_seal BEFORE INSERT ON evidence.document_checkpoint FOR EACH ROW EXECUTE FUNCTION evidence.seal_document_checkpoint();


--
-- Name: package evidence_package_stays_closed; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER evidence_package_stays_closed BEFORE INSERT OR UPDATE OF accepts_evidence ON evidence.package FOR EACH ROW EXECUTE FUNCTION evidence.keep_submitted_package_closed();


--
-- Name: receipt evidence_receipt_immutable; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER evidence_receipt_immutable BEFORE DELETE OR UPDATE ON evidence.receipt FOR EACH ROW EXECUTE FUNCTION evidence.guard_receipt_transition();


--
-- Name: receipt evidence_receipt_no_truncate; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER evidence_receipt_no_truncate BEFORE TRUNCATE ON evidence.receipt FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();


--
-- Name: document_revision evidence_revision_immutable; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER evidence_revision_immutable BEFORE DELETE OR UPDATE ON evidence.document_revision FOR EACH ROW EXECUTE FUNCTION evidence.reject_append_only_change();


--
-- Name: document_revision evidence_revision_no_truncate; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER evidence_revision_no_truncate BEFORE TRUNCATE ON evidence.document_revision FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();


--
-- Name: segment evidence_segment_immutable; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER evidence_segment_immutable BEFORE DELETE OR UPDATE ON evidence.segment FOR EACH ROW EXECUTE FUNCTION evidence.reject_append_only_change();


--
-- Name: segment evidence_segment_no_truncate; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER evidence_segment_no_truncate BEFORE TRUNCATE ON evidence.segment FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();


--
-- Name: signing_key evidence_signing_key_immutable; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER evidence_signing_key_immutable BEFORE DELETE OR UPDATE ON evidence.signing_key FOR EACH ROW EXECUTE FUNCTION evidence.guard_signing_key_change();


--
-- Name: signing_key evidence_signing_key_no_truncate; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER evidence_signing_key_no_truncate BEFORE TRUNCATE ON evidence.signing_key FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();


--
-- Name: submission evidence_submission_closes_package; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER evidence_submission_closes_package AFTER INSERT ON evidence.submission FOR EACH ROW EXECUTE FUNCTION evidence.close_submitted_packages();


--
-- Name: submission evidence_submission_immutable; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER evidence_submission_immutable BEFORE DELETE OR UPDATE ON evidence.submission FOR EACH ROW EXECUTE FUNCTION evidence.reject_append_only_change();


--
-- Name: submission evidence_submission_no_truncate; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER evidence_submission_no_truncate BEFORE TRUNCATE ON evidence.submission FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();


--
-- Name: submission_request evidence_submission_request_immutable; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER evidence_submission_request_immutable BEFORE DELETE OR UPDATE ON evidence.submission_request FOR EACH ROW EXECUTE FUNCTION evidence.reject_append_only_change();


--
-- Name: submission_request evidence_submission_request_no_truncate; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER evidence_submission_request_no_truncate BEFORE TRUNCATE ON evidence.submission_request FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();


--
-- Name: submission_receipt submission_receipt_immutable; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER submission_receipt_immutable BEFORE DELETE OR UPDATE ON evidence.submission_receipt FOR EACH ROW EXECUTE FUNCTION evidence.reject_append_only_change();


--
-- Name: submission_receipt_issuance submission_receipt_issuance_immutable; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER submission_receipt_issuance_immutable BEFORE DELETE OR UPDATE ON evidence.submission_receipt_issuance FOR EACH ROW EXECUTE FUNCTION evidence.reject_append_only_change();


--
-- Name: submission_receipt_issuance submission_receipt_issuance_no_truncate; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER submission_receipt_issuance_no_truncate BEFORE TRUNCATE ON evidence.submission_receipt_issuance FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();


--
-- Name: submission_receipt submission_receipt_no_truncate; Type: TRIGGER; Schema: evidence; Owner: -
--

CREATE TRIGGER submission_receipt_no_truncate BEFORE TRUNCATE ON evidence.submission_receipt FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();


--
-- Name: assignment_version assignment_version_immutable; Type: TRIGGER; Schema: institution; Owner: -
--

CREATE TRIGGER assignment_version_immutable BEFORE DELETE OR UPDATE ON institution.assignment_version FOR EACH ROW EXECUTE FUNCTION institution.refuse_change();


--
-- Name: assignment_version assignment_version_mentorship_rule; Type: TRIGGER; Schema: institution; Owner: -
--

CREATE TRIGGER assignment_version_mentorship_rule BEFORE INSERT ON institution.assignment_version FOR EACH ROW EXECUTE FUNCTION institution.check_mentorship_version();


--
-- Name: assignment_version assignment_version_no_truncate; Type: TRIGGER; Schema: institution; Owner: -
--

CREATE TRIGGER assignment_version_no_truncate BEFORE TRUNCATE ON institution.assignment_version FOR EACH STATEMENT EXECUTE FUNCTION institution.refuse_change();


--
-- Name: assignment_version assignment_version_notify; Type: TRIGGER; Schema: institution; Owner: -
--

CREATE TRIGGER assignment_version_notify AFTER INSERT ON institution.assignment_version FOR EACH ROW WHEN ((new.version_no > 1)) EXECUTE FUNCTION institution.notify_assignment_version();


--
-- Name: access_log access_log_assignment_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.access_log
    ADD CONSTRAINT access_log_assignment_id_institution_id_fkey FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment(id, institution_id);


--
-- Name: access_log access_log_owner_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.access_log
    ADD CONSTRAINT access_log_owner_id_institution_id_fkey FOREIGN KEY (owner_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: access_log access_log_reader_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.access_log
    ADD CONSTRAINT access_log_reader_id_institution_id_fkey FOREIGN KEY (reader_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: course_member_event course_member_event_actor_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.course_member_event
    ADD CONSTRAINT course_member_event_actor_id_institution_id_fkey FOREIGN KEY (actor_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: course_member_event course_member_event_course_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.course_member_event
    ADD CONSTRAINT course_member_event_course_id_institution_id_fkey FOREIGN KEY (course_id, institution_id) REFERENCES institution.course(id, institution_id);


--
-- Name: course_member_event course_member_event_membership_fkey; Type: FK CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.course_member_event
    ADD CONSTRAINT course_member_event_membership_fkey FOREIGN KEY (membership_id, course_id, student_id, institution_id) REFERENCES institution.course_member(id, course_id, user_id, institution_id);


--
-- Name: course_member_event course_member_event_student_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.course_member_event
    ADD CONSTRAINT course_member_event_student_id_institution_id_fkey FOREIGN KEY (student_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: enrollment_code_event enrollment_code_event_actor_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.enrollment_code_event
    ADD CONSTRAINT enrollment_code_event_actor_id_institution_id_fkey FOREIGN KEY (actor_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: enrollment_code_event enrollment_code_event_code_id_fkey; Type: FK CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.enrollment_code_event
    ADD CONSTRAINT enrollment_code_event_code_id_fkey FOREIGN KEY (code_id) REFERENCES institution.course_enrollment_code(id);


--
-- Name: enrollment_code_event enrollment_code_event_course_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.enrollment_code_event
    ADD CONSTRAINT enrollment_code_event_course_id_institution_id_fkey FOREIGN KEY (course_id, institution_id) REFERENCES institution.course(id, institution_id);


--
-- Name: comment comment_author_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.comment
    ADD CONSTRAINT comment_author_id_institution_id_fkey FOREIGN KEY (author_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: comment_thread comment_thread_assignment_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.comment_thread
    ADD CONSTRAINT comment_thread_assignment_id_institution_id_fkey FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment(id, institution_id);


--
-- Name: comment_thread comment_thread_created_by_institution_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.comment_thread
    ADD CONSTRAINT comment_thread_created_by_institution_id_fkey FOREIGN KEY (created_by, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: comment comment_thread_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.comment
    ADD CONSTRAINT comment_thread_id_institution_id_fkey FOREIGN KEY (thread_id, institution_id) REFERENCES collaboration.comment_thread(id, institution_id);


--
-- Name: comment_thread comment_thread_owner_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.comment_thread
    ADD CONSTRAINT comment_thread_owner_id_institution_id_fkey FOREIGN KEY (owner_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: live_state live_state_assignment_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.live_state
    ADD CONSTRAINT live_state_assignment_id_institution_id_fkey FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment(id, institution_id);


--
-- Name: live_state live_state_owner_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.live_state
    ADD CONSTRAINT live_state_owner_id_institution_id_fkey FOREIGN KEY (owner_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: document_checkpoint document_checkpoint_document_id_institution_id_revision_co_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.document_checkpoint
    ADD CONSTRAINT document_checkpoint_document_id_institution_id_revision_co_fkey FOREIGN KEY (document_id, institution_id, revision, content_hash) REFERENCES evidence.document_revision(document_id, institution_id, revision, content_hash);


--
-- Name: document document_project_id_institution_id_principal_id_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.document
    ADD CONSTRAINT document_project_id_institution_id_principal_id_fkey FOREIGN KEY (project_id, institution_id, principal_id) REFERENCES evidence.project(id, institution_id, principal_id);


--
-- Name: document_revision document_revision_document_id_institution_id_base_revision_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.document_revision
    ADD CONSTRAINT document_revision_document_id_institution_id_base_revision_fkey FOREIGN KEY (document_id, institution_id, base_revision) REFERENCES evidence.document_revision(document_id, institution_id, revision) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: document_revision document_revision_document_id_institution_id_principal_id_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.document_revision
    ADD CONSTRAINT document_revision_document_id_institution_id_principal_id_fkey FOREIGN KEY (document_id, institution_id, principal_id) REFERENCES evidence.document(id, institution_id, principal_id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: document_revision document_revision_principal_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.document_revision
    ADD CONSTRAINT document_revision_principal_id_institution_id_fkey FOREIGN KEY (principal_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: domain domain_institution_id_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.domain
    ADD CONSTRAINT domain_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES identity.institution(id);


--
-- Name: document evidence_document_current_revision_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.document
    ADD CONSTRAINT evidence_document_current_revision_fkey FOREIGN KEY (id, institution_id, current_revision, current_content_hash) REFERENCES evidence.document_revision(document_id, institution_id, revision, content_hash) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: package evidence_package_head_receipt_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.package
    ADD CONSTRAINT evidence_package_head_receipt_fkey FOREIGN KEY (head_receipt_id, id, institution_id) REFERENCES evidence.receipt(id, evidence_package_id, institution_id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: fast_path_window fast_path_window_assignment_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.fast_path_window
    ADD CONSTRAINT fast_path_window_assignment_id_institution_id_fkey FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment(id, institution_id);


--
-- Name: fast_path_window fast_path_window_reader_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.fast_path_window
    ADD CONSTRAINT fast_path_window_reader_id_institution_id_fkey FOREIGN KEY (reader_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: package package_document_id_institution_id_project_id_principal_id_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.package
    ADD CONSTRAINT package_document_id_institution_id_project_id_principal_id_fkey FOREIGN KEY (document_id, institution_id, project_id, principal_id) REFERENCES evidence.document(id, institution_id, project_id, principal_id);


--
-- Name: package package_evidence_domain_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.package
    ADD CONSTRAINT package_evidence_domain_id_institution_id_fkey FOREIGN KEY (evidence_domain_id, institution_id) REFERENCES evidence.domain(id, institution_id);


--
-- Name: project project_assignment_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.project
    ADD CONSTRAINT project_assignment_id_institution_id_fkey FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment(id, institution_id);


--
-- Name: project project_principal_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.project
    ADD CONSTRAINT project_principal_id_institution_id_fkey FOREIGN KEY (principal_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: receipt receipt_evidence_package_id_institution_id_evidence_domain_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.receipt
    ADD CONSTRAINT receipt_evidence_package_id_institution_id_evidence_domain_fkey FOREIGN KEY (evidence_package_id, institution_id, evidence_domain_id) REFERENCES evidence.package(id, institution_id, evidence_domain_id);


--
-- Name: receipt receipt_previous_receipt_id_evidence_package_id_institutio_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.receipt
    ADD CONSTRAINT receipt_previous_receipt_id_evidence_package_id_institutio_fkey FOREIGN KEY (previous_receipt_id, evidence_package_id, institution_id) REFERENCES evidence.receipt(id, evidence_package_id, institution_id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: receipt receipt_principal_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.receipt
    ADD CONSTRAINT receipt_principal_id_institution_id_fkey FOREIGN KEY (principal_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: receipt receipt_segment_id_evidence_package_id_institution_id_prin_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.receipt
    ADD CONSTRAINT receipt_segment_id_evidence_package_id_institution_id_prin_fkey FOREIGN KEY (segment_id, evidence_package_id, institution_id, principal_id) REFERENCES evidence.segment(id, evidence_package_id, institution_id, principal_id);


--
-- Name: segment segment_evidence_package_id_institution_id_document_id_pri_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.segment
    ADD CONSTRAINT segment_evidence_package_id_institution_id_document_id_pri_fkey FOREIGN KEY (evidence_package_id, institution_id, document_id, principal_id) REFERENCES evidence.package(id, institution_id, document_id, principal_id);


--
-- Name: segment segment_principal_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.segment
    ADD CONSTRAINT segment_principal_id_institution_id_fkey FOREIGN KEY (principal_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: signing_key signing_key_evidence_domain_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.signing_key
    ADD CONSTRAINT signing_key_evidence_domain_id_institution_id_fkey FOREIGN KEY (evidence_domain_id, institution_id) REFERENCES evidence.domain(id, institution_id);


--
-- Name: submission submission_assignment_id_assignment_version_due_at_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission
    ADD CONSTRAINT submission_assignment_id_assignment_version_due_at_fkey FOREIGN KEY (assignment_id, assignment_version, due_at) REFERENCES institution.assignment_version(assignment_id, version_no, due_at);


--
-- Name: submission submission_assignment_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission
    ADD CONSTRAINT submission_assignment_id_institution_id_fkey FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment(id, institution_id);


--
-- Name: submission submission_principal_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission
    ADD CONSTRAINT submission_principal_id_institution_id_fkey FOREIGN KEY (principal_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: submission_receipt submission_receipt_issuance_id_submission_id_institution_i_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission_receipt
    ADD CONSTRAINT submission_receipt_issuance_id_submission_id_institution_i_fkey FOREIGN KEY (issuance_id, submission_id, institution_id, principal_id) REFERENCES evidence.submission_receipt_issuance(id, submission_id, institution_id, principal_id);


--
-- Name: submission_receipt_issuance submission_receipt_issuance_key_id_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission_receipt_issuance
    ADD CONSTRAINT submission_receipt_issuance_key_id_fkey FOREIGN KEY (key_id) REFERENCES evidence.signing_key(key_id);


--
-- Name: submission_receipt_issuance submission_receipt_issuance_submission_id_institution_id_p_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission_receipt_issuance
    ADD CONSTRAINT submission_receipt_issuance_submission_id_institution_id_p_fkey FOREIGN KEY (submission_id, institution_id, principal_id) REFERENCES evidence.submission(id, institution_id, principal_id);


--
-- Name: submission_request submission_request_assignment_id_assignment_version_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission_request
    ADD CONSTRAINT submission_request_assignment_id_assignment_version_fkey FOREIGN KEY (assignment_id, assignment_version) REFERENCES institution.assignment_version(assignment_id, version_no);


--
-- Name: submission_request submission_request_assignment_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission_request
    ADD CONSTRAINT submission_request_assignment_id_institution_id_fkey FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment(id, institution_id);


--
-- Name: submission_request submission_request_document_id_institution_id_project_id_p_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission_request
    ADD CONSTRAINT submission_request_document_id_institution_id_project_id_p_fkey FOREIGN KEY (document_id, institution_id, project_id, principal_id) REFERENCES evidence.document(id, institution_id, project_id, principal_id);


--
-- Name: submission_request submission_request_document_id_institution_id_revision_con_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission_request
    ADD CONSTRAINT submission_request_document_id_institution_id_revision_con_fkey FOREIGN KEY (document_id, institution_id, revision, content_hash) REFERENCES evidence.document_revision(document_id, institution_id, revision, content_hash);


--
-- Name: submission_request submission_request_principal_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission_request
    ADD CONSTRAINT submission_request_principal_id_institution_id_fkey FOREIGN KEY (principal_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: submission_request submission_request_project_id_institution_id_principal_id__fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission_request
    ADD CONSTRAINT submission_request_project_id_institution_id_principal_id__fkey FOREIGN KEY (project_id, institution_id, principal_id, assignment_id) REFERENCES evidence.project(id, institution_id, principal_id, assignment_id);


--
-- Name: submission submission_submission_request_id_institution_id_principal__fkey; Type: FK CONSTRAINT; Schema: evidence; Owner: -
--

ALTER TABLE ONLY evidence.submission
    ADD CONSTRAINT submission_submission_request_id_institution_id_principal__fkey FOREIGN KEY (submission_request_id, institution_id, principal_id, assignment_id, assignment_version, revision, artifact_hash, requested_at) REFERENCES evidence.submission_request(id, institution_id, principal_id, assignment_id, assignment_version, revision, content_hash, requested_at);


--
-- Name: institution_issuer institution_issuer_institution_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.institution_issuer
    ADD CONSTRAINT institution_issuer_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES identity.institution(id);


--
-- Name: person_name person_name_user_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.person_name
    ADD CONSTRAINT person_name_user_id_institution_id_fkey FOREIGN KEY (user_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: session session_user_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.session
    ADD CONSTRAINT session_user_id_institution_id_fkey FOREIGN KEY (user_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: user_account user_account_institution_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_account
    ADD CONSTRAINT user_account_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES identity.institution(id);


--
-- Name: assignment assignment_course_institution_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.assignment
    ADD CONSTRAINT assignment_course_institution_fkey FOREIGN KEY (course_id, institution_id) REFERENCES institution.course(id, institution_id);


--
-- Name: assignment assignment_created_by_institution_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.assignment
    ADD CONSTRAINT assignment_created_by_institution_fkey FOREIGN KEY (created_by, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: assignment assignment_current_version_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.assignment
    ADD CONSTRAINT assignment_current_version_fkey FOREIGN KEY (id, current_version) REFERENCES institution.assignment_version(assignment_id, version_no) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: assignment assignment_mentorship_institution_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.assignment
    ADD CONSTRAINT assignment_mentorship_institution_fkey FOREIGN KEY (mentorship_id, institution_id) REFERENCES institution.mentorship(id, institution_id);


--
-- Name: assignment_version assignment_version_assignment_id_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.assignment_version
    ADD CONSTRAINT assignment_version_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES institution.assignment(id);


--
-- Name: assignment_version assignment_version_created_by_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.assignment_version
    ADD CONSTRAINT assignment_version_created_by_fkey FOREIGN KEY (created_by) REFERENCES identity.user_account(id);


--
-- Name: course course_created_by_institution_id_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.course
    ADD CONSTRAINT course_created_by_institution_id_fkey FOREIGN KEY (created_by, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: course_enrollment_code course_enrollment_code_course_id_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.course_enrollment_code
    ADD CONSTRAINT course_enrollment_code_course_id_fkey FOREIGN KEY (course_id) REFERENCES institution.course(id);


--
-- Name: course_enrollment_code course_enrollment_code_created_by_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.course_enrollment_code
    ADD CONSTRAINT course_enrollment_code_created_by_fkey FOREIGN KEY (created_by) REFERENCES identity.user_account(id);


--
-- Name: course course_institution_id_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.course
    ADD CONSTRAINT course_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES identity.institution(id);


--
-- Name: course_member course_member_course_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.course_member
    ADD CONSTRAINT course_member_course_id_institution_id_fkey FOREIGN KEY (course_id, institution_id) REFERENCES institution.course(id, institution_id);


--
-- Name: course_member course_member_removed_by_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.course_member
    ADD CONSTRAINT course_member_removed_by_fkey FOREIGN KEY (removed_by, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: course_member course_member_user_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.course_member
    ADD CONSTRAINT course_member_user_id_institution_id_fkey FOREIGN KEY (user_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: enrollment_attempt enrollment_attempt_user_id_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.enrollment_attempt
    ADD CONSTRAINT enrollment_attempt_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity.user_account(id);


--
-- Name: faculty_work_rule faculty_work_rule_institution_id_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.faculty_work_rule
    ADD CONSTRAINT faculty_work_rule_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES identity.institution(id);


--
-- Name: institution_role institution_role_confirmed_by_institution_id_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.institution_role
    ADD CONSTRAINT institution_role_confirmed_by_institution_id_fkey FOREIGN KEY (confirmed_by, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: institution_role institution_role_user_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.institution_role
    ADD CONSTRAINT institution_role_user_id_institution_id_fkey FOREIGN KEY (user_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: institution_settings institution_settings_institution_id_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.institution_settings
    ADD CONSTRAINT institution_settings_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES identity.institution(id);


--
-- Name: mentorship mentorship_confirmed_by_institution_id_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.mentorship
    ADD CONSTRAINT mentorship_confirmed_by_institution_id_fkey FOREIGN KEY (confirmed_by, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: mentorship mentorship_mentor_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.mentorship
    ADD CONSTRAINT mentorship_mentor_id_institution_id_fkey FOREIGN KEY (mentor_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: mentorship mentorship_student_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.mentorship
    ADD CONSTRAINT mentorship_student_id_institution_id_fkey FOREIGN KEY (student_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: notice_acknowledgment notice_acknowledgment_assignment_id_version_no_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.notice_acknowledgment
    ADD CONSTRAINT notice_acknowledgment_assignment_id_version_no_fkey FOREIGN KEY (assignment_id, version_no) REFERENCES institution.assignment_version(assignment_id, version_no);


--
-- Name: notice_acknowledgment notice_acknowledgment_assignment_institution_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.notice_acknowledgment
    ADD CONSTRAINT notice_acknowledgment_assignment_institution_fkey FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment(id, institution_id);


--
-- Name: notice_acknowledgment notice_acknowledgment_student_institution_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.notice_acknowledgment
    ADD CONSTRAINT notice_acknowledgment_student_institution_fkey FOREIGN KEY (student_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: notification notification_recipient_id_institution_id_fkey; Type: FK CONSTRAINT; Schema: institution; Owner: -
--

ALTER TABLE ONLY institution.notification
    ADD CONSTRAINT notification_recipient_id_institution_id_fkey FOREIGN KEY (recipient_id, institution_id) REFERENCES identity.user_account(id, institution_id);


--
-- Name: access_log; Type: ROW SECURITY; Schema: audit; Owner: -
--

ALTER TABLE audit.access_log ENABLE ROW LEVEL SECURITY;

--
-- Name: access_log access_log_owner; Type: POLICY; Schema: audit; Owner: -
--

CREATE POLICY access_log_owner ON audit.access_log TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: course_member_event; Type: ROW SECURITY; Schema: audit; Owner: -
--

ALTER TABLE audit.course_member_event ENABLE ROW LEVEL SECURITY;

--
-- Name: course_member_event course_member_event_owner; Type: POLICY; Schema: audit; Owner: -
--

CREATE POLICY course_member_event_owner ON audit.course_member_event TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: enrollment_code_event; Type: ROW SECURITY; Schema: audit; Owner: -
--

ALTER TABLE audit.enrollment_code_event ENABLE ROW LEVEL SECURITY;

--
-- Name: enrollment_code_event enrollment_code_event_owner; Type: POLICY; Schema: audit; Owner: -
--

CREATE POLICY enrollment_code_event_owner ON audit.enrollment_code_event TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: comment; Type: ROW SECURITY; Schema: collaboration; Owner: -
--

ALTER TABLE collaboration.comment ENABLE ROW LEVEL SECURITY;

--
-- Name: comment comment_owner; Type: POLICY; Schema: collaboration; Owner: -
--

CREATE POLICY comment_owner ON collaboration.comment TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: comment_thread; Type: ROW SECURITY; Schema: collaboration; Owner: -
--

ALTER TABLE collaboration.comment_thread ENABLE ROW LEVEL SECURITY;

--
-- Name: comment_thread comment_thread_owner; Type: POLICY; Schema: collaboration; Owner: -
--

CREATE POLICY comment_thread_owner ON collaboration.comment_thread TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: live_state; Type: ROW SECURITY; Schema: collaboration; Owner: -
--

ALTER TABLE collaboration.live_state ENABLE ROW LEVEL SECURITY;

--
-- Name: live_state live_state_owner; Type: POLICY; Schema: collaboration; Owner: -
--

CREATE POLICY live_state_owner ON collaboration.live_state TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: document; Type: ROW SECURITY; Schema: evidence; Owner: -
--

ALTER TABLE evidence.document ENABLE ROW LEVEL SECURITY;

--
-- Name: document_checkpoint; Type: ROW SECURITY; Schema: evidence; Owner: -
--

ALTER TABLE evidence.document_checkpoint ENABLE ROW LEVEL SECURITY;

--
-- Name: document_revision; Type: ROW SECURITY; Schema: evidence; Owner: -
--

ALTER TABLE evidence.document_revision ENABLE ROW LEVEL SECURITY;

--
-- Name: domain; Type: ROW SECURITY; Schema: evidence; Owner: -
--

ALTER TABLE evidence.domain ENABLE ROW LEVEL SECURITY;

--
-- Name: document_checkpoint evidence_document_checkpoint_owner; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_document_checkpoint_owner ON evidence.document_checkpoint TO ductus_evidence USING (true) WITH CHECK (true);


--
-- Name: document evidence_document_owner; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_document_owner ON evidence.document TO ductus_evidence USING (true) WITH CHECK (true);


--
-- Name: document evidence_document_read; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_document_read ON evidence.document FOR SELECT TO ductus_app USING (((institution_id = ( SELECT app.current_institution_id() AS current_institution_id)) AND (principal_id = ( SELECT app.current_user_id() AS current_user_id))));


--
-- Name: document_revision evidence_document_revision_owner; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_document_revision_owner ON evidence.document_revision TO ductus_evidence USING (true) WITH CHECK (true);


--
-- Name: domain evidence_domain_owner; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_domain_owner ON evidence.domain TO ductus_evidence USING (true) WITH CHECK (true);


--
-- Name: domain evidence_domain_read; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_domain_read ON evidence.domain FOR SELECT TO ductus_app USING ((institution_id = ( SELECT app.current_institution_id() AS current_institution_id)));


--
-- Name: package evidence_package_owner; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_package_owner ON evidence.package TO ductus_evidence USING (true) WITH CHECK (true);


--
-- Name: package evidence_package_read; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_package_read ON evidence.package FOR SELECT TO ductus_app USING (((institution_id = ( SELECT app.current_institution_id() AS current_institution_id)) AND (principal_id = ( SELECT app.current_user_id() AS current_user_id))));


--
-- Name: project evidence_project_owner; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_project_owner ON evidence.project TO ductus_evidence USING (true) WITH CHECK (true);


--
-- Name: project evidence_project_read; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_project_read ON evidence.project FOR SELECT TO ductus_app USING (((institution_id = ( SELECT app.current_institution_id() AS current_institution_id)) AND (principal_id = ( SELECT app.current_user_id() AS current_user_id))));


--
-- Name: receipt evidence_receipt_owner; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_receipt_owner ON evidence.receipt TO ductus_evidence USING (true) WITH CHECK (true);


--
-- Name: receipt evidence_receipt_read; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_receipt_read ON evidence.receipt FOR SELECT TO ductus_app USING (((institution_id = ( SELECT app.current_institution_id() AS current_institution_id)) AND (principal_id = ( SELECT app.current_user_id() AS current_user_id))));


--
-- Name: document_revision evidence_revision_read; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_revision_read ON evidence.document_revision FOR SELECT TO ductus_app USING (((institution_id = ( SELECT app.current_institution_id() AS current_institution_id)) AND (principal_id = ( SELECT app.current_user_id() AS current_user_id))));


--
-- Name: segment evidence_segment_owner; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_segment_owner ON evidence.segment TO ductus_evidence USING (true) WITH CHECK (true);


--
-- Name: segment evidence_segment_read; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_segment_read ON evidence.segment FOR SELECT TO ductus_app USING (((institution_id = ( SELECT app.current_institution_id() AS current_institution_id)) AND (principal_id = ( SELECT app.current_user_id() AS current_user_id))));


--
-- Name: signing_key evidence_signing_key_owner; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_signing_key_owner ON evidence.signing_key TO ductus_evidence USING (true) WITH CHECK (true);


--
-- Name: signing_key evidence_signing_key_read; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_signing_key_read ON evidence.signing_key FOR SELECT TO ductus_app USING ((institution_id = ( SELECT app.current_institution_id() AS current_institution_id)));


--
-- Name: submission evidence_submission_owner; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_submission_owner ON evidence.submission TO ductus_evidence USING (true) WITH CHECK (true);


--
-- Name: submission evidence_submission_read; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_submission_read ON evidence.submission FOR SELECT TO ductus_app USING (((institution_id = ( SELECT app.current_institution_id() AS current_institution_id)) AND (principal_id = ( SELECT app.current_user_id() AS current_user_id))));


--
-- Name: submission_request evidence_submission_request_owner; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_submission_request_owner ON evidence.submission_request TO ductus_evidence USING (true) WITH CHECK (true);


--
-- Name: submission_request evidence_submission_request_read; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY evidence_submission_request_read ON evidence.submission_request FOR SELECT TO ductus_app USING (((institution_id = ( SELECT app.current_institution_id() AS current_institution_id)) AND (principal_id = ( SELECT app.current_user_id() AS current_user_id))));


--
-- Name: fast_path_window; Type: ROW SECURITY; Schema: evidence; Owner: -
--

ALTER TABLE evidence.fast_path_window ENABLE ROW LEVEL SECURITY;

--
-- Name: fast_path_window fast_path_window_owner; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY fast_path_window_owner ON evidence.fast_path_window TO ductus_evidence USING (true) WITH CHECK (true);


--
-- Name: package; Type: ROW SECURITY; Schema: evidence; Owner: -
--

ALTER TABLE evidence.package ENABLE ROW LEVEL SECURITY;

--
-- Name: project; Type: ROW SECURITY; Schema: evidence; Owner: -
--

ALTER TABLE evidence.project ENABLE ROW LEVEL SECURITY;

--
-- Name: receipt; Type: ROW SECURITY; Schema: evidence; Owner: -
--

ALTER TABLE evidence.receipt ENABLE ROW LEVEL SECURITY;

--
-- Name: segment; Type: ROW SECURITY; Schema: evidence; Owner: -
--

ALTER TABLE evidence.segment ENABLE ROW LEVEL SECURITY;

--
-- Name: signing_key; Type: ROW SECURITY; Schema: evidence; Owner: -
--

ALTER TABLE evidence.signing_key ENABLE ROW LEVEL SECURITY;

--
-- Name: submission; Type: ROW SECURITY; Schema: evidence; Owner: -
--

ALTER TABLE evidence.submission ENABLE ROW LEVEL SECURITY;

--
-- Name: submission_receipt; Type: ROW SECURITY; Schema: evidence; Owner: -
--

ALTER TABLE evidence.submission_receipt ENABLE ROW LEVEL SECURITY;

--
-- Name: submission_receipt_issuance; Type: ROW SECURITY; Schema: evidence; Owner: -
--

ALTER TABLE evidence.submission_receipt_issuance ENABLE ROW LEVEL SECURITY;

--
-- Name: submission_receipt_issuance submission_receipt_issuance_owner; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY submission_receipt_issuance_owner ON evidence.submission_receipt_issuance TO ductus_evidence USING (true) WITH CHECK (true);


--
-- Name: submission_receipt_issuance submission_receipt_issuance_read; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY submission_receipt_issuance_read ON evidence.submission_receipt_issuance FOR SELECT TO ductus_app USING (((institution_id = ( SELECT app.current_institution_id() AS current_institution_id)) AND (principal_id = ( SELECT app.current_user_id() AS current_user_id))));


--
-- Name: submission_receipt submission_receipt_owner; Type: POLICY; Schema: evidence; Owner: -
--

CREATE POLICY submission_receipt_owner ON evidence.submission_receipt TO ductus_evidence USING (true) WITH CHECK (true);


--
-- Name: submission_request; Type: ROW SECURITY; Schema: evidence; Owner: -
--

ALTER TABLE evidence.submission_request ENABLE ROW LEVEL SECURITY;

--
-- Name: institution; Type: ROW SECURITY; Schema: identity; Owner: -
--

ALTER TABLE identity.institution ENABLE ROW LEVEL SECURITY;

--
-- Name: institution_issuer; Type: ROW SECURITY; Schema: identity; Owner: -
--

ALTER TABLE identity.institution_issuer ENABLE ROW LEVEL SECURITY;

--
-- Name: institution_issuer institution_issuer_owner; Type: POLICY; Schema: identity; Owner: -
--

CREATE POLICY institution_issuer_owner ON identity.institution_issuer TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: institution institution_owner; Type: POLICY; Schema: identity; Owner: -
--

CREATE POLICY institution_owner ON identity.institution TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: person_name; Type: ROW SECURITY; Schema: identity; Owner: -
--

ALTER TABLE identity.person_name ENABLE ROW LEVEL SECURITY;

--
-- Name: person_name person_name_owner; Type: POLICY; Schema: identity; Owner: -
--

CREATE POLICY person_name_owner ON identity.person_name TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: session; Type: ROW SECURITY; Schema: identity; Owner: -
--

ALTER TABLE identity.session ENABLE ROW LEVEL SECURITY;

--
-- Name: session session_owner; Type: POLICY; Schema: identity; Owner: -
--

CREATE POLICY session_owner ON identity.session TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: user_account; Type: ROW SECURITY; Schema: identity; Owner: -
--

ALTER TABLE identity.user_account ENABLE ROW LEVEL SECURITY;

--
-- Name: user_account user_account_owner; Type: POLICY; Schema: identity; Owner: -
--

CREATE POLICY user_account_owner ON identity.user_account TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: assignment; Type: ROW SECURITY; Schema: institution; Owner: -
--

ALTER TABLE institution.assignment ENABLE ROW LEVEL SECURITY;

--
-- Name: assignment assignment_owner; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY assignment_owner ON institution.assignment TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: assignment assignment_read; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY assignment_read ON institution.assignment FOR SELECT TO ductus_app USING (((institution_id = ( SELECT app.current_institution_id() AS current_institution_id)) AND (institution.actor_assignment_role(id) IS NOT NULL)));


--
-- Name: assignment_version; Type: ROW SECURITY; Schema: institution; Owner: -
--

ALTER TABLE institution.assignment_version ENABLE ROW LEVEL SECURITY;

--
-- Name: assignment_version assignment_version_owner; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY assignment_version_owner ON institution.assignment_version TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: assignment_version assignment_version_read; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY assignment_version_read ON institution.assignment_version FOR SELECT TO ductus_app USING ((institution.actor_assignment_role(assignment_id) IS NOT NULL));


--
-- Name: course; Type: ROW SECURITY; Schema: institution; Owner: -
--

ALTER TABLE institution.course ENABLE ROW LEVEL SECURITY;

--
-- Name: course_enrollment_code; Type: ROW SECURITY; Schema: institution; Owner: -
--

ALTER TABLE institution.course_enrollment_code ENABLE ROW LEVEL SECURITY;

--
-- Name: course_enrollment_code course_enrollment_code_owner; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY course_enrollment_code_owner ON institution.course_enrollment_code TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: course_enrollment_code course_enrollment_code_read; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY course_enrollment_code_read ON institution.course_enrollment_code FOR SELECT TO ductus_app USING ((institution.actor_course_role(course_id) = 'teacher'::text));


--
-- Name: course_member; Type: ROW SECURITY; Schema: institution; Owner: -
--

ALTER TABLE institution.course_member ENABLE ROW LEVEL SECURITY;

--
-- Name: course_member course_member_owner; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY course_member_owner ON institution.course_member TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: course_member course_member_read; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY course_member_read ON institution.course_member FOR SELECT TO ductus_app USING (((user_id = ( SELECT app.current_user_id() AS current_user_id)) OR (institution.actor_course_role(course_id) = 'teacher'::text) OR ((role = 'teacher'::text) AND (member_to IS NULL) AND (institution.actor_course_role(course_id) IS NOT NULL))));


--
-- Name: course course_owner; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY course_owner ON institution.course TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: course course_read; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY course_read ON institution.course FOR SELECT TO ductus_app USING ((institution.actor_course_role(id) IS NOT NULL));


--
-- Name: enrollment_attempt; Type: ROW SECURITY; Schema: institution; Owner: -
--

ALTER TABLE institution.enrollment_attempt ENABLE ROW LEVEL SECURITY;

--
-- Name: enrollment_attempt enrollment_attempt_owner; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY enrollment_attempt_owner ON institution.enrollment_attempt TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: faculty_work_rule; Type: ROW SECURITY; Schema: institution; Owner: -
--

ALTER TABLE institution.faculty_work_rule ENABLE ROW LEVEL SECURITY;

--
-- Name: faculty_work_rule faculty_work_rule_owner; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY faculty_work_rule_owner ON institution.faculty_work_rule TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: institution_role; Type: ROW SECURITY; Schema: institution; Owner: -
--

ALTER TABLE institution.institution_role ENABLE ROW LEVEL SECURITY;

--
-- Name: institution_role institution_role_owner; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY institution_role_owner ON institution.institution_role TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: institution_role institution_role_read; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY institution_role_read ON institution.institution_role FOR SELECT TO ductus_app USING (((institution_id = ( SELECT app.current_institution_id() AS current_institution_id)) AND ( SELECT institution.actor_has_role('admin'::text) AS actor_has_role)));


--
-- Name: institution_settings; Type: ROW SECURITY; Schema: institution; Owner: -
--

ALTER TABLE institution.institution_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: institution_settings institution_settings_owner; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY institution_settings_owner ON institution.institution_settings TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: institution_settings institution_settings_read; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY institution_settings_read ON institution.institution_settings FOR SELECT TO ductus_app USING (((institution_id = ( SELECT app.current_institution_id() AS current_institution_id)) AND ( SELECT institution.actor_has_role('admin'::text) AS actor_has_role)));


--
-- Name: mentorship; Type: ROW SECURITY; Schema: institution; Owner: -
--

ALTER TABLE institution.mentorship ENABLE ROW LEVEL SECURITY;

--
-- Name: mentorship mentorship_owner; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY mentorship_owner ON institution.mentorship TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: mentorship mentorship_read; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY mentorship_read ON institution.mentorship FOR SELECT TO ductus_app USING (((institution_id = ( SELECT app.current_institution_id() AS current_institution_id)) AND ((student_id = ( SELECT app.current_user_id() AS current_user_id)) OR ((mentor_id = ( SELECT app.current_user_id() AS current_user_id)) AND (ended_at IS NULL) AND ( SELECT institution.actor_has_role('teacher'::text) AS actor_has_role)))));


--
-- Name: notice_acknowledgment; Type: ROW SECURITY; Schema: institution; Owner: -
--

ALTER TABLE institution.notice_acknowledgment ENABLE ROW LEVEL SECURITY;

--
-- Name: notice_acknowledgment notice_acknowledgment_owner; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY notice_acknowledgment_owner ON institution.notice_acknowledgment TO ductus_identity USING (true) WITH CHECK (true);


--
-- Name: notice_acknowledgment notice_acknowledgment_read; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY notice_acknowledgment_read ON institution.notice_acknowledgment FOR SELECT TO ductus_app USING (((institution_id = ( SELECT app.current_institution_id() AS current_institution_id)) AND ((institution.actor_assignment_role(assignment_id) = 'teacher'::text) OR ((student_id = ( SELECT app.current_user_id() AS current_user_id)) AND (institution.actor_assignment_role(assignment_id) = 'student'::text)))));


--
-- Name: notification; Type: ROW SECURITY; Schema: institution; Owner: -
--

ALTER TABLE institution.notification ENABLE ROW LEVEL SECURITY;

--
-- Name: notification notification_owner; Type: POLICY; Schema: institution; Owner: -
--

CREATE POLICY notification_owner ON institution.notification TO ductus_identity USING (true) WITH CHECK (true);


--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20261003200000'),
    ('20261003210000'),
    ('20261003210100'),
    ('20261010180000'),
    ('20261010190000'),
    ('20261010200000'),
    ('20261010210000'),
    ('20261010220000'),
    ('20261011100000'),
    ('20261014110000'),
    ('20261014120000'),
    ('20261014130000'),
    ('20261014140000'),
    ('20261017120000'),
    ('20261017130000'),
    ('20261018120000'),
    ('20261018130000'),
    ('20261018140000'),
    ('20261019120000'),
    ('20261019130000'),
    ('20261019150000'),
    ('20261019160000'),
    ('20261019170000'),
    ('20261019180000'),
    ('20261020120000'),
    ('20261020140000'),
    ('20261020160000'),
    ('20261021120000'),
    ('20261021130000'),
    ('20261022090000'),
    ('20261022100000'),
    ('20261023190000'),
    ('20261024120000'),
    ('20261025090000'),
    ('20261026120000'),
    ('20261026130000'),
    ('20261026153000'),
    ('20261026163000'),
    ('20261027090000'),
    ('20261027150000'),
    ('20261027180000'),
    ('20261027190000'),
    ('20261027200000'),
    ('20261027210000'),
    ('20261027230000'),
    ('20261028000000'),
    ('20261028100000'),
    ('20261028120000'),
    ('20261028121000'),
    ('20261028140000'),
    ('20261028150000'),
    ('20261031120000'),
    ('20261031200000'),
    ('20261101010000'),
    ('20261101150000'),
    ('20261101160000'),
    ('20261101200000');

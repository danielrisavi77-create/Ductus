-- B-8 step 3 / DAN-83 (docs/BACKEND.md 4.13 t. 5 and 7, ADR 2026-10-11 5.3):
-- the acceptance writes the document snapshot in its own transaction and
-- names each conflict with the server state; the evidence domain's key
-- registry; the RPC that attaches the signature to a receipt reserved in the
-- same transaction. Keys are written by the operator (locally a db/local
-- script), never by a migration. Identity and institution come from
-- current_actor(), never from an argument (4.1, 4.3).
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA evidence, app TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;

-- The public keys of an evidence domain (D-102), in the form the receipt
-- verifier reads (EvidenceDomainKey): a canonical Ed25519 SPKI of 44 bytes in
-- unpadded base64url, validity on whole UTC minutes (owner decision of
-- 11 October 2026, comment 6108490197). key_id is unique across all domains
-- and a public key belongs to one domain only.
CREATE TABLE evidence.signing_key (
  key_id text PRIMARY KEY
    CHECK (length(key_id) BETWEEN 1 AND 256 AND key_id = btrim(key_id) AND key_id !~ '[[:cntrl:]]'),
  key_version text NOT NULL
    CHECK (length(key_version) BETWEEN 1 AND 256 AND key_version = btrim(key_version) AND key_version !~ '[[:cntrl:]]'),
  evidence_domain_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('receipt', 'checkpoint')),
  algorithm text NOT NULL CHECK (algorithm = 'Ed25519'),
  key_base64url text NOT NULL UNIQUE
    CHECK (key_base64url ~ '^MCowBQYDK2VwAyEA[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
  valid_from timestamptz NOT NULL
    CHECK (date_trunc('minute', valid_from AT TIME ZONE 'UTC') = valid_from AT TIME ZONE 'UTC'),
  valid_to timestamptz
    CHECK (date_trunc('minute', valid_to AT TIME ZONE 'UTC') = valid_to AT TIME ZONE 'UTC'),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (evidence_domain_id, institution_id) REFERENCES evidence.domain (id, institution_id),
  CHECK (valid_to > valid_from)
);
CREATE INDEX evidence_signing_key_domain_idx ON evidence.signing_key (evidence_domain_id, institution_id);

-- A key under existing receipts never changes: no delete, and an update may
-- only end the validity once (at a later minute than any receipt signed so
-- far) or revoke the key once.
CREATE FUNCTION evidence.guard_signing_key_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
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
REVOKE ALL ON FUNCTION evidence.guard_signing_key_change() FROM PUBLIC;
CREATE TRIGGER evidence_signing_key_immutable BEFORE UPDATE OR DELETE ON evidence.signing_key
  FOR EACH ROW EXECUTE FUNCTION evidence.guard_signing_key_change();
CREATE TRIGGER evidence_signing_key_no_truncate BEFORE TRUNCATE ON evidence.signing_key
  FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();

-- No read policy and no grant for the web role: the read path comes with its
-- caller (4.13 steps 4 and 5).
ALTER TABLE evidence.signing_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence.signing_key FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_signing_key_owner ON evidence.signing_key
  TO ductus_evidence USING (true) WITH CHECK (true);

-- Was the row with this xmin written by the current transaction or one of its
-- subtransactions? A visible row whose writer is still in progress can only
-- be our own: rows of other open transactions are not visible. xmin has 32
-- bits, so it is first placed next to our own full transaction id.
CREATE FUNCTION evidence.inserted_by_current_transaction(p_xmin xid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SET search_path = ''
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
REVOKE ALL ON FUNCTION evidence.inserted_by_current_transaction(xid) FROM PUBLIC;

DROP FUNCTION app.commit_evidence_segment(text, text, bigint, text, text, jsonb, text, text);

-- The acceptance (ADR 5.3 t. 7 to 13). Changes against 20261017130000: the
-- snapshot of the document after the segment (p_snapshot, exact bytes whose
-- SHA-256 is p_final_document_hash) is written with the revision; the old
-- concurrent_conflict and chain_conflict become stale_base (t. 9),
-- chain_conflict (t. 10), invalid for a sequence going back (t. 11) and
-- not_continuous (t. 12), each conflict with the state of the locked rows;
-- duplicate_signed also returns the stored signature.
CREATE FUNCTION app.commit_evidence_segment(
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
REVOKE ALL ON FUNCTION app.commit_evidence_segment(text, text, bigint, text, text, jsonb, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.commit_evidence_segment(text, text, bigint, text, text, jsonb, text, text, text)
  TO ductus_app;

-- Attaches the signature the web process made over the receipt (4.13 t. 3.6
-- and 7, D-92). Outcomes: signed, unauthorized (no session), invalid (an
-- argument or signature envelope of the wrong form), not_found (no such
-- receipt of the caller), already_signed, other_transaction (not reserved in
-- this transaction: the demo never signs an earlier acceptance, #155 T6),
-- digest_mismatch, and the key refusals of the receipt verifier in its order:
-- key_unknown, key_scope, key_revoked, key_not_valid. The database cannot
-- check the Ed25519 signature itself; the web process verifies it first.
CREATE FUNCTION app.attach_receipt_signature(
  p_receipt_id uuid, p_payload_digest_sha256 text, p_signature jsonb
) RETURNS TABLE (outcome text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
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
$$;
REVOKE ALL ON FUNCTION app.attach_receipt_signature(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.attach_receipt_signature(uuid, text, jsonb) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence, app FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA evidence, app TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.attach_receipt_signature(uuid, text, jsonb);
DROP FUNCTION app.commit_evidence_segment(text, text, bigint, text, text, jsonb, text, text, text);
DROP FUNCTION evidence.inserted_by_current_transaction(xid);
DROP TABLE evidence.signing_key;
DROP FUNCTION evidence.guard_signing_key_change();

-- The acceptance of 20261017130000_evidence_acceptance.sql, verbatim
-- (tests/unit/evidence-acceptance-signature-migration.test.ts).
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
  -- idempotency lookup. Rows are locked in one fixed order: package,
  -- assignment, membership, document; this serializes concurrent reserves and
  -- holds the authority rows until commit.
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
  IF NOT FOUND OR v_project.principal_id <> v_actor.user_id THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  SELECT * INTO v_assignment FROM app.lock_student_assignment(v_project.assignment_id);
  IF NOT FOUND THEN
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
    ELSIF NOT evidence.acceptance_retry_matches(v_existing.id, v_document.id, v_actor.user_id, p_expected_revision, p_initial_document_hash, p_final_document_hash, p_storage_ref) THEN
      RETURN QUERY SELECT 'idempotency_conflict'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
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

  -- New acceptance only (ADR 5.3 t. 8, PRODUCT 6 S3): the locked current
  -- version must be acknowledged by the student and open.
  IF NOT v_package.accepts_evidence OR NOT v_assignment.acknowledged
     OR v_assignment.opens_at > pg_catalog.clock_timestamp() THEN
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
REVOKE CREATE ON SCHEMA evidence, app FROM ductus_evidence;

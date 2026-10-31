-- B-9 step 1 / DAN-84 (attack plan #1021; docs/BACKEND.md 3 t. 2 and 3,
-- 4.13 t. 7): the narrow entry points of the worker that signs a receipt
-- reserved in an earlier transaction. The worker has no session: it lists the
-- pending v2 receipts of one evidence domain, reads that domain's receipt keys
-- to verify its own signature, and attaches the signature. The database still
-- cannot check an Ed25519 signature; the worker verifies it first. The web
-- role gets none of these, and the worker role nothing else (D-71, D-74).
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA evidence, app TO ductus_evidence;
GRANT USAGE ON SCHEMA app TO ductus_worker;

SET LOCAL ROLE ductus_evidence;

-- The worker reads the oldest pending receipts of a domain; signed receipts
-- leave the index.
CREATE INDEX evidence_receipt_pending_idx ON evidence.receipt (evidence_domain_id, created_at, id)
  WHERE status = 'pending_signature';

-- Oldest first, at most p_limit, only receipts of schema v2: a receipt of
-- another schema is never signed on this path and never blocks the queue
-- (plan #1021 P-4). The receipt text is the stored one, the only input of the
-- digest (P-3); no descriptor, segment bytes or storage reference.
CREATE FUNCTION app.worker_pending_receipts(p_evidence_domain_id uuid, p_limit integer)
RETURNS TABLE (receipt_id uuid, receipt_payload text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
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

-- The receipt keys of one domain in the form the receipt verifier reads
-- (EvidenceDomainKey), revoked and retired ones included, so the worker
-- verifies with the registry and never with the signer's own key (N-6).
CREATE FUNCTION app.worker_receipt_keys(p_evidence_domain_id uuid)
RETURNS TABLE (
  key_id text, key_version text, key_base64url text,
  valid_from timestamptz, valid_to timestamptz, revoked_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
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

-- The checks of app.attach_receipt_signature, in its order, without the
-- session and the same-transaction rule: invalid, not_found, already_signed
-- (with the stored signature, never overwritten), unsupported_schema,
-- digest_mismatch, key_unknown, key_scope, key_revoked, key_not_valid. The
-- receipt is locked before the key, as on the web path (N-10).
CREATE FUNCTION app.worker_attach_receipt_signature(
  p_receipt_id uuid, p_payload_digest_sha256 text, p_signature jsonb
) RETURNS TABLE (outcome text, signature jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION app.worker_pending_receipts(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.worker_receipt_keys(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.worker_attach_receipt_signature(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.worker_pending_receipts(uuid, integer) TO ductus_worker;
GRANT EXECUTE ON FUNCTION app.worker_receipt_keys(uuid) TO ductus_worker;
GRANT EXECUTE ON FUNCTION app.worker_attach_receipt_signature(uuid, text, jsonb) TO ductus_worker;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence, app FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA evidence, app TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.worker_attach_receipt_signature(uuid, text, jsonb);
DROP FUNCTION app.worker_receipt_keys(uuid);
DROP FUNCTION app.worker_pending_receipts(uuid, integer);
DROP INDEX evidence.evidence_receipt_pending_idx;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence, app FROM ductus_evidence;
REVOKE USAGE ON SCHEMA app FROM ductus_worker;

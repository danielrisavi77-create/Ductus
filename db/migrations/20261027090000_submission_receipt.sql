-- DAN-291 (#746, part 291a): a submission receipt v2 is signed and bound once,
-- then returned unchanged. The web process freezes an attempt
-- (prepare_submission_receipt), signs it outside the transaction and verifies
-- the Ed25519 signature, then binds it here. The database cannot check the
-- signature itself; it rechecks the frozen key and a fresh clock and binds at
-- most one receipt per submission (docs/contracts/submission-receipt-v2.md).
-- migrate:up
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA evidence, app TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;

ALTER TABLE evidence.submission_receipt_issuance ADD CONSTRAINT submission_receipt_issuance_binding_key
  UNIQUE (id, submission_id, institution_id, principal_id);
CREATE TABLE evidence.submission_receipt (
  submission_id uuid PRIMARY KEY,
  institution_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  issuance_id uuid NOT NULL UNIQUE,
  key_id text NOT NULL,
  key_version text NOT NULL,
  signed_at timestamptz NOT NULL,
  receipt_payload text NOT NULL,
  payload_digest_sha256 text NOT NULL
    CHECK (payload_digest_sha256=encode(sha256(convert_to(receipt_payload,'UTF8')),'hex')),
  signature jsonb NOT NULL
    CHECK (signature->>'keyId'=key_id AND signature->>'keyVersion'=key_version),
  -- Only a frozen attempt of the same submission, institution and student.
  FOREIGN KEY (issuance_id,submission_id,institution_id,principal_id)
    REFERENCES evidence.submission_receipt_issuance(id,submission_id,institution_id,principal_id)
);
-- No policy and no grant for the web role: it reads only through the RPCs.
ALTER TABLE evidence.submission_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence.submission_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY submission_receipt_owner ON evidence.submission_receipt
  TO ductus_evidence USING (true) WITH CHECK (true);
CREATE TRIGGER submission_receipt_immutable BEFORE UPDATE OR DELETE ON evidence.submission_receipt
  FOR EACH ROW EXECUTE FUNCTION evidence.reject_append_only_change();
CREATE TRIGGER submission_receipt_no_truncate BEFORE TRUNCATE ON evidence.submission_receipt
  FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();

-- Outcomes in check order: unauthorized (no session), invalid (an argument or
-- signature envelope of the wrong form), not_found (no such attempt of the
-- caller, or no longer an active student of its assignment), existing (the
-- stored receipt, unchanged, with no further check), digest_mismatch,
-- key_mismatch (not the key frozen in the attempt), key_revoked,
-- key_not_valid, attached. Only "attached" writes.
CREATE FUNCTION app.attach_submission_receipt(p_issuance_id uuid,p_payload_digest_sha256 text,p_signature jsonb)
RETURNS TABLE(outcome text,receipt_payload text,payload_digest_sha256 text,signature jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
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
$$;
REVOKE ALL ON FUNCTION app.attach_submission_receipt(uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.attach_submission_receipt(uuid,text,jsonb) TO ductus_app;

-- Outcomes: found (the caller's submission with its bound receipt), none (the
-- caller's submission without one), not_found (another's or no such
-- submission), unauthorized (no session).
CREATE FUNCTION app.read_submission_receipt(p_submission_id uuid)
RETURNS TABLE(outcome text,receipt_payload text,payload_digest_sha256 text,signature jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
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
REVOKE ALL ON FUNCTION app.read_submission_receipt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_submission_receipt(uuid) TO ductus_app;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence, app FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.read_submission_receipt(uuid);
DROP FUNCTION app.attach_submission_receipt(uuid,text,jsonb);
DROP TABLE evidence.submission_receipt;
ALTER TABLE evidence.submission_receipt_issuance DROP CONSTRAINT submission_receipt_issuance_binding_key;
RESET ROLE;

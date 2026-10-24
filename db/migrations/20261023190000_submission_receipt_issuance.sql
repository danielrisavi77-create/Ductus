-- DAN-87 #595: freeze a submission receipt v2 before the network signer.
-- This is an issuance attempt, never proof of a signed or accepted receipt.
-- Final attachment/fresh-key validation and the runtime caller are separate.
-- migrate:up
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA evidence, app TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;

ALTER TABLE evidence.submission ADD CONSTRAINT submission_issuance_identity_key
  UNIQUE (id, institution_id, principal_id);
CREATE TABLE evidence.submission_receipt_issuance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  key_id text NOT NULL REFERENCES evidence.signing_key(key_id),
  key_version text NOT NULL,
  signed_at timestamptz NOT NULL,
  receipt_payload text NOT NULL,
  payload_digest_sha256 text NOT NULL
    CHECK (payload_digest_sha256=encode(sha256(convert_to(receipt_payload,'UTF8')),'hex')),
  FOREIGN KEY (submission_id,institution_id,principal_id)
    REFERENCES evidence.submission(id,institution_id,principal_id)
);
CREATE INDEX submission_receipt_issuance_submission_idx ON evidence.submission_receipt_issuance(submission_id);
ALTER TABLE evidence.submission_receipt_issuance ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence.submission_receipt_issuance FORCE ROW LEVEL SECURITY;
CREATE POLICY submission_receipt_issuance_owner ON evidence.submission_receipt_issuance
  TO ductus_evidence USING (true) WITH CHECK (true);
CREATE POLICY submission_receipt_issuance_read ON evidence.submission_receipt_issuance FOR SELECT TO ductus_app
  USING (institution_id=(SELECT app.current_institution_id()) AND principal_id=(SELECT app.current_user_id()));
GRANT SELECT ON evidence.submission_receipt_issuance TO ductus_app;
CREATE TRIGGER submission_receipt_issuance_immutable BEFORE UPDATE OR DELETE ON evidence.submission_receipt_issuance
  FOR EACH ROW EXECUTE FUNCTION evidence.reject_append_only_change();
CREATE TRIGGER submission_receipt_issuance_no_truncate BEFORE TRUNCATE ON evidence.submission_receipt_issuance
  FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();

-- Called only after the server reconstructs and records the matching work.
-- No client identity, time, content, hash or reconstruction verdict argument.
-- Multiple attempts are distinct immutable rows; a later successful receipt
-- must be stored once and returned unchanged on HTTP retry (next step).
CREATE FUNCTION app.prepare_submission_receipt(p_submission_id uuid,p_key_id text,p_key_version text)
RETURNS TABLE(outcome text,issuance_id uuid,receipt_payload text,payload_digest_sha256 text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
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
REVOKE ALL ON FUNCTION app.prepare_submission_receipt(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.prepare_submission_receipt(uuid,text,text) TO ductus_app;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence, app FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.prepare_submission_receipt(uuid,text,text);
DROP TABLE evidence.submission_receipt_issuance;
ALTER TABLE evidence.submission DROP CONSTRAINT submission_issuance_identity_key;
RESET ROLE;

-- DAN-189 / D-103: evidence revisions and segments are append-only; receipts
-- may only move once from pending_signature to signed without rewriting data.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA evidence TO ductus_evidence;
GRANT ductus_evidence TO ductus_identity WITH INHERIT FALSE, SET TRUE;

SET LOCAL ROLE ductus_identity;
SET LOCAL ROLE ductus_evidence;

CREATE FUNCTION evidence.reject_append_only_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'append-only row' USING ERRCODE = 'ZD403';
END
$$;

CREATE TRIGGER evidence_revision_immutable BEFORE UPDATE OR DELETE ON evidence.document_revision
  FOR EACH ROW EXECUTE FUNCTION evidence.reject_append_only_change();
CREATE TRIGGER evidence_revision_no_truncate BEFORE TRUNCATE ON evidence.document_revision
  FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();
CREATE TRIGGER evidence_segment_immutable BEFORE UPDATE OR DELETE ON evidence.segment
  FOR EACH ROW EXECUTE FUNCTION evidence.reject_append_only_change();
CREATE TRIGGER evidence_segment_no_truncate BEFORE TRUNCATE ON evidence.segment
  FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();

CREATE FUNCTION evidence.guard_receipt_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
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
CREATE TRIGGER evidence_receipt_immutable BEFORE UPDATE OR DELETE ON evidence.receipt
  FOR EACH ROW EXECUTE FUNCTION evidence.guard_receipt_transition();
CREATE TRIGGER evidence_receipt_no_truncate BEFORE TRUNCATE ON evidence.receipt
  FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence FROM ductus_evidence;
REVOKE ductus_evidence FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA evidence TO ductus_evidence;
GRANT ductus_evidence TO ductus_identity WITH INHERIT FALSE, SET TRUE;
SET LOCAL ROLE ductus_identity;
SET LOCAL ROLE ductus_evidence;

DROP TRIGGER evidence_revision_immutable ON evidence.document_revision;
DROP TRIGGER evidence_revision_no_truncate ON evidence.document_revision;
DROP TRIGGER evidence_segment_immutable ON evidence.segment;
DROP TRIGGER evidence_segment_no_truncate ON evidence.segment;
DROP TRIGGER evidence_receipt_immutable ON evidence.receipt;
DROP TRIGGER evidence_receipt_no_truncate ON evidence.receipt;
DROP FUNCTION evidence.guard_receipt_transition();
DROP FUNCTION evidence.reject_append_only_change();

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence FROM ductus_evidence;
REVOKE ductus_evidence FROM ductus_identity;

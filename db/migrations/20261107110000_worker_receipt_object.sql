-- DAN-301, attack plan #1690 (docs/ARCHITECTURE.md:220, docs/backend/
-- evidencija.md:28, plan #1021 P-13): before the worker signs a pending
-- receipt it checks, with a HEAD to the payload store, that the segment
-- object the receipt names is there. This function gives the worker only
-- what that check needs, for one pending v2 receipt of one evidence domain:
-- the object key (institution, package, segment hash), the byte count and
-- the stored reference. No payload, descriptor, person or session leaves it,
-- and the web role gets nothing (D-71, D-74, D-102).
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;

-- At most one row. A signed receipt, a receipt of another domain or schema
-- and an unknown id all give no row, so the answer never tells them apart.
CREATE FUNCTION app.worker_receipt_object(p_evidence_domain_id uuid, p_receipt_id uuid)
RETURNS TABLE (institution_id uuid, evidence_package_id text, segment_hash text,
               payload_bytes integer, storage_ref text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_evidence_domain_id IS NULL OR p_receipt_id IS NULL THEN
    RAISE EXCEPTION 'invalid worker request' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT s.institution_id, s.evidence_package_id, s.segment_hash, s.payload_bytes, s.storage_ref
      FROM evidence.receipt r
      JOIN evidence.segment s
        ON s.id = r.segment_id
       AND s.evidence_package_id = r.evidence_package_id
       AND s.institution_id = r.institution_id
     WHERE r.id = p_receipt_id
       AND r.evidence_domain_id = p_evidence_domain_id
       AND r.status = 'pending_signature'
       AND (r.receipt_payload::jsonb ->> 'receiptSchema') = 'ductus-evidence-receipt-v2';
END
$$;

REVOKE ALL ON FUNCTION app.worker_receipt_object(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.worker_receipt_object(uuid, uuid) TO ductus_worker;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.worker_receipt_object(uuid, uuid);
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

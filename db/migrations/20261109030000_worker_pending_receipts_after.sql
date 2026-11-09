-- DAN-593 (plan #1021 P-10): the worker's pending list reads past a given
-- receipt. app.worker_pending_receipts always returned the oldest p_limit
-- receipts of a domain, and a receipt that stays pending (held, refused)
-- keeps its place, so more than 100 of them hid every receipt behind them
-- from the reconciler. p_after_receipt_id continues after that receipt in
-- the same order (created_at, id); NULL, or a receipt that is not of this
-- domain, starts at the oldest. The receipt named may be signed by now: its
-- place in the order is enough. Nothing else changes: v2 only, at most 100,
-- the worker role alone (D-71, D-74).
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA evidence, app TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;

DROP FUNCTION app.worker_pending_receipts(uuid, integer);

CREATE FUNCTION app.worker_pending_receipts(p_evidence_domain_id uuid, p_limit integer, p_after_receipt_id uuid)
RETURNS TABLE (receipt_id uuid, receipt_payload text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_after_at timestamptz;
BEGIN
  IF p_evidence_domain_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid worker request' USING ERRCODE = '22023';
  END IF;
  IF p_after_receipt_id IS NOT NULL THEN
    SELECT a.created_at INTO v_after_at
      FROM evidence.receipt a
     WHERE a.id = p_after_receipt_id AND a.evidence_domain_id = p_evidence_domain_id;
  END IF;
  RETURN QUERY
    SELECT r.id, r.receipt_payload
      FROM evidence.receipt r
     WHERE r.evidence_domain_id = p_evidence_domain_id AND r.status = 'pending_signature'
       AND (r.receipt_payload::jsonb ->> 'receiptSchema') = 'ductus-evidence-receipt-v2'
       AND (v_after_at IS NULL OR (r.created_at, r.id) > (v_after_at, p_after_receipt_id))
     ORDER BY r.created_at, r.id
     LIMIT p_limit;
END
$$;

REVOKE ALL ON FUNCTION app.worker_pending_receipts(uuid, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.worker_pending_receipts(uuid, integer, uuid) TO ductus_worker;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence, app FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA evidence, app TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.worker_pending_receipts(uuid, integer, uuid);
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
REVOKE ALL ON FUNCTION app.worker_pending_receipts(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.worker_pending_receipts(uuid, integer) TO ductus_worker;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence, app FROM ductus_evidence;

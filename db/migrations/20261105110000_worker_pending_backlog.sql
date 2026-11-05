-- DAN-517, attack plan #1021 P-10 and P-20 (docs/BACKEND.md 5, 6): the worker
-- sees, per evidence domain, how many receipts wait for a signature and since
-- when. The periodic sweep uses the list to find the domains to drain, so a
-- lost job still comes up (P-10); the count and the oldest age feed the alarm
-- (P-20). Every pending receipt counts, of any schema: one the v2 path never
-- signs still waits, and the alarm must see it. No receipt id, payload,
-- person or institution leaves the function, and the web role gets nothing
-- (D-71, D-74).
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;

-- Reads only the partial index evidence_receipt_pending_idx, whose leading
-- column is the domain: signed receipts never enter it.
CREATE FUNCTION app.worker_pending_backlog()
RETURNS TABLE (evidence_domain_id uuid, pending_count bigint, oldest_created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT r.evidence_domain_id, count(*), min(r.created_at)
    FROM evidence.receipt r
   WHERE r.status = 'pending_signature'
   GROUP BY r.evidence_domain_id
   ORDER BY r.evidence_domain_id
$$;

REVOKE ALL ON FUNCTION app.worker_pending_backlog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.worker_pending_backlog() TO ductus_worker;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.worker_pending_backlog();
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

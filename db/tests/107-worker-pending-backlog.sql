-- DAN-517 (attack plan #1021 P-10, P-20): the worker's backlog view. Per
-- evidence domain it gives the number of pending receipts and the oldest
-- one's time, and nothing that names a receipt, a person or an institution.
-- Every person, document and receipt below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

CREATE FUNCTION pg_temp.worker(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask_as('ductus_worker', 'anon', p_sql)
$$;
-- domain|count|age in whole hours, one line per domain, in the order returned.
CREATE FUNCTION pg_temp.backlog() RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.worker($q$
    SELECT coalesce(string_agg(evidence_domain_id::text || '|' || pending_count || '|'
             || floor(extract(epoch FROM now() - oldest_created_at) / 3600)::int, ',' ORDER BY ord), '')
      FROM app.worker_pending_backlog() WITH ORDINALITY AS b (evidence_domain_id, pending_count, oldest_created_at, ord) $q$)
$$;

-- The catalogue: a definer of the evidence role with an empty search_path,
-- read-only, executed by the worker alone.
SELECT ok((SELECT p.prosecdef AND p.proowner = 'ductus_evidence'::regrole AND 'search_path=""' = ANY (p.proconfig)
             AND p.provolatile = 's'
           FROM pg_proc p WHERE p.oid = 'app.worker_pending_backlog()'::regprocedure),
  'the backlog is a STABLE SECURITY DEFINER function of the evidence role with an empty search_path');
SELECT is(pg_get_function_result('app.worker_pending_backlog()'::regprocedure),
  'TABLE(evidence_domain_id uuid, pending_count bigint, oldest_created_at timestamp with time zone)',
  'the backlog carries a domain, a count and a time only: no receipt id, payload, person or institution (N-5)');
SELECT is_empty(
  $$ SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_retention', 'ductus_auth', 'ductus_identity',
                                'ductus_app_local', 'ductus_auth_local', 'public']) AS r
      WHERE has_function_privilege(r, 'app.worker_pending_backlog()'::regprocedure, 'EXECUTE') $$,
  'no role but the worker executes the backlog, nor PUBLIC');
SELECT ok(has_function_privilege('ductus_worker', 'app.worker_pending_backlog()'::regprocedure, 'EXECUTE'),
  'the worker executes the backlog');

SELECT is(pg_temp.backlog(), '', 'with no pending receipt the backlog is empty');

-- Fixture: Ana's two pending receipts in domain d1 and Tomo's in d2 through
-- the commit path; in d1 also an older v2 and an even older v1 receipt
-- written by the owner, and a signed one that must not count.
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64), repeat('b', 64)),
  'reserved', 'fixture: Ana commits revision 1');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-2',
    pg_temp.descriptor(p_segment => 'segment-a-2', p_sequence_from => 2, p_sequence_to => 2, p_hash => repeat('c', 64),
      p_predecessor => repeat('b', 64)), 1, repeat('d', 64), repeat('e', 64), repeat('c', 64)),
  'reserved', 'fixture: Ana commits revision 2');
SELECT is(pg_temp.call('tomo', 'pkg-b', 'request-b1',
    pg_temp.descriptor(p_package => 'pkg-b', p_document => 'doc-b', p_segment => 'segment-b-1'), 0, repeat('c', 64), repeat('d', 64), repeat('b', 64)),
  'reserved', 'fixture: Tomo commits revision 1');
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.receipt (id, evidence_package_id, institution_id, evidence_domain_id, segment_id, principal_id,
  client_request_id, payload_sha256, descriptor, receipt_payload, status, signature, key_id, created_at)
VALUES
  (gen_random_uuid(), 'pkg-a', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1', 'segment-a-1', pg_temp.id('ana'),
   'late-v2', repeat('a', 64), '{}', '{"acceptedAt":"2026-01-01T00:00:00.000Z","receiptSchema":"ductus-evidence-receipt-v2"}',
   'pending_signature', NULL, NULL, now() - interval '1 day'),
  (gen_random_uuid(), 'pkg-a', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1', 'segment-a-1', pg_temp.id('ana'),
   'legacy-v1', repeat('a', 64), '{}', '{"acceptedAt":"2026-01-01T00:00:00.000Z","receiptSchema":"ductus-evidence-receipt-v1"}',
   'pending_signature', NULL, NULL, now() - interval '2 days'),
  (gen_random_uuid(), 'pkg-b', pg_temp.id('fak_b'), '00000000-0000-4000-8000-0000000000d2', 'segment-b-1', pg_temp.id('tomo'),
   'old-signed', repeat('a', 64), '{}', '{"acceptedAt":"2026-01-01T00:00:00.000Z","receiptSchema":"ductus-evidence-receipt-v2"}',
   'signed', '{"algorithm":"Ed25519"}', 'key-old', now() - interval '5 days');
RESET ROLE;

-- P-20: count and oldest age per domain; the v1 receipt counts (it still
-- waits), the signed one does not, and the order is by domain.
SELECT is(pg_temp.backlog(),
  '00000000-0000-4000-8000-0000000000d1|4|48,00000000-0000-4000-8000-0000000000d2|1|0',
  'per domain: every pending receipt of any schema and the oldest one''s age; a signed receipt is not counted');

-- P-10: once a receipt is signed it leaves the backlog, and a domain with
-- nothing pending is not listed, so the sweep visits only domains with work.
SET LOCAL ROLE ductus_evidence;
UPDATE evidence.receipt SET status = 'signed', signature = '{"algorithm":"Ed25519"}', key_id = 'key-x'
 WHERE client_request_id = 'request-b1';
RESET ROLE;
SELECT is(pg_temp.backlog(), '00000000-0000-4000-8000-0000000000d1|4|48',
  'a domain whose receipts are all signed leaves the backlog');

-- The web role, with a session, cannot call it.
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM app.worker_pending_backlog()'),
  '42501: permission denied for function worker_pending_backlog', 'the web role cannot read the backlog');

SELECT * FROM finish();
ROLLBACK;

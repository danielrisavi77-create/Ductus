-- DAN-301 (attack plan #1690): the worker's read of the segment object a
-- pending v2 receipt names, for the HEAD before it signs (P-13). One row at
-- most, with only the object key, the byte count and the stored reference.
-- Every person, document and receipt below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

CREATE FUNCTION pg_temp.worker(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask_as('ductus_worker', 'anon', p_sql)
$$;
CREATE FUNCTION pg_temp.rid(p_request text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM evidence.receipt WHERE client_request_id = p_request
$$;
-- count|first row as institution|package|hash|bytes|reference, as the worker sees it.
CREATE FUNCTION pg_temp.object(p_domain text, p_receipt text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.worker(format(
    $q$ SELECT count(*) || '|' || coalesce(min(institution_id::text || '|' || evidence_package_id || '|' || segment_hash
             || '|' || payload_bytes || '|' || storage_ref), '')
          FROM app.worker_receipt_object(%s, %s) $q$,
    coalesce(quote_literal(p_domain) || '::uuid', 'NULL::uuid'), coalesce(quote_literal(p_receipt) || '::uuid', 'NULL::uuid')))
$$;

-- A1: the catalogue: a read-only definer of the evidence role with an empty
-- search_path, executed by the worker alone.
SELECT ok((SELECT p.prosecdef AND p.proowner = 'ductus_evidence'::regrole AND 'search_path=""' = ANY (p.proconfig)
             AND p.provolatile = 's'
           FROM pg_proc p WHERE p.oid = 'app.worker_receipt_object(uuid, uuid)'::regprocedure),
  'the object read is a STABLE SECURITY DEFINER function of the evidence role with an empty search_path');
SELECT is(pg_get_function_result('app.worker_receipt_object(uuid, uuid)'::regprocedure),
  'TABLE(institution_id uuid, evidence_package_id text, segment_hash text, payload_bytes integer, storage_ref text)',
  'the object read carries the key, the byte count and the reference only: no payload, descriptor, person or session');
-- A2
SELECT is_empty(
  $$ SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_retention', 'ductus_auth', 'ductus_identity',
                                'ductus_app_local', 'ductus_auth_local', 'public']) AS r
      WHERE has_function_privilege(r, 'app.worker_receipt_object(uuid, uuid)'::regprocedure, 'EXECUTE') $$,
  'no role but the worker executes the object read, nor PUBLIC');
SELECT ok(has_function_privilege('ductus_worker', 'app.worker_receipt_object(uuid, uuid)'::regprocedure, 'EXECUTE'),
  'the worker executes the object read');

-- Fixture: Ana's pending receipt in d1 and Tomo's in d2 through the commit
-- path, and in d1 a v1 receipt written by the owner on Ana's segment.
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64), repeat('b', 64)),
  'reserved', 'fixture: Ana commits revision 1');
SELECT is(pg_temp.call('tomo', 'pkg-b', 'request-b1',
    pg_temp.descriptor(p_package => 'pkg-b', p_document => 'doc-b', p_segment => 'segment-b-1', p_bytes => 77),
    0, repeat('c', 64), repeat('d', 64), repeat('b', 64)),
  'reserved', 'fixture: Tomo commits revision 1');
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.receipt (id, evidence_package_id, institution_id, evidence_domain_id, segment_id, principal_id,
  client_request_id, payload_sha256, descriptor, receipt_payload, status, signature, key_id, created_at)
VALUES
  (gen_random_uuid(), 'pkg-a', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1', 'segment-a-1', pg_temp.id('ana'),
   'legacy-v1', repeat('a', 64), '{}', '{"acceptedAt":"2026-01-01T00:00:00.000Z","receiptSchema":"ductus-evidence-receipt-v1"}',
   'pending_signature', NULL, NULL, now() - interval '2 days');
RESET ROLE;

-- A3: a pending v2 receipt gives exactly the row of its own segment, with the
-- institution the database keeps for the package.
SELECT is(pg_temp.object('00000000-0000-4000-8000-0000000000d1', pg_temp.rid('request-1')::text),
  '1|' || pg_temp.id('fak_a') || '|pkg-a|' || repeat('b', 64) || '|123|synthetic://pkg-a/request-1',
  'a pending v2 receipt gives the key, byte count and reference of its own segment');
SELECT is(pg_temp.object('00000000-0000-4000-8000-0000000000d2', pg_temp.rid('request-b1')::text),
  '1|' || pg_temp.id('fak_b') || '|pkg-b|' || repeat('b', 64) || '|77|synthetic://pkg-b/request-b1',
  'Tomo''s receipt gives the row of his institution and package, not Ana''s');

-- A4: a receipt asked under another domain gives no row, in either direction.
SELECT is(pg_temp.object('00000000-0000-4000-8000-0000000000d2', pg_temp.rid('request-1')::text), '0|',
  'a receipt of d1 asked under d2 gives no row');
SELECT is(pg_temp.object('00000000-0000-4000-8000-0000000000d1', pg_temp.rid('request-b1')::text), '0|',
  'a receipt of d2 asked under d1 gives no row');
-- A5: an unknown id and a domain that does not exist give no row.
SELECT is(pg_temp.object('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000ff'), '0|',
  'an unknown receipt id gives no row');
SELECT is(pg_temp.object('00000000-0000-4000-8000-0000000000ee', pg_temp.rid('request-1')::text), '0|',
  'an unknown domain gives no row');
-- A6: a receipt of schema v1 gives no row, though it is pending.
SELECT is(pg_temp.object('00000000-0000-4000-8000-0000000000d1', pg_temp.rid('legacy-v1')::text), '0|',
  'a pending v1 receipt gives no row');

-- A7: once signed the receipt gives no row, as an unknown id does.
SET LOCAL ROLE ductus_evidence;
UPDATE evidence.receipt SET status = 'signed', signature = '{"algorithm":"Ed25519"}', key_id = 'key-x'
 WHERE client_request_id = 'request-b1';
RESET ROLE;
SELECT is(pg_temp.object('00000000-0000-4000-8000-0000000000d2', pg_temp.rid('request-b1')::text), '0|',
  'a signed receipt gives no row');

-- A8: NULL in either argument is refused, never read as a wildcard.
SELECT is(pg_temp.object(NULL, pg_temp.rid('request-1')::text), '22023: invalid worker request',
  'a NULL domain is refused');
SELECT is(pg_temp.object('00000000-0000-4000-8000-0000000000d1', NULL), '22023: invalid worker request',
  'a NULL receipt id is refused');

-- A9: the web role, with a session, cannot call it, and the read changed nothing.
SELECT is(pg_temp.ask('ana', format('SELECT count(*) FROM app.worker_receipt_object(%L::uuid, %L::uuid)',
    '00000000-0000-4000-8000-0000000000d1', pg_temp.rid('request-1'))),
  '42501: permission denied for function worker_receipt_object', 'the web role cannot read the object');
SELECT is((SELECT status FROM evidence.receipt WHERE client_request_id = 'request-1'), 'pending_signature',
  'the read leaves the receipt pending');

SELECT * FROM finish();
ROLLBACK;

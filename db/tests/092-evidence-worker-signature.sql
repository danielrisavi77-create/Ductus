-- B-9 step 1 / DAN-84 (attack plan #1021): the worker's entry points that
-- list pending receipts, read a domain's receipt keys and attach a signature
-- without a session. Every person, key, document and signature below is
-- invented; the public keys are not points anyone holds.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

-- A second evidence domain of fak-a, for a key of the right institution but
-- the wrong domain.
INSERT INTO evidence.domain (id, institution_id, region)
VALUES ('00000000-0000-4000-8000-0000000000d3', pg_temp.id('fak_a'), 'eu-west-1');

CREATE FUNCTION pg_temp.spki(p_byte text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'MCowBQYDK2VwAyEA' || translate(rtrim(encode(decode(repeat(p_byte, 32), 'hex'), 'base64'), '='), '+/', '-_')
$$;
CREATE FUNCTION pg_temp.sig(p_key text, p_version text DEFAULT '1', p_letter text DEFAULT 'A') RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('algorithm', 'Ed25519', 'keyId', p_key, 'keyVersion', p_version,
    'signatureEncoding', 'raw', 'signatureBase64Url', repeat(p_letter, 85) || 'A')
$$;
-- The worker role without any session (N-1).
CREATE FUNCTION pg_temp.worker(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask_as('ductus_worker', 'anon', p_sql)
$$;
CREATE FUNCTION pg_temp.rid(p_request text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM evidence.receipt WHERE client_request_id = p_request
$$;
-- outcome|signature of one worker attach; the digest is the right one unless given.
CREATE FUNCTION pg_temp.attach(p_request text, p_signature jsonb, p_digest text DEFAULT NULL) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.worker(format(
    $q$ SELECT outcome || '|' || coalesce(signature::text, '') FROM app.worker_attach_receipt_signature(%L::uuid, %L, %L::jsonb) $q$,
    pg_temp.rid(p_request),
    coalesce(p_digest, (SELECT pg_temp.sha(receipt_payload) FROM evidence.receipt WHERE client_request_id = p_request)),
    p_signature::text))
$$;
-- The pending list of a domain as request ids in the order returned.
CREATE FUNCTION pg_temp.pending(p_domain text, p_limit text DEFAULT '10') RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN w ~ '^[0-9a-f,-]*$' THEN
    (SELECT coalesce(string_agg(r.client_request_id, ',' ORDER BY x.ord), '')
       FROM unnest(string_to_array(w, ',')) WITH ORDINALITY AS x (id, ord)
       JOIN evidence.receipt r ON r.id = x.id::uuid)
    ELSE w END
  FROM pg_temp.worker(format(
    $q$ SELECT coalesce(string_agg(receipt_id::text, ',' ORDER BY ord), '')
          FROM app.worker_pending_receipts(%L::uuid, %s) WITH ORDINALITY AS w (receipt_id, receipt_payload, ord) $q$,
    p_domain, p_limit)) AS w
$$;
CREATE FUNCTION pg_temp.sorted(p_list text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(x, ',' ORDER BY x) FROM unnest(string_to_array(p_list, ',')) AS x
$$;
CREATE FUNCTION pg_temp.evidence_print() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(string_agg(r, '|' ORDER BY r)) FROM (
    SELECT 'd' || row_to_json(x)::text FROM evidence.document x UNION ALL
    SELECT 'r' || row_to_json(x)::text FROM evidence.document_revision x UNION ALL
    SELECT 'p' || row_to_json(x)::text FROM evidence.package x UNION ALL
    SELECT 's' || row_to_json(x)::text FROM evidence.segment x UNION ALL
    SELECT 'c' || row_to_json(x)::text FROM evidence.receipt x UNION ALL
    SELECT 'y' || row_to_json(x)::text FROM evidence.signing_key x
  ) AS t (r)
$$;

SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.signing_key
  (key_id, key_version, evidence_domain_id, institution_id, purpose, algorithm, key_base64url, valid_from, valid_to, revoked_at)
VALUES
  ('key-a', '1', '00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), 'receipt', 'Ed25519', pg_temp.spki('11'),
   date_trunc('minute', now()) - interval '1 day', NULL, NULL),
  ('key-other-domain', '1', '00000000-0000-4000-8000-0000000000d3', pg_temp.id('fak_a'), 'receipt', 'Ed25519', pg_temp.spki('22'),
   date_trunc('minute', now()) - interval '1 day', NULL, NULL),
  ('key-b', '1', '00000000-0000-4000-8000-0000000000d2', pg_temp.id('fak_b'), 'receipt', 'Ed25519', pg_temp.spki('33'),
   date_trunc('minute', now()) - interval '1 day', NULL, NULL),
  ('key-checkpoint', '1', '00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), 'checkpoint', 'Ed25519', pg_temp.spki('44'),
   date_trunc('minute', now()) - interval '1 day', NULL, NULL),
  ('key-revoked', '1', '00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), 'receipt', 'Ed25519', pg_temp.spki('55'),
   date_trunc('minute', now()) - interval '1 day', NULL, now() - interval '1 hour'),
  ('key-retired', '1', '00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), 'receipt', 'Ed25519', pg_temp.spki('66'),
   date_trunc('minute', now()) - interval '2 days', date_trunc('minute', now()) - interval '1 day', NULL),
  ('key-future', '1', '00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), 'receipt', 'Ed25519', pg_temp.spki('77'),
   date_trunc('minute', now()) + interval '1 day', NULL, NULL);
RESET ROLE;

-- Catalogue (P-18): three DEFINER functions of the evidence role, executed by
-- the worker role alone, and the worker executes nothing else.
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.oid IN ('app.worker_pending_receipts(uuid,integer)'::regprocedure, 'app.worker_receipt_keys(uuid)'::regprocedure,
                      'app.worker_attach_receipt_signature(uuid,text,jsonb)'::regprocedure)
        AND (NOT p.prosecdef OR p.proowner <> 'ductus_evidence'::regrole OR NOT 'search_path=""' = ANY (p.proconfig)) $$,
  'the three worker RPCs are SECURITY DEFINER functions of the evidence role with an empty search_path');
SELECT bag_eq(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname NOT IN ('information_schema', 'public')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
        AND has_function_privilege('ductus_worker', p.oid, 'EXECUTE') $$,
  $$ VALUES ('app.worker_pending_receipts(uuid,integer)'), ('app.worker_receipt_keys(uuid)'),
            ('app.worker_attach_receipt_signature(uuid,text,jsonb)') $$,
  'the worker role executes exactly the three worker RPCs');
SELECT is_empty(
  $$ SELECT r || ' ' || p.oid::regprocedure::text FROM pg_proc p
      CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_retention', 'ductus_auth', 'ductus_identity', 'ductus_test_stranger']) AS r
      WHERE p.oid IN ('app.worker_pending_receipts(uuid,integer)'::regprocedure, 'app.worker_receipt_keys(uuid)'::regprocedure,
                      'app.worker_attach_receipt_signature(uuid,text,jsonb)'::regprocedure)
        AND has_function_privilege(r, p.oid, 'EXECUTE') $$,
  'no other runtime role executes a worker RPC');
SELECT ok(has_schema_privilege('ductus_worker', 'app', 'USAGE') AND NOT has_schema_privilege('ductus_worker', 'app', 'CREATE')
  AND NOT has_schema_privilege('ductus_worker', 'evidence', 'USAGE'),
  'the worker reaches the app schema to call its RPCs, creates nothing and has no way into evidence');
SELECT is(pg_get_function_arguments('app.worker_attach_receipt_signature(uuid,text,jsonb)'::regprocedure),
  'p_receipt_id uuid, p_payload_digest_sha256 text, p_signature jsonb',
  'the attach takes no person, institution or key domain: they come from the receipt');
SELECT is(pg_get_function_result('app.worker_pending_receipts(uuid,integer)'::regprocedure),
  'TABLE(receipt_id uuid, receipt_payload text)', 'the list carries the receipt id and its stored text only (N-5)');
SELECT is(pg_get_indexdef('evidence.evidence_receipt_pending_idx'::regclass),
  'CREATE INDEX evidence_receipt_pending_idx ON evidence.receipt USING btree (evidence_domain_id, created_at, id) WHERE (status = ''pending_signature''::text)',
  'pending receipts of a domain are found oldest first through a partial index');

-- Fixture: Ana's two pending receipts in domain d1, Tomo's in d2; a v2
-- receipt accepted long before key-a became valid and a v1 receipt, both
-- older, written by the owner.
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
  client_request_id, payload_sha256, descriptor, receipt_payload, status, created_at)
VALUES
  (gen_random_uuid(), 'pkg-a', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1', 'segment-a-1', pg_temp.id('ana'),
   'late-v2', repeat('a', 64), '{}', '{"acceptedAt":"2026-01-01T00:00:00.000Z","receiptSchema":"ductus-evidence-receipt-v2"}',
   'pending_signature', now() - interval '1 day'),
  (gen_random_uuid(), 'pkg-a', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1', 'segment-a-1', pg_temp.id('ana'),
   'legacy-v1', repeat('a', 64), '{}', '{"acceptedAt":"2026-01-01T00:00:00.000Z","receiptSchema":"ductus-evidence-receipt-v1"}',
   'pending_signature', now() - interval '2 days');
RESET ROLE;

-- The pending list (N-4, N-5, P-4).
SELECT is(pg_temp.pending('00000000-0000-4000-8000-0000000000d1', '1'), 'late-v2',
  'the oldest pending v2 receipt of the domain comes first; the older v1 receipt is never listed');
SELECT is(pg_temp.sorted(pg_temp.pending('00000000-0000-4000-8000-0000000000d1')), 'late-v2,request-1,request-2',
  'the list holds every pending v2 receipt of the domain and nothing of another domain');
SELECT is(pg_temp.pending('00000000-0000-4000-8000-0000000000d2'), 'request-b1', 'the worker of domain d2 sees only Tomo''s receipt');
SELECT is(pg_temp.pending('00000000-0000-4000-8000-0000000000d3'), '', 'a domain without pending receipts lists nothing');
SELECT is(pg_temp.worker($$ SELECT receipt_payload FROM app.worker_pending_receipts('00000000-0000-4000-8000-0000000000d2', 1) $$),
  (SELECT receipt_payload FROM evidence.receipt WHERE client_request_id = 'request-b1'),
  'the listed text is the stored receipt text, byte for byte (P-3)');
SELECT is(pg_temp.pending('00000000-0000-4000-8000-0000000000d1', p), '22023: invalid worker request',
  'a limit of ' || p || ' is refused') FROM unnest(ARRAY['0', '101', 'NULL']) AS p;
SELECT is(pg_temp.pending(NULL), '22023: invalid worker request', 'a list without a domain is refused');

-- The receipt keys of a domain (N-6): receipt keys only, revoked and retired
-- ones with their state, never a key of another domain or purpose.
SELECT is(pg_temp.worker($$ SELECT string_agg(key_id || ':' || (revoked_at IS NOT NULL) || ':' || (valid_to IS NOT NULL), ',' ORDER BY key_id)
    FROM app.worker_receipt_keys('00000000-0000-4000-8000-0000000000d1') $$),
  'key-a:false:false,key-future:false:false,key-retired:false:true,key-revoked:true:false',
  'domain d1 has four receipt keys; the checkpoint key and the keys of d2 and d3 are not among them');
SELECT is(pg_temp.worker($$ SELECT string_agg(key_id || ' ' || key_version || ' ' || key_base64url, ',')
    FROM app.worker_receipt_keys('00000000-0000-4000-8000-0000000000d2') $$),
  'key-b 1 ' || pg_temp.spki('33'), 'domain d2 has Tomo''s institution key with its public key');
SELECT is(pg_temp.worker('SELECT count(*) FROM app.worker_receipt_keys(NULL)'), '22023: invalid worker request',
  'keys without a domain are refused');

-- Signing out of order (request-2 before request-1) as the worker, without a
-- session (N-1). The web RPC would refuse this receipt from another
-- transaction (other_transaction); the worker path has no such rule.
SELECT is((SELECT xmax::text FROM evidence.signing_key WHERE key_id = 'key-a'), '0', 'before signing nothing holds the key');
SELECT is(pg_temp.attach('request-2', pg_temp.sig('key-a')), 'signed|' || pg_temp.sig('key-a')::text,
  'the worker signs a pending receipt with the domain''s receipt key');
SELECT is((SELECT format('%s|%s|%s', status, key_id, signature = pg_temp.sig('key-a')) FROM evidence.receipt WHERE client_request_id = 'request-2'),
  'signed|key-a|t', 'the receipt holds the signature and the key id');
SELECT isnt((SELECT xmax::text FROM evidence.signing_key WHERE key_id = 'key-a'), '0',
  'the key row stays locked until commit, so a revocation waits for the signature (P-15, N-10)');
SELECT is(pg_temp.attach('request-2', pg_temp.sig('key-a')), 'already_signed|' || pg_temp.sig('key-a')::text,
  'a repeat of the same signature is already_signed with the stored signature (P-9 c, P-11)');
SELECT is(pg_temp.attach('request-2', pg_temp.sig('key-a', '1', 'B')), 'already_signed|' || pg_temp.sig('key-a')::text,
  'another signature never overwrites the stored one (P-8)');
SELECT is(pg_temp.pending('00000000-0000-4000-8000-0000000000d1', '100'), 'late-v2,request-1',
  'a signed receipt leaves the list');

-- Refusals on request-1; each leaves every row as it was.
INSERT INTO ref SELECT 'print_before', pg_temp.evidence_print();
SELECT is(pg_temp.worker(format($q$ SELECT outcome FROM app.worker_attach_receipt_signature(%L::uuid, %L, %L::jsonb) $q$,
    gen_random_uuid(), repeat('0', 64), pg_temp.sig('key-a'))), 'not_found', 'an unknown receipt id is not_found');
SELECT is(pg_temp.attach('request-1', pg_temp.sig('key-a'), repeat('0', 64)), 'digest_mismatch|',
  'a digest that is not the SHA-256 of the stored receipt text is refused (P-5)');
SELECT is(pg_temp.attach('request-1', pg_temp.sig('key-a'), upper(pg_temp.h('x'))), 'invalid|', 'an upper-case digest is invalid');
SELECT is(pg_temp.attach('request-1', s), 'invalid|', 'a malformed envelope is invalid: ' || s::text)
  FROM unnest(ARRAY[pg_temp.sig('key-a') || '{"extra": 1}', pg_temp.sig('key-a') - 'keyVersion',
    pg_temp.sig('key-a') || '{"algorithm": "ECDSA_P256_SHA256"}', pg_temp.sig('key-a') || '{"signatureEncoding": "der"}',
    pg_temp.sig('key-a') || jsonb_build_object('signatureBase64Url', repeat('A', 85)),
    pg_temp.sig('key-a') || jsonb_build_object('signatureBase64Url', repeat('A', 85) || 'B'),
    pg_temp.sig('key-a') || '{"keyId": 1}', '[]'::jsonb]) AS s;
SELECT is(pg_temp.attach('legacy-v1', pg_temp.sig('key-a')), 'unsupported_schema|',
  'a receipt of another schema is never signed on the v2 path, whatever the digest (P-4)');
SELECT is(pg_temp.attach('request-1', pg_temp.sig(k, v)), o || '|', o || ': ' || k || ' version ' || v)
  FROM (VALUES ('key-none', '1', 'key_unknown'), ('key-a', '2', 'key_unknown'), ('key-other-domain', '1', 'key_scope'),
               ('key-b', '1', 'key_scope'), ('key-checkpoint', '1', 'key_scope'), ('key-revoked', '1', 'key_revoked'),
               ('key-retired', '1', 'key_not_valid'), ('key-future', '1', 'key_not_valid')) AS t (k, v, o);
SELECT is(pg_temp.evidence_print(), (SELECT val FROM ref WHERE name = 'print_before'), 'no refusal writes anything');

-- A package closed by its submission still has its earlier receipt signed (N-3).
INSERT INTO ref SELECT 'payload_1', receipt_payload FROM evidence.receipt WHERE client_request_id = 'request-1';
UPDATE evidence.package SET accepts_evidence = false WHERE id = 'pkg-a';
SELECT is(pg_temp.attach('request-1', pg_temp.sig('key-a', '1', 'C')), 'signed|' || pg_temp.sig('key-a', '1', 'C')::text,
  'the receipt of a closed package is signed');
SELECT is((SELECT receipt_payload FROM evidence.receipt WHERE client_request_id = 'request-1'), (SELECT val FROM ref WHERE name = 'payload_1'),
  'signing changes no byte of the receipt text');

-- A receipt accepted before key-a became valid is signed by it (N-7).
SELECT is(pg_temp.attach('late-v2', pg_temp.sig('key-a')), 'signed|' || pg_temp.sig('key-a')::text,
  'valid_from is compared with the time of signing, not with acceptedAt');
SELECT is(pg_temp.pending('00000000-0000-4000-8000-0000000000d1'), '', 'domain d1 has no pending v2 receipt left');
SELECT is((SELECT status FROM evidence.receipt WHERE client_request_id = 'legacy-v1'), 'pending_signature',
  'the v1 receipt stays pending for its own path');

-- Role boundaries (P-18): the worker has no direct access and none of the
-- web RPCs; the web role has none of the worker RPCs.
SELECT matches(pg_temp.worker('SELECT count(*) FROM evidence.receipt'), '^42501:', 'the worker reads no evidence table directly');
SELECT matches(pg_temp.worker(format($q$ UPDATE evidence.receipt SET status = 'pending_signature' WHERE id = %L RETURNING 1 $q$, pg_temp.rid('request-b1'))),
  '^42501:', 'the worker writes no evidence table directly');
SELECT matches(pg_temp.worker(format($q$ SELECT outcome FROM app.attach_receipt_signature(%L::uuid, %L, %L::jsonb) $q$,
    pg_temp.rid('request-b1'), repeat('0', 64), pg_temp.sig('key-b'))), '^42501:', 'the worker cannot use the web signature RPC');
SELECT matches(pg_temp.worker($$ SELECT outcome FROM app.commit_evidence_segment('pkg-b', 'x', 0, 'a', 'b', '{}', 'c', 'd', 'e') $$),
  '^42501:', 'the worker cannot accept evidence');
SELECT matches(pg_temp.ask('tomo', format($q$ SELECT outcome FROM app.worker_attach_receipt_signature(%L::uuid, %L, %L::jsonb) $q$,
    pg_temp.rid('request-b1'), repeat('0', 64), pg_temp.sig('key-b'))), '^42501:', 'the web role cannot use the worker attach');
SELECT matches(pg_temp.ask('tomo', $$ SELECT count(*) FROM app.worker_pending_receipts('00000000-0000-4000-8000-0000000000d2', 1) $$),
  '^42501:', 'the web role cannot list pending receipts');
SELECT matches(pg_temp.ask('tomo', $$ SELECT count(*) FROM app.worker_receipt_keys('00000000-0000-4000-8000-0000000000d2') $$),
  '^42501:', 'the web role cannot use the worker key read');
SELECT is((SELECT status FROM evidence.receipt WHERE client_request_id = 'request-b1'), 'pending_signature',
  'Tomo''s receipt is still pending after every refused call');

SELECT * FROM finish();
ROLLBACK;

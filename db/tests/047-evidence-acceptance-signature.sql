-- B-8 step 3 / DAN-83: the key registry, the signature RPC and the acceptance
-- with its snapshot and named conflicts (docs/BACKEND.md 4.13 t. 5 and 7 and
-- its pgTAP rows; ADR 2026-10-11 5.3 t. 9 to 12). Every person, key, document
-- and signature below is invented; the public keys are not points anyone holds.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

-- A second evidence domain of fak-a (another region), for a key of the right
-- institution but the wrong domain.
INSERT INTO evidence.domain (id, institution_id, region)
VALUES ('00000000-0000-4000-8000-0000000000d3', pg_temp.id('fak_a'), 'eu-west-1');

-- A canonical Ed25519 SPKI (RFC 8410 prefix and 32 bytes) in unpadded base64url.
CREATE FUNCTION pg_temp.spki(p_byte text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'MCowBQYDK2VwAyEA' || translate(rtrim(encode(decode(repeat(p_byte, 32), 'hex'), 'base64'), '='), '+/', '-_')
$$;
CREATE FUNCTION pg_temp.sig(p_key text, p_version text DEFAULT '1') RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('algorithm', 'Ed25519', 'keyId', p_key, 'keyVersion', p_version,
    'signatureEncoding', 'raw', 'signatureBase64Url', repeat('A', 86))
$$;
CREATE FUNCTION pg_temp.attach(p_actor text, p_request text, p_signature jsonb, p_digest text DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format('SELECT outcome FROM app.attach_receipt_signature(%L::uuid, %L, %L::jsonb)',
    (SELECT id FROM evidence.receipt WHERE client_request_id = p_request),
    coalesce(p_digest, (SELECT pg_temp.sha(receipt_payload) FROM evidence.receipt WHERE client_request_id = p_request)),
    p_signature::text))
$$;
-- One acceptance as one line: outcome, receipt, signature and conflict state.
CREATE FUNCTION pg_temp.accept(
  p_request text, p_descriptor jsonb, p_revision bigint, p_initial text, p_final text, p_payload_hash text,
  p_snapshot text DEFAULT NULL
) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask('ana', format(
    $q$ SELECT format('%%s|%%s|%%s|%%s|%%s|%%s|%%s', outcome, committed_revision, signature,
                         current_revision, document_hash, head_segment_hash, last_sequence_to)
          FROM app.commit_evidence_segment('pkg-a', %L, %s, %L, %L, %L::jsonb, %L, %L, %L) $q$,
    p_request, p_revision, pg_temp.sha(p_initial), pg_temp.sha(p_final), p_descriptor::text, p_payload_hash,
    'synthetic://pkg-a/' || p_request, coalesce(p_snapshot, p_final)))
$$;
CREATE FUNCTION pg_temp.second(p_segment text DEFAULT 'segment-a-2', p_from bigint DEFAULT 2,
  p_predecessor text DEFAULT repeat('b', 64)) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_temp.descriptor(p_segment => p_segment, p_sequence_from => p_from, p_sequence_to => p_from,
    p_hash => repeat('c', 64), p_predecessor => p_predecessor)
$$;
-- Everything the evidence schema holds, as one value.
CREATE FUNCTION pg_temp.evidence_print() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(string_agg(r, '|' ORDER BY r)) FROM (
    SELECT 'd' || row_to_json(x)::text FROM evidence.document x UNION ALL
    SELECT 'r' || row_to_json(x)::text FROM evidence.document_revision x UNION ALL
    SELECT 'k' || row_to_json(x)::text FROM evidence.document_checkpoint x UNION ALL
    SELECT 'p' || row_to_json(x)::text FROM evidence.package x UNION ALL
    SELECT 's' || row_to_json(x)::text FROM evidence.segment x UNION ALL
    SELECT 'c' || row_to_json(x)::text FROM evidence.receipt x UNION ALL
    SELECT 'y' || row_to_json(x)::text FROM evidence.signing_key x
  ) AS t (r)
$$;

-- Operator configuration (in the demo a db/local script): the keys.
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

-- Catalogue: the registry and the two RPCs.
SELECT row_eq(
  $$ SELECT relowner::regrole::text, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE oid = 'evidence.signing_key'::regclass $$,
  ROW('ductus_evidence'::text, true, true), 'the evidence role owns the key registry and RLS is enabled and forced');
SELECT bag_eq(
  $$ SELECT polname::text, polroles::regrole[]::text FROM pg_policy WHERE polrelid = 'evidence.signing_key'::regclass $$,
  $$ VALUES ('evidence_signing_key_owner', '{ductus_evidence}'), ('evidence_signing_key_read', '{ductus_app}') $$,
  'the owner''s policy and one read policy for the web role (step 4a)');
SELECT is(
  (SELECT polcmd::text || ' ' || pg_get_expr(polqual, polrelid) || ' ' || coalesce(pg_get_expr(polwithcheck, polrelid), '-')
     FROM pg_policy WHERE polrelid = 'evidence.signing_key'::regclass AND polname = 'evidence_signing_key_read'),
  'r (institution_id = ( SELECT app.current_institution_id() AS current_institution_id)) -',
  'the web role reads only keys of the session''s institution, and the policy allows no write');
SELECT bag_eq(
  $$ SELECT a.grantee::regrole::text, a.privilege_type FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid = 'evidence.signing_key'::regclass AND a.grantee <> c.relowner $$,
  $$ VALUES ('ductus_app', 'SELECT') $$,
  'the only privilege beside the owner''s is SELECT for the web role');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p
  CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_identity',
                          'ductus_migrator', 'ductus_test_stranger']) AS r
  WHERE has_table_privilege(r, 'evidence.signing_key', p) AND (r, p) <> ('ductus_app', 'SELECT')
), 'no runtime role writes the key registry, and only the web role reads it');
SELECT bag_eq(
  $$ SELECT attname::text, format_type(atttypid, atttypmod) FROM pg_attribute
      WHERE attrelid = 'evidence.signing_key'::regclass AND attnum > 0 AND NOT attisdropped $$,
  $$ VALUES ('key_id', 'text'), ('key_version', 'text'), ('evidence_domain_id', 'uuid'), ('institution_id', 'uuid'),
            ('purpose', 'text'), ('algorithm', 'text'), ('key_base64url', 'text'),
            ('valid_from', 'timestamp with time zone'), ('valid_to', 'timestamp with time zone'),
            ('revoked_at', 'timestamp with time zone'), ('created_at', 'timestamp with time zone') $$,
  'a key holds its domain, institution, purpose, public key and validity');
SELECT col_hasnt_default('evidence', 'signing_key', 'institution_id', 'the key has no tenant default');
SELECT is(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'evidence.signing_key'::regclass AND contype = 'f'),
  'FOREIGN KEY (evidence_domain_id, institution_id) REFERENCES evidence.domain(id, institution_id)',
  'one composite foreign key ties a key to its domain and institution; it never cascades');
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.oid IN ('app.attach_receipt_signature(uuid,text,jsonb)'::regprocedure,
                      'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)'::regprocedure)
        AND (NOT p.prosecdef OR p.proowner <> 'ductus_evidence'::regrole OR NOT 'search_path=""' = ANY (p.proconfig)) $$,
  'both RPCs are SECURITY DEFINER functions of the evidence role with an empty search_path');
SELECT is_empty(
  $$ SELECT r || ' ' || p.oid::regprocedure::text FROM pg_proc p
      CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_identity',
                              'ductus_test_stranger']) AS r
      WHERE (p.oid IN ('evidence.inserted_by_current_transaction(xid)'::regprocedure,
                       'evidence.guard_signing_key_change()'::regprocedure)
             OR (r <> 'ductus_app' AND p.oid IN ('app.attach_receipt_signature(uuid,text,jsonb)'::regprocedure,
                 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)'::regprocedure)))
        AND has_function_privilege(r, p.oid, 'EXECUTE') $$,
  'only the web role executes the two RPCs, and nobody the private helpers');
SELECT is(to_regprocedure('app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text)')::text, NULL,
  'the acceptance without a snapshot is gone');
SELECT is(pg_get_function_arguments('app.attach_receipt_signature(uuid,text,jsonb)'::regprocedure),
  'p_receipt_id uuid, p_payload_digest_sha256 text, p_signature jsonb',
  'the signature RPC takes no person, institution or key domain: they come from the session and the receipt');
SELECT is(pg_get_function_result('app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)'::regprocedure),
  'TABLE(outcome text, committed_revision bigint, receipt_payload text, receipt_id uuid, signature jsonb, current_revision bigint, document_hash text, head_segment_hash text, last_sequence_to bigint)',
  'the acceptance returns the receipt, the stored signature and the conflict state');

-- Access matrix: a member of an institution reads all of its keys, of every
-- domain, purpose and state, and no key of another; without a session nothing.
-- A write grant given by mistake still takes no write.
SELECT is(pg_temp.ask(p, $$ SELECT string_agg(key_id, ',' ORDER BY key_id) FROM evidence.signing_key $$),
  'key-a,key-checkpoint,key-future,key-other-domain,key-retired,key-revoked', p || ' reads every key of fak-a and none of fak-b')
  FROM unnest(ARRAY['ana', 'vesna', 'iva']) AS p;
SELECT is(pg_temp.ask('tomo', $$ SELECT string_agg(key_id, ',' ORDER BY key_id) FROM evidence.signing_key $$),
  'key-b', 'tomo reads only the key of fak-b');
SELECT is(pg_temp.ask('anon', 'SELECT count(*) FROM evidence.signing_key'), '0', 'without a session no key is read');
GRANT INSERT, UPDATE, DELETE ON evidence.signing_key TO ductus_app;
SELECT matches(pg_temp.ask('ana', format(
  $q$ INSERT INTO evidence.signing_key (key_id, key_version, evidence_domain_id, institution_id, purpose, algorithm,
        key_base64url, valid_from) VALUES ('key-x', '1', %L, %L, 'receipt', 'Ed25519', %L, date_trunc('minute', now())) $q$,
  '00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), pg_temp.spki('88'))),
  '^42501: new row violates row-level security policy', 'with a mistaken grant RLS refuses a key from the web role');
SELECT is(pg_temp.ask('ana', 'WITH u AS (UPDATE evidence.signing_key SET revoked_at = now() RETURNING 1) SELECT count(*) FROM u'),
  '0', 'with a mistaken grant RLS lets the web role revoke nothing');
SELECT is(pg_temp.ask('ana', 'WITH d AS (DELETE FROM evidence.signing_key RETURNING 1) SELECT count(*) FROM d'),
  '0', 'with a mistaken grant RLS lets the web role delete nothing');
REVOKE INSERT, UPDATE, DELETE ON evidence.signing_key FROM ductus_app;

-- The registry's own rules, as the owner.
CREATE FUNCTION pg_temp.key_insert(p_values text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask_as('ductus_evidence', 'anon', format(
    $q$ INSERT INTO evidence.signing_key (key_id, key_version, evidence_domain_id, institution_id, purpose, algorithm,
          key_base64url, valid_from, valid_to) VALUES (%s) RETURNING 1 $q$, p_values))
$$;
SELECT is(pg_temp.key_insert(format($$ 'key-control', '1', %L, %L, 'receipt', 'Ed25519', %L, date_trunc('minute', now()), NULL $$,
  '00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), pg_temp.spki('99'))), '1', 'control: a well-formed key is accepted');
SELECT matches(pg_temp.key_insert(format($$ 'key-control', '1', %L, %L, 'receipt', 'Ed25519', %L, date_trunc('minute', now()), NULL $$,
  '00000000-0000-4000-8000-0000000000d2', pg_temp.id('fak_b'), pg_temp.spki('aa'))), '^23505:', 'a key id is unique across domains');
SELECT matches(pg_temp.key_insert(format($$ 'key-copy', '1', %L, %L, 'receipt', 'Ed25519', %L, date_trunc('minute', now()), NULL $$,
  '00000000-0000-4000-8000-0000000000d2', pg_temp.id('fak_b'), pg_temp.spki('11'))), '^23505:', 'one public key belongs to one domain');
SELECT matches(pg_temp.key_insert(format($$ 'key-mixed', '1', %L, %L, 'receipt', 'Ed25519', %L, date_trunc('minute', now()), NULL $$,
  '00000000-0000-4000-8000-0000000000d2', pg_temp.id('fak_a'), pg_temp.spki('bb'))), '^23503:', 'a key cannot pair a domain with another institution');
SELECT matches(pg_temp.key_insert(format($$ 'key-short', '1', %L, %L, 'receipt', 'Ed25519', %L, date_trunc('minute', now()), NULL $$,
  '00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), left(pg_temp.spki('cc'), 58))), '^23514:', 'a key that is not a 44-byte Ed25519 SPKI is refused');
SELECT matches(pg_temp.key_insert(format($$ 'key-padded', '1', %L, %L, 'receipt', 'Ed25519', %L, date_trunc('minute', now()), NULL $$,
  '00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), pg_temp.spki('cc') || '=')), '^23514:', 'a padded key is refused');
SELECT matches(pg_temp.key_insert(format($$ 'key-ecdsa', '1', %L, %L, 'receipt', 'ECDSA_P256_SHA256', %L, date_trunc('minute', now()), NULL $$,
  '00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), pg_temp.spki('dd'))), '^23514:', 'a key of another algorithm is refused');
SELECT matches(pg_temp.key_insert(format($$ 'key-second', '1', %L, %L, 'receipt', 'Ed25519', %L, date_trunc('minute', now()) + interval '1 second', NULL $$,
  '00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), pg_temp.spki('ee'))), '^23514:', 'validity starts on a whole minute');
SELECT matches(pg_temp.key_insert(format($$ 'key-reversed', '1', %L, %L, 'receipt', 'Ed25519', %L, date_trunc('minute', now()), date_trunc('minute', now()) $$,
  '00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), pg_temp.spki('ff'))), '^23514:', 'validity ends after it starts');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', format($q$ UPDATE evidence.signing_key SET key_base64url = %L
    WHERE key_id = 'key-control' RETURNING 1 $q$, pg_temp.spki('12'))), '^ZD403:', 'the public key under a key id never changes');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ UPDATE evidence.signing_key SET evidence_domain_id = '00000000-0000-4000-8000-0000000000d3'
    WHERE key_id = 'key-control' RETURNING 1 $$), '^ZD403:', 'a key never moves to another domain');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ UPDATE evidence.signing_key SET valid_to = date_trunc('minute', now())
    WHERE key_id = 'key-control' RETURNING 1 $$), '^ZD403:', 'validity cannot end at or before a minute already signed in');
SELECT is(pg_temp.ask_as('ductus_evidence', 'anon', $$ UPDATE evidence.signing_key SET valid_to = date_trunc('minute', now()) + interval '1 hour'
    WHERE key_id = 'key-control' RETURNING 1 $$), '1', 'validity may end once, later');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ UPDATE evidence.signing_key SET valid_to = date_trunc('minute', now()) + interval '2 hours'
    WHERE key_id = 'key-control' RETURNING 1 $$), '^ZD403:', 'an end of validity is never moved');
SELECT is(pg_temp.ask_as('ductus_evidence', 'anon', $$ UPDATE evidence.signing_key SET revoked_at = now()
    WHERE key_id = 'key-control' RETURNING 1 $$), '1', 'a key may be revoked once');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ UPDATE evidence.signing_key SET revoked_at = NULL
    WHERE key_id = 'key-control' RETURNING 1 $$), '^ZD403:', 'a revocation is never taken back');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ DELETE FROM evidence.signing_key WHERE key_id = 'key-control' RETURNING 1 $$),
  '^ZD403:', 'a key is never deleted');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', 'TRUNCATE evidence.signing_key'), '^ZD403:', 'the registry is never truncated');

-- The acceptance writes the snapshot with the revision (4.13 t. 5, 4.10 t. 2).
SELECT is(pg_temp.accept('request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64), repeat('b', 64)),
  'reserved|1|||||', 'a new segment is reserved with its snapshot');
SELECT is((SELECT format('%s|%s', body = repeat('d', 64), content_hash = pg_temp.h('d'))
    FROM evidence.document_checkpoint WHERE document_id = 'doc-a' AND revision = 1),
  't|t', 'the snapshot of revision 1 holds the bytes sent and their hash');
INSERT INTO ref SELECT 'print_before_refusals', pg_temp.evidence_print();
SELECT is(pg_temp.accept('request-x1', pg_temp.second(), 1, repeat('d', 64), repeat('e', 64), repeat('c', 64), repeat('x', 64)),
  'invalid||||||', 'a snapshot whose bytes do not hash to the final document hash is invalid');
SELECT is(pg_temp.ask('ana', format($q$ SELECT outcome FROM app.commit_evidence_segment('pkg-a', 'request-x2', 1, %L, %L, %L::jsonb,
    %L, 'synthetic://x2', NULL) $q$, pg_temp.h('d'), pg_temp.h('e'), pg_temp.second()::text, repeat('c', 64))),
  'invalid', 'an acceptance without a snapshot is invalid');

-- t. 9 to 12: each conflict by its own name, with the state of the locked rows.
SELECT is(pg_temp.accept('request-stale', pg_temp.second(), 0, repeat('a', 64), repeat('e', 64), repeat('c', 64)),
  format('stale_base|||1|%s|%s|1', pg_temp.h('d'), repeat('b', 64)), 'a base revision behind the current one is stale_base');
SELECT is(pg_temp.accept('request-chain', pg_temp.second(p_predecessor => repeat('f', 64)), 1, repeat('d', 64), repeat('e', 64), repeat('c', 64)),
  format('chain_conflict|||1|%s|%s|1', pg_temp.h('d'), repeat('b', 64)), 'a predecessor other than the head is chain_conflict');
SELECT is(pg_temp.accept('request-skip', pg_temp.second(p_from => 3), 1, repeat('d', 64), repeat('e', 64), repeat('c', 64)),
  format('not_continuous|||1|%s|%s|1', pg_temp.h('d'), repeat('b', 64)), 'a skipped sequence number after the head is not_continuous');
SELECT is(pg_temp.accept('request-initial', pg_temp.second(), 1, repeat('x', 64), repeat('e', 64), repeat('c', 64)),
  format('not_continuous|||1|%s|%s|1', pg_temp.h('d'), repeat('b', 64)), 'an initial hash other than the stored document is not_continuous');
SELECT is(pg_temp.accept('request-back', pg_temp.second(p_from => 1), 1, repeat('d', 64), repeat('e', 64), repeat('c', 64)),
  'invalid||||||', 'a sequence going back after the head is invalid, never a conflict');
SELECT is(pg_temp.accept('request-stale-chain', pg_temp.second(p_predecessor => repeat('f', 64)), 0, repeat('a', 64), repeat('e', 64), repeat('c', 64)),
  format('stale_base|||1|%s|%s|1', pg_temp.h('d'), repeat('b', 64)), 'a stale base is named before a chain conflict (t. 9 before t. 10)');
SELECT is(pg_temp.evidence_print(), (SELECT val FROM ref WHERE name = 'print_before_refusals'), 'refusals and conflicts write nothing');

-- Signing (4.13 t. 7): the caller's own pending receipt of this transaction.
SELECT is((SELECT xmax::text FROM evidence.signing_key WHERE key_id = 'key-a'), '0', 'before signing nothing holds the key');
SELECT is(pg_temp.attach('ana', 'request-1', pg_temp.sig('key-a')), 'signed', 'the receipt is signed with the domain''s receipt key');
SELECT is((SELECT format('%s|%s|%s', status, key_id, signature = pg_temp.sig('key-a')) FROM evidence.receipt WHERE client_request_id = 'request-1'),
  'signed|key-a|t', 'the receipt holds the signature and the key id');
SELECT isnt((SELECT xmax::text FROM evidence.signing_key WHERE key_id = 'key-a'), '0',
  'the key row stays locked until commit, so a revocation waits for the signature');
SELECT is(pg_temp.attach('ana', 'request-1', pg_temp.sig('key-a')), 'already_signed', 'a signed receipt is never signed again');

-- A repeat after the signature (4.13 t. 3.6, duplicate_signed): the stored
-- signature, and not one row changed.
INSERT INTO ref SELECT 'print_signed', pg_temp.evidence_print();
SELECT is(pg_temp.accept('request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64), repeat('b', 64)),
  format('duplicate_signed|1|%s||||', pg_temp.sig('key-a')), 'a repeat with the same key returns the stored signature');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64), repeat('b', 64), 'receipt_payload'),
  (SELECT receipt_payload FROM evidence.receipt WHERE client_request_id = 'request-1'), 'and the original receipt bytes');
SELECT is(pg_temp.evidence_print(), (SELECT val FROM ref WHERE name = 'print_signed'), 'the repeat changes no row');

-- Refusals on a second pending receipt; each leaves it pending.
SELECT is(pg_temp.accept('request-2', pg_temp.second(), 1, repeat('d', 64), repeat('e', 64), repeat('c', 64)),
  'reserved|2|||||', 'a second segment continues the chain');
SELECT is(pg_temp.attach('anon', 'request-2', pg_temp.sig('key-a')), 'unauthorized', 'no session signs nothing');
SELECT is(pg_temp.attach('boris', 'request-2', pg_temp.sig('key-a')), 'not_found', 'another student cannot sign the receipt');
SELECT is(pg_temp.attach('tomo', 'request-2', pg_temp.sig('key-b')), 'not_found', 'another institution cannot sign the receipt');
SELECT is(pg_temp.attach('vesna', 'request-2', pg_temp.sig('key-a')), 'not_found', 'the teacher cannot sign the receipt');
SELECT is(pg_temp.attach('ana', 'request-2', pg_temp.sig('key-a'), repeat('0', 64)), 'digest_mismatch',
  'a digest that is not the SHA-256 of the receipt payload is refused');
SELECT is(pg_temp.attach('ana', 'request-2', pg_temp.sig('key-a'), upper(pg_temp.h('x'))), 'invalid', 'an upper-case digest is invalid');
SELECT is(pg_temp.attach('ana', 'request-2', pg_temp.sig('key-a') || '{"extra": 1}'), 'invalid', 'an envelope with another field is invalid');
SELECT is(pg_temp.attach('ana', 'request-2', pg_temp.sig('key-a') - 'keyVersion'), 'invalid', 'an envelope without a field is invalid');
SELECT is(pg_temp.attach('ana', 'request-2', pg_temp.sig('key-a') || '{"algorithm": "ECDSA_P256_SHA256"}'), 'invalid',
  'a signature of another algorithm is invalid');
SELECT is(pg_temp.attach('ana', 'request-2', pg_temp.sig('key-a') || '{"signatureEncoding": "der"}'), 'invalid',
  'another signature encoding is invalid');
SELECT is(pg_temp.attach('ana', 'request-2', pg_temp.sig('key-a') || jsonb_build_object('signatureBase64Url', repeat('A', 85))), 'invalid',
  'a signature that is not 64 bytes is invalid');
SELECT is(pg_temp.attach('ana', 'request-2', pg_temp.sig('key-a') || jsonb_build_object('signatureBase64Url', repeat('A', 85) || 'B')), 'invalid',
  'a signature in a non-canonical base64url spelling is invalid');
SELECT is(pg_temp.attach('ana', 'request-2', pg_temp.sig('key-a') || '{"keyId": 1}'), 'invalid', 'a key id that is not text is invalid');
SELECT is(pg_temp.attach('ana', 'request-2', '[]'), 'invalid', 'a signature that is not an object is invalid');
SELECT is(pg_temp.attach('ana', 'request-2', pg_temp.sig('key-none')), 'key_unknown', 'a key outside the registry is refused');
SELECT is(pg_temp.attach('ana', 'request-2', pg_temp.sig('key-a', '2')), 'key_unknown', 'another version of a known key is refused');
SELECT is(pg_temp.attach('ana', 'request-2', pg_temp.sig('key-other-domain')), 'key_scope',
  'a key of another domain of the same institution is refused');
SELECT is(pg_temp.attach('ana', 'request-2', pg_temp.sig('key-b')), 'key_scope', 'a key of another institution''s domain is refused');
SELECT is(pg_temp.attach('ana', 'request-2', pg_temp.sig('key-checkpoint')), 'key_scope', 'a checkpoint key does not sign receipts');
SELECT is(pg_temp.attach('ana', 'request-2', pg_temp.sig('key-revoked')), 'key_revoked', 'a revoked key is refused');
SELECT is(pg_temp.attach('ana', 'request-2', pg_temp.sig('key-retired')), 'key_not_valid', 'a key whose validity ended is refused');
SELECT is(pg_temp.attach('ana', 'request-2', pg_temp.sig('key-future')), 'key_not_valid', 'a key not yet valid is refused');
SELECT is((SELECT status FROM evidence.receipt WHERE client_request_id = 'request-2'), 'pending_signature',
  'every refusal leaves the receipt unsigned');
SELECT is(pg_temp.attach('ana', 'request-2', pg_temp.sig('key-a')), 'signed', 'the right key still signs it');

-- L1: the student removed between the context check (t. 3.2) and the
-- acceptance (t. 3.6) is refused and nothing is written. Last block: it ends
-- Ana's membership.
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.evidence_commit_context('doc-a', 'request-3') $$), 'ok',
  'the context check passes while Ana is a student');
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('ana') AND member_to IS NULL;
INSERT INTO ref SELECT 'print_removed', pg_temp.evidence_print();
SELECT is(pg_temp.accept('request-3', pg_temp.second(p_segment => 'segment-a-3', p_from => 3, p_predecessor => repeat('c', 64)),
    2, repeat('e', 64), repeat('f', 64), repeat('c', 64)),
  'unauthorized||||||', 'the removed student is refused at the acceptance');
SELECT is(pg_temp.accept('request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64), repeat('b', 64)),
  'unauthorized||||||', 'and gets no earlier receipt back either');
SELECT is(pg_temp.evidence_print(), (SELECT val FROM ref WHERE name = 'print_removed'), 'the refused student writes nothing');

SELECT * FROM finish();
ROLLBACK;

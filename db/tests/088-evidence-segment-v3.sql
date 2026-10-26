-- DAN-343 (contract on #896): evidence segment format v3 in the database. The
-- descriptor validator takes the schema v2 or v3 and nothing else, and the
-- receipt names the schema of the descriptor it accepted. A package may hold
-- v2 and v3 segments in any order (an old tab keeps writing v2). Every
-- document, package and segment below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

CREATE FUNCTION pg_temp.with_schema(p_descriptor jsonb, p_schema jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_set(p_descriptor, '{evidenceSchema}', p_schema)
$$;
CREATE FUNCTION pg_temp.v3(p_descriptor jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_temp.with_schema(p_descriptor, '"ductus-evidence-segment-v3"')
$$;
-- 'valid' or 'invalid', never an error, like the caller reads it.
CREATE FUNCTION pg_temp.outcome(p_descriptor jsonb) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN CASE WHEN EXISTS (SELECT 1 FROM evidence.validate_segment_descriptor_v2(p_descriptor, repeat('b', 64)))
    THEN 'valid' ELSE 'invalid' END;
EXCEPTION WHEN OTHERS THEN
  RETURN 'error ' || SQLSTATE;
END
$$;
CREATE FUNCTION pg_temp.receipt_schema(p_request text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask('ana', format($q$ SELECT receipt_payload::jsonb->>'evidenceSchema'
    FROM evidence.receipt WHERE client_request_id = %L $q$, p_request))
$$;

-- The validator: v2 as before, v3 now, every other schema invalid.
SELECT is(pg_temp.outcome(pg_temp.descriptor()), 'valid', 'a v2 descriptor stays valid');
SELECT is(pg_temp.outcome(pg_temp.v3(pg_temp.descriptor())), 'valid', 'a v3 descriptor is valid');
SELECT is((SELECT format('%s|%s|%s|%s', sequence_from, sequence_to, event_count, payload_bytes)
    FROM evidence.validate_segment_descriptor_v2(pg_temp.v3(pg_temp.descriptor()), repeat('b', 64))),
  '1|1|1|123', 'a v3 descriptor returns the same bounded fields as v2');
SELECT is(pg_temp.outcome(pg_temp.with_schema(pg_temp.descriptor(), v.schema::jsonb)), 'invalid',
  'the schema ' || v.schema || ' is invalid without an error')
FROM (VALUES
  (1, '"ductus-evidence-segment-v1"'), (2, '"ductus-evidence-segment-v4"'), (3, '""'),
  (4, '"ductus-evidence-segment-V3"'), (5, '"Ductus-evidence-segment-v3"'),
  (6, '"ductus-evidence-segment-v3 "'), (7, '" ductus-evidence-segment-v3"'),
  (8, '"ductus-evidence-segment-v"'), (9, '"ductus-evidence-segment-v23"'),
  (10, '3'), (11, 'null'), (12, '["ductus-evidence-segment-v3"]')
) AS v (n, schema)
ORDER BY v.n;
SELECT is(pg_temp.outcome(pg_temp.v3(pg_temp.descriptor()) || '{"unknown":true}'::jsonb), 'invalid',
  'a v3 descriptor with an unknown field is invalid, as in v2');
SELECT is(pg_temp.outcome(pg_temp.v3(pg_temp.descriptor()) - 'evidenceSchema'), 'invalid',
  'a descriptor without a schema is invalid');

-- Owner, mode and grants of both functions are those of the earlier migrations.
SELECT is((SELECT format('%s|%s|%s', proowner::regrole, prosecdef, 'search_path=""' = ANY (proconfig))
    FROM pg_proc WHERE oid = 'evidence.validate_segment_descriptor_v2(jsonb,text)'::regprocedure),
  'ductus_evidence|f|t', 'the validator keeps its owner, mode and empty search_path');
SELECT is((SELECT format('%s|%s|%s', proowner::regrole, prosecdef, 'search_path=""' = ANY (proconfig))
    FROM pg_proc WHERE oid = 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)'::regprocedure),
  'ductus_evidence|t|t', 'the acceptance keeps its owner, SECURITY DEFINER and empty search_path');
SELECT ok(
  has_function_privilege('ductus_app', 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_identity', 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_app', 'evidence.validate_segment_descriptor_v2(jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_identity', 'evidence.validate_segment_descriptor_v2(jsonb,text)', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid IN ('evidence.validate_segment_descriptor_v2(jsonb,text)'::regprocedure,
                    'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)'::regprocedure)
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ), 'the web role runs the acceptance, nobody else gains EXECUTE');

-- The receipt names the schema of the segment it accepted: v2, then v3, then
-- v2 again in one package.
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(),
    0, repeat('a', 64), repeat('d', 64), repeat('b', 64)),
  'reserved', 'a v2 segment is accepted');
SELECT is(pg_temp.receipt_schema('request-1'), 'ductus-evidence-segment-v2', 'its receipt names v2');

SELECT is(pg_temp.call('ana', 'pkg-a', 'request-2',
    pg_temp.v3(pg_temp.descriptor(p_segment => 'segment-a-2', p_sequence_from => 2, p_sequence_to => 2,
      p_hash => repeat('c', 64), p_predecessor => repeat('b', 64))),
    1, repeat('d', 64), repeat('e', 64), repeat('c', 64)),
  'reserved', 'a v3 segment continues the v2 chain');
SELECT is(pg_temp.receipt_schema('request-2'), 'ductus-evidence-segment-v3', 'its receipt names v3');
SELECT is(pg_temp.ask_as('ductus_evidence', 'ana', $$ SELECT receipt_payload = evidence.canonical_receipt_v2(receipt_payload::jsonb)
    FROM evidence.receipt WHERE client_request_id = 'request-2' $$),
  'true', 'the v3 receipt bytes use the canonical v2 receipt serializer');
SELECT is(pg_temp.ask('ana', $$ SELECT (receipt_payload::jsonb - 'receiptId' - 'acceptedAt' - 'previousReceiptId') = jsonb_build_object(
    'receiptSchema', 'ductus-evidence-receipt-v2', 'evidencePackageId', 'pkg-a', 'documentId', 'doc-a',
    'sessionId', 'capture-session-a', 'segmentId', 'segment-a-2', 'segmentHash', repeat('c', 64),
    'predecessorSegmentHash', repeat('b', 64), 'evidenceSchema', 'ductus-evidence-segment-v3',
    'evidenceProfileId', 'standard-v1', 'sequenceFrom', 2, 'sequenceTo', 2, 'eventCount', 1,
    'payloadBytes', 123, 'revision', 2, 'clientTransactionId', 'request-2',
    'evidenceDomainId', '00000000-0000-4000-8000-0000000000d1', 'principalId', {ana})
    FROM evidence.receipt WHERE client_request_id = 'request-2' $$),
  'true', 'the v3 receipt differs from a v2 one only in the schema it names');
SELECT is(pg_temp.ask('ana', $$ SELECT descriptor->>'evidenceSchema' FROM evidence.segment WHERE id = 'segment-a-2' $$),
  'ductus-evidence-segment-v3', 'the stored descriptor keeps v3');

SELECT is(pg_temp.call('ana', 'pkg-a', 'request-2',
    pg_temp.v3(pg_temp.descriptor(p_segment => 'segment-a-2', p_sequence_from => 2, p_sequence_to => 2,
      p_hash => repeat('c', 64), p_predecessor => repeat('b', 64))),
    1, repeat('d', 64), repeat('e', 64), repeat('c', 64), 'receipt_payload'),
  pg_temp.ask('ana', $$ SELECT receipt_payload FROM evidence.receipt WHERE client_request_id = 'request-2' $$),
  'a retry of the v3 segment returns its original receipt bytes');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-2',
    pg_temp.descriptor(p_segment => 'segment-a-2', p_sequence_from => 2, p_sequence_to => 2,
      p_hash => repeat('c', 64), p_predecessor => repeat('b', 64)),
    1, repeat('d', 64), repeat('e', 64), repeat('c', 64)),
  'idempotency_conflict', 'the same request cannot change its schema from v3 to v2');

SELECT is(pg_temp.call('ana', 'pkg-a', 'request-v4',
    pg_temp.with_schema(pg_temp.descriptor(p_segment => 'segment-a-3', p_sequence_from => 3, p_sequence_to => 3,
      p_hash => repeat('9', 64), p_predecessor => repeat('c', 64)), '"ductus-evidence-segment-v4"'),
    2, repeat('e', 64), repeat('f', 64), repeat('9', 64)),
  'invalid', 'a v4 segment is invalid');
SELECT is(pg_temp.ask('ana', $$ SELECT count(*)::text FROM evidence.receipt WHERE client_request_id = 'request-v4' $$),
  '0', 'and leaves no receipt');

SELECT is(pg_temp.call('ana', 'pkg-a', 'request-3',
    pg_temp.descriptor(p_segment => 'segment-a-3', p_sequence_from => 3, p_sequence_to => 3,
      p_hash => repeat('9', 64), p_predecessor => repeat('c', 64)),
    2, repeat('e', 64), repeat('f', 64), repeat('9', 64)),
  'reserved', 'a v2 segment after a v3 one is accepted (an old tab)');
SELECT is(pg_temp.receipt_schema('request-3'), 'ductus-evidence-segment-v2', 'its receipt names v2');
SELECT is(pg_temp.ask('ana', $$ SELECT string_agg(receipt_payload::jsonb->>'evidenceSchema', ',' ORDER BY (receipt_payload::jsonb->>'sequenceFrom')::int)
    FROM evidence.receipt WHERE evidence_package_id = 'pkg-a' $$),
  'ductus-evidence-segment-v2,ductus-evidence-segment-v3,ductus-evidence-segment-v2',
  'one package holds v2, v3 and v2 receipts in chain order');

SELECT * FROM finish();
ROLLBACK;

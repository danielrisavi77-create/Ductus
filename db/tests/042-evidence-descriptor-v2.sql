-- DAN-189 / B-8: synthetic receipt serialization and descriptor validation.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

CREATE FUNCTION pg_temp.descriptor() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'evidencePackageId', 'pkg-a', 'documentId', 'doc-a', 'sessionId', 'capture-a',
    'segmentId', 'segment-a-1', 'evidenceSchema', 'ductus-evidence-segment-v2',
    'canonicalization', 'RFC8785-JCS', 'hashAlgorithm', 'sha256',
    'evidenceProfileId', 'standard-v1', 'sequenceFrom', 1, 'sequenceTo', 1,
    'eventCount', 1, 'observedStartedAt', '2026-10-14T10:00:00.000Z',
    'observedEndedAt', '2026-10-14T10:00:00.000Z', 'segmentHash', repeat('b',64),
    'predecessorSegmentHash', NULL, 'payloadBytes', 123
  )
$$;

SELECT is(evidence.canonical_receipt_v2('{"z":1,"a":"x"}'::jsonb), '{"a":"x","z":1}',
  'receipt keys are serialized in canonical byte order');
SELECT throws_ok($$ SELECT evidence.canonical_receipt_v2('{"nested":{}}'::jsonb) $$,
  'ZD422', NULL, 'nested values are excluded from receipt serialization');
SELECT ok(
  NOT has_function_privilege('ductus_app', 'evidence.canonical_receipt_v2(jsonb)', 'EXECUTE')
  AND has_function_privilege('ductus_evidence', 'evidence.canonical_receipt_v2(jsonb)', 'EXECUTE')
  AND has_function_privilege('ductus_evidence', 'evidence.validate_segment_descriptor_v2(jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_identity', 'evidence.validate_segment_descriptor_v2(jsonb,text)', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid IN ('evidence.canonical_receipt_v2(jsonb)'::regprocedure,
                    'evidence.validate_segment_descriptor_v2(jsonb,text)'::regprocedure)
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ), 'helper functions have no public or app EXECUTE grant');
SELECT is((SELECT sequence_from FROM evidence.validate_segment_descriptor_v2(pg_temp.descriptor(), repeat('b',64))),
  1::bigint, 'the canonical descriptor validates');
SELECT is((SELECT payload_bytes FROM evidence.validate_segment_descriptor_v2(pg_temp.descriptor(), repeat('b',64))),
  123, 'validated descriptor fields are returned as bounded types');
SELECT is((SELECT count(*) FROM evidence.validate_segment_descriptor_v2(pg_temp.descriptor() || '{"unknown":true}'::jsonb, repeat('b',64))),
  0::bigint, 'unknown descriptor fields are rejected');
SELECT is((SELECT count(*) FROM evidence.validate_segment_descriptor_v2(pg_temp.descriptor() - 'segmentId', repeat('b',64))),
  0::bigint, 'missing fields are rejected');
SELECT is((SELECT count(*) FROM evidence.validate_segment_descriptor_v2(jsonb_set(pg_temp.descriptor(), '{sequenceFrom}', '1.5'), repeat('b',64))),
  0::bigint, 'fractional sequence numbers are rejected');
SELECT is((SELECT count(*) FROM evidence.validate_segment_descriptor_v2(jsonb_set(pg_temp.descriptor(), '{eventCount}', '5001'), repeat('b',64))),
  0::bigint, 'event counts over the protocol limit are rejected');
SELECT is((SELECT count(*) FROM evidence.validate_segment_descriptor_v2(jsonb_set(pg_temp.descriptor(), '{segmentHash}', to_jsonb(repeat('c',64))), repeat('b',64))),
  0::bigint, 'descriptor and received payload hashes must match');
SELECT is((SELECT count(*) FROM evidence.validate_segment_descriptor_v2(jsonb_set(pg_temp.descriptor(), '{observedStartedAt}', '"2026-02-30T10:00:00.000Z"'), repeat('b',64))),
  0::bigint, 'impossible UTC timestamps are rejected');
SELECT is((SELECT count(*) FROM evidence.validate_segment_descriptor_v2('[]'::jsonb, repeat('b',64))),
  0::bigint, 'non-object descriptors are rejected without error');

SELECT * FROM finish();
ROLLBACK;

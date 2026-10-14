-- DAN-189 / B-8: synthetic atomic acceptance and retry smoke coverage.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';
SELECT no_plan();

SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.domain (id, institution_id, region)
VALUES ('00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), 'eu-central-1');
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id)
VALUES ('project-a', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('ana'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash)
VALUES ('doc-a', pg_temp.id('fak_a'), 'project-a', pg_temp.id('ana'), repeat('a', 64));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash)
VALUES ('doc-a', pg_temp.id('fak_a'), 0, pg_temp.id('ana'), repeat('a', 64));
INSERT INTO evidence.package (
  id, institution_id, evidence_domain_id, document_id, project_id, principal_id,
  evidence_profile_id, max_payload_bytes
) VALUES (
  'pkg-a', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1',
  'doc-a', 'project-a', pg_temp.id('ana'), 'standard-v1', 2097152
);
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS evidence.evidence_document_current_revision_fkey DEFERRED;
RESET ROLE;

CREATE FUNCTION pg_temp.descriptor(
  p_package text DEFAULT 'pkg-a', p_document text DEFAULT 'doc-a', p_segment text DEFAULT 'segment-a-1',
  p_sequence_from bigint DEFAULT 1, p_sequence_to bigint DEFAULT 1, p_event_count integer DEFAULT 1,
  p_hash text DEFAULT repeat('b', 64), p_predecessor text DEFAULT NULL, p_bytes integer DEFAULT 123,
  p_session text DEFAULT 'capture-session-a'
) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'evidencePackageId', p_package, 'documentId', p_document, 'sessionId', p_session,
    'segmentId', p_segment, 'evidenceSchema', 'ductus-evidence-segment-v2',
    'canonicalization', 'RFC8785-JCS', 'hashAlgorithm', 'sha256',
    'evidenceProfileId', 'standard-v1', 'sequenceFrom', p_sequence_from,
    'sequenceTo', p_sequence_to, 'eventCount', p_event_count,
    'observedStartedAt', '2026-10-14T10:00:00.000Z',
    'observedEndedAt', '2026-10-14T10:00:00.000Z', 'segmentHash', p_hash,
    'predecessorSegmentHash', p_predecessor, 'payloadBytes', p_bytes
  )
$$;

CREATE FUNCTION pg_temp.call(p_column text DEFAULT 'outcome') RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask('ana', format(
    'SELECT %I FROM app.commit_evidence_segment(%L, %L, 0, %L, %L, %L::jsonb, %L, %L)',
    p_column, 'pkg-a', 'request-smoke', repeat('a',64), repeat('d',64),
    pg_temp.descriptor()::text, repeat('b',64), 'synthetic://pkg-a/request-smoke'
  ))
$$;

SELECT ok(
  (SELECT prosecdef AND 'search_path=""' = ANY(proconfig)
     FROM pg_proc WHERE oid = 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text)'::regprocedure),
  'the acceptance entrypoint is SECURITY DEFINER with an empty search_path'
);
SELECT ok(
  has_function_privilege('ductus_app', 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_test_stranger', 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text)', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text)'::regprocedure
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ), 'only the app role can execute the acceptance entrypoint'
);
SELECT ok(
  NOT has_function_privilege('ductus_app', 'evidence.canonical_receipt_v2(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_test_stranger', 'app.current_assignment_role(uuid)', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid IN ('evidence.canonical_receipt_v2(jsonb)'::regprocedure, 'app.current_assignment_role(uuid)'::regprocedure)
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ), 'internal receipt and identity helpers are not public entrypoints'
);
SELECT is(pg_temp.call(), 'reserved', 'a valid synthetic segment is reserved atomically');
SELECT is(pg_temp.ask('ana', $$ SELECT current_revision::text || ':' || current_content_hash
  FROM evidence.document WHERE id = 'doc-a' $$), '1:' || repeat('d',64), 'the document revision and hash advance together');
SELECT is(pg_temp.ask('ana', $$ SELECT concat_ws(':',
  (SELECT count(*) FROM evidence.document_revision WHERE document_id='doc-a'),
  (SELECT count(*) FROM evidence.segment WHERE evidence_package_id='pkg-a'),
  (SELECT count(*) FROM evidence.receipt WHERE evidence_package_id='pkg-a'),
  (SELECT status FROM evidence.receipt WHERE evidence_package_id='pkg-a')) $$),
  '2:1:1:pending_signature', 'one immutable revision, segment and pending receipt are recorded');
SELECT ok((SELECT receipt_payload = evidence.canonical_receipt_v2(receipt_payload::jsonb)
  AND receipt_payload::jsonb->>'revision' = '1'
  AND receipt_payload::jsonb->>'segmentHash' = repeat('b',64)
  FROM evidence.receipt WHERE client_request_id = 'request-smoke'), 'the stored receipt is canonical and binds this reservation');
SELECT is(pg_temp.call(), 'duplicate_pending', 'an identical retry returns the existing receipt');
SELECT is(pg_temp.ask('ana', $$ SELECT concat_ws(':',
  (SELECT current_revision FROM evidence.document WHERE id='doc-a'),
  (SELECT last_sequence_to FROM evidence.package WHERE id='pkg-a'),
  (SELECT count(*) FROM evidence.segment WHERE evidence_package_id='pkg-a'),
  (SELECT count(*) FROM evidence.receipt WHERE evidence_package_id='pkg-a')) $$),
  '1:1:1:1', 'an idempotent retry does not write a second revision or reservation');

SELECT * FROM finish();
ROLLBACK;

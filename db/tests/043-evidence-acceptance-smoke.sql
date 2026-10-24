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

-- The document after a segment is a stand-in text; its hash is the SHA-256
-- of the snapshot bytes sent with it.
CREATE FUNCTION pg_temp.sha(p_body text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_body, 'UTF8')), 'hex')
$$;
CREATE FUNCTION pg_temp.call(p_column text DEFAULT 'outcome') RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask('ana', format(
    'SELECT %I FROM app.commit_evidence_segment(%L, %L, 0, %L, %L, %L::jsonb, %L, %L, %L)',
    p_column, 'pkg-a', 'request-smoke', repeat('a',64), pg_temp.sha(repeat('d',64)),
    pg_temp.descriptor()::text, repeat('b',64), 'synthetic://pkg-a/request-smoke', repeat('d',64)
  ))
$$;

SELECT ok(
  (SELECT prosecdef AND 'search_path=""' = ANY(proconfig)
     FROM pg_proc WHERE oid = 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)'::regprocedure),
  'the acceptance entrypoint is SECURITY DEFINER with an empty search_path'
);
SELECT ok(
  has_function_privilege('ductus_app', 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_test_stranger', 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)'::regprocedure
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ), 'only the app role can execute the acceptance entrypoint'
);
SELECT ok(
  NOT has_function_privilege('ductus_app', 'evidence.canonical_receipt_v2(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_test_stranger', 'app.lock_student_assignment(uuid)', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid IN ('evidence.canonical_receipt_v2(jsonb)'::regprocedure, 'app.lock_student_assignment(uuid)'::regprocedure)
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ), 'internal receipt and identity helpers are not public entrypoints'
);
SELECT is(
  (SELECT xmax::text FROM institution.course_member
    WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('ana') AND member_to IS NULL),
  '0', 'before any acceptance nothing holds Ana''s membership row'
);
SELECT is(pg_temp.call(), 'reserved', 'a valid synthetic segment is reserved atomically');
-- ADR 2026-10-11 5.3 t. 7: the membership the acceptance relies on stays
-- locked until commit, so a removal cannot commit between check and write.
SELECT isnt(
  (SELECT xmax::text FROM institution.course_member
    WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('ana') AND member_to IS NULL),
  '0', 'the acceptance locks the student membership it relies on'
);
SELECT is(pg_temp.ask('ana', $$ SELECT current_revision::text || ':' || current_content_hash
  FROM evidence.document WHERE id = 'doc-a' $$), '1:' || pg_temp.sha(repeat('d',64)), 'the document revision and hash advance together');
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

-- ADR 2026-10-11 5.3 t. 8 and PRODUCT 6 (S3): a new acceptance needs the
-- current assignment version to be acknowledged and open. A new version is
-- written as publish_assignment_version writes it.
CREATE FUNCTION pg_temp.publish(p_version integer, p_opens_at timestamptz) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO institution.assignment_version (
    assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
    evidence_profile, import_allowed, created_by
  )
  SELECT v.assignment_id, p_version, v.title, v.instructions, v.work_type, p_opens_at,
         p_opens_at + interval '30 days', v.ai_policy, v.ai_purposes, v.evidence_profile, v.import_allowed,
         v.created_by
    FROM institution.assignment_version v
   WHERE v.assignment_id = pg_temp.id('z1') AND v.version_no = 2;
  UPDATE institution.assignment SET current_version = p_version WHERE id = pg_temp.id('z1');
$$;
CREATE FUNCTION pg_temp.next(p_request text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask('ana', format(
    'SELECT outcome FROM app.commit_evidence_segment(%L, %L, 1, %L, %L, %L::jsonb, %L, %L, %L)',
    'pkg-a', p_request, pg_temp.sha(repeat('d',64)), pg_temp.sha(repeat('e',64)),
    pg_temp.descriptor(p_segment => 'segment-a-2', p_sequence_from => 2, p_sequence_to => 2,
                       p_hash => repeat('c',64), p_predecessor => repeat('b',64))::text,
    repeat('c',64), 'synthetic://pkg-a/' || p_request, repeat('e',64)
  ))
$$;

SELECT pg_temp.publish(3, now() - interval '1 day');
SELECT is(pg_temp.next('request-unacknowledged'), 'not_accepting',
  'no new evidence before the student acknowledges the current version');
SELECT is(pg_temp.call(), 'duplicate_pending',
  'an already accepted request is still recovered after a new version');
SELECT pg_temp.publish(4, now() + interval '1 day');
SELECT is(pg_temp.ask('ana', 'SELECT institution.acknowledge_notice({z1}, 4) IS NOT NULL'), 'true',
  'Ana acknowledges the version that opens tomorrow');
SELECT is(pg_temp.next('request-not-open'), 'not_accepting',
  'no new evidence while the current version has not opened');
SELECT pg_temp.publish(5, now() - interval '1 day');
SELECT is(pg_temp.ask('ana', 'SELECT institution.acknowledge_notice({z1}, 5) IS NOT NULL'), 'true',
  'Ana acknowledges the open current version');
SELECT is(pg_temp.next('request-open'), 'reserved',
  'an acknowledged, open current version accepts the next segment');

SELECT * FROM finish();
ROLLBACK;

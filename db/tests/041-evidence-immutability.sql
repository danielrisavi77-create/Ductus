-- DAN-189 / D-103: immutable revisions/segments and the single receipt-signing transition.
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
  id, institution_id, evidence_domain_id, document_id, project_id, principal_id, evidence_profile_id, max_payload_bytes
) VALUES (
  'pkg-a', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1', 'doc-a', 'project-a',
  pg_temp.id('ana'), 'standard-v1', 2097152
);
INSERT INTO evidence.segment (
  id, evidence_package_id, institution_id, document_id, principal_id, session_id, sequence_from, sequence_to,
  event_count, descriptor, segment_hash, payload_bytes, storage_ref, accepted_at
) VALUES (
  'segment-a', 'pkg-a', pg_temp.id('fak_a'), 'doc-a', pg_temp.id('ana'), 'synthetic-session-a', 1, 1, 1,
  jsonb_build_object('segmentHash', repeat('b',64), 'payloadBytes', 123), repeat('b',64), 123,
  'synthetic://pkg-a/segment-a', now()
);
INSERT INTO evidence.receipt (
  id, evidence_package_id, institution_id, evidence_domain_id, segment_id, principal_id,
  client_request_id, payload_sha256, descriptor, receipt_payload, status
) VALUES (
  '00000000-0000-4000-8000-0000000000e1', 'pkg-a', pg_temp.id('fak_a'),
  '00000000-0000-4000-8000-0000000000d1', 'segment-a', pg_temp.id('ana'),
  'synthetic-request-a', repeat('e',64), '{}', '{"receipt":"synthetic"}', 'pending_signature'
);
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;

SELECT is((SELECT count(*)::integer FROM pg_trigger WHERE NOT tgisinternal
  AND tgname = ANY(ARRAY[
    'evidence_revision_immutable', 'evidence_revision_no_truncate',
    'evidence_segment_immutable', 'evidence_segment_no_truncate',
    'evidence_receipt_immutable', 'evidence_receipt_no_truncate'
  ])), 6, 'all six immutable-evidence triggers are installed');
SELECT ok(NOT has_function_privilege('ductus_app', 'evidence.reject_append_only_change()', 'EXECUTE')
  AND NOT has_function_privilege('ductus_app', 'evidence.guard_receipt_transition()', 'EXECUTE'),
  'the web role cannot invoke the private trigger functions');

SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ UPDATE evidence.document_revision
  SET content_hash = repeat('f',64) WHERE document_id = 'doc-a' $$),
  '^ZD403:', 'a document revision cannot be updated');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ DELETE FROM evidence.document_revision
  WHERE document_id = 'doc-a' $$), '^ZD403:', 'a document revision cannot be deleted');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ TRUNCATE evidence.document_revision CASCADE $$),
  '^ZD403:', 'document revisions cannot be truncated');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ UPDATE evidence.segment
  SET storage_ref = 'synthetic://rewritten' WHERE id = 'segment-a' $$),
  '^ZD403:', 'an evidence segment cannot be updated');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ DELETE FROM evidence.segment
  WHERE id = 'segment-a' $$), '^ZD403:', 'an evidence segment cannot be deleted');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ TRUNCATE evidence.segment CASCADE $$),
  '^ZD403:', 'evidence segments cannot be truncated');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ UPDATE evidence.receipt
  SET receipt_payload = '{"receipt":"rewritten"}' WHERE client_request_id = 'synthetic-request-a' $$),
  '^ZD403:', 'a receipt payload cannot be rewritten');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ DELETE FROM evidence.receipt
  WHERE client_request_id = 'synthetic-request-a' $$), '^ZD403:', 'a receipt cannot be deleted');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ TRUNCATE evidence.receipt CASCADE $$),
  '^ZD403:', 'receipts cannot be truncated');

SELECT is(pg_temp.ask_as('ductus_evidence', 'anon', $$ UPDATE evidence.receipt
  SET status = 'signed', signature = '{"algorithm":"synthetic","value":"test"}'::jsonb,
      key_id = 'synthetic-key'
  WHERE client_request_id = 'synthetic-request-a' RETURNING status $$),
  'signed', 'a pending receipt may transition once to signed with a signature envelope');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ UPDATE evidence.receipt
  SET key_id = 'rewritten-key' WHERE client_request_id = 'synthetic-request-a' $$),
  '^ZD403:', 'a signed receipt key id cannot be rewritten');

SELECT * FROM finish();
ROLLBACK;

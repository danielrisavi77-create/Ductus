-- DAN-289 A2 (contract #756, plan of attack #755 part B): the summary of a
-- submitted work stops at the submitted revision. Every person, document and
-- hash below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

-- outcome, segment count and the first letter of the last segment hash, as the reader sees them.
CREATE FUNCTION pg_temp.summary(p_actor text, p_document text DEFAULT 'doc-a') RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format($q$ SELECT concat_ws(' ', outcome, cardinality(segment_hashes),
      left(segment_hashes[cardinality(segment_hashes)], 1))
    FROM app.read_process_summary_source(%L) $q$, p_document))
$$;
CREATE FUNCTION pg_temp.listing(p_actor text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, $q$ SELECT array_to_string(segment_hashes, ',')
    FROM app.read_process_summary_source('doc-a') $q$)
$$;
CREATE FUNCTION pg_temp.req() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT id::text FROM evidence.submission_request WHERE document_id = 'doc-a'
$$;
CREATE FUNCTION pg_temp.opened() RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM audit.access_log
$$;

-- Ana commits revision 1 (segment b...b) and requests it, then commits
-- revisions 2 (c...c) and 3 (9...9) before the submission is recorded.
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64),
  repeat('b', 64)), 'reserved', 'fixture: Ana commits revision 1');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a', 1) $$), 'requested',
  'fixture: Ana requests revision 1');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-2',
    pg_temp.descriptor(p_segment => 'segment-a-2', p_sequence_from => 2, p_sequence_to => 2,
                       p_hash => repeat('c', 64), p_predecessor => repeat('b', 64)),
    1, repeat('d', 64), repeat('e', 64), repeat('c', 64)), 'reserved', 'fixture: Ana commits revision 2');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-3',
    pg_temp.descriptor(p_segment => 'segment-a-3', p_sequence_from => 3, p_sequence_to => 3,
                       p_hash => repeat('9', 64), p_predecessor => repeat('c', 64)),
    2, repeat('e', 64), repeat('f', 64), repeat('9', 64)), 'reserved', 'fixture: Ana commits revision 3');

-- A request alone is not a submission (B1, B4): the summary runs to the head.
SELECT is(pg_temp.summary('vesna'), 'found 3 9', 'before the submission the teacher reads up to the package head');
SELECT is(pg_temp.summary('ana'), 'found 3 9', 'and the student reads the same');
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.record_submission(%L::uuid, %L)', pg_temp.req(),
  repeat('f', 64))), 'artifact_mismatch', 'fixture: a mismatching reconstruction records nothing');
SELECT is(pg_temp.summary('vesna'), 'found 3 9', 'a refused submission does not cut the summary');

-- The submission of revision 1 cuts it there, for everyone who may read (B2).
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.record_submission(%L::uuid, %L)', pg_temp.req(),
  pg_temp.h('d'))), 'recorded', 'fixture: the submission of revision 1 is recorded');
SELECT is(pg_temp.summary('vesna'), 'found 1 b', 'the teacher reads the summary up to the submitted revision');
SELECT is(pg_temp.summary('ana'), 'found 1 b', 'the student reads the same summary');
SELECT is(pg_temp.listing('vesna'), pg_temp.listing('ana'), 'student and teacher get the same listing');
SELECT is(pg_temp.listing('ana'),
  pg_temp.ask('ana', format($q$ SELECT string_agg(e->>'segmentHash', ',' ORDER BY n)
      FROM app.read_submission_record(%L::uuid) r, jsonb_array_elements(r.segments) WITH ORDINALITY AS x(e, n) $q$,
    pg_temp.req())),
  'the listing is the record the submission was reconstructed from');
SELECT is(pg_temp.ask('vesna', $$ SELECT evidence_package_id FROM app.read_process_summary_source('doc-a') $$), 'pkg-a',
  'the package is the same');

-- Who may not read still may not, and the teacher's read is still logged (B5, B6).
SELECT is(pg_temp.summary('petra'), 'not_found', 'the teacher of another institution gets no answer');
SELECT is(pg_temp.summary('marko'), 'not_found', 'the teacher of another course gets no answer');
SELECT is(pg_temp.summary('dora'), 'not_found', 'a classmate gets no answer');
SELECT is(pg_temp.summary('tomo'), 'not_found', 'a student of another institution gets no answer');
SELECT is(pg_temp.summary('tomo', 'doc-b'), 'found 0', 'another document without a submission is not cut');
CREATE TEMP TABLE before_read AS SELECT pg_temp.opened() AS n;
SELECT is(pg_temp.summary('vesna'), 'found 1 b', 'fixture: the teacher reads again');
SELECT is(pg_temp.opened(), (SELECT n + 1 FROM before_read), 'the teacher''s read of a submitted work is logged');

-- No receipt names the submitted revision (B3): unavailable, never the head.
ALTER TABLE evidence.receipt DISABLE TRIGGER evidence_receipt_immutable;
UPDATE evidence.receipt SET receipt_payload = jsonb_set(receipt_payload::jsonb, '{revision}', '7')::text
 WHERE client_request_id = 'request-1';
ALTER TABLE evidence.receipt ENABLE TRIGGER evidence_receipt_immutable;
SELECT is(pg_temp.summary('vesna'), 'unavailable', 'without a receipt of the submitted revision the teacher gets unavailable');
SELECT is(pg_temp.summary('ana'), 'unavailable', 'and so does the student');
ALTER TABLE evidence.receipt DISABLE TRIGGER evidence_receipt_immutable;
UPDATE evidence.receipt SET receipt_payload = jsonb_set(receipt_payload::jsonb, '{revision}', '1')::text
 WHERE client_request_id = 'request-1';
UPDATE evidence.receipt SET receipt_payload = jsonb_set(receipt_payload::jsonb, '{revision}', '"1"')::text
 WHERE client_request_id = 'request-2';
ALTER TABLE evidence.receipt ENABLE TRIGGER evidence_receipt_immutable;
SELECT is(pg_temp.summary('vesna'), 'found 1 b', 'a revision written as a string elsewhere is not read as the submitted one');

-- Two packages of the submitted document (B7): unavailable, as before.
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.package (
  id, institution_id, evidence_domain_id, document_id, project_id, principal_id, evidence_profile_id,
  max_payload_bytes, accepts_evidence
) VALUES ('pkg-a-second', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1', 'doc-a', 'project-a',
  pg_temp.id('ana'), 'standard-v1', 2097152, false);
RESET ROLE;
SELECT is(pg_temp.summary('vesna'), 'unavailable', 'two packages of a submitted document give unavailable');

SELECT * FROM finish();
ROLLBACK;

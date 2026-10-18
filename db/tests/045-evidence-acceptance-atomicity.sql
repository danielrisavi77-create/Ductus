-- DAN-189 / #356: CAS, receipt, idempotency and rollback behavior.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'reserved', 'one valid segment reserves atomically');
SELECT is(pg_temp.ask('ana', $$ SELECT current_revision::text || ':' || current_content_hash
  FROM evidence.document WHERE id='doc-a' $$), '1:' || repeat('d',64), 'revision and document hash advance together');
SELECT is(pg_temp.ask('ana', $$ SELECT concat_ws(':',
  (SELECT count(*) FROM evidence.document_revision WHERE document_id='doc-a'),
  (SELECT count(*) FROM evidence.segment WHERE evidence_package_id='pkg-a'),
  (SELECT count(*) FROM evidence.receipt WHERE evidence_package_id='pkg-a'),
  (SELECT status FROM evidence.receipt WHERE evidence_package_id='pkg-a')) $$),
  '2:1:1:pending_signature', 'the RPC records one revision, segment and pending receipt');
SELECT is(pg_temp.ask('ana', $$ SELECT (receipt_payload::jsonb - 'receiptId' - 'acceptedAt') = jsonb_build_object(
  'receiptSchema','ductus-evidence-receipt-v2','evidencePackageId','pkg-a','documentId','doc-a',
  'sessionId','capture-session-a','segmentId','segment-a-1','segmentHash',repeat('b',64),
  'predecessorSegmentHash',NULL,'previousReceiptId',NULL,'evidenceSchema','ductus-evidence-segment-v2',
  'evidenceProfileId','standard-v1','sequenceFrom',1,'sequenceTo',1,'eventCount',1,
  'payloadBytes',123,'revision',1,'clientTransactionId','request-1',
  'evidenceDomainId','00000000-0000-4000-8000-0000000000d1','principalId',{ana})
  FROM evidence.receipt WHERE evidence_package_id='pkg-a' $$), 'true',
  'receipt binds the actor, domain, request and committed revision');
SELECT is(pg_temp.ask_as('ductus_evidence','ana', $$ SELECT receipt_payload=evidence.canonical_receipt_v2(receipt_payload::jsonb)
  FROM evidence.receipt WHERE evidence_package_id='pkg-a' $$), 'true', 'receipt bytes use the canonical v2 serializer');
SELECT is(pg_temp.ask('ana', $$ SELECT receipt_payload::jsonb->>'acceptedAt' ~
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:00[.]000Z$'
  FROM evidence.receipt WHERE evidence_package_id='pkg-a' $$), 'true', 'acceptedAt is a canonical UTC minute');
SELECT is(pg_temp.ask('ana', $$ SELECT receipt_payload::jsonb->>'receiptId' = id::text
  FROM evidence.receipt WHERE evidence_package_id='pkg-a' $$), 'true', 'receiptId names the persisted receipt row');
SELECT is(pg_temp.ask('ana', $$ SELECT r.receipt_payload::jsonb->>'acceptedAt'
    = to_char(s.accepted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:00.000"Z"')
  FROM evidence.receipt r JOIN evidence.segment s
    ON s.evidence_package_id = r.evidence_package_id AND s.id = r.segment_id
  WHERE r.evidence_package_id='pkg-a' $$), 'true', 'acceptedAt is the minute the segment was accepted');

SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'duplicate_pending', 'an identical retry returns the pending receipt');
SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64),'receipt_payload'),
  pg_temp.ask('ana', $$ SELECT receipt_payload FROM evidence.receipt WHERE evidence_package_id='pkg-a' $$),
  'the retry returns the original receipt bytes');
SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),1,repeat('a',64),repeat('d',64),repeat('b',64)),
  'idempotency_conflict', 'the same request cannot change its expected revision');
SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),0,repeat('c',64),repeat('d',64),repeat('b',64)),
  'idempotency_conflict', 'the same request cannot change its initial document hash');
SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),0,repeat('a',64),repeat('e',64),repeat('b',64)),
  'idempotency_conflict', 'the same request cannot change its final document hash');
SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64),
  'outcome', 'synthetic://different/request-1'),
  'idempotency_conflict', 'the same request cannot change its storage reference');
SELECT is(pg_temp.call('ana','pkg-a','request-1',
  pg_temp.descriptor(p_segment=>'segment-other',p_hash=>repeat('c',64)),0,repeat('a',64),repeat('d',64),repeat('c',64)),
  'idempotency_conflict', 'the same request id with a changed descriptor conflicts');
SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('c',64)),
  'invalid', 'the same descriptor with a changed payload hash is rejected');

UPDATE evidence.package SET accepts_evidence=false,max_payload_bytes=100 WHERE id='pkg-a';
SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'duplicate_pending', 'an identical retry precedes changed package acceptance and size limits');
SELECT is(pg_temp.call('ana','pkg-a','request-new',
  pg_temp.descriptor(p_segment=>'segment-a-2',p_sequence_from=>2,p_sequence_to=>2,p_hash=>repeat('c',64),p_predecessor=>repeat('b',64)),
  1,repeat('d',64),repeat('e',64),repeat('c',64)), 'not_accepting', 'a closed package refuses a new request');
UPDATE evidence.package SET accepts_evidence=true,max_payload_bytes=100 WHERE id='pkg-a';
SELECT is(pg_temp.call('ana','pkg-a','request-too-large',
  pg_temp.descriptor(p_segment=>'segment-too-large',p_sequence_from=>2,p_sequence_to=>2,p_hash=>repeat('c',64),p_predecessor=>repeat('b',64)),
  1,repeat('d',64),repeat('e',64),repeat('c',64)), 'too_large', 'a new payload obeys the package size limit');
UPDATE evidence.package SET max_payload_bytes=2097152 WHERE id='pkg-a';

SELECT is(pg_temp.call('ana','pkg-a','request-gap',
  pg_temp.descriptor(p_segment=>'segment-gap',p_sequence_from=>3,p_sequence_to=>3,p_hash=>repeat('c',64),p_predecessor=>repeat('b',64)),
  1,repeat('d',64),repeat('e',64),repeat('c',64)), 'chain_conflict', 'a sequence gap is rejected');
SELECT is(pg_temp.call('ana','pkg-a','request-gap-current',
  pg_temp.descriptor(p_segment=>'segment-gap-2',p_sequence_from=>3,p_sequence_to=>3,p_hash=>repeat('c',64),p_predecessor=>repeat('b',64)),
  1,repeat('d',64),repeat('e',64),repeat('c',64),'expected_previous_segment_hash'), repeat('b',64),
  'chain conflict returns the current segment hash');
SELECT is(pg_temp.call('ana','pkg-a','request-stale',
  pg_temp.descriptor(p_segment=>'segment-stale',p_sequence_from=>2,p_sequence_to=>2,p_hash=>repeat('c',64),p_predecessor=>repeat('b',64)),
  0,repeat('a',64),repeat('e',64),repeat('c',64)), 'concurrent_conflict', 'a stale document revision is rejected');
SELECT is(pg_temp.call('ana','pkg-a','request-bad-hash',
  pg_temp.descriptor(p_segment=>'segment-bad-hash',p_sequence_from=>2,p_sequence_to=>2,p_hash=>repeat('c',64),p_predecessor=>repeat('b',64)),
  1,repeat('d',64),repeat('e',64),repeat('f',64)), 'invalid', 'a digest that differs from the descriptor is rejected');
SELECT is(pg_temp.call('ana','pkg-a','request-bad-range',
  pg_temp.descriptor(p_segment=>'segment-bad-range',p_sequence_from=>2,p_sequence_to=>3,p_event_count=>1,p_hash=>repeat('c',64),p_predecessor=>repeat('b',64)),
  1,repeat('d',64),repeat('e',64),repeat('c',64)), 'invalid', 'sequence range must equal event count');
SELECT is(pg_temp.call('ana','pkg-a','request-bad-predecessor',
  pg_temp.descriptor(p_segment=>'segment-bad-predecessor',p_sequence_from=>2,p_sequence_to=>2,p_hash=>repeat('c',64),p_predecessor=>repeat('f',64)),
  1,repeat('d',64),repeat('e',64),repeat('c',64)), 'chain_conflict', 'a new segment must name the current predecessor');
SELECT is(pg_temp.call('ana','pkg-a','request-bad-initial',
  pg_temp.descriptor(p_segment=>'segment-bad-initial',p_sequence_from=>2,p_sequence_to=>2,p_hash=>repeat('c',64),p_predecessor=>repeat('b',64)),
  1,repeat('c',64),repeat('e',64),repeat('c',64)), 'concurrent_conflict', 'the initial content hash participates in CAS');
SELECT is(pg_temp.ask('ana', $$ SELECT current_revision::text || ':' || current_content_hash FROM evidence.document WHERE id='doc-a' $$),
  '1:' || repeat('d',64), 'refused requests do not change document state');
SELECT is(pg_temp.ask('ana', $$ SELECT last_sequence_to::text || ':' || head_segment_hash FROM evidence.package WHERE id='pkg-a' $$),
  '1:' || repeat('b',64), 'refused requests do not change the evidence head');

CREATE FUNCTION pg_temp.fail_receipt_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'synthetic mid-transaction failure' USING ERRCODE='ZD422'; END
$$;
CREATE TRIGGER evidence_test_fail_receipt BEFORE INSERT ON evidence.receipt
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_receipt_insert();
SELECT matches(pg_temp.call('ana','pkg-a','request-rollback',
  pg_temp.descriptor(p_segment=>'segment-a-2',p_sequence_from=>2,p_sequence_to=>2,p_hash=>repeat('c',64),p_predecessor=>repeat('b',64)),
  1,repeat('d',64),repeat('e',64),repeat('c',64)), '^ZD422:.*$', 'injected receipt failure is observable');
DROP TRIGGER evidence_test_fail_receipt ON evidence.receipt;
DROP FUNCTION pg_temp.fail_receipt_insert();
SELECT is(pg_temp.ask('ana', $$ SELECT count(*) FROM evidence.document_revision WHERE document_id='doc-a' $$),
  '2', 'failure after CAS rolled back the new document revision');
SELECT is(pg_temp.ask('ana', $$ SELECT count(*) FROM evidence.segment WHERE evidence_package_id='pkg-a' $$),
  '1', 'failure rolled back the segment');
SELECT is(pg_temp.ask('ana', $$ SELECT count(*) FROM evidence.receipt WHERE evidence_package_id='pkg-a' $$),
  '1', 'failure rolled back the receipt');
SELECT is(pg_temp.call('ana','pkg-a','request-rollback',
  pg_temp.descriptor(p_segment=>'segment-a-2',p_sequence_from=>2,p_sequence_to=>2,p_hash=>repeat('c',64),p_predecessor=>repeat('b',64)),
  1,repeat('d',64),repeat('e',64),repeat('c',64)), 'reserved', 'rollback leaves the revision and request key reusable');
SELECT is(pg_temp.ask('ana', $$ SELECT concat_ws(':',
    second.receipt_payload::jsonb->>'previousReceiptId' = first.id::text,
    second.receipt_payload::jsonb->>'predecessorSegmentHash' = repeat('b',64),
    second.previous_receipt_id = first.id)
  FROM evidence.receipt first, evidence.receipt second
  WHERE first.client_request_id='request-1' AND second.client_request_id='request-rollback' $$),
  't:t:t', 'a non-initial receipt names the previous receipt and segment hash');

UPDATE evidence.receipt SET status='signed',signature='{"signature":"synthetic"}'::jsonb,key_id='synthetic-key'
 WHERE client_request_id='request-1';
SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'duplicate_signed', 'a signed retry reports the signed state');
SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64),'receipt_payload'),
  pg_temp.ask('ana', $$ SELECT receipt_payload FROM evidence.receipt WHERE client_request_id='request-1' $$),
  'a signed retry returns the original receipt bytes');
SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64),'receipt_id'),
  pg_temp.ask('ana', $$ SELECT id::text FROM evidence.receipt WHERE client_request_id='request-1' $$),
  'a signed retry returns the original receipt id');
SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64),'committed_revision'),
  '1', 'a signed retry returns the original committed revision');

SELECT * FROM finish();
ROLLBACK;

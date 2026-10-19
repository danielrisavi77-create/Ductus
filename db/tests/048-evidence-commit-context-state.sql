-- F-099 / DAN-83: the context before a commit refuses what the acceptance
-- would refuse for a new key, and returns the chain state (docs/BACKEND.md
-- 4.13 t. 3.2 and 3.5). Every person, course and text below is invented.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';
SELECT no_plan();

INSERT INTO evidence.domain (id, institution_id, region) VALUES
  ('00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), 'eu-central-1');
INSERT INTO ref VALUES ('rev0_hash', 'a102ced8a59b446a86c135c8d87d3ddf9f889e4ac93bcbc1857cd7c2c73ad14b');
CREATE FUNCTION pg_temp.val(p_name text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT val FROM ref WHERE name = p_name $$;
-- One call as one line; a NULL column prints as nothing.
CREATE FUNCTION pg_temp.context(p_actor text, p_document text, p_key text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    $q$ SELECT format('%%s|%%s|%%s|%%s|%%s|%%s|%%s|%%s|%%s|%%s|%%s', outcome, evidence_package_id, institution_id,
                         evidence_domain_id, evidence_profile_id, max_payload_bytes, transaction_known,
                         current_revision, document_hash, head_segment_hash, last_sequence_to)
          FROM app.evidence_commit_context(%L, %L) $q$, p_document, p_key))
$$;
CREATE FUNCTION pg_temp.doc() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT d.id FROM evidence.document d JOIN evidence.project p ON p.id = d.project_id
   WHERE p.principal_id = pg_temp.id('ana') AND p.assignment_id = pg_temp.id('z1')
$$;
CREATE FUNCTION pg_temp.evidence_print() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT md5(string_agg(r, '|' ORDER BY r)) FROM (
    SELECT 'd' || row_to_json(x)::text FROM evidence.document x UNION ALL
    SELECT 'p' || row_to_json(x)::text FROM evidence.package x UNION ALL
    SELECT 's' || row_to_json(x)::text FROM evidence.segment x UNION ALL
    SELECT 'c' || row_to_json(x)::text FROM evidence.receipt x
  ) AS t (r)
$$;
-- A new current version of Z1, as publish_assignment_version writes it.
CREATE FUNCTION pg_temp.publish_z1(p_version integer, p_opens_at timestamptz) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO institution.assignment_version (
    assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
    evidence_profile, import_allowed, created_by
  )
  SELECT v.assignment_id, p_version, v.title, v.instructions, v.work_type, p_opens_at,
         p_opens_at + interval '30 days', v.ai_policy, v.ai_purposes, v.evidence_profile, v.import_allowed,
         v.created_by
    FROM institution.assignment_version v
   WHERE v.assignment_id = pg_temp.id('z1') AND v.version_no = 1;
  UPDATE institution.assignment SET current_version = p_version WHERE id = pg_temp.id('z1');
$$;

-- Catalogue: the same RPC, arguments and reach, with the state columns.
SELECT is(pg_get_function_arguments('app.evidence_commit_context(text,text)'::regprocedure),
  'p_document_id text, p_client_transaction_id text', 'the context still takes no person or institution');
SELECT is(pg_get_function_result('app.evidence_commit_context(text,text)'::regprocedure),
  'TABLE(outcome text, evidence_package_id text, institution_id uuid, evidence_domain_id uuid, evidence_profile_id text, max_payload_bytes integer, transaction_known boolean, current_revision bigint, document_hash text, head_segment_hash text, last_sequence_to bigint)',
  'the context returns the chain state and no person');
SELECT ok((SELECT p.prosecdef AND p.proowner = 'ductus_evidence'::regrole AND 'search_path=""' = ANY (p.proconfig)
             FROM pg_proc p WHERE p.oid = 'app.evidence_commit_context(text,text)'::regprocedure),
  'a SECURITY DEFINER function of the evidence role with an empty search_path');
SELECT is(ARRAY(SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth',
                                           'ductus_identity']) AS r
                 WHERE has_function_privilege(r, 'app.evidence_commit_context(text,text)', 'EXECUTE')),
  ARRAY['ductus_app'], 'only the web role executes it');

-- The owner's work at revision 0.
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.open_student_work(%L::uuid)', pg_temp.id('z1'))), 'opened',
  'the owner opens the work');
INSERT INTO ref SELECT 'pkg', id FROM evidence.package WHERE document_id = pg_temp.doc();
INSERT INTO ref VALUES ('ok_head', concat_ws('|', 'ok', pg_temp.val('pkg'), pg_temp.id('fak_a'),
  '00000000-0000-4000-8000-0000000000d1', 'standard-v1', '2097152'));
SELECT is(pg_temp.context('ana', pg_temp.doc(), 'tx-1'), pg_temp.val('ok_head') || '|f|0|' || pg_temp.val('rev0_hash') || '||0',
  'a new key gets the state of revision 0: no head segment and no sequence yet');

-- After one acceptance the state follows the document and the package.
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.segment (
  id, evidence_package_id, institution_id, document_id, principal_id, session_id, sequence_from, sequence_to,
  event_count, descriptor, segment_hash, payload_bytes, storage_ref, accepted_at
) VALUES ('segment-1', pg_temp.val('pkg'), pg_temp.id('fak_a'), pg_temp.doc(), pg_temp.id('ana'),
  'synthetic-session', 1, 4, 4, jsonb_build_object('segmentHash', repeat('b', 64), 'payloadBytes', 123),
  repeat('b', 64), 123, 'synthetic://segment-1', now());
INSERT INTO evidence.receipt (
  id, evidence_package_id, institution_id, evidence_domain_id, segment_id, principal_id, client_request_id,
  payload_sha256, descriptor, receipt_payload, status
) VALUES ('00000000-0000-4000-8000-0000000000e1', pg_temp.val('pkg'), pg_temp.id('fak_a'),
  '00000000-0000-4000-8000-0000000000d1', 'segment-1', pg_temp.id('ana'), 'tx-1', repeat('b', 64), '{}', '{}',
  'pending_signature');
SET CONSTRAINTS ALL DEFERRED;
UPDATE evidence.document SET current_revision = 1, current_content_hash = repeat('f', 64) WHERE id = pg_temp.doc();
INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
VALUES (pg_temp.doc(), pg_temp.id('fak_a'), 1, 0, pg_temp.id('ana'), repeat('f', 64));
UPDATE evidence.package SET head_segment_hash = repeat('b', 64), head_receipt_id = '00000000-0000-4000-8000-0000000000e1',
       last_sequence_to = 4
 WHERE id = pg_temp.val('pkg');
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;
SELECT is(pg_temp.context('ana', pg_temp.doc(), 'tx-2'),
  pg_temp.val('ok_head') || '|f|1|' || repeat('f', 64) || '|' || repeat('b', 64) || '|4',
  'the state is the current revision, its hash, the head segment and the last sequence');
SELECT is(pg_temp.context('ana', pg_temp.doc(), 'tx-1'),
  pg_temp.val('ok_head') || '|t|1|' || repeat('f', 64) || '|' || repeat('b', 64) || '|4', 'a known key gets the same state');

-- What the acceptance refuses for a new key, the context refuses first; a
-- known key is a retry and still gets ok, so it can reach its receipt.
CREATE TEMP TABLE print_before AS SELECT pg_temp.evidence_print() AS v;
UPDATE evidence.package SET accepts_evidence = false WHERE id = pg_temp.val('pkg');
SELECT is(pg_temp.context('ana', pg_temp.doc(), 'tx-2'), 'not_accepting||||||||||',
  'a package that accepts no more evidence: not_accepting, and nothing else');
SELECT matches(pg_temp.context('ana', pg_temp.doc(), 'tx-1'), '^ok\|.*\|t\|1\|', 'a known key still gets ok');
UPDATE evidence.package SET accepts_evidence = true WHERE id = pg_temp.val('pkg');

-- Z1 is at version 2 in the fixtures.
SELECT pg_temp.publish_z1(3, now() - interval '1 minute');
SELECT is(pg_temp.context('ana', pg_temp.doc(), 'tx-2'), 'not_accepting||||||||||',
  'a current version the student has not acknowledged: not_accepting');
SELECT matches(pg_temp.context('ana', pg_temp.doc(), 'tx-1'), '^ok\|', 'a known key still gets ok');
SELECT pg_temp.publish_z1(4, now() + interval '1 day');
INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
VALUES (pg_temp.id('z1'), 4, pg_temp.id('ana'), pg_temp.id('fak_a'));
SELECT is(pg_temp.context('ana', pg_temp.doc(), 'tx-2'), 'not_accepting||||||||||',
  'an acknowledged version that has not opened yet: not_accepting');
SELECT pg_temp.publish_z1(5, now() - interval '1 minute');
INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
VALUES (pg_temp.id('z1'), 5, pg_temp.id('ana'), pg_temp.id('fak_a'));
SELECT matches(pg_temp.context('ana', pg_temp.doc(), 'tx-2'), '^ok\|.*\|f\|1\|', 'acknowledged and open: ok again');
SELECT is(pg_temp.evidence_print(), (SELECT v FROM print_before), 'the context writes nothing');

-- The refusals before the state keep their answers and show no state.
SELECT is(pg_temp.context('dora', pg_temp.doc(), 'tx-2'), 'not_found||||||||||', 'another student: not_found, no state');
SELECT is(pg_temp.context('tomo', pg_temp.doc(), 'tx-2'), 'not_found||||||||||',
  'a student of another institution: not_found, no state');
SELECT is(pg_temp.context('vesna', pg_temp.doc(), 'tx-2'), 'not_found||||||||||', 'the teacher: not_found, no state');
SELECT is(pg_temp.context('anon', pg_temp.doc(), 'tx-2'), 'unauthenticated||||||||||', 'no session: unauthenticated');
SELECT is(pg_temp.context('ana', pg_temp.doc(), ''), 'invalid||||||||||', 'an empty key: invalid');
UPDATE institution.course_member SET member_to = now() WHERE user_id = pg_temp.id('ana') AND course_id = pg_temp.id('k1');
SELECT is(pg_temp.context('ana', pg_temp.doc(), 'tx-1'), 'not_found||||||||||',
  'a removed student gets not_found, even with a known key');

SELECT * FROM finish();
ROLLBACK;

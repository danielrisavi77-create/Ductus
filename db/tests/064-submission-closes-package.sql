-- DAN-289 A1 (contract #756, plan of attack #755 part A): a recorded
-- submission closes the packages of its document and they stay closed. Every
-- person, document and hash below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

-- Besides Ana's pkg-a and Tomo's pkg-b (fak-b): Dora's work of the same
-- assignment and Ana's work of another assignment (A5).
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES
  ('project-d', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('dora')),
  ('project-a2', pg_temp.id('fak_a'), pg_temp.id('z2'), pg_temp.id('ana'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash) VALUES
  ('doc-d', pg_temp.id('fak_a'), 'project-d', pg_temp.id('dora'), pg_temp.h('a')),
  ('doc-a2', pg_temp.id('fak_a'), 'project-a2', pg_temp.id('ana'), pg_temp.h('a'));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash) VALUES
  ('doc-d', pg_temp.id('fak_a'), 0, pg_temp.id('dora'), pg_temp.h('a')),
  ('doc-a2', pg_temp.id('fak_a'), 0, pg_temp.id('ana'), pg_temp.h('a'));
INSERT INTO evidence.package (
  id, institution_id, evidence_domain_id, document_id, project_id, principal_id, evidence_profile_id, max_payload_bytes
) VALUES
  ('pkg-d', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1', 'doc-d', 'project-d', pg_temp.id('dora'),
   'standard-v1', 2097152),
  ('pkg-a2', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1', 'doc-a2', 'project-a2', pg_temp.id('ana'),
   'standard-v1', 2097152);
-- The domain's receipt key, so a receipt accepted before the submission can be signed after it (A7).
INSERT INTO evidence.signing_key
  (key_id, key_version, evidence_domain_id, institution_id, purpose, algorithm, key_base64url, valid_from)
VALUES ('key-a', '1', '00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), 'receipt', 'Ed25519',
  'MCowBQYDK2VwAyEA' || translate(rtrim(encode(decode(repeat('11', 32), 'hex'), 'base64'), '='), '+/', '-_'),
  date_trunc('minute', now()) - interval '1 day');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS evidence.evidence_document_current_revision_fkey DEFERRED;
RESET ROLE;

CREATE FUNCTION pg_temp.accepts(p_package text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT accepts_evidence::text FROM evidence.package WHERE id = p_package
$$;
CREATE FUNCTION pg_temp.record(p_actor text, p_hash text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format('SELECT outcome FROM app.record_submission(%L::uuid, %L)',
    (SELECT id FROM evidence.submission_request WHERE document_id = 'doc-a'), p_hash))
$$;
-- Ana's second segment (revision 1 to 2) and a third one (2 to 3).
CREATE FUNCTION pg_temp.second() RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call('ana', 'pkg-a', 'request-2',
    pg_temp.descriptor(p_segment => 'segment-a-2', p_sequence_from => 2, p_sequence_to => 2,
                       p_hash => repeat('c', 64), p_predecessor => repeat('b', 64)),
    1, repeat('d', 64), repeat('e', 64), repeat('c', 64))
$$;
CREATE FUNCTION pg_temp.third() RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.call('ana', 'pkg-a', 'request-3',
    pg_temp.descriptor(p_segment => 'segment-a-3', p_sequence_from => 3, p_sequence_to => 3,
                       p_hash => repeat('9', 64), p_predecessor => repeat('c', 64)),
    2, repeat('e', 64), repeat('f', 64), repeat('9', 64))
$$;
CREATE FUNCTION pg_temp.context(p_key text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask('ana', format('SELECT outcome FROM app.evidence_commit_context(%L, %L)', 'doc-a', p_key))
$$;
CREATE FUNCTION pg_temp.chain() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT concat_ws(' ', (SELECT current_revision FROM evidence.document WHERE id = 'doc-a'),
    (SELECT count(*) FROM evidence.segment WHERE evidence_package_id = 'pkg-a'),
    (SELECT count(*) FROM evidence.receipt WHERE evidence_package_id = 'pkg-a'))
$$;

-- Shape (A12): two private trigger functions of the evidence role; the
-- closing trigger fires on every inserted submission inside its statement.
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.oid IN ('evidence.close_submitted_packages()'::regprocedure,
                      'evidence.keep_submitted_package_closed()'::regprocedure)
        AND (p.proowner <> 'ductus_evidence'::regrole OR NOT 'search_path=""' = ANY (p.proconfig)) $$,
  'both trigger functions belong to the evidence role and pin an empty search_path');
SELECT is_empty(
  $$ SELECT r || ' ' || p.oid::regprocedure::text FROM pg_proc p
      CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_identity',
                              'ductus_test_stranger']) AS r
      WHERE p.oid IN ('evidence.close_submitted_packages()'::regprocedure,
                      'evidence.keep_submitted_package_closed()'::regprocedure)
        AND has_function_privilege(r, p.oid, 'EXECUTE') $$,
  'no runtime role executes the trigger functions');
SELECT bag_eq(
  $$ SELECT c.relname || ': ' || t.tgname || ' ' || t.tgtype::text || ' ' || t.tgenabled::text || ' ' || t.tgdeferrable::text
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE t.tgname IN ('evidence_submission_closes_package', 'evidence_package_stays_closed') $$,
  ARRAY['submission: evidence_submission_closes_package 5 O false',
        'package: evidence_package_stays_closed 23 O false'],
  'after each inserted submission row, and before each package insert or accepts_evidence update; enabled, not deferrable');

-- Ana commits revision 1 and requests it; then commits revision 2 before the
-- submission is recorded (A11).
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64),
  repeat('b', 64)), 'reserved', 'fixture: Ana commits revision 1');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a', 1) $$), 'requested',
  'fixture: Ana requests revision 1');
SELECT is(pg_temp.second(), 'reserved', 'a commit between the request and the submission is still accepted');
SELECT is(pg_temp.chain(), '2 2 2', 'fixture: revision 2 is committed');

-- Only "recorded" closes (A3).
SELECT is(pg_temp.record('ana', repeat('f', 64)), 'artifact_mismatch', 'a mismatching reconstruction is not recorded');
SELECT is(pg_temp.record('tomo', pg_temp.h('d')), 'unauthorized', 'a student of another institution is refused');
SELECT is(pg_temp.record('dora', pg_temp.h('d')), 'unauthorized', 'a classmate is refused');
SELECT is(pg_temp.record('anon', pg_temp.h('d')), 'unauthorized', 'no session is refused');
SELECT is(pg_temp.record('ana', repeat('D', 64)), 'invalid', 'an invalid hash is refused');
SELECT is(pg_temp.accepts('pkg-a'), 'true', 'no refusal closes the package');
SELECT is(pg_temp.context('request-3'), 'ok', 'control: before the submission a new key is still accepted by the context');

-- The submission closes Ana's package of this document and nothing else (A1, A2, A5).
SELECT is(pg_temp.record('ana', pg_temp.h('d')), 'recorded', 'the submission of revision 1 is recorded');
SELECT is(pg_temp.accepts('pkg-a'), 'false', 'the package of the submitted document is closed by the same call');
SELECT is(concat_ws(' ', pg_temp.accepts('pkg-b'), pg_temp.accepts('pkg-d'), pg_temp.accepts('pkg-a2')), 'true true true',
  'another institution''s package, a classmate''s and Ana''s work of another assignment stay open');
SELECT is(pg_temp.ask('ana', $$ SELECT accepts_evidence::text FROM evidence.package WHERE id = 'pkg-a' $$), 'false',
  'the student reads the package as closed');

-- No new commit after the submission (A1).
SELECT is(pg_temp.context('request-3'), 'not_accepting', 'the context refuses a new key before anything is stored');
SELECT is(pg_temp.third(), 'not_accepting', 'the acceptance refuses a new segment after the submission');
SELECT is(pg_temp.chain(), '2 2 2', 'the refusal writes no revision, segment or receipt');

-- What was accepted before stays answered (A6, A7).
SELECT is(pg_temp.context('request-2'), 'ok', 'the context still answers a key accepted before the submission');
SELECT is(pg_temp.second(), 'duplicate_pending', 'a retry of a key accepted before the submission gets its receipt');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64),
  repeat('b', 64)), 'duplicate_pending', 'so does a retry of the submitted revision''s own key');
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.attach_receipt_signature(%L::uuid, %L, %L::jsonb)',
    (SELECT id FROM evidence.receipt WHERE client_request_id = 'request-2'),
    (SELECT pg_temp.sha(receipt_payload) FROM evidence.receipt WHERE client_request_id = 'request-2'),
    jsonb_build_object('algorithm', 'Ed25519', 'keyId', 'key-a', 'keyVersion', '1', 'signatureEncoding', 'raw',
                       'signatureBase64Url', repeat('A', 86))::text)),
  'signed', 'a receipt accepted before the submission is still signed after it');
SELECT is(pg_temp.second(), 'duplicate_signed', 'the retry then gets the signed receipt');
SELECT is(pg_temp.chain(), '2 2 2', 'neither the retries nor the signature add a revision');

-- A repeat keeps it closed (A4); opening the work still opens it (D2).
SELECT is(pg_temp.record('ana', pg_temp.h('d')), 'existing', 'a repeated submission returns the earlier one');
SELECT is(pg_temp.accepts('pkg-a'), 'false', 'the package stays closed after the repeat');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.open_student_work({z1}) $$), 'opened',
  'the student still opens the submitted work: a closed package is not an unacknowledged notice');

-- Nobody opens it again (A8).
SELECT matches(pg_temp.ask('ana', $$ UPDATE evidence.package SET accepts_evidence = true WHERE id = 'pkg-a' RETURNING 1 $$),
  '^42501:', 'the web role cannot reopen the package');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon',
    $$ UPDATE evidence.package SET accepts_evidence = true WHERE id = 'pkg-a' RETURNING 1 $$),
  '^ZD403:', 'the owner cannot reopen a package of a submitted document');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ INSERT INTO evidence.package (
      id, institution_id, evidence_domain_id, document_id, project_id, principal_id, evidence_profile_id, max_payload_bytes
    ) VALUES ('pkg-a-new', {fak_a}, '00000000-0000-4000-8000-0000000000d1', 'doc-a', 'project-a', {ana},
      'standard-v1', 2097152) RETURNING 1 $$),
  '^ZD403:', 'no new open package can be created for a submitted document');
SELECT is(pg_temp.ask_as('ductus_evidence', 'anon', $$ INSERT INTO evidence.package (
      id, institution_id, evidence_domain_id, document_id, project_id, principal_id, evidence_profile_id,
      max_payload_bytes, accepts_evidence
    ) VALUES ('pkg-a-closed', {fak_a}, '00000000-0000-4000-8000-0000000000d1', 'doc-a', 'project-a', {ana},
      'standard-v1', 2097152, false) RETURNING 1 $$),
  '1', 'control: a closed package of a submitted document can be created');
SELECT is(pg_temp.ask_as('ductus_evidence', 'anon',
    $$ UPDATE evidence.package SET head_segment_hash = head_segment_hash WHERE id = 'pkg-a' RETURNING 1 $$),
  '1', 'an update that does not touch accepts_evidence is not refused');
-- A package without a submission still closes and opens (045, 048).
SELECT is(pg_temp.ask_as('ductus_evidence', 'anon',
    $$ UPDATE evidence.package SET accepts_evidence = false WHERE id = 'pkg-d' RETURNING 1 $$),
  '1', 'control: the owner closes a package without a submission');
SELECT is(pg_temp.ask_as('ductus_evidence', 'anon',
    $$ UPDATE evidence.package SET accepts_evidence = true WHERE id = 'pkg-d' RETURNING 1 $$),
  '1', 'control: and opens it again');
SELECT is(pg_temp.accepts('pkg-a'), 'false', 'after every attempt the package of the submitted document is closed');

SELECT * FROM finish();
ROLLBACK;

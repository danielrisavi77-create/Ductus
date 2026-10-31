-- B-8 step 2 / DAN-83: the student's work and the checkpoint table
-- (docs/BACKEND.md 4.13 t. 6 and its pgTAP rows, 4.10 t. 3 and 5). Every
-- person, course and text below is invented.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';
SELECT no_plan();

-- Operator configuration: the evidence domain of fak-a. Fak-b gets its
-- domain only after the "not configured" rows below.
INSERT INTO evidence.domain (id, institution_id, region) VALUES
  ('00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), 'eu-central-1');

INSERT INTO ref VALUES
  ('rev0', '{"nodes":[{"children":[],"id":"00000000-0000-4000-8000-000000000000","type":"paragraph"}],"schemaVersion":1}'),
  ('rev0_hash', 'a102ced8a59b446a86c135c8d87d3ddf9f889e4ac93bcbc1857cd7c2c73ad14b');
CREATE FUNCTION pg_temp.val(p_name text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT val FROM ref WHERE name = p_name $$;
-- One call as one line, so two answers compare in full.
CREATE FUNCTION pg_temp.open(p_actor text, p_assignment uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    $q$ SELECT format('%%s|%%s|%%s|%%s|%%s|%%s|%%s|%%s', outcome, document_id, evidence_profile_id, current_revision,
                         document_hash, head_segment_hash, last_sequence_to, snapshot)
          FROM app.open_student_work(%L::uuid) $q$, p_assignment))
$$;
CREATE FUNCTION pg_temp.context(p_actor text, p_document text, p_key text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    $q$ SELECT format('%%s|%%s|%%s|%%s|%%s|%%s|%%s', outcome, evidence_package_id, institution_id, evidence_domain_id,
                         evidence_profile_id, max_payload_bytes, transaction_known)
          FROM app.evidence_commit_context(%L, %L) $q$, p_document, p_key))
$$;
CREATE FUNCTION pg_temp.works(p_student text) RETURNS integer
LANGUAGE sql STABLE AS $$ SELECT count(*)::integer FROM evidence.project WHERE principal_id = pg_temp.id(p_student) $$;
CREATE FUNCTION pg_temp.doc(p_student text, p_assignment text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT d.id FROM evidence.document d JOIN evidence.project p ON p.id = d.project_id
   WHERE p.principal_id = pg_temp.id(p_student) AND p.assignment_id = pg_temp.id(p_assignment)
$$;
-- Everything the evidence schema holds, as one value.
CREATE FUNCTION pg_temp.evidence_print() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT md5(string_agg(r, '|' ORDER BY r)) FROM (
    SELECT 'j' || row_to_json(x)::text FROM evidence.project x UNION ALL
    SELECT 'd' || row_to_json(x)::text FROM evidence.document x UNION ALL
    SELECT 'r' || row_to_json(x)::text FROM evidence.document_revision x UNION ALL
    SELECT 'k' || row_to_json(x)::text FROM evidence.document_checkpoint x UNION ALL
    SELECT 'p' || row_to_json(x)::text FROM evidence.package x UNION ALL
    SELECT 's' || row_to_json(x)::text FROM evidence.segment x UNION ALL
    SELECT 'c' || row_to_json(x)::text FROM evidence.receipt x
  ) AS t (r)
$$;
-- A new current version of Z3, as publish_assignment_version writes it.
CREATE FUNCTION pg_temp.publish_z3(p_version integer, p_opens_at timestamptz) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO institution.assignment_version (
    assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
    evidence_profile, import_allowed, created_by
  )
  SELECT v.assignment_id, p_version, v.title, v.instructions, v.work_type, p_opens_at,
         p_opens_at + interval '30 days', v.ai_policy, v.ai_purposes, v.evidence_profile, v.import_allowed,
         v.created_by
    FROM institution.assignment_version v
   WHERE v.assignment_id = pg_temp.id('z3') AND v.version_no = 1;
  UPDATE institution.assignment SET current_version = p_version WHERE id = pg_temp.id('z3');
$$;

-- Catalogue: the checkpoint table, the two RPCs and who may call them.
SELECT row_eq(
  $$ SELECT relowner::regrole::text, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE oid = 'evidence.document_checkpoint'::regclass $$,
  ROW('ductus_evidence'::text, true, true), 'the evidence role owns the checkpoint table and RLS is enabled and forced');
SELECT bag_eq(
  $$ SELECT polname::text, polroles::regrole[]::text FROM pg_policy WHERE polrelid = 'evidence.document_checkpoint'::regclass $$,
  $$ VALUES ('evidence_document_checkpoint_owner', '{ductus_evidence}') $$,
  'the only policy is the owner''s: the web role has no read policy');
SELECT is_empty(
  $$ SELECT a.grantee::regrole::text FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid = 'evidence.document_checkpoint'::regclass AND a.grantee <> c.relowner $$,
  'no role but the owner has any privilege on the checkpoint table');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p
  CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_identity',
                          'ductus_migrator']) AS r
  WHERE has_table_privilege(r, 'evidence.document_checkpoint', p)
), 'no runtime role reads or writes checkpoints directly');
SELECT bag_eq(
  $$ SELECT attname::text, format_type(atttypid, atttypmod) FROM pg_attribute
      WHERE attrelid = 'evidence.document_checkpoint'::regclass AND attnum > 0 AND NOT attisdropped $$,
  $$ VALUES ('document_id', 'text'), ('institution_id', 'uuid'), ('revision', 'bigint'), ('body', 'text'),
            ('content_hash', 'text'), ('created_at', 'timestamp with time zone') $$,
  'the checkpoint holds institution, document, revision, the bytes as text, their hash and the database time');
SELECT is(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'evidence.document_checkpoint'::regclass AND contype = 'f'),
  'FOREIGN KEY (document_id, institution_id, revision, content_hash) REFERENCES evidence.document_revision(document_id, institution_id, revision, content_hash)',
  'one composite foreign key ties a checkpoint to its revision, institution and hash; it never cascades');
SELECT is(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'evidence_project_one_per_student'),
  'UNIQUE (assignment_id, institution_id, principal_id)', 'one work per student and assignment');
SELECT bag_eq(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.proowner = 'ductus_evidence'::regrole AND has_function_privilege('ductus_app', p.oid, 'EXECUTE') $$,
  $$ VALUES ('app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)'),
            ('app.attach_receipt_signature(uuid,text,jsonb)'),
            ('app.request_submission(text,bigint)'), ('app.record_submission(uuid,text)'),
            ('app.open_student_work(uuid)'), ('app.evidence_commit_context(text,text)'),
            ('app.read_submission_record(uuid)'), ('app.prepare_submission_receipt(uuid,text,text)'),
            ('app.assignment_works(uuid)'), ('app.work_submitted(uuid)'), ('app.fast_path_works(uuid)'),
            ('app.assignment_submissions(uuid)'), ('app.teacher_assignment_names(uuid)'),
            ('app.attach_submission_receipt(uuid,text,jsonb)'), ('app.read_submission_receipt(uuid)') $$,
  'the web role executes exactly the expected evidence RPCs');
SELECT is_empty(
  $$ SELECT r || ' ' || p.oid::regprocedure::text FROM pg_proc p
      CROSS JOIN unnest(ARRAY['ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_identity']) AS r
      WHERE p.oid IN ('app.open_student_work(uuid)'::regprocedure, 'app.evidence_commit_context(text,text)'::regprocedure,
                      'evidence.revision_zero_document()'::regprocedure, 'evidence.seal_document_checkpoint()'::regprocedure)
        AND has_function_privilege(r, p.oid, 'EXECUTE') $$,
  'no other runtime role executes the new functions');
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.oid IN ('app.open_student_work(uuid)'::regprocedure, 'app.evidence_commit_context(text,text)'::regprocedure)
        AND (NOT p.prosecdef OR p.proowner <> 'ductus_evidence'::regrole OR NOT 'search_path=""' = ANY (p.proconfig)) $$,
  'both RPCs are SECURITY DEFINER functions of the evidence role with an empty search_path');
SELECT is(pg_get_function_arguments('app.open_student_work(uuid)'::regprocedure), 'p_assignment_id uuid',
  'opening takes no person or institution: they come from the session');
SELECT is(pg_get_function_arguments('app.evidence_commit_context(text,text)'::regprocedure),
  'p_document_id text, p_client_transaction_id text', 'the context takes no person or institution');
SELECT is(pg_get_function_result('app.open_student_work(uuid)'::regprocedure),
  'TABLE(outcome text, document_id text, evidence_profile_id text, current_revision bigint, document_hash text, head_segment_hash text, last_sequence_to bigint, snapshot text)',
  'opening returns no package, institution or person');

-- Revision 0: the known answer of src/domain/document/revision-zero.ts.
SELECT is(evidence.revision_zero_document(), pg_temp.val('rev0'), 'revision 0 is the empty paragraph with the fixed id');
SELECT is(encode(sha256(convert_to(evidence.revision_zero_document(), 'UTF8')), 'hex'), pg_temp.val('rev0_hash'),
  'revision 0 has the known hash');

-- The student owner: the first call creates the work, the second returns it.
CREATE TEMP TABLE print_before AS SELECT pg_temp.evidence_print() AS v;
INSERT INTO ref SELECT 'ana_open', pg_temp.open('ana', pg_temp.id('z1'));
SELECT matches(pg_temp.val('ana_open'),
  '^opened\|[0-9a-f-]{36}\|standard-v1\|0\|' || pg_temp.val('rev0_hash') || '\|\|0\|',
  'the owner opens the work at revision 0 with no segment yet');
SELECT is(split_part(pg_temp.val('ana_open'), '|', 8), pg_temp.val('rev0'), 'the answer carries the revision 0 snapshot');
SELECT is(pg_temp.open('ana', pg_temp.id('z1')), pg_temp.val('ana_open'), 'a second call returns the same work');
SELECT is(pg_temp.works('ana'), 1, 'two calls create one project');
SELECT is(split_part(pg_temp.val('ana_open'), '|', 2), pg_temp.doc('ana', 'z1'), 'the answer names the stored document');
SELECT row_eq(
  format($$ SELECT d.institution_id, d.principal_id, d.current_revision, d.current_content_hash,
                   r.revision, r.base_revision, r.content_hash, c.body, c.content_hash
              FROM evidence.document d
              JOIN evidence.document_revision r ON r.document_id = d.id AND r.institution_id = d.institution_id
              JOIN evidence.document_checkpoint c ON c.document_id = d.id AND c.revision = 0
             WHERE d.id = %L $$, pg_temp.doc('ana', 'z1')),
  ROW(pg_temp.id('fak_a'), pg_temp.id('ana'), 0::bigint, pg_temp.val('rev0_hash'), 0::bigint, NULL::bigint,
      pg_temp.val('rev0_hash'), pg_temp.val('rev0'), pg_temp.val('rev0_hash')),
  'document, revision 0 and its checkpoint carry the institution and person of the session and the known bytes');
SELECT row_eq(
  format($$ SELECT k.institution_id, k.evidence_domain_id, k.principal_id, k.evidence_profile_id, k.max_payload_bytes,
                   k.accepts_evidence, k.head_segment_hash, k.last_sequence_to, k.id ~ '^[a-z0-9][a-z0-9_-]{0,127}$'
              FROM evidence.package k WHERE k.document_id = %L $$, pg_temp.doc('ana', 'z1')),
  ROW(pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1'::uuid, pg_temp.id('ana'), 'standard-v1'::text,
      2097152, true, NULL::text, 0::bigint, true),
  'the package gets the institution''s domain, the shared profile and the D-96 limit');

-- Everyone else on Z1, the same refusal; nothing is written.
CREATE TEMP TABLE print_after_ana AS SELECT pg_temp.evidence_print() AS v;
SELECT is(pg_temp.open('dora', pg_temp.id('z1')), 'not_accepting|||||||',
  'a student who has not acknowledged the current version is told so, and nothing else');
SELECT is(pg_temp.works('dora'), 0, 'and gets no work before acknowledging');
SELECT is(pg_temp.open(p.name, pg_temp.id('z1')), 'not_found|||||||', p.why)
FROM (VALUES ('vesna', 'the teacher of the assignment gets not_found'),
             ('marko', 'a teacher of another course gets not_found'),
             ('iva', 'the administrator gets not_found'),
             ('boris', 'a student of no course gets not_found'),
             ('tomo', 'a student of another institution gets not_found'),
             ('lea', 'the administrator of another institution gets not_found')) AS p (name, why);
SELECT is(pg_temp.open('ana', pg_temp.id('nobody')), 'not_found|||||||', 'an assignment that does not exist: the same answer');
SELECT is(pg_temp.open('ana', NULL), 'not_found|||||||', 'no assignment: the same answer');
SELECT is(pg_temp.open(p.name, pg_temp.id('z1')), 'unauthenticated|||||||', p.why)
FROM (VALUES ('anon', 'no session'), ('expired', 'an expired session'), ('closed', 'a closed session')) AS p (name, why);
SELECT is(pg_temp.evidence_print(), (SELECT v FROM print_after_ana), 'the refused calls wrote nothing');

-- The unique key holds also against the evidence role itself.
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', format(
  $q$ INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES ('second', %L, %L, %L) $q$,
  pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('ana'))), '^23505:', 'a second work for the same student and assignment is refused');

-- Fak-b: the version must be open, and the institution needs one domain.
SELECT pg_temp.publish_z3(2, now() + interval '1 day');
INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
VALUES (pg_temp.id('z3'), 2, pg_temp.id('tomo'), pg_temp.id('fak_b'));
SELECT is(pg_temp.open('tomo', pg_temp.id('z3')), 'not_accepting|||||||', 'an acknowledged version that has not opened yet: not_accepting');
SELECT pg_temp.publish_z3(3, now() - interval '1 minute');
INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
VALUES (pg_temp.id('z3'), 3, pg_temp.id('tomo'), pg_temp.id('fak_b'));
SELECT is(pg_temp.open('tomo', pg_temp.id('z3')), 'not_configured|||||||', 'an institution without an evidence domain: not_configured');
INSERT INTO evidence.domain (id, institution_id, region) VALUES
  ('00000000-0000-4000-8000-0000000000d2', pg_temp.id('fak_b'), 'eu-central-1'),
  ('00000000-0000-4000-8000-0000000000d3', pg_temp.id('fak_b'), 'eu-west-1');
SELECT is(pg_temp.open('tomo', pg_temp.id('z3')), 'not_configured|||||||', 'two domains are not guessed between: not_configured');
SELECT is(pg_temp.works('tomo'), 0, 'neither writes a work');
DELETE FROM evidence.domain WHERE id = '00000000-0000-4000-8000-0000000000d3';
SELECT matches(pg_temp.open('tomo', pg_temp.id('z3')), '^opened\|', 'with one domain the student of fak-b opens the work');
SELECT is((SELECT evidence_domain_id FROM evidence.package WHERE document_id = pg_temp.doc('tomo', 'z3')),
  '00000000-0000-4000-8000-0000000000d2'::uuid, 'his package gets the domain of his own institution');

-- The checkpoint table, row by row: nobody reads or writes it directly.
SELECT matches(pg_temp.ask(p.name, 'SELECT count(*) FROM evidence.document_checkpoint'), '^42501:', p.why)
FROM (VALUES ('ana', 'the student owner cannot read checkpoints directly'),
             ('dora', 'another student of the course cannot'),
             ('vesna', 'the teacher of the assignment cannot'),
             ('marko', 'a teacher of another course cannot'),
             ('tomo', 'a student of another institution cannot'),
             ('petra', 'a teacher of another institution cannot')) AS p (name, why);
SELECT matches(pg_temp.ask_as(r, 'anon', 'SELECT count(*) FROM evidence.document_checkpoint'), '^42501:',
  r || ' cannot read checkpoints')
FROM unnest(ARRAY['ductus_worker', 'ductus_retention']) AS r;
SELECT matches(pg_temp.ask('ana', format(
  $q$ INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body) VALUES (%L, %L, 0, 'x') $q$,
  pg_temp.doc('ana', 'z1'), pg_temp.id('fak_a'))), '^42501:', 'the web role cannot write a checkpoint');
-- With a grant given by mistake, RLS still shows nothing and accepts nothing.
GRANT SELECT, INSERT, UPDATE, DELETE ON evidence.document_checkpoint TO ductus_app;
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM evidence.document_checkpoint'), '0',
  'with a mistaken grant the owner still reads 0 rows');
SELECT is(pg_temp.ask('vesna', 'SELECT count(*) FROM evidence.document_checkpoint'), '0',
  'with a mistaken grant the teacher still reads 0 rows');
SELECT matches(pg_temp.ask('ana', format(
  $q$ INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body) VALUES (%L, %L, 0, 'x') $q$,
  pg_temp.doc('ana', 'z1'), pg_temp.id('fak_a'))), '^42501:', 'with a mistaken grant a write is refused by RLS');
SELECT is(pg_temp.ask('ana', 'WITH d AS (DELETE FROM evidence.document_checkpoint RETURNING 1) SELECT count(*) FROM d'), '0',
  'with a mistaken grant a delete removes nothing');
REVOKE SELECT, INSERT, UPDATE, DELETE ON evidence.document_checkpoint FROM ductus_app;

-- The database checks the bytes against the revision, not the writer.
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', format(
  $q$ INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body) VALUES (%L, %L, 1, %L) $q$,
  pg_temp.doc('ana', 'z1'), pg_temp.id('fak_a'), pg_temp.val('rev0'))), '^23503:', 'a checkpoint of a revision that does not exist is refused');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', format(
  $q$ INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body) VALUES (%L, %L, 0, %L) $q$,
  pg_temp.doc('tomo', 'z3'), pg_temp.id('fak_a'), pg_temp.val('rev0'))), '^23503:', 'a checkpoint under another institution is refused');
SET LOCAL ROLE ductus_evidence;
SET CONSTRAINTS ALL DEFERRED;
UPDATE evidence.document SET current_revision = 1, current_content_hash = repeat('f', 64) WHERE id = pg_temp.doc('ana', 'z1');
INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
VALUES (pg_temp.doc('ana', 'z1'), pg_temp.id('fak_a'), 1, 0, pg_temp.id('ana'), repeat('f', 64));
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', format(
  $q$ INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body) VALUES (%L, %L, 1, 'other') $q$,
  pg_temp.doc('ana', 'z1'), pg_temp.id('fak_a'))), '^23503:', 'bytes whose hash is not the revision''s hash are refused');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', format(
  $q$ INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body, content_hash, created_at)
      VALUES (%L, %L, 1, 'other', repeat('f', 64), '2000-01-01') $q$,
  pg_temp.doc('ana', 'z1'), pg_temp.id('fak_a'))), '^23503:', 'a hash given by the writer is ignored: the database computes it');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', format(
  $q$ UPDATE evidence.document_checkpoint SET body = body WHERE document_id = %L $q$, pg_temp.doc('ana', 'z1'))),
  '^ZD403:', 'a checkpoint never changes');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', 'TRUNCATE evidence.document_checkpoint'), '^ZD403:',
  'the checkpoint table is not truncated');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', format(
  $q$ INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body) VALUES (%L, %L, 1, %L) $q$,
  pg_temp.doc('tomo', 'z3'), pg_temp.id('fak_b'), repeat('x', 2097153))), '^23514:', 'bytes over 2 MiB are refused');
SELECT is((SELECT created_at FROM evidence.document_checkpoint WHERE document_id = pg_temp.doc('ana', 'z1')), now(),
  'the time is the database''s');
-- The answer carries the current revision; its checkpoint is written with
-- the acceptance from step 3, so until then there is none.
SELECT matches(pg_temp.open('ana', pg_temp.id('z1')), '^opened\|[0-9a-f-]{36}\|standard-v1\|1\|f{64}\|\|0\|$',
  'reconciliation returns the current revision and no older snapshot in its place');

-- The context before a commit.
INSERT INTO ref SELECT 'pkg_a', id FROM evidence.package WHERE document_id = pg_temp.doc('ana', 'z1');
SELECT is(pg_temp.context('ana', pg_temp.doc('ana', 'z1'), 'tx-1'),
  concat_ws('|', 'ok', pg_temp.val('pkg_a'), pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1', 'standard-v1',
            '2097152', 'f'),
  'the owner gets package, institution, domain, profile and limit; the key is not known yet');
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.segment (
  id, evidence_package_id, institution_id, document_id, principal_id, session_id, sequence_from, sequence_to,
  event_count, descriptor, segment_hash, payload_bytes, storage_ref, accepted_at
) VALUES ('segment-1', pg_temp.val('pkg_a'), pg_temp.id('fak_a'), pg_temp.doc('ana', 'z1'), pg_temp.id('ana'),
  'synthetic-session', 1, 1, 1, jsonb_build_object('segmentHash', repeat('b', 64), 'payloadBytes', 123),
  repeat('b', 64), 123, 'synthetic://segment-1', now());
INSERT INTO evidence.receipt (
  id, evidence_package_id, institution_id, evidence_domain_id, segment_id, principal_id, client_request_id,
  payload_sha256, descriptor, receipt_payload, status
) VALUES ('00000000-0000-4000-8000-0000000000e1', pg_temp.val('pkg_a'), pg_temp.id('fak_a'),
  '00000000-0000-4000-8000-0000000000d1', 'segment-1', pg_temp.id('ana'), 'tx-1', repeat('b', 64), '{}', '{}',
  'pending_signature');
RESET ROLE;
SELECT is(split_part(pg_temp.context('ana', pg_temp.doc('ana', 'z1'), 'tx-1'), '|', 7), 't', 'a key with a receipt is known');
SELECT is(split_part(pg_temp.context('ana', pg_temp.doc('ana', 'z1'), 'tx-2'), '|', 7), 'f', 'another key is not');
SELECT is(pg_temp.context('ana', pg_temp.doc('ana', 'z1'), repeat('k', 128)), concat_ws('|', 'ok', pg_temp.val('pkg_a'),
  pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1', 'standard-v1', '2097152', 'f'), 'a key of 128 units is accepted');

CREATE TEMP TABLE print_context AS SELECT pg_temp.evidence_print() AS v;
SELECT is(pg_temp.context(c.name, c.document, 'tx-1'), 'not_found||||||', c.why)
FROM (VALUES ('ana', 'no-such-document', 'a document that does not exist: not_found'),
             ('ana', pg_temp.doc('tomo', 'z3'), 'a document of another institution: the same answer'),
             ('tomo', pg_temp.doc('ana', 'z1'), 'a student of another institution asking for it: the same answer'),
             ('dora', pg_temp.doc('ana', 'z1'), 'another student of the course: the same answer'),
             ('vesna', pg_temp.doc('ana', 'z1'), 'the teacher of the assignment: the same answer')) AS c (name, document, why);
SELECT is(pg_temp.context('anon', pg_temp.doc('ana', 'z1'), 'tx-1'), 'unauthenticated||||||', 'no session: unauthenticated');
SELECT is(pg_temp.context('ana', c.document, c.key_text), 'invalid||||||', c.why)
FROM (VALUES (NULL, 'tx-1', 'no document: invalid'), (repeat('d', 257), 'tx-1', 'a document id over 256 characters: invalid'),
             ('doc' || chr(10), 'tx-1', 'a control character in the document id: invalid'),
             (pg_temp.doc('ana', 'z1'), NULL, 'no key: invalid'), (pg_temp.doc('ana', 'z1'), '', 'an empty key: invalid'),
             (pg_temp.doc('ana', 'z1'), repeat('k', 129), 'a key over 128 units: invalid'),
             (pg_temp.doc('ana', 'z1'), repeat(chr(128512), 65), 'a key of 65 astral characters is 130 units: invalid'),
             (pg_temp.doc('ana', 'z1'), 'tx' || chr(9), 'a control character in the key: invalid')) AS c (document, key_text, why);
SELECT is(pg_temp.evidence_print(), (SELECT v FROM print_context), 'the context writes nothing');

-- A student removed from the course loses both at once.
UPDATE institution.course_member SET member_to = now()
 WHERE user_id = pg_temp.id('ana') AND course_id = pg_temp.id('k1');
SELECT is(pg_temp.context('ana', pg_temp.doc('ana', 'z1'), 'tx-1'), 'not_found||||||', 'a removed student gets not_found from the context');
SELECT is(pg_temp.open('ana', pg_temp.id('z1')), 'not_found|||||||', 'and from opening, though the work exists');

SELECT * FROM finish();
ROLLBACK;

-- B-12 step 2 / DAN-87: the submission request (plan of attack #385).
-- Every person, document and hash below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

-- Dora (fak-a, K1) has her own empty document on Z1 and has acknowledged only
-- version 1 of it. Z3 of fak-b gets a version 2 whose deadline has passed;
-- Tomo acknowledges it.
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id)
VALUES ('project-d', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('dora'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash)
VALUES ('doc-d', pg_temp.id('fak_a'), 'project-d', pg_temp.id('dora'), repeat('a',64));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash)
VALUES ('doc-d', pg_temp.id('fak_a'), 0, pg_temp.id('dora'), repeat('a',64));
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS evidence.evidence_document_current_revision_fkey DEFERRED;
RESET ROLE;
SET LOCAL ROLE ductus_identity;
INSERT INTO institution.assignment_version (
  assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
  evidence_profile, import_allowed, created_by
) VALUES (pg_temp.id('z3'), 2, 'Z3', 'Upute za izmišljeni zadatak.', 'essay', now() - interval '2 days',
  now() - interval '1 day', 'encouraged', '{translation}', 'basic', true, pg_temp.id('petra'));
UPDATE institution.assignment SET current_version = 2 WHERE id = pg_temp.id('z3');
INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
VALUES (pg_temp.id('z3'), 2, pg_temp.id('tomo'), pg_temp.id('fak_b'));
RESET ROLE;

CREATE FUNCTION pg_temp.request(p_actor text, p_document text, p_revision bigint, p_column text DEFAULT 'outcome')
RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format('SELECT %I::text FROM app.request_submission(%L, %s)',
    p_column, p_document, coalesce(p_revision::text, 'NULL')))
$$;

-- Shape of the entrypoint: owner, definer, search_path, grants, no identity
-- or time argument (A1, F1).
SELECT is((SELECT r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.oid = 'app.request_submission(text,bigint)'::regprocedure),
  'ductus_evidence', 'the request RPC is owned by the NOLOGIN evidence role');
SELECT ok((SELECT prosecdef AND 'search_path=""' = ANY(proconfig)
  FROM pg_proc WHERE oid = 'app.request_submission(text,bigint)'::regprocedure),
  'the request RPC is SECURITY DEFINER with an empty search_path');
SELECT ok(
  has_function_privilege('ductus_app', 'app.request_submission(text,bigint)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_worker', 'app.request_submission(text,bigint)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_retention', 'app.request_submission(text,bigint)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_auth', 'app.request_submission(text,bigint)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_test_stranger', 'app.request_submission(text,bigint)', 'EXECUTE'),
  'only ductus_app executes the request RPC');
SELECT is((SELECT proargnames[1:pronargs]::text FROM pg_proc
  WHERE oid = 'app.request_submission(text,bigint)'::regprocedure),
  '{p_document_id,p_revision}', 'the RPC takes only the document and the revision: no identity, institution or time');

-- Table: tenant key, RLS, owner, no DML for the web role (F5).
SELECT col_not_null('evidence', 'submission_request', 'institution_id', 'the request requires institution_id');
SELECT col_hasnt_default('evidence', 'submission_request', 'institution_id', 'the request has no tenant default');
SELECT col_hasnt_default('evidence', 'submission_request', 'requested_at', 'requested_at has no default the caller could lean on');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'evidence.submission_request'::regclass),
  'the request table enables and forces RLS');
SELECT hasnt_column('evidence', 'submission_request', 'after_due',
  'the request stores no lateness flag: the outcome decides it with the deadline and any extension');
-- Access matrix for every service role and operation: only the web role
-- reads, nobody but the NOLOGIN owner writes, nobody is a member of the owner.
SELECT set_eq(
  $$ SELECT r || ':' || p
       FROM unnest(ARRAY['ductus_app','ductus_migrator','ductus_identity','ductus_auth','ductus_worker',
                         'ductus_retention','ductus_test_stranger']) AS r
       CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p
      WHERE has_table_privilege(r, 'evidence.submission_request', p) $$,
  ARRAY['ductus_app:SELECT'],
  'every service role: only ductus_app may SELECT, none may write');
SELECT is_empty(
  $$ SELECT r || ':' || p
       FROM unnest(ARRAY['ductus_app','ductus_migrator','ductus_identity','ductus_auth','ductus_worker',
                         'ductus_retention']) AS r
       CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS p
      WHERE has_any_column_privilege(r, 'evidence.submission_request', p)
        AND NOT has_table_privilege(r, 'evidence.submission_request', p) $$,
  'no service role holds a column-level privilege beyond its table privilege');
SELECT is_empty(
  $$ SELECT member::regrole::text FROM pg_auth_members
      WHERE roleid = 'ductus_evidence'::regrole AND member <> 'ductus_migrator'::regrole $$,
  'apart from the migrator (provisioning, no inherited rights: see the matrix above), no role is a member of the owner');
SELECT set_eq(
  $$ SELECT policyname || ':' || cmd || ':' || array_to_string(roles, ',') FROM pg_policies
      WHERE schemaname = 'evidence' AND tablename = 'submission_request' $$,
  ARRAY['evidence_submission_request_owner:ALL:ductus_evidence', 'evidence_submission_request_read:SELECT:ductus_app'],
  'the only policies are the owner policy and the web role read policy');
SELECT matches(pg_temp.ask('ana', $$ INSERT INTO evidence.submission_request
     (institution_id,assignment_id,assignment_version,project_id,document_id,principal_id,revision,content_hash,requested_at)
     VALUES ({fak_a},{z1},2,'project-a','doc-a',{ana},1,repeat('d',64),now() - interval '1 day') RETURNING 1 $$),
  '^42501:', 'a student cannot write a request with an earlier time');
-- Defence in depth: with an INSERT grant the row-level policy still refuses.
GRANT INSERT ON evidence.submission_request TO ductus_app;
SELECT matches(pg_temp.ask('ana', $$ INSERT INTO evidence.submission_request
     (institution_id,assignment_id,assignment_version,project_id,document_id,principal_id,revision,content_hash,requested_at)
     VALUES ({fak_a},{z1},2,'project-a','doc-a',{ana},1,repeat('d',64),now() - interval '1 day') RETURNING 1 $$),
  '^42501: new row violates row-level security policy', 'even with a grant, RLS refuses a direct write by the web role');
REVOKE INSERT ON evidence.submission_request FROM ductus_app;

-- Who may request (F1 to F4, B7): one answer for every refusal.
SELECT is(pg_temp.request('anon', 'doc-a', 0), 'unauthorized', 'an anonymous session is refused');
SELECT is(pg_temp.request('expired', 'doc-a', 0), 'unauthorized', 'an expired session is refused');
SELECT is(pg_temp.request('tomo', 'doc-a', 0), 'unauthorized', 'a student of another institution is refused');
SELECT is(pg_temp.request('boris', 'doc-a', 0), 'unauthorized', 'a same-institution student cannot request for another student');
SELECT is(pg_temp.request('dora', 'doc-a', 0), 'unauthorized', 'a classmate cannot request for another student''s document');
SELECT is(pg_temp.request('vesna', 'doc-a', 0), 'unauthorized', 'the teacher cannot submit for the student');
SELECT is(pg_temp.request('iva', 'doc-a', 0), 'unauthorized', 'the administrator cannot submit for the student');
SELECT is(pg_temp.request('ana', 'doc-none', 0), 'unauthorized', 'a missing document gets the same answer as a foreign one');
SELECT is(pg_temp.request('ana', NULL, 0), 'invalid', 'a missing document id is invalid');
SELECT is(pg_temp.request('ana', E'doc-a\n', 0), 'invalid', 'a document id with a control character is invalid');
SELECT is(pg_temp.request('ana', 'doc-a', NULL), 'invalid', 'a missing revision is invalid');
SELECT is(pg_temp.request('ana', 'doc-a', -1), 'invalid', 'a negative revision is invalid');

-- Nothing written yet: no request (C3), and not acknowledged (B8).
SELECT is(pg_temp.request('ana', 'doc-a', 0), 'no_evidence', 'a document without a committed revision is not requested');
SELECT is(pg_temp.request('dora', 'doc-d', 0), 'not_acknowledged',
  'a student who has not acknowledged the current version gets no request');

-- Ana commits revision 1 (content hash d...d).
SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'reserved', 'fixture: Ana commits revision 1');

-- Stale revision (B3): never quietly another revision than the one named.
SELECT is(pg_temp.request('ana', 'doc-a', 0), 'stale_revision', 'an older revision than the current one is refused');
SELECT is(pg_temp.request('ana', 'doc-a', 2), 'stale_revision', 'a revision the server does not have is refused');
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM evidence.submission_request'), '0', 'refusals write nothing');

-- A commit that held the document while the click waited (revision 2,
-- accepted one hour after this click by the database clock): the click keeps
-- the revision that was current when it was made.
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash, created_at)
VALUES ('doc-a', pg_temp.id('fak_a'), 2, 1, pg_temp.id('ana'), repeat('f',64), clock_timestamp() + interval '1 hour');
UPDATE evidence.document SET current_revision = 2, current_content_hash = repeat('f',64) WHERE id = 'doc-a';
RESET ROLE;

-- The request (A1, A2, A7, B2): time from the database clock at the call,
-- revision and hash from the server's own committed revision.
CREATE TEMP TABLE clock_mark (before_call timestamptz, after_call timestamptz, result text);
INSERT INTO clock_mark (before_call) VALUES (clock_timestamp());
UPDATE clock_mark SET result = pg_temp.ask('ana',
  $$ SELECT concat_ws(' ', outcome, revision, assignment_version, submission_request_id IS NOT NULL)
       FROM app.request_submission('doc-a', 1) $$);
UPDATE clock_mark SET after_call = clock_timestamp();
SELECT is((SELECT result FROM clock_mark), 'requested 1 2 t', 'the revision current at the click is requested although a later commit landed after it');
SELECT ok((SELECT s.requested_at >= m.before_call AND s.requested_at <= m.after_call AND s.requested_at > now()
  FROM evidence.submission_request s CROSS JOIN clock_mark m WHERE s.document_id = 'doc-a'),
  'requested_at is the database clock during the call, not the transaction start or a client value');
SELECT is((SELECT concat_ws(' ', institution_id = pg_temp.id('fak_a'), principal_id = pg_temp.id('ana'),
    assignment_id = pg_temp.id('z1'), project_id, revision, content_hash = repeat('d',64))
  FROM evidence.submission_request WHERE document_id = 'doc-a'),
  't t t project-a 1 t', 'the request pins the session principal, its institution and the committed hash');

-- Repeat requests (A6, B6): the same row and the same time, nothing new.
SELECT is(pg_temp.request('ana', 'doc-a', 1), 'existing', 'a second click returns the earlier request');
SELECT is(pg_temp.request('ana', 'doc-a', 0, 'requested_at'),
  (SELECT requested_at::text FROM evidence.submission_request WHERE document_id = 'doc-a'),
  'a later request keeps the first requested_at');
SELECT is(pg_temp.request('ana', 'doc-a', 2, 'revision'), '1',
  'a request after more writing still names the requested revision (B4: one snapshot)');
SELECT is((SELECT count(*)::text FROM evidence.submission_request WHERE principal_id = pg_temp.id('ana')), '1',
  'one request per student and assignment');
CREATE FUNCTION pg_temp.request_with_spoofed_user_id() RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('app.user_id', pg_temp.id('ana')::text, true);
  v := pg_temp.request('tomo', 'doc-a', 1);
  PERFORM set_config('app.user_id', '', true);
  RETURN v;
END
$$;
SELECT is(pg_temp.request_with_spoofed_user_id(), 'unauthorized', 'a forged user-id setting cannot replace the session');

-- A revision whose successor was accepted before the click is stale (B3);
-- a request after the deadline is still recorded with its time (D-69).
SELECT is(pg_temp.call('tomo','pkg-b','request-b1',
    pg_temp.descriptor(p_package=>'pkg-b',p_document=>'doc-b',p_segment=>'segment-b-1'),0,repeat('c',64),repeat('d',64),repeat('b',64)),
  'reserved', 'fixture: Tomo commits revision 1');
SELECT is(pg_temp.call('tomo','pkg-b','request-b2',
    pg_temp.descriptor(p_package=>'pkg-b',p_document=>'doc-b',p_segment=>'segment-b-2',p_sequence_from=>2,p_sequence_to=>2,
      p_hash=>repeat('e',64),p_predecessor=>repeat('b',64)),1,repeat('d',64),repeat('f',64),repeat('e',64)),
  'reserved', 'fixture: Tomo commits revision 2');
SELECT is(pg_temp.request('tomo', 'doc-b', 1), 'stale_revision',
  'a revision replaced before the click is stale');
SELECT is(pg_temp.ask('tomo', $$ SELECT concat_ws(' ', outcome, revision, assignment_version)
    FROM app.request_submission('doc-b', 2) $$),
  'requested 2 2', 'a request after the deadline is recorded; lateness is decided with the outcome');

-- Not open yet: Z1 gets a version 3 that opens tomorrow; Dora, who has a
-- revision, acknowledges it and still gets no request.
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
VALUES ('doc-d', pg_temp.id('fak_a'), 1, 0, pg_temp.id('dora'), repeat('e',64));
UPDATE evidence.document SET current_revision = 1, current_content_hash = repeat('e',64) WHERE id = 'doc-d';
RESET ROLE;
SET LOCAL ROLE ductus_identity;
INSERT INTO institution.assignment_version (
  assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
  evidence_profile, import_allowed, created_by
) VALUES (pg_temp.id('z1'), 3, 'Z1', 'Upute za izmišljeni zadatak.', 'essay', now() + interval '1 day',
  now() + interval '30 days', 'partially_allowed', '{proofreading}', 'extended', true, pg_temp.id('vesna'));
UPDATE institution.assignment SET current_version = 3 WHERE id = pg_temp.id('z1');
INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
VALUES (pg_temp.id('z1'), 3, pg_temp.id('dora'), pg_temp.id('fak_a'));
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS evidence.evidence_document_current_revision_fkey DEFERRED;
SELECT is(pg_temp.request('dora', 'doc-d', 1), 'not_open', 'a version that has not opened yet takes no request');

-- Reading (F2, F3, F7): the student sees the own request only.
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM evidence.submission_request'), '1', 'the student reads the own request');
SELECT is(pg_temp.ask('tomo', 'SELECT count(*) FROM evidence.submission_request'), '1', 'the second-institution student reads only the own request');
SELECT is(pg_temp.ask('tomo', 'SELECT count(*) FROM evidence.submission_request WHERE document_id = ''doc-a'''), '0',
  'another institution cannot read the request');
SELECT is(pg_temp.ask('dora', 'SELECT count(*) FROM evidence.submission_request'), '0', 'a classmate reads nothing');
SELECT is(pg_temp.ask('vesna', 'SELECT count(*) FROM evidence.submission_request'), '0',
  'the teacher reads no bare request (the outcome is the next step)');
SELECT is(pg_temp.ask('petra', 'SELECT count(*) FROM evidence.submission_request'), '0',
  'the teacher of another institution reads nothing');
SELECT is(pg_temp.ask('iva', 'SELECT count(*) FROM evidence.submission_request'), '0', 'the administrator reads nothing');

-- Append-only (B5, F5): nobody rewrites the time, revision or flag.
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon',
  $$ UPDATE evidence.submission_request SET requested_at = requested_at - interval '1 hour' RETURNING 1 $$),
  '^ZD403:', 'the owner cannot move requested_at');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon',
  $$ UPDATE evidence.submission_request SET revision = 2, content_hash = repeat('f',64) WHERE document_id = 'doc-a' RETURNING 1 $$),
  '^ZD403:', 'the owner cannot move the request to another revision');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ DELETE FROM evidence.submission_request RETURNING 1 $$),
  '^ZD403:', 'the owner cannot delete a request');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ TRUNCATE evidence.submission_request $$),
  '^ZD403:', 'the owner cannot truncate requests');

-- Composite keys (F6, B2, D-103).
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ INSERT INTO evidence.submission_request
     (institution_id,assignment_id,assignment_version,project_id,document_id,principal_id,revision,content_hash,requested_at)
     VALUES ({fak_b},{z1},2,'project-a','doc-a',{ana},1,repeat('d',64),now()) RETURNING 1 $$),
  '^23503:', 'a request cannot pair an assignment with another institution');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ INSERT INTO evidence.submission_request
     (institution_id,assignment_id,assignment_version,project_id,document_id,principal_id,revision,content_hash,requested_at)
     VALUES ({fak_a},{z2},1,'project-a','doc-a',{ana},1,repeat('d',64),now()) RETURNING 1 $$),
  '^23503:', 'a request cannot name a project of another assignment');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ INSERT INTO evidence.submission_request
     (institution_id,assignment_id,assignment_version,project_id,document_id,principal_id,revision,content_hash,requested_at)
     VALUES ({fak_a},{z1},2,'project-d','doc-d',{dora},1,repeat('d',64),now()) RETURNING 1 $$),
  '^23503:', 'a request cannot name a revision or hash the document does not have');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ INSERT INTO evidence.submission_request
     (institution_id,assignment_id,assignment_version,project_id,document_id,principal_id,revision,content_hash,requested_at)
     VALUES ({fak_a},{z1},2,'project-a','doc-a',{ana},2,repeat('f',64),now()) RETURNING 1 $$),
  '^23505:', 'a second request for the same student and assignment is refused by the table');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ INSERT INTO evidence.submission_request
     (institution_id,assignment_id,assignment_version,project_id,document_id,principal_id,revision,content_hash,requested_at)
     VALUES ({fak_a},{z1},9,'project-d','doc-d',{dora},0,repeat('a',64),now()) RETURNING 1 $$),
  '^23514:', 'revision 0 is never requested');

SELECT * FROM finish();
ROLLBACK;

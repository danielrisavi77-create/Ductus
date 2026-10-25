-- DAN-289 O2 (contract on #756, c.6397770372): app.work_submitted is true only
-- for the caller's own recorded submission of the assignment. Every person,
-- document and hash below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

CREATE FUNCTION pg_temp.submitted(p_actor text, p_assignment text DEFAULT '{z1}') RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format('SELECT app.work_submitted(%s)::text', p_assignment))
$$;
CREATE FUNCTION pg_temp.req() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT id::text FROM evidence.submission_request WHERE document_id = 'doc-a'
$$;

-- Shape: owner role, empty search_path, only the web role executes it (point 1).
SELECT is((SELECT pg_get_userbyid(proowner)::text FROM pg_proc WHERE oid = 'app.work_submitted(uuid)'::regprocedure),
  'ductus_evidence', 'the owner role owns it');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'app.work_submitted(uuid)'::regprocedure),
  'it runs as its owner');
SELECT ok((SELECT 'search_path=""' = ANY (proconfig) FROM pg_proc WHERE oid = 'app.work_submitted(uuid)'::regprocedure),
  'with an empty search_path');
SELECT is(
  ARRAY(SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_identity',
                                   'ductus_test_stranger']) AS r
         WHERE has_function_privilege(r, 'app.work_submitted(uuid)', 'EXECUTE')),
  ARRAY['ductus_app'], 'of the runtime roles only ductus_app executes it, and PUBLIC does not');
SELECT matches(pg_temp.ask_as('ductus_worker', 'ana', 'SELECT app.work_submitted({z1})::text'),
  '^42501: ', 'the worker gets no answer');

-- Nothing submitted yet.
SELECT is(pg_temp.submitted('ana'), 'false', 'before anything Ana''s work is not submitted');

-- A request alone is not a submission, nor a refused one.
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64),
  repeat('b', 64)), 'reserved', 'fixture: Ana commits revision 1');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a', 1) $$), 'requested',
  'fixture: Ana requests revision 1');
SELECT is(pg_temp.submitted('ana'), 'false', 'a request alone is not a submission');
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.record_submission(%L::uuid, %L)', pg_temp.req(),
  repeat('f', 64))), 'artifact_mismatch', 'fixture: a mismatching reconstruction records nothing');
SELECT is(pg_temp.submitted('ana'), 'false', 'a refused submission is not a submission');

-- The recorded submission.
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.record_submission(%L::uuid, %L)', pg_temp.req(),
  pg_temp.h('d'))), 'recorded', 'fixture: the submission of revision 1 is recorded');
SELECT is(pg_temp.submitted('ana'), 'true', 'Ana''s recorded submission makes her work submitted');

-- Only her own, for that assignment.
SELECT is(pg_temp.submitted('dora'), 'false', 'a classmate on the same assignment gets false');
SELECT is(pg_temp.submitted('vesna'), 'false', 'the teacher of the assignment gets false');
SELECT is(pg_temp.submitted('tomo'), 'false', 'a student of another institution gets false');
SELECT is(pg_temp.submitted('tomo', '{z3}'), 'false', 'and false for his own assignment, which he has not submitted');
SELECT is(pg_temp.submitted('ana', '{z2}'), 'false', 'another assignment of Ana''s institution gets false');
SELECT is(pg_temp.submitted('ana', '{z3}'), 'false', 'an assignment of another institution gets false');
SELECT is(pg_temp.submitted('ana', '{nobody}'), 'false', 'an assignment that does not exist gets false');
SELECT is(pg_temp.submitted('ana', 'NULL'), 'false', 'NULL gets false');

-- Without an open session.
SELECT is(pg_temp.submitted('anon'), 'false', 'no session gets false');
SELECT is(pg_temp.submitted('expired'), 'false', 'Ana''s expired session gets false');
SELECT is(pg_temp.submitted('closed'), 'false', 'Ana''s closed session gets false');
SELECT is(pg_temp.submitted('unknown'), 'false', 'an unknown session gets false');

-- A forged user-id setting does not replace the session.
CREATE FUNCTION pg_temp.submitted_with_spoofed_user_id() RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('app.user_id', pg_temp.id('ana')::text, true);
  v := pg_temp.submitted('dora');
  PERFORM set_config('app.user_id', '', true);
  RETURN v;
END
$$;
SELECT is(pg_temp.submitted_with_spoofed_user_id(), 'false', 'a forged user-id setting cannot replace the session');

SELECT * FROM finish();
ROLLBACK;

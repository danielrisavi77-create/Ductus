-- DAN-289 A3 (contract on #756, option (a)): after the submission the live
-- channel refuses publishing and answers the submitted revision to the student
-- and the teacher alike. Every person, document, text and hash below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

-- A read as one line, to compare student and teacher byte for byte.
CREATE FUNCTION pg_temp.read_as(p_actor text, p_document text DEFAULT 'doc-a', p_known text DEFAULT NULL) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    $q$ SELECT format('%%s|%%s|%%s', outcome, content_hash, body) FROM collaboration.read_live_state(%L, %L) $q$,
    p_document, p_known))
$$;
CREATE FUNCTION pg_temp.publish_as(p_actor text, p_token text, p_body text, p_document text DEFAULT 'doc-a') RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    $q$ SELECT format('%%s|%%s', outcome, write_token) FROM collaboration.publish_live_state(%L, %L, %L) $q$,
    p_document, p_token, p_body))
$$;
CREATE FUNCTION pg_temp.stored(p_document text DEFAULT 'doc-a') RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT write_token::text || '|' || body FROM collaboration.live_state WHERE document_id = p_document
$$;
CREATE FUNCTION pg_temp.token() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT write_token::text FROM collaboration.live_state WHERE document_id = 'doc-a'
$$;
CREATE FUNCTION pg_temp.req() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT id::text FROM evidence.submission_request WHERE document_id = 'doc-a'
$$;
-- The check as the live functions call it: as their owner, in the caller's session.
CREATE FUNCTION pg_temp.submitted_as_owner(p_document text, p_actor text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask_as('ductus_identity', p_actor, format('SELECT app.document_submitted(%L)::text', p_document))
$$;
CREATE FUNCTION pg_temp.submitted_text() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('submitted|%s|%s', pg_temp.h('d'), repeat('d', 64))
$$;

-- Shape: two functions of the evidence role, only the live owner executes them,
-- and that owner still has no access to schema evidence (BACKEND 4.12 t. 1).
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.oid IN ('app.document_submitted(text)'::regprocedure, 'app.submitted_document_text(text)'::regprocedure)
        AND (NOT p.prosecdef OR p.proowner <> 'ductus_evidence'::regrole OR NOT 'search_path=""' = ANY (p.proconfig)) $$,
  'both functions are SECURITY DEFINER functions of the evidence role with an empty search_path');
SELECT is_empty(
  $$ SELECT r || ' ' || p.oid::regprocedure::text FROM pg_proc p
      CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_test_stranger']) AS r
      WHERE p.oid IN ('app.document_submitted(text)'::regprocedure, 'app.submitted_document_text(text)'::regprocedure)
        AND has_function_privilege(r, p.oid, 'EXECUTE') $$,
  'no runtime role and not PUBLIC executes them');
SELECT ok(has_function_privilege('ductus_identity', 'app.document_submitted(text)', 'EXECUTE')
          AND has_function_privilege('ductus_identity', 'app.submitted_document_text(text)', 'EXECUTE'),
  'the owner of the live functions executes both');
SELECT ok(NOT has_schema_privilege('ductus_identity', 'evidence', 'USAGE'),
  'the owner of the live functions still has no evidence-schema access');
SELECT is(pg_get_function_result('app.document_submitted(text)'::regprocedure), 'boolean',
  'the check answers only yes or no');
SELECT is(pg_get_function_result('collaboration.read_live_state(text,text)'::regprocedure),
  'TABLE(outcome text, content_hash text, body text)', 'reading still returns no revision, time or id');

-- Before the submission: publishing and reading work as before.
SELECT matches(pg_temp.publish_as('ana', NULL, 'nacrt-1'), '^accepted\|', 'before anything Ana publishes');
SELECT is(pg_temp.read_as('vesna'), format('state|%s|nacrt-1', pg_temp.sha('nacrt-1')), 'and Vesna reads the live state');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64),
  repeat('b', 64)), 'reserved', 'fixture: Ana commits revision 1');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a', 1) $$), 'requested',
  'fixture: Ana requests revision 1');
SELECT matches(pg_temp.publish_as('ana', pg_temp.token(), 'nacrt-2'), '^accepted\|', 'a request alone does not stop publishing');
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.record_submission(%L::uuid, %L)', pg_temp.req(),
  repeat('f', 64))), 'artifact_mismatch', 'fixture: a mismatching reconstruction records nothing');
SELECT matches(pg_temp.publish_as('ana', pg_temp.token(), 'nacrt-3'), '^accepted\|', 'nor does a refused submission');
SELECT is(pg_temp.read_as('ana'), format('state|%s|nacrt-3', pg_temp.sha('nacrt-3')), 'Ana still reads the live state');
SELECT is(pg_temp.submitted_as_owner('doc-a', 'vesna'), 'false', 'the check says no before the submission');

-- The submission.
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.record_submission(%L::uuid, %L)', pg_temp.req(),
  pg_temp.h('d'))), 'recorded', 'fixture: the submission of revision 1 is recorded');
SELECT is(pg_temp.submitted_as_owner('doc-a', 'vesna'), 'true', 'the check says yes in a session of the institution of the document');
SELECT is(pg_temp.submitted_as_owner('doc-a', 'tomo'), 'false', 'and no in a session of another institution');
SELECT is(pg_temp.submitted_as_owner('doc-a', 'anon'), 'false', 'and no without a session');
SELECT is(pg_get_function_arguments('app.document_submitted(text)'::regprocedure), 'p_document_id text',
  'the check takes no institution: it comes from the session (033, U1)');

-- Publishing writes nothing (I6), with a token and without.
CREATE TEMP TABLE before_publish AS SELECT pg_temp.stored() AS v;
SELECT is(pg_temp.publish_as('ana', pg_temp.token(), 'nacrt-4'), 'ZD403: forbidden',
  'after the submission a publish with the current token is refused like any refused publish');
SELECT is(pg_temp.publish_as('ana', NULL, 'nacrt-4'), 'ZD403: forbidden', 'and so is one without a token');
SELECT is(pg_temp.publish_as('ana', NULL, ''), 'ZD403: forbidden', 'the refusal comes before the input check');
SELECT is(pg_temp.stored(), (SELECT v FROM before_publish), 'nothing is written');

-- Reading answers the submitted revision, the same for everyone allowed (I7, I9).
SELECT is(pg_temp.read_as('ana'), pg_temp.submitted_text(), 'Ana reads the submitted revision, not the live state');
SELECT is(pg_temp.read_as('vesna'), pg_temp.read_as('ana'), 'Vesna reads exactly the same');
SELECT is(pg_temp.read_as('vesna', 'doc-a', pg_temp.h('d')), format('submitted|%s|', pg_temp.h('d')),
  'a reader that holds the submitted hash gets no bytes again');
SELECT is(pg_temp.read_as('vesna', 'doc-a', pg_temp.sha('nacrt-3')), pg_temp.submitted_text(),
  'a reader that holds the last live hash gets the submitted revision');
SELECT is(pg_temp.read_as('petra'), 'ZD403: forbidden', 'the teacher of another institution is refused');
SELECT is(pg_temp.read_as('marko'), 'ZD403: forbidden', 'the teacher of another course is refused');
SELECT is(pg_temp.read_as('dora'), 'ZD403: forbidden', 'a classmate is refused');
SELECT is(pg_temp.read_as('tomo'), 'ZD403: forbidden', 'a student of another institution is refused');
SELECT cmp_ok((SELECT count(*) FROM audit.access_log WHERE document_id = 'doc-a' AND surface = 'live_view'), '>', 0::bigint,
  'the teacher''s reads are still logged');

-- Another student's document is not affected.
SELECT matches(pg_temp.publish_as('tomo', NULL, 'nacrt-b', 'doc-b'), '^accepted\|', 'Tomo publishes his own work normally');
SELECT is(pg_temp.read_as('tomo', 'doc-b'), format('state|%s|nacrt-b', pg_temp.sha('nacrt-b')), 'and reads it as live state');

-- The submitted text cannot be shown: unavailable, never the live state (I9).
ALTER TABLE evidence.document_checkpoint DISABLE TRIGGER evidence_checkpoint_immutable;
UPDATE evidence.document_checkpoint SET body = repeat('e', 64) WHERE document_id = 'doc-a' AND revision = 1;
ALTER TABLE evidence.document_checkpoint ENABLE TRIGGER evidence_checkpoint_immutable;
SELECT is(pg_temp.read_as('ana'), 'unavailable||', 'a checkpoint whose bytes do not hash to the submission is unavailable');
SELECT is(pg_temp.read_as('vesna'), 'unavailable||', 'for the teacher as well');
DELETE FROM evidence.document_checkpoint WHERE document_id = 'doc-a' AND revision = 1;
SELECT is(pg_temp.read_as('vesna'), 'unavailable||', 'no checkpoint of the submitted revision is unavailable');
SELECT is(pg_temp.publish_as('ana', NULL, 'nacrt-5'), 'ZD403: forbidden', 'and publishing stays refused');

SELECT * FROM finish();
ROLLBACK;

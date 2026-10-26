-- DAN-332 PR 2 (contract on #826, c.6420660650, N14-N22): who reads a
-- submitted work through the live channel, for the access cases 066 leaves
-- open: no session, a document that does not exist, a work not submitted, a
-- student and a teacher whose membership ended, and the teacher on the work of
-- a student who left the course (current behaviour, kept by the owner until
-- the pilot: #87 c.6420796310, P1). Every person, document and text is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

CREATE FUNCTION pg_temp.read_as(p_actor text, p_document text DEFAULT 'doc-a') RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    $q$ SELECT format('%%s|%%s|%%s', outcome, content_hash, body) FROM collaboration.read_live_state(%L, NULL) $q$,
    p_document))
$$;
CREATE FUNCTION pg_temp.submitted_text() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('submitted|%s|%s', pg_temp.h('d'), repeat('d', 64))
$$;

-- Fixture: Ana commits revision 1 and submits it.
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64),
  repeat('b', 64)), 'reserved', 'fixture: Ana commits revision 1');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a', 1) $$), 'requested',
  'fixture: Ana requests revision 1');
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.record_submission(%L::uuid, %L)',
  (SELECT id FROM evidence.submission_request WHERE document_id = 'doc-a'), pg_temp.h('d'))), 'recorded',
  'fixture: the submission of revision 1 is recorded');
SELECT is(pg_temp.read_as('vesna'), pg_temp.submitted_text(), 'the teacher of the assignment reads the submitted revision');

-- N16: no session, an expired, a closed or an unknown one.
SELECT matches(pg_temp.read_as('anon'), '^ZD401:', 'no session is ZD401');
SELECT matches(pg_temp.read_as('expired'), '^ZD401:', 'an expired session is ZD401');
SELECT matches(pg_temp.read_as('closed'), '^ZD401:', 'a closed session is ZD401');
SELECT matches(pg_temp.read_as('unknown'), '^ZD401:', 'an unknown session is ZD401');
-- N18: a document that does not exist reads like a refused one.
SELECT is(pg_temp.read_as('vesna', 'doc-nema'), 'ZD403: forbidden', 'a document that does not exist is ZD403');
SELECT is(pg_temp.read_as('ana', 'doc-nema'), 'ZD403: forbidden', 'for the student as well');
-- N17: the administrator of the institution and a student of no course.
SELECT is(pg_temp.read_as('iva'), 'ZD403: forbidden', 'the administrator of the institution is refused');
SELECT is(pg_temp.read_as('boris'), 'ZD403: forbidden', 'a student of no course is refused');
-- N19: a work that is not submitted is never read as submitted.
SELECT is(pg_temp.read_as('petra', 'doc-b'), 'empty||', 'a work not submitted, with no live state, is empty');

-- N14 and N22: Ana leaves the course after submitting.
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('ana') AND member_to IS NULL;
SELECT is(pg_temp.read_as('ana'), 'ZD403: forbidden', 'the student who left reads her submitted work no longer');
SELECT is(pg_temp.read_as('vesna'), pg_temp.submitted_text(),
  'the teacher of the assignment still reads it (current behaviour; owner P1, decided with R-05)');

-- N15: Vesna's own membership ends.
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('vesna') AND member_to IS NULL;
SELECT is(pg_temp.read_as('vesna'), 'ZD403: forbidden', 'a teacher whose membership ended is refused');

SELECT * FROM finish();
ROLLBACK;

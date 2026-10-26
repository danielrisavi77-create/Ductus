-- DAN-290 (#745, contract c.6403391413): app.assignment_submissions gives the
-- teacher of an assignment, per student of its course, whether the work was
-- submitted, the revision, the minute of the request and whether it came
-- after the deadline; nobody else gets anything. Personas of institution.inc.
-- Added here: Boris joins K1 without a work; Ana has only a request on Z1;
-- Dora submits Z1 30 seconds after the deadline; Nina submitted Z1 and then
-- left K1; Tomo submits Z3 exactly at the deadline. Everything is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

CREATE TEMP TABLE due AS
SELECT pg_temp.id('z1') AS z1, (SELECT due_at FROM institution.assignment_version
                                  WHERE assignment_id = pg_temp.id('z1') AND version_no = 2) AS z1_due,
       (SELECT due_at FROM institution.assignment_version
         WHERE assignment_id = pg_temp.id('z3') AND version_no = 1) AS z3_due;
GRANT SELECT ON due TO PUBLIC;

INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('boris'), 'student'),
       (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('nina'), 'student');

SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES
  ('project-d', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('dora')),
  ('project-n', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('nina'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash) VALUES
  ('doc-d', pg_temp.id('fak_a'), 'project-d', pg_temp.id('dora'), pg_temp.h('d')),
  ('doc-n', pg_temp.id('fak_a'), 'project-n', pg_temp.id('nina'), pg_temp.h('n'));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
SELECT r.doc, pg_temp.id(r.fak), r.revision, nullif(r.revision - 1, -1), pg_temp.id(r.who), pg_temp.h(r.letter)
  FROM (VALUES
    ('doc-a', 'fak_a', 1, 'ana', 'g'), ('doc-b', 'fak_b', 1, 'tomo', 't'),
    ('doc-d', 'fak_a', 0, 'dora', 'd'), ('doc-d', 'fak_a', 1, 'dora', 'e'), ('doc-d', 'fak_a', 2, 'dora', 'f'),
    ('doc-n', 'fak_a', 0, 'nina', 'n'), ('doc-n', 'fak_a', 1, 'nina', 'o')
  ) AS r (doc, fak, revision, who, letter);
-- Request ids: ...e1 Ana, ...e2 Dora, ...e3 Nina, ...e4 Tomo.
INSERT INTO evidence.submission_request (
  id, institution_id, assignment_id, assignment_version, project_id, document_id, principal_id,
  revision, content_hash, requested_at
)
SELECT r.id::uuid, pg_temp.id(r.fak), pg_temp.id(r.z), r.version, r.project, r.doc, pg_temp.id(r.who),
       r.revision, pg_temp.h(r.letter), r.at
  FROM due, LATERAL (VALUES
    ('00000000-0000-4000-8000-0000000000e1', 'fak_a', 'z1', 2, 'project-a', 'doc-a', 'ana', 1, 'g',
     due.z1_due - interval '1 day'),
    ('00000000-0000-4000-8000-0000000000e2', 'fak_a', 'z1', 2, 'project-d', 'doc-d', 'dora', 2, 'f',
     due.z1_due + interval '30 seconds'),
    ('00000000-0000-4000-8000-0000000000e3', 'fak_a', 'z1', 2, 'project-n', 'doc-n', 'nina', 1, 'o',
     due.z1_due - interval '2 hours'),
    ('00000000-0000-4000-8000-0000000000e4', 'fak_b', 'z3', 1, 'project-b', 'doc-b', 'tomo', 1, 't',
     due.z3_due)
  ) AS r (id, fak, z, version, project, doc, who, revision, letter, at);
-- Ana's request stays without a submission for now.
INSERT INTO evidence.submission (
  submission_request_id, institution_id, principal_id, assignment_id, assignment_version, revision,
  artifact_hash, requested_at, due_at, recorded_at
)
SELECT q.id, q.institution_id, q.principal_id, q.assignment_id, q.assignment_version, q.revision,
       q.content_hash, q.requested_at, CASE WHEN q.assignment_id = due.z1 THEN due.z1_due ELSE due.z3_due END,
       q.requested_at + interval '2 seconds'
  FROM evidence.submission_request q, due
 WHERE q.principal_id <> pg_temp.id('ana');
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;

-- Nina leaves K1 after submitting.
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('nina') AND member_to IS NULL;

-- The rows as "name:state" in the function's own order, or "none". State is
-- "no" for a student without a submission (and "BAD" if any other column is
-- then set), otherwise "r<revision>/on-time|late". Names replace the ids
-- outside the web role.
CREATE FUNCTION pg_temp.subs(p_actor text, p_assignment text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_result text;
  r record;
BEGIN
  v_result := pg_temp.ask(p_actor, format(
    $q$ SELECT coalesce(string_agg(w.student_id::text || ':' || CASE
                 WHEN NOT w.submitted AND w.revision IS NULL AND w.requested_minute IS NULL
                      AND w.after_deadline IS NULL THEN 'no'
                 WHEN w.submitted AND w.revision IS NOT NULL AND w.requested_minute IS NOT NULL
                      AND w.after_deadline IS NOT NULL
                   THEN 'r' || w.revision || CASE WHEN w.after_deadline THEN '/late' ELSE '/on-time' END
                 ELSE 'BAD' END, ' ' ORDER BY w.n), 'none')
          FROM app.assignment_submissions(%s) WITH ORDINALITY AS w (student_id, submitted, revision,
                                                                  requested_minute, after_deadline, n) $q$,
    coalesce(quote_literal(pg_temp.id(p_assignment)::text), 'NULL')));
  FOR r IN SELECT name, id FROM person LOOP
    v_result := replace(v_result, r.id::text, r.name);
  END LOOP;
  RETURN v_result;
END
$$;

-- The minute the teacher sees for one student, as UTC text.
CREATE FUNCTION pg_temp.minute(p_actor text, p_student text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    $q$ SELECT to_char(w.requested_minute AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')
          FROM app.assignment_submissions({z1}) w WHERE w.student_id = %L $q$, pg_temp.id(p_student)))
$$;

-- Catalogue.
SELECT is(
  (SELECT format('%s %s %s %s', pg_get_userbyid(proowner), prosecdef::text, provolatile, ('search_path=""' = ANY(proconfig))::text)
     FROM pg_proc WHERE oid = 'app.assignment_submissions(uuid)'::regprocedure),
  'ductus_evidence true s true', 'the list is the evidence role''s, SECURITY DEFINER, STABLE, empty search_path');
SELECT bag_eq(
  $$ SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth',
                                'ductus_identity', 'ductus_test_stranger']) AS r
     WHERE has_function_privilege(r, 'app.assignment_submissions(uuid)', 'EXECUTE') $$,
  $$ VALUES ('ductus_app') $$,
  'only the web role executes the list');
SELECT is(pg_get_function_result('app.assignment_submissions(uuid)'::regprocedure),
  'TABLE(student_id uuid, submitted boolean, revision bigint, requested_minute timestamp with time zone, after_deadline boolean)',
  'the list returns these five columns and nothing else');
SELECT is((SELECT proargnames[1:pronargs]::text FROM pg_proc WHERE oid = 'app.assignment_submissions(uuid)'::regprocedure),
  '{p_assignment_id}', 'the list takes only the assignment: no identity or institution argument');
SELECT matches(pg_temp.ask_as('ductus_test_stranger', 'vesna', $$ SELECT count(*) FROM app.assignment_submissions({z1}) $$),
  '^42501:.*$', 'an unrelated role cannot call the list');

-- What the teacher sees.
SELECT is(pg_temp.subs('vesna', 'z1'), 'ana:no dora:r2/late boris:no',
  'the teacher of the course: every open student once, a request alone is not submitted, a student who left is not listed');
SELECT is(pg_temp.subs('petra', 'z3'), 'tomo:r1/on-time', 'a request exactly at the deadline is on time (P6)');
SELECT is(pg_temp.minute('vesna', 'dora'),
  (SELECT to_char(date_trunc('minute', z1_due + interval '30 seconds', 'UTC') AT TIME ZONE 'UTC',
                  'YYYY-MM-DD HH24:MI:SS.US') FROM due),
  'the time is the request''s minute, not the exact time');
SELECT is(pg_temp.ask('vesna', $$ SELECT count(*) FROM app.assignment_submissions({z1}) w
                                  WHERE w.requested_minute <> date_trunc('minute', w.requested_minute, 'UTC') $$),
  '0', 'no row carries seconds');
SET LOCAL TimeZone TO 'America/St_Johns';
SELECT is(pg_temp.minute('vesna', 'dora'),
  (SELECT to_char(date_trunc('minute', z1_due + interval '30 seconds', 'UTC') AT TIME ZONE 'UTC',
                  'YYYY-MM-DD HH24:MI:SS.US') FROM due),
  'the minute does not depend on the session time zone');
RESET TimeZone;

-- Nobody else gets anything.
SELECT is(pg_temp.subs('marko', 'z1'), 'none', 'a teacher of another course of the same institution');
SELECT is(pg_temp.subs('petra', 'z1'), 'none', 'a teacher of another institution');
SELECT is(pg_temp.subs('vesna', 'z3'), 'none', 'the teacher asking for another institution''s assignment');
SELECT is(pg_temp.subs('dora', 'z1'), 'none', 'a student of the course who submitted');
SELECT is(pg_temp.subs('ana', 'z1'), 'none', 'a student of the course who did not');
SELECT is(pg_temp.subs('tomo', 'z3'), 'none', 'a student asking for the own assignment');
SELECT is(pg_temp.subs('iva', 'z1'), 'none', 'the administrator of the institution');
SELECT is(pg_temp.subs('nina', 'z1'), 'none', 'a former student with an unconfirmed teacher role');
SELECT is(pg_temp.subs('vesna', 'nobody'), 'none', 'an assignment that does not exist');
SELECT is(pg_temp.subs('vesna', 'no-such-name'), 'none', 'a NULL assignment');
SELECT matches(pg_temp.subs('anon', 'z1'), '^ZD401:', 'no session');
SELECT matches(pg_temp.subs('expired', 'z1'), '^ZD401:', 'an expired session');
SELECT matches(pg_temp.subs('closed', 'z1'), '^ZD401:', 'a closed session');
SELECT matches(pg_temp.subs('unknown', 'z1'), '^ZD401:', 'an unknown token');

-- Ana's submission is recorded: she becomes submitted, on time.
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.submission (
  submission_request_id, institution_id, principal_id, assignment_id, assignment_version, revision,
  artifact_hash, requested_at, due_at, recorded_at
)
SELECT q.id, q.institution_id, q.principal_id, q.assignment_id, q.assignment_version, q.revision,
       q.content_hash, q.requested_at, due.z1_due, q.requested_at + interval '2 seconds'
  FROM evidence.submission_request q, due
 WHERE q.principal_id = pg_temp.id('ana');
RESET ROLE;
SELECT is(pg_temp.subs('vesna', 'z1'), 'ana:r1/on-time dora:r2/late boris:no', 'a recorded submission shows on the next call');

-- The web role still reads only its own submissions directly.
SELECT is(pg_temp.ask('vesna', $$ SELECT count(*) FROM evidence.submission $$), '0',
  'the teacher reads no submission row outside the list');
SELECT is(pg_temp.ask('dora', $$ SELECT count(*) FROM evidence.submission $$), '1',
  'a student reads only the own submission');

-- Vesna's own membership ends: she lists nothing.
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('vesna') AND member_to IS NULL;
SELECT is(pg_temp.subs('vesna', 'z1'), 'none', 'a teacher whose membership ended');

-- Reading wrote nothing.
SELECT is((SELECT count(*)::integer FROM audit.access_log), 0, 'listing the submissions opens no work');

SELECT * FROM finish();
ROLLBACK;

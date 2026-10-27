-- DAN-349, part 2 of 4 (#916, contract issuecomment-6431784351): the evidence
-- path of a mentorship's work. app.lock_student_assignment and
-- app.teacher_assignment_students decide for a mentorship's assignment through
-- the mentorship; for a course's assignment nothing changes. Personas of
-- institution.inc and mentorship.inc: Ana writes zm1 under Marko (ms1, open),
-- Dora's zm2 under Vesna has ended (ms2), Boris's zm3 under Nina, whose
-- teacher role nobody confirmed, is not acknowledged (ms3). Everything is
-- invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
-- evidence-acceptance.inc leaves every constraint IMMEDIATE; mentorship.inc
-- writes an assignment before its first version, as institution.inc does
-- under the key's INITIALLY DEFERRED, so defer it for the fixture and check it
-- at once after.
SET CONSTRAINTS institution.assignment_current_version_fkey DEFERRED;
\ir fixtures/mentorship.inc
SET CONSTRAINTS institution.assignment_current_version_fkey IMMEDIATE;
SELECT no_plan();

CREATE FUNCTION pg_temp.val(p_name text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT val FROM ref WHERE name = p_name $$;
CREATE FUNCTION pg_temp.open(p_actor text, p_assignment text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format('SELECT outcome FROM app.open_student_work(%L::uuid)', pg_temp.id(p_assignment)))
$$;
CREATE FUNCTION pg_temp.doc(p_student text, p_assignment text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT d.id FROM evidence.document d JOIN evidence.project p ON p.id = d.project_id
   WHERE p.principal_id = pg_temp.id(p_student) AND p.assignment_id = pg_temp.id(p_assignment)
$$;
-- Everything the evidence schema holds, as one value (as in 046).
CREATE FUNCTION pg_temp.evidence_print() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT md5(string_agg(r, '|' ORDER BY r)) FROM (
    SELECT 'j' || row_to_json(x)::text FROM evidence.project x UNION ALL
    SELECT 'd' || row_to_json(x)::text FROM evidence.document x UNION ALL
    SELECT 'r' || row_to_json(x)::text FROM evidence.document_revision x UNION ALL
    SELECT 'k' || row_to_json(x)::text FROM evidence.document_checkpoint x UNION ALL
    SELECT 'p' || row_to_json(x)::text FROM evidence.package x UNION ALL
    SELECT 's' || row_to_json(x)::text FROM evidence.segment x UNION ALL
    SELECT 'c' || row_to_json(x)::text FROM evidence.receipt x UNION ALL
    SELECT 'q' || row_to_json(x)::text FROM evidence.submission_request x
  ) AS t (r)
$$;
-- A teacher list as names, in the function's own order, or "none"/"empty".
CREATE FUNCTION pg_temp.names(p_actor text, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v text := pg_temp.ask(p_actor, p_sql);
  r record;
BEGIN
  FOR r IN SELECT name, id FROM person LOOP
    v := replace(v, r.id::text, r.name);
  END LOOP;
  RETURN v;
END
$$;
CREATE FUNCTION pg_temp.works(p_actor text, p_assignment text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.names(p_actor, format(
    $q$ SELECT coalesce(string_agg(w.student_id::text || '/' || w.document_id, ' ' ORDER BY w.n), 'none')
          FROM app.assignment_works(%L::uuid) WITH ORDINALITY AS w (student_id, document_id, n) $q$,
    pg_temp.id(p_assignment)))
$$;
CREATE FUNCTION pg_temp.fast(p_actor text, p_assignment text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.names(p_actor, format(
    $q$ SELECT coalesce(string_agg(student_id::text, ' ' ORDER BY student_id), 'empty')
          FROM app.fast_path_works(%L::uuid) $q$, pg_temp.id(p_assignment)))
$$;
CREATE FUNCTION pg_temp.subs(p_actor text, p_assignment text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.names(p_actor, format(
    $q$ SELECT coalesce(string_agg(w.student_id::text || ':' || CASE
                 WHEN w.submitted THEN 'r' || w.revision || CASE WHEN w.after_deadline THEN '/late' ELSE '/on-time' END
                 ELSE 'no' END, ' ' ORDER BY w.n), 'none')
          FROM app.assignment_submissions(%L::uuid) WITH ORDINALITY AS w (student_id, submitted, revision,
                                                                       requested_minute, after_deadline, n) $q$,
    pg_temp.id(p_assignment)))
$$;
CREATE FUNCTION pg_temp.ms_xmax() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT xmax::text FROM institution.mentorship WHERE id = pg_temp.id('ms1') $$;

-- Catalogue: the same two functions, owners, definer rights and grants.
SELECT is(
  (SELECT string_agg(format('%s %s %s %s', p.oid::regprocedure, pg_get_userbyid(p.proowner), p.prosecdef,
                            'search_path=""' = ANY (p.proconfig)), '; ' ORDER BY p.oid::regprocedure::text)
     FROM pg_proc p
    WHERE p.oid IN ('app.lock_student_assignment(uuid)'::regprocedure, 'app.teacher_assignment_students(uuid)'::regprocedure)),
  'app.lock_student_assignment(uuid) ductus_identity true true; app.teacher_assignment_students(uuid) ductus_identity true true',
  'both functions stay the identity role''s, SECURITY DEFINER, with an empty search_path');
SELECT bag_eq(
  $$ SELECT r || ' ' || f FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth',
                                            'ductus_evidence', 'ductus_test_stranger']) AS r
     CROSS JOIN unnest(ARRAY['app.lock_student_assignment(uuid)', 'app.teacher_assignment_students(uuid)']) AS f
     WHERE has_function_privilege(r, f, 'EXECUTE') $$,
  $$ VALUES ('ductus_evidence app.lock_student_assignment(uuid)'), ('ductus_evidence app.teacher_assignment_students(uuid)') $$,
  'only the evidence role executes them; the web role reaches them only through the evidence RPCs');

-- Works the refused openings must not reach: Dora's on zm2 and Boris's on zm3,
-- written by the owner as the other tests write fixtures.
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES
  ('project-m2', pg_temp.id('fak_a'), pg_temp.id('zm2'), pg_temp.id('dora')),
  ('project-m3', pg_temp.id('fak_a'), pg_temp.id('zm3'), pg_temp.id('boris'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash) VALUES
  ('doc-m2', pg_temp.id('fak_a'), 'project-m2', pg_temp.id('dora'), pg_temp.h('m')),
  ('doc-m3', pg_temp.id('fak_a'), 'project-m3', pg_temp.id('boris'), pg_temp.h('n'));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash) VALUES
  ('doc-m2', pg_temp.id('fak_a'), 0, pg_temp.id('dora'), pg_temp.h('m')),
  ('doc-m3', pg_temp.id('fak_a'), 0, pg_temp.id('boris'), pg_temp.h('n'));
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS evidence.evidence_document_current_revision_fkey DEFERRED;
RESET ROLE;

-- 9: nothing holds the mentorship before the student's first call.
SELECT is(pg_temp.ms_xmax(), '0', 'before any call nothing holds Ana''s mentorship');

-- 1: Ana opens her mentorship's work.
SELECT is(pg_temp.open('ana', 'zm1'), 'opened', 'the student of an open mentorship opens its work');
SELECT is(pg_temp.open('ana', 'zm1'), 'opened', 'a second call returns the same work');
SELECT is((SELECT count(*)::integer FROM evidence.project WHERE assignment_id = pg_temp.id('zm1')), 1,
  'one project for the mentorship''s assignment, under its own assignment_id');
-- 9: the authority row stays locked until the caller commits (as 047 shows for the key).
SELECT isnt(pg_temp.ms_xmax(), '0', 'the mentorship row is held FOR SHARE by the call, so ending it waits');
INSERT INTO ref SELECT 'doc_m1', pg_temp.doc('ana', 'zm1');
INSERT INTO ref SELECT 'pkg_m1', id FROM evidence.package WHERE document_id = pg_temp.doc('ana', 'zm1');

-- 2 to 5: every other caller, the same refusals as for a course; nothing written.
CREATE TEMP TABLE print_before AS SELECT pg_temp.evidence_print() AS v;
SELECT is(pg_temp.open('boris', 'zm3'), 'not_accepting', 'the student of an open mentorship who has not acknowledged its rules');
SELECT is(pg_temp.open(c.actor, c.assignment), 'not_found', c.why)
FROM (VALUES
  ('dora', 'zm2', 'the student of an ended mentorship'),
  ('ana', 'zm2', 'a student of another, ended mentorship'),
  ('ana', 'zm3', 'a student of another, open mentorship'),
  ('dora', 'zm1', 'a student of Ana''s course, who is not the mentorship''s student'),
  ('marko', 'zm1', 'the mentor, opening the work as a student'),
  ('vesna', 'zm1', 'the teacher of Ana''s course'),
  ('nina', 'zm3', 'the mentor without a confirmed role'),
  ('iva', 'zm1', 'the administrator'),
  ('tomo', 'zm1', 'a student of another institution')
) AS c (actor, assignment, why);
SELECT is(pg_temp.evidence_print(), (SELECT v FROM print_before), 'the refused openings wrote nothing');

-- 1: Ana writes, requests and submits; the receipt is prepared.
SELECT is(pg_temp.call('ana', pg_temp.val('pkg_m1'), 'm-request-1',
    pg_temp.descriptor(p_package => pg_temp.val('pkg_m1'), p_document => pg_temp.val('doc_m1'), p_segment => 'segment-m-1'),
    0, evidence.revision_zero_document(), repeat('d', 64), repeat('b', 64)),
  'reserved', 'the student''s first segment is accepted');
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.request_submission(%L, 1)', pg_temp.val('doc_m1'))),
  'requested', 'the student requests the submission of revision 1');
INSERT INTO ref SELECT 'req_m1', id::text FROM evidence.submission_request WHERE document_id = pg_temp.val('doc_m1');
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.record_submission(%L::uuid, %L)',
    pg_temp.val('req_m1'), pg_temp.h('d'))),
  'recorded', 'the submission is recorded');
INSERT INTO ref SELECT 'sub_m1', id::text FROM evidence.submission WHERE submission_request_id = pg_temp.val('req_m1')::uuid;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.signing_key
  (key_id, key_version, evidence_domain_id, institution_id, purpose, algorithm, key_base64url, valid_from)
VALUES ('key-m', '1', '00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), 'receipt', 'Ed25519',
  'MCowBQYDK2VwAyEA' || translate(rtrim(encode(decode(repeat('11', 32), 'hex'), 'base64'), '='), '+/', '-_'),
  date_trunc('minute', now()) - interval '1 day');
RESET ROLE;
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.prepare_submission_receipt(%L::uuid, %L, %L)',
    pg_temp.val('sub_m1'), 'key-m', '1')),
  'prepared', 'the receipt of the mentorship''s work is prepared');

-- 6 and 7: the mentor's lists hold exactly Ana; everyone else gets nothing.
SELECT is(pg_temp.works('marko', 'zm1'), 'ana/' || pg_temp.val('doc_m1'), 'the mentor lists exactly Ana''s work');
SELECT is(pg_temp.fast('marko', 'zm1'), 'ana', 'the fast path gives the mentor exactly Ana');
SELECT is(pg_temp.subs('marko', 'zm1'), 'ana:r1/on-time', 'the mentor sees Ana''s submission');
SELECT is(pg_temp.works(c.actor, c.assignment), 'none', c.why)
FROM (VALUES
  ('nina', 'zm3', 'the mentor without a confirmed role lists nothing'),
  ('vesna', 'zm2', 'the mentor of an ended mentorship lists nothing'),
  ('vesna', 'zm1', 'the teacher of Ana''s course lists nothing of the mentorship'),
  ('ana', 'zm1', 'the student lists nothing as a teacher'),
  ('petra', 'zm1', 'a teacher of another institution lists nothing')
) AS c (actor, assignment, why);
SELECT is(pg_temp.fast(c.actor, c.assignment), 'empty', c.why)
FROM (VALUES ('nina', 'zm3', 'no fast path for the mentor without a confirmed role'),
             ('vesna', 'zm2', 'no fast path for an ended mentorship'),
             ('vesna', 'zm1', 'no fast path for the teacher of Ana''s course')) AS c (actor, assignment, why);
SELECT is(pg_temp.subs(c.actor, c.assignment), 'none', c.why)
FROM (VALUES ('nina', 'zm3', 'no submissions for the mentor without a confirmed role'),
             ('vesna', 'zm2', 'no submissions for an ended mentorship'),
             ('vesna', 'zm1', 'no submissions for the teacher of Ana''s course')) AS c (actor, assignment, why);
SELECT is(pg_temp.works('marko', 'z2'), 'none', 'the mentor''s own course is unchanged: no student, no work');

-- 11: a course's assignment answers as before.
SELECT is(pg_temp.works('vesna', 'z1'), 'ana/doc-a', 'the teacher of K1 still lists Ana''s course work');
SELECT is(pg_temp.works('marko', 'z1'), 'none', 'the mentor gets nothing of Ana''s course');
SELECT is(pg_temp.open('ana', 'z1'), 'opened', 'Ana still opens her course work');
SELECT is(pg_temp.open('dora', 'z1'), 'not_accepting', 'Dora still has to acknowledge the current version of Z1');
SELECT is(pg_temp.open('marko', 'z1'), 'not_found', 'the mentor still cannot open a course work');

-- 10: the mentor's teacher role revoked closes the lists at once, and back.
UPDATE institution.institution_role SET revoked_at = now() WHERE user_id = pg_temp.id('marko');
SELECT is(pg_temp.works('marko', 'zm1'), 'none', 'a revoked mentor lists nothing');
SELECT is(pg_temp.subs('marko', 'zm1'), 'none', 'a revoked mentor sees no submission');
SELECT is(pg_temp.fast('marko', 'zm1'), 'empty', 'a revoked mentor gets no fast path');
UPDATE institution.institution_role SET revoked_at = NULL WHERE user_id = pg_temp.id('marko');
SELECT is(pg_temp.works('marko', 'zm1'), 'ana/' || pg_temp.val('doc_m1'), 'the role restored, the list is back');

-- 8: the mentorship ends after Ana opened her work: every path closes as for
-- a student removed from a course (044, 063).
UPDATE institution.mentorship SET ended_at = now() WHERE id = pg_temp.id('ms1');
CREATE TEMP TABLE print_ended AS SELECT pg_temp.evidence_print() AS v;
SELECT is(pg_temp.call('ana', pg_temp.val('pkg_m1'), 'm-request-2',
    pg_temp.descriptor(p_package => pg_temp.val('pkg_m1'), p_document => pg_temp.val('doc_m1'), p_segment => 'segment-m-2',
                       p_sequence_from => 2, p_sequence_to => 2, p_hash => repeat('c', 64), p_predecessor => repeat('b', 64)),
    1, repeat('d', 64), repeat('e', 64), repeat('c', 64)),
  'unauthorized', 'the next segment of an ended mentorship is refused');
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.request_submission(%L, 1)', pg_temp.val('doc_m1'))),
  'unauthorized', 'a submission request of an ended mentorship is refused, before the earlier request is named');
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.prepare_submission_receipt(%L::uuid, %L, %L)',
    pg_temp.val('sub_m1'), 'key-m', '1')),
  'unauthorized', 'no new receipt attempt for an ended mentorship');
SELECT is(pg_temp.open('ana', 'zm1'), 'not_found', 'the work of an ended mentorship does not open');
SELECT is(pg_temp.evidence_print(), (SELECT v FROM print_ended), 'the refusals after the end wrote nothing');
SELECT is(pg_temp.works('marko', 'zm1'), 'none', 'the mentor of the ended mentorship lists nothing');
SELECT is(pg_temp.subs('marko', 'zm1'), 'none', 'and sees no submission');

SELECT * FROM finish();
ROLLBACK;

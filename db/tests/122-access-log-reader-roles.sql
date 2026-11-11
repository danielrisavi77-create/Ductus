-- DAN-294 (M10.4-P02, contract on #1836, c.6788079686): every read that returns
-- the content of a work, or its summary, to someone other than its owner writes
-- one row of audit.access_log with the reader's real role (teacher of the
-- course, mentor, teacher of a seminar group) and the surface; the submitted
-- text has its own surface. The owner's own read, a refused read and a list
-- without content write nothing. Every person, work and text below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
-- evidence-acceptance.inc leaves every constraint IMMEDIATE; mentorship.inc
-- writes an assignment before its first version (as in 038).
SET CONSTRAINTS institution.assignment_current_version_institution_fkey DEFERRED;
\ir fixtures/mentorship.inc
SET CONSTRAINTS institution.assignment_current_version_institution_fkey IMMEDIATE;
SELECT no_plan();

-- doc-a (Ana, Z1 of K1) comes from evidence-acceptance.inc. Ana's thesis with
-- Marko (zm1), Dora's ended thesis with Vesna (zm2), Boris's thesis with Nina
-- (zm3) and Dora's work on Z1.
CREATE TEMP TABLE work (id text PRIMARY KEY, assignment text, owner text);
GRANT SELECT ON work TO PUBLIC;
INSERT INTO work VALUES ('doc-am', 'zm1', 'ana'), ('doc-dm', 'zm2', 'dora'), ('doc-bm', 'zm3', 'boris'),
                        ('doc-d', 'z1', 'dora');
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id)
SELECT 'project-' || w.id, pg_temp.id('fak_a'), pg_temp.id(w.assignment), pg_temp.id(w.owner) FROM work w;
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash)
SELECT w.id, pg_temp.id('fak_a'), 'project-' || w.id, pg_temp.id(w.owner), pg_temp.h('a') FROM work w;
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash)
SELECT w.id, pg_temp.id('fak_a'), 0, pg_temp.id(w.owner), pg_temp.h('a') FROM work w;
SET CONSTRAINTS ALL IMMEDIATE;
-- As evidence-acceptance.inc leaves it, for the commit in section 8.
SET CONSTRAINTS evidence.evidence_document_current_revision_fkey DEFERRED;
RESET ROLE;

-- The rows of one work as "reader role surface", sorted; '' is none.
CREATE FUNCTION pg_temp.rows(p_document text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(format('%s %s %s', r.name, l.reader_role, l.surface), '; '
                             ORDER BY r.name, l.reader_role, l.surface), '')
    FROM audit.access_log l JOIN person r ON r.id = l.reader_id
   WHERE l.document_id = p_document
$$;
CREATE FUNCTION pg_temp.total() RETURNS bigint LANGUAGE sql STABLE AS $$ SELECT count(*) FROM audit.access_log $$;
-- One read of the live channel; its outcome, or the error.
CREATE FUNCTION pg_temp.live(p_actor text, p_document text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format('SELECT outcome FROM collaboration.read_live_state(%L, %L)', p_document,
                                     repeat('0', 64)))
$$;
CREATE FUNCTION pg_temp.summary(p_actor text, p_document text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format('SELECT outcome FROM app.read_process_summary_source(%L)', p_document))
$$;
CREATE FUNCTION pg_temp.replay(p_actor text, p_document text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format('SELECT outcome FROM app.read_replay_source(%L)', p_document))
$$;
CREATE FUNCTION pg_temp.fast_path(p_actor text, p_document text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask_as('ductus_identity', p_actor,
                        format($q$ SELECT 'ok' FROM app.record_fast_path_opening(%L) $q$, p_document))
$$;

-- 1. Shape. The new role and surface values are in the closed lists, which
-- still hold for every row; the writer and the role helper stay functions of
-- the identity role that no runtime role calls.
SELECT is(
  (SELECT string_agg(conname || ' ' || convalidated::text, ', ' ORDER BY conname) FROM pg_constraint
    WHERE conrelid = 'audit.access_log'::regclass AND conname IN ('access_log_reader_role_check', 'access_log_surface_check')),
  'access_log_reader_role_check true, access_log_surface_check true', 'both closed lists are validated');
SELECT matches(pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'access_log_reader_role_check')),
  'teacher.*mentor.*seminar_teacher', 'the reader roles are teacher, mentor and seminar_teacher');
SELECT matches(pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'access_log_surface_check')),
  'live_view.*process_summary.*fast_path.*replay.*submitted_text', 'submitted_text joins the surfaces');
SELECT is(
  (SELECT format('%s %s %s %s', proowner::regrole, prosecdef, provolatile, 'search_path=""' = ANY (proconfig))
     FROM pg_proc WHERE oid = 'audit.reader_role(uuid,uuid,uuid)'::regprocedure),
  'ductus_identity f s t', 'reader_role is a stable invoker function of the identity role, empty search_path');
SELECT is(
  (SELECT format('%s %s %s', proowner::regrole, prosecdef, proargnames)
     FROM pg_proc WHERE oid = 'audit.record_work_opening(uuid,text,uuid,uuid,text)'::regprocedure),
  'ductus_identity f {p_institution_id,p_document_id,p_assignment_id,p_owner_id,p_surface}',
  'the writer keeps its owner, its arguments and takes no reader or role from the caller');
SELECT is_empty(
  $$ SELECT r || ' ' || f FROM unnest(ARRAY['public', 'ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth',
                                            'ductus_evidence', 'ductus_test_stranger']) AS r
      CROSS JOIN unnest(ARRAY['audit.reader_role(uuid,uuid,uuid)', 'audit.record_work_opening(uuid,text,uuid,uuid,text)']) AS f
      WHERE has_function_privilege(r, f, 'EXECUTE') $$,
  'no runtime role and not PUBLIC calls the role helper or the writer');
SELECT ok(NOT has_schema_privilege('ductus_identity', 'audit', 'CREATE')
  AND NOT has_schema_privilege('ductus_identity', 'collaboration', 'CREATE'),
  'the migration leaves no CREATE right behind');

-- 2. Groups. Marko, mentor of Ana's thesis and teacher of K2 only, becomes the
-- teacher of G1 of K1 and Ana its member; Vesna, teacher of K1, is in G1 too.
INSERT INTO ref VALUES ('g1', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa 1') $$));
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.set_course_holder({k1}, {vesna}) $$), 'ok',
  'fixture: Vesna becomes the holder of K1');
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_teacher({g1}, {marko}) $$), 'ok',
  'fixture: Marko becomes the teacher of G1');
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_teacher({g1}, {vesna}) $$), 'ok',
  'fixture: Vesna is a teacher of G1 as well');
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_student({g1}, {ana}) $$), 'ok',
  'fixture: Ana joins G1');

-- 3. Who reads what, and the row each read writes (R1 to R8, S1). The class,
-- the reader, the work, the expected outcome and the expected rows of that work.
CREATE TEMP TABLE expect (pos integer PRIMARY KEY, class text, actor text, doc text, outcome text, log text);
INSERT INTO expect VALUES
  (1, 'R5', 'ana', 'doc-a', 'empty', ''),
  (2, 'R1', 'vesna', 'doc-a', 'empty', 'vesna teacher live_view'),
  (3, 'R3', 'marko', 'doc-a', 'empty', 'marko seminar_teacher live_view; vesna teacher live_view'),
  (4, 'R6', 'dora', 'doc-a', 'ZD403: forbidden', 'marko seminar_teacher live_view; vesna teacher live_view'),
  (5, 'R6', 'petra', 'doc-a', 'ZD403: forbidden', 'marko seminar_teacher live_view; vesna teacher live_view'),
  (6, 'R6', 'nina', 'doc-a', 'ZD403: forbidden', 'marko seminar_teacher live_view; vesna teacher live_view'),
  (7, 'R5', 'ana', 'doc-am', 'empty', ''),
  (8, 'R2', 'marko', 'doc-am', 'empty', 'marko mentor live_view'),
  (9, 'R6', 'vesna', 'doc-am', 'ZD403: forbidden', 'marko mentor live_view'),
  (10, 'R4', 'vesna', 'doc-d', 'empty', 'vesna teacher live_view'),
  (11, 'R6', 'marko', 'doc-d', 'ZD403: forbidden', 'vesna teacher live_view'),
  (12, 'R7', 'vesna', 'doc-dm', 'ZD403: forbidden', ''),
  (13, 'R8', 'nina', 'doc-bm', 'ZD403: forbidden', '');
SELECT is(pg_temp.live(e.actor, e.doc), e.outcome, format('%s: %s reads %s', e.class, e.actor, e.doc))
  FROM expect e ORDER BY e.pos;
-- Reads again in the same interval add nothing: one row per reader, work,
-- surface and interval, whatever the role.
SELECT is(string_agg(pg_temp.live(e.actor, e.doc), ','), 'empty,empty,empty,empty',
  'fixture: the same four reads again') FROM expect e WHERE e.outcome = 'empty' AND e.actor <> 'ana';
SELECT is(pg_temp.rows(d.doc), (SELECT e.log FROM expect e WHERE e.doc = d.doc ORDER BY e.pos DESC LIMIT 1),
  format('the rows of %s after every read', d.doc))
  FROM (SELECT DISTINCT doc FROM expect) d ORDER BY d.doc;

-- R8: Nina's role confirmed, she reads Boris's thesis as its mentor; with the
-- role revoked she is refused again and nothing more is written.
INSERT INTO identity.teacher_eligibility (user_id, institution_id) VALUES (pg_temp.id('nina'), pg_temp.id('fak_a'));
SELECT is(pg_temp.ask('iva', $$ SELECT 'ok' FROM institution.confirm_teacher_role({nina}) $$), 'ok',
  'fixture: Iva confirms Nina''s teacher role');
SELECT is(pg_temp.live('nina', 'doc-bm'), 'empty', 'R2: Nina, now a confirmed mentor, reads Boris''s thesis');
SELECT is(pg_temp.rows('doc-bm'), 'nina mentor live_view', 'and the row names her a mentor');
SELECT is(pg_temp.ask('iva', $$ SELECT 'ok' FROM institution.revoke_teacher_role({nina}) $$), 'ok',
  'fixture: Iva revokes Nina''s teacher role');
SELECT is(pg_temp.summary('nina', 'doc-bm'), 'not_found', 'R8: a revoked mentor is refused the summary');
SELECT is(pg_temp.live('nina', 'doc-bm'), 'ZD403: forbidden', 'R8: and the text');
SELECT is(pg_temp.rows('doc-bm'), 'nina mentor live_view', 'R8: and writes nothing');

-- 4. The other surfaces with the new roles (S3).
SELECT is(pg_temp.summary('marko', 'doc-am'), 'unavailable', 'S3: Marko reads the summary of Ana''s thesis');
SELECT is(pg_temp.replay('marko', 'doc-am'), 'unavailable', 'S3: and its replay');
SELECT is(pg_temp.fast_path('marko', 'doc-am'), 'ok', 'S3: and opens it in the fast path');
SELECT is(pg_temp.summary('marko', 'doc-a'), 'found', 'S3: Marko reads the summary of Ana''s Z1 work, which has a package');
SELECT is(pg_temp.ask('marko', format('SELECT count(*)::text FROM app.read_replay_checkpoints(%L, ARRAY[%L])',
  'doc-a', pg_temp.h('a'))), '0', 'S3: and asks for its replay checkpoints');
SELECT is(pg_temp.summary('ana', 'doc-am'), 'unavailable', 'S3: Ana reads her own summary');
SELECT is(pg_temp.rows('doc-am'),
  'marko mentor fast_path; marko mentor live_view; marko mentor process_summary; marko mentor replay',
  'S3: every surface of the thesis names Marko a mentor, and Ana''s own read writes nothing');
SELECT is(pg_temp.rows('doc-a'),
  'marko seminar_teacher live_view; marko seminar_teacher process_summary; marko seminar_teacher replay; vesna teacher live_view',
  'S3: every surface of the Z1 work names Marko a teacher of the seminar group');

-- 5. Lists without content write nothing (S4).
SELECT is(pg_temp.total(), 10::bigint, 'fixture: ten rows so far');
SELECT ok(pg_temp.ask('vesna', $$ SELECT count(*)::text FROM app.assignment_works({z1}) $$) ~ '^[0-9]+$'
      AND pg_temp.ask('vesna', $$ SELECT count(*)::text FROM app.assignment_submissions({z1}) $$) ~ '^[0-9]+$'
      AND pg_temp.ask('marko', $$ SELECT count(*)::text FROM app.teacher_assignment_names({z1}) $$) ~ '^[0-9]+$'
      AND pg_temp.ask('vesna', $$ SELECT count(*)::text FROM app.teacher_course_students({k1}) $$) ~ '^[0-9]+$',
  'S4: Vesna and Marko list works, submissions, names and students');
SELECT is(pg_temp.total(), 10::bigint, 'S4: and no list writes a row');

-- 6. The writer derives the role itself: called in a session that reaches no
-- such role, it refuses and writes nothing, whatever the caller passes (R6).
SELECT is(pg_temp.ask_as('ductus_identity', 'dora', format(
  'SELECT audit.record_work_opening(%L, %L, %L, %L, %L)::text', pg_temp.id('fak_a'), 'doc-a', pg_temp.id('z1'),
  pg_temp.id('ana'), 'live_view')), 'ZD403: forbidden', 'R6: the writer refuses a reader with no role on the work');
SELECT is(pg_temp.ask_as('ductus_identity', 'petra', format(
  'SELECT audit.record_work_opening(%L, %L, %L, %L, %L)::text', pg_temp.id('fak_a'), 'doc-a', pg_temp.id('z1'),
  pg_temp.id('ana'), 'live_view')), 'ZD403: forbidden', 'R6: and one of another institution');
SELECT is(pg_temp.ask_as('ductus_identity', 'ana', format(
  'SELECT audit.record_work_opening(%L, %L, %L, %L, %L)::text', pg_temp.id('fak_a'), 'doc-a', pg_temp.id('z1'),
  pg_temp.id('ana'), 'live_view')), 'ZD403: forbidden', 'R5: and the owner herself');
SELECT is(pg_temp.total(), 10::bigint, 'and nothing is written');

-- 7. A mentorship that ends before the read: the access check and the role
-- are one decision, so the read is refused and nothing is written (R7).
UPDATE institution.mentorship SET ended_at = now() WHERE id = pg_temp.id('ms1');
SELECT is(pg_temp.live('marko', 'doc-am'), 'ZD403: forbidden', 'R7: Marko, whose mentorship ended, is refused the text');
SELECT is(pg_temp.summary('marko', 'doc-am'), 'not_found', 'R7: and the summary');
SELECT is(pg_temp.total(), 10::bigint, 'R7: and nothing is written');

-- 8. After the submission the live channel answers the submitted text, and a
-- teacher's read of it is logged under its own surface (S1, S2).
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64),
  repeat('b', 64)), 'reserved', 'fixture: Ana commits revision 1');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a', 1) $$), 'requested',
  'fixture: Ana requests revision 1');
SELECT is(pg_temp.live('marko', 'doc-a'), 'empty', 'S1: before the submission is recorded Marko reads the live text');
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.record_submission(%L::uuid, %L)',
  (SELECT id::text FROM evidence.submission_request WHERE document_id = 'doc-a'), pg_temp.h('d'))), 'recorded',
  'fixture: the submission of revision 1 is recorded');
SELECT is(pg_temp.live('ana', 'doc-a'), 'submitted', 'S2: Ana reads her submitted text');
SELECT is(pg_temp.live('vesna', 'doc-a'), 'submitted', 'S2: Vesna reads it');
SELECT is(pg_temp.live('marko', 'doc-a'), 'submitted', 'S2: and Marko');
SELECT is(pg_temp.live('dora', 'doc-a'), 'ZD403: forbidden', 'S2: Dora is still refused');
SELECT is(pg_temp.rows('doc-a'),
  'marko seminar_teacher live_view; marko seminar_teacher process_summary; marko seminar_teacher replay; '
  || 'marko seminar_teacher submitted_text; vesna teacher live_view; vesna teacher submitted_text',
  'S2: the submitted text has its own surface; the live rows stay as they were, the owner writes nothing');

SELECT * FROM finish();
ROLLBACK;

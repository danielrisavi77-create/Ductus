-- DAN-351, M2.7-P04b (contract on #1836, c.6858454835): a teacher of a
-- course reaches a student's work on its assignment only if the work was not
-- started before her open teacher membership of the course began. Equal is
-- not earlier, and a work not yet started has nothing earlier. An earlier
-- work stays reachable through a seminar group of the actor when the group
-- boundary allows it; the course list keeps the names of every student.
-- Classes of the contract:
--   K1 started before the membership: closed on every surface, in can(),
--      in the lists and in work_accommodation; K2 the same instant: open;
--   K3 started after: open; K4 not started: the student is listed, and the
--   work opens once started; K5 closed through the course, open through a
--   group, with no duplicate; K6 the creator of the course; K7 the owner and
--   a mentorship; K8 an ended membership.
-- Marko's late membership of K1 is written straight into the table: in this
-- step no RPC writes one (P04c does). Personas of institution.inc and
-- mentorship.inc; the works, texts and group names are invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
\ir fixtures/mentorship.inc
\ir fixtures/work-reach.inc
SELECT no_plan();

-- A work of p_owner on p_assignment, as the evidence role writes it, with
-- one checkpoint text, started at now(); its id is doc-<owner>-<assignment>.
CREATE FUNCTION pg_temp.add_work(p_owner text, p_assignment text DEFAULT 'z1') RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_id text := 'doc-' || p_owner || '-' || p_assignment;
BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  SET LOCAL ROLE ductus_evidence;
  INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id)
  VALUES ('project-' || v_id, pg_temp.id('fak_a'), pg_temp.id(p_assignment), pg_temp.id(p_owner));
  INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash)
  VALUES (v_id, pg_temp.id('fak_a'), 'project-' || v_id, pg_temp.id(p_owner), pg_temp.text_hash());
  INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash)
  VALUES (v_id, pg_temp.id('fak_a'), 0, pg_temp.id(p_owner), pg_temp.text_hash());
  INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body, content_hash, created_at)
  VALUES (v_id, pg_temp.id('fak_a'), 0, 'Prvi odlomak.', pg_temp.text_hash(), now());
  SET CONSTRAINTS ALL IMMEDIATE;
  RESET ROLE;
END
$$;

-- The expected answer of every row of a stage. A work row gives the
-- surfaces and the can() actions: "teacher", "owner" or "-". A list row
-- gives the course list, the students of Z1 and the works of Z1:
-- "course|students|works". An accommodation row gives the answer of
-- institution.work_accommodation on Z1 for the student in doc.
CREATE TEMP TABLE expect (stage text, pos integer, class text, actor text, doc text, want text,
                          PRIMARY KEY (stage, pos));
CREATE FUNCTION pg_temp.answer(p_want text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_want
           WHEN 'teacher' THEN 'text,comments,summary,replay,checkpoints,fast_path,comment | read,comment,open_fast_path,propose'
           WHEN 'owner' THEN 'text,comments,summary,replay,checkpoints,comment | read,write'
           WHEN '-' THEN '- | -'
         END
$$;
CREATE FUNCTION pg_temp.check_stage(p_stage text) RETURNS SETOF text
LANGUAGE sql AS $$
  SELECT is(
           CASE WHEN e.doc IS NULL THEN pg_temp.lists(e.actor)
                WHEN e.doc LIKE 'mark:%' THEN pg_temp.ask(e.actor, format(
                  'SELECT coalesce(institution.work_accommodation({z1}, %L)::text, ''null'')',
                  pg_temp.id(substr(e.doc, 6))))
                ELSE pg_temp.reach(e.actor, 'doc-' || e.doc) || ' | ' || pg_temp.can(e.actor, 'doc-' || e.doc) END,
           CASE WHEN e.doc IS NULL
                THEN format('course=%1$s; names=%2$s; submissions=%2$s; works=%3$s',
                            split_part(e.want, '|', 1), split_part(e.want, '|', 2), split_part(e.want, '|', 3))
                WHEN e.doc LIKE 'mark:%' THEN e.want
                ELSE pg_temp.answer(e.want) END,
           format('%s, class %s: %s on %s', p_stage, e.class, e.actor,
                  CASE WHEN e.doc IS NULL THEN 'every list'
                       WHEN e.doc LIKE 'mark:%' THEN 'the accommodation of ' || substr(e.doc, 6)
                       ELSE 'doc-' || e.doc END))
  FROM expect e WHERE e.stage = p_stage ORDER BY e.pos
$$;

-- The helper: an invoker function of the identity role, not callable by the
-- web, evidence, worker or auth role.
SELECT is(
  (SELECT p.oid::regprocedure::text || ' ' || p.proowner::regrole::text || ' ' || p.prosecdef::text
          || ' ' || p.provolatile::text || ' ' || array_to_string(p.proconfig, ',')
     FROM pg_proc p WHERE p.oid = 'institution.actor_course_work(uuid, uuid)'::regprocedure),
  'institution.actor_course_work(uuid,uuid) ductus_identity false s search_path=""',
  'actor_course_work is a stable invoker function of the identity role with an empty search_path');
SELECT is_empty(
  $$ SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_evidence', 'ductus_worker', 'ductus_auth', 'public']) r
      WHERE has_function_privilege(r, 'institution.actor_course_work(uuid, uuid)', 'EXECUTE') $$,
  'no web, evidence, worker or auth role calls actor_course_work');
SELECT matches(pg_temp.ask('vesna', $$ SELECT institution.actor_course_work({z1}, {ana})::text $$),
  '^42501', 'the web role cannot ask the helper itself');

-- Setup at t0: Boris enrols in K1; Vesna, creator of K1, opens G1, where
-- Marko (teacher of K2 only) teaches Boris. Ana starts her work on Z1 and her
-- master thesis (zm1, mentored by Marko); Dora starts nothing yet.
SELECT is(pg_temp.ask('boris', $$ SELECT e::text FROM institution.enroll_with_code('KOD-K1-TEST') e $$),
          format('(enrolled,%s)', pg_temp.id('k1')), 'Boris enrols in K1 with its code');
INSERT INTO ref VALUES ('g1', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa 1') $$));
SELECT is(pg_temp.ask('vesna', v.sql), 'ok', v.what)
FROM (VALUES
  (1, $$ SELECT 'ok' FROM institution.assign_group_teacher({g1}, {marko}) $$, 'Marko becomes the teacher of G1'),
  (2, $$ SELECT 'ok' FROM institution.assign_group_student({g1}, {boris}) $$, 'Boris joins G1')
) AS v (n, sql, what) ORDER BY v.n;
DO $$ BEGIN PERFORM pg_temp.add_work('ana'); PERFORM pg_temp.add_work('ana', 'zm1'); END $$;

-- Stage "start": K6, the creator's row and Ana's work share the instant t0.
INSERT INTO expect VALUES
  ('start', 1, 'K6 creator, K2 equal', 'vesna', 'ana-z1', 'teacher'),
  ('start', 2, 'no membership', 'marko', 'ana-z1', '-'),
  ('start', 3, 'K7 mentorship', 'marko', 'ana-zm1', 'teacher'),
  ('start', 4, 'K6 creator', 'vesna', NULL, 'ana,boris,dora|ana,boris,dora|doc-ana-z1');
SELECT check_stage FROM pg_temp.check_stage('start') check_stage;

-- A minute later Boris starts his work, in G1.
SELECT pg_temp.tick();
SELECT pg_temp.add_work('boris');
-- A minute later Marko joins the teaching team of K1: Ana's and Boris's works
-- were started before his membership; Dora's is not started.
SELECT pg_temp.tick();
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('marko'), 'teacher');
SELECT is(pg_temp.ask('marko', $$ SELECT institution.can('read', 'doc-ana-z1')::text $$), 'false',
  'K1: can() does not fall back to the course role for an earlier work');

INSERT INTO expect VALUES
  ('late', 1, 'K1 earlier', 'marko', 'ana-z1', '-'),
  ('late', 2, 'K5 earlier, through G1', 'marko', 'boris-z1', 'teacher'),
  ('late', 3, 'K1, K4, K5', 'marko', NULL, 'ana,boris,dora|boris,dora|doc-boris-z1'),
  ('late', 4, 'K1 accommodation', 'marko', 'mark:ana', 'null'),
  ('late', 5, 'K5 accommodation', 'marko', 'mark:boris', 'false'),
  ('late', 6, 'K4 accommodation', 'marko', 'mark:dora', 'false'),
  ('late', 7, 'K7 mentorship', 'marko', 'ana-zm1', 'teacher'),
  ('late', 8, 'K7 owner', 'ana', 'ana-z1', 'owner'),
  ('late', 9, 'K6 creator', 'vesna', 'ana-z1', 'teacher'),
  ('late', 10, 'K6 creator', 'vesna', 'mark:ana', 'false'),
  ('late', 11, 'K6 creator', 'vesna', NULL, 'ana,boris,dora|ana,boris,dora|doc-ana-z1,doc-boris-z1');
SELECT check_stage FROM pg_temp.check_stage('late') check_stage;
-- The read paths of K1, each asked on its own, and nothing logged for them.
SELECT is(pg_temp.ask('marko', v.sql), v.want, v.what)
FROM (VALUES
  (1, $$ SELECT outcome FROM app.read_replay_source('doc-ana-z1') $$, 'not_found',
   'K1 replay: read_replay_source refuses Marko Ana''s earlier work'),
  (2, format($$ SELECT outcome FROM collaboration.read_live_state('doc-ana-z1', %L) $$, repeat('0', 64)), 'ZD403: forbidden',
   'K1 text: read_live_state refuses it'),
  (3, $$ SELECT count(*)::text FROM collaboration.list_comments('doc-ana-z1') $$, 'ZD403: forbidden',
   'K1 comments: list_comments refuses it')
) AS v (n, sql, want, what) ORDER BY v.n;
SELECT is_empty($$ SELECT 1 FROM audit.access_log WHERE reader_id = pg_temp.id('marko') AND document_id = 'doc-ana-z1' $$,
  'K1: no refused read of Ana''s earlier work is logged');
SELECT isnt_empty($$ SELECT 1 FROM audit.access_log WHERE reader_id = pg_temp.id('marko') AND document_id = 'doc-boris-z1' $$,
  'K5: Marko''s reads of Boris''s work through G1 are logged');

-- K2 and K4: Dora starts her work at the instant of Marko's membership.
SELECT pg_temp.add_work('dora');
INSERT INTO expect VALUES
  ('equal', 1, 'K2 equal', 'marko', 'dora-z1', 'teacher'),
  ('equal', 2, 'K2, K4', 'marko', NULL, 'ana,boris,dora|boris,dora|doc-boris-z1,doc-dora-z1'),
  ('equal', 3, 'K2 accommodation', 'marko', 'mark:dora', 'false');
SELECT check_stage FROM pg_temp.check_stage('equal') check_stage;
-- One microsecond earlier it is closed; one second later open (K3).
UPDATE evidence.project SET created_at = created_at - interval '1 microsecond' WHERE id = 'project-doc-dora-z1';
INSERT INTO expect VALUES
  ('earlier', 1, 'K1 one microsecond earlier', 'marko', 'dora-z1', '-'),
  ('earlier', 2, 'K1 one microsecond earlier', 'marko', NULL, 'ana,boris,dora|boris|doc-boris-z1'),
  ('earlier', 3, 'K1 accommodation', 'marko', 'mark:dora', 'null'),
  ('earlier', 4, 'K6 creator', 'vesna', 'dora-z1', 'teacher');
SELECT check_stage FROM pg_temp.check_stage('earlier') check_stage;
UPDATE evidence.project SET created_at = created_at + interval '1 microsecond' + interval '1 second'
 WHERE id = 'project-doc-dora-z1';
INSERT INTO expect VALUES
  ('after', 1, 'K3 after', 'marko', 'dora-z1', 'teacher'),
  ('after', 2, 'K3 after', 'marko', NULL, 'ana,boris,dora|boris,dora|doc-boris-z1,doc-dora-z1');
SELECT check_stage FROM pg_temp.check_stage('after') check_stage;

-- K8: Marko's membership of K1 ends. Dora's work, open through the course,
-- closes; Boris's stays open through G1.
SELECT pg_temp.tick();
UPDATE institution.course_member SET member_to = now()
 WHERE user_id = pg_temp.id('marko') AND course_id = pg_temp.id('k1');
INSERT INTO expect VALUES
  ('ended', 1, 'K8 ended', 'marko', 'dora-z1', '-'),
  ('ended', 2, 'K8 ended', 'marko', 'ana-z1', '-'),
  ('ended', 3, 'K8, K5 group', 'marko', 'boris-z1', 'teacher'),
  ('ended', 4, 'K8 accommodation', 'marko', 'mark:dora', 'null'),
  ('ended', 5, 'K7 mentorship', 'marko', 'ana-zm1', 'teacher'),
  ('ended', 6, 'K6 creator', 'vesna', 'dora-z1', 'teacher');
SELECT check_stage FROM pg_temp.check_stage('ended') check_stage;

SELECT * FROM finish();
ROLLBACK;

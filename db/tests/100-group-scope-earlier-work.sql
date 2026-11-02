-- DAN-351, M2.5-P01, repair round 2 (#1372; QA c.6585602557; contract on
-- #1091, c.6585876057; DAN-351, dopuna 27. 10., points 4 and 5): a teacher
-- of a seminar group reaches a work only if it was started no earlier than
-- both the student's place in the group and her own place as its teacher.
-- Without an explicit transfer (not in the schema) an earlier work stays
-- closed to every group teacher on every surface, in can() and in the lists
-- of the assignment; the course list keeps the names of the current members.
-- One table of expected answers per stage, over every class of the contract:
--   1 work in the current group; 2 earlier work from another group; 3 moved
--   student with a new work; 4 no membership; 5 teacher of two groups,
--   handover and reassignment; 6 course teacher, owner, equality boundary.
-- Personas of institution.inc; the works, texts and group names are invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
\ir fixtures/work-reach.inc
SELECT no_plan();

-- Works on Z1 of K1, as the evidence role writes them, each with one
-- checkpoint text, started at now().
CREATE FUNCTION pg_temp.add_work(p_owner text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_id text := 'doc-' || p_owner || '-z1';
BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  SET LOCAL ROLE ductus_evidence;
  INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id)
  VALUES ('project-' || v_id, pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id(p_owner));
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
-- gives the four lists of K1 and Z1, the course list apart from the three
-- lists of the assignment: "course|students of z1|works of z1".
CREATE TEMP TABLE expect (stage text, pos integer, class text, actor text, doc text, want text,
                          PRIMARY KEY (stage, pos));
CREATE FUNCTION pg_temp.answer(p_want text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_want
           WHEN 'teacher' THEN 'text,comments,summary,replay,checkpoints,fast_path,comment | read,comment,open_fast_path,propose'
           WHEN 'owner' THEN 'text,comments,summary,replay,checkpoints | read,write'
           WHEN '-' THEN '- | -'
         END
$$;
CREATE FUNCTION pg_temp.check_stage(p_stage text) RETURNS SETOF text
LANGUAGE sql AS $$
  SELECT is(
           CASE WHEN e.doc IS NULL THEN pg_temp.lists(e.actor)
                ELSE pg_temp.reach(e.actor, 'doc-' || e.doc || '-z1') || ' | ' || pg_temp.can(e.actor, 'doc-' || e.doc || '-z1') END,
           CASE WHEN e.doc IS NULL
                THEN format('course=%1$s; names=%2$s; submissions=%2$s; works=%3$s',
                            split_part(e.want, '|', 1), split_part(e.want, '|', 2), split_part(e.want, '|', 3))
                ELSE pg_temp.answer(e.want) END,
           format('%s, class %s: %s on %s', p_stage, e.class, e.actor, coalesce(e.doc || '''s work', 'every list')))
  FROM expect e WHERE e.stage = p_stage ORDER BY e.pos
$$;

-- The helpers: owned as the contract says, not callable by the web role.
SELECT is(
  (SELECT string_agg(p.oid::regprocedure::text || ' ' || p.proowner::regrole::text || ' ' || p.prosecdef::text
                     || ' ' || array_to_string(p.proconfig, ','), '; ' ORDER BY p.oid::regprocedure::text)
     FROM pg_proc p
    WHERE p.oid IN ('collaboration.work_started_at(uuid, uuid, uuid)'::regprocedure,
                    'institution.actor_group_work(uuid, uuid)'::regprocedure)),
  'collaboration.work_started_at(uuid,uuid,uuid) ductus_evidence true search_path=""; '
  || 'institution.actor_group_work(uuid,uuid) ductus_identity false search_path=""',
  'work_started_at is a definer function of the evidence role, actor_group_work an invoker one of the identity role');
SELECT is_empty(
  $$ SELECT f || ' ' || r
       FROM unnest(ARRAY['collaboration.work_started_at(uuid, uuid, uuid)', 'institution.actor_group_work(uuid, uuid)']) f,
            unnest(ARRAY['ductus_app', 'ductus_evidence', 'ductus_worker', 'ductus_auth', 'public']) r
      WHERE has_function_privilege(r, f, 'EXECUTE')
        AND NOT (f LIKE 'collaboration.%' AND r = 'ductus_evidence') $$,
  'no web, worker or auth role calls either helper');
SELECT ok(has_function_privilege('ductus_identity', 'collaboration.work_started_at(uuid, uuid, uuid)', 'EXECUTE')
          AND NOT has_table_privilege('ductus_identity', 'evidence.project', 'SELECT'),
  'the identity role gets the start of a work, and still no right on the evidence tables');
SELECT matches(pg_temp.ask('vesna', format($$ SELECT collaboration.work_started_at(%L, %L, %L)::text $$,
                                           pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('ana'))),
  '^42501', 'the web role cannot ask when a work was started');

-- Setup at t0: Iva confirms Nina; Vesna, holder of K1, opens G1 and G2;
-- Marko (teacher of K2 only) teaches G1 and Nina (of no course) G2; Boris
-- enrols in K1 with its code; Ana and Boris are in G1, Dora in no group.
-- Ana and Dora start their works at the same instant.
INSERT INTO identity.teacher_eligibility (user_id, institution_id) VALUES (pg_temp.id('nina'), pg_temp.id('fak_a'));
SELECT is(pg_temp.ask('iva', $$ SELECT 'ok' FROM institution.confirm_teacher_role({nina}) $$), 'ok',
  'Iva confirms Nina''s teacher role');
SELECT is(pg_temp.ask('boris', $$ SELECT e::text FROM institution.enroll_with_code('KOD-K1-TEST') e $$),
          format('(enrolled,%s)', pg_temp.id('k1')), 'Boris enrols in K1 with its code');
INSERT INTO ref VALUES ('g1', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa 1') $$)),
                       ('g2', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa 2') $$));
SELECT is(pg_temp.ask('vesna', v.sql), 'ok', v.what)
FROM (VALUES
  (1, $$ SELECT 'ok' FROM institution.set_course_holder({k1}, {vesna}) $$, 'Vesna becomes the holder of K1'),
  (2, $$ SELECT 'ok' FROM institution.assign_group_teacher({g1}, {marko}) $$, 'Marko becomes the teacher of G1'),
  (3, $$ SELECT 'ok' FROM institution.assign_group_teacher({g2}, {nina}) $$, 'Nina becomes the teacher of G2'),
  (4, $$ SELECT 'ok' FROM institution.assign_group_student({g1}, {ana}) $$, 'Ana joins G1'),
  (5, $$ SELECT 'ok' FROM institution.assign_group_student({g1}, {boris}) $$, 'Boris joins G1')
) AS v (n, sql, what) ORDER BY v.n;
DO $$ BEGIN PERFORM pg_temp.add_work('ana'); PERFORM pg_temp.add_work('dora'); END $$;

-- Stage "start": classes 1, 4 and 6. Ana's work starts at the very instant
-- of her place in G1 and of Marko's: equal is not earlier.
INSERT INTO expect VALUES
  ('start', 1, '1, 6 equal', 'marko', 'ana', 'teacher'),
  ('start', 2, '4', 'marko', 'dora', '-'),
  ('start', 3, '4', 'nina', 'dora', '-'),
  ('start', 4, '1', 'marko', NULL, 'ana,boris|ana,boris|doc-ana-z1'),
  ('start', 5, '4', 'nina', NULL, '-|-|-'),
  ('start', 6, '6 owner', 'ana', 'ana', 'owner'),
  ('start', 7, '6 course teacher', 'vesna', 'dora', 'teacher');
SELECT check_stage FROM pg_temp.check_stage('start') check_stage;

-- Istodobnost (a), a move between two reads: Marko has just read Ana's work
-- (stage "start"); a minute later Vesna moves Ana and Boris from G1 to G2.
SELECT pg_temp.tick();
SELECT is(pg_temp.ask('vesna', v.sql), 'ok', v.what)
FROM (VALUES
  (1, $$ SELECT 'ok' FROM institution.end_group_assignment({g1}, {ana}) $$, 'Ana leaves G1'),
  (2, $$ SELECT 'ok' FROM institution.assign_group_student({g2}, {ana}) $$, 'Ana joins G2'),
  (3, $$ SELECT 'ok' FROM institution.end_group_assignment({g1}, {boris}) $$, 'Boris leaves G1'),
  (4, $$ SELECT 'ok' FROM institution.assign_group_student({g2}, {boris}) $$, 'Boris joins G2')
) AS v (n, sql, what) ORDER BY v.n;

-- Stage "moved": class 2. Ana's work was started in G1: Nina, her teacher
-- now, gets nothing of it, and Marko's second read is refused.
INSERT INTO expect VALUES
  ('moved', 1, '2', 'nina', 'ana', '-'),
  ('moved', 2, '2', 'marko', 'ana', '-'),
  ('moved', 3, '2', 'nina', NULL, 'ana,boris|boris|-'),
  ('moved', 4, '2', 'marko', NULL, '-|-|-'),
  ('moved', 5, '6 owner', 'ana', 'ana', 'owner'),
  ('moved', 6, '6 course teacher', 'vesna', 'ana', 'teacher'),
  ('moved', 7, '6 course teacher', 'vesna', NULL, 'ana,boris,dora|ana,boris,dora|doc-ana-z1,doc-dora-z1');
SELECT check_stage FROM pg_temp.check_stage('moved') check_stage;
-- The three read paths the finding names, each asked on its own.
SELECT is(pg_temp.ask('nina', v.sql), v.want, v.what)
FROM (VALUES
  (1, $$ SELECT outcome FROM app.read_replay_source('doc-ana-z1') $$, 'not_found',
   'replay: read_replay_source refuses Nina Ana''s earlier work'),
  (2, format($$ SELECT outcome FROM collaboration.read_live_state('doc-ana-z1', %L) $$, repeat('0', 64)), 'ZD403: forbidden',
   'text: read_live_state refuses it'),
  (3, $$ SELECT count(*)::text FROM collaboration.list_comments('doc-ana-z1') $$, 'ZD403: forbidden',
   'comments: list_comments refuses it')
) AS v (n, sql, want, what) ORDER BY v.n;
SELECT is_empty($$ SELECT 1 FROM audit.access_log WHERE reader_id = pg_temp.id('nina') AND document_id = 'doc-ana-z1' $$,
  'no refused read of Ana''s earlier work is logged');

-- Class 3: a minute after the move Boris starts his work, in G2.
SELECT pg_temp.tick();
SELECT pg_temp.add_work('boris');
INSERT INTO expect VALUES
  ('new work', 1, '3', 'nina', 'boris', 'teacher'),
  ('new work', 2, '3', 'marko', 'boris', '-'),
  ('new work', 3, '3', 'nina', NULL, 'ana,boris|boris|doc-boris-z1'),
  ('new work', 4, '2', 'nina', 'ana', '-');
SELECT check_stage FROM pg_temp.check_stage('new work') check_stage;

-- Class 6, the boundary: Boris's work started exactly when his place in G2
-- began is his teacher's; one microsecond earlier it is not.
UPDATE evidence.project p SET created_at = g.valid_from
  FROM institution.seminar_group_member g
 WHERE p.id = 'project-doc-boris-z1' AND g.user_id = p.principal_id AND g.valid_to IS NULL;
INSERT INTO expect VALUES
  ('equal', 1, '6 equal', 'nina', 'boris', 'teacher');
SELECT check_stage FROM pg_temp.check_stage('equal') check_stage;
UPDATE evidence.project SET created_at = created_at - interval '1 microsecond' WHERE id = 'project-doc-boris-z1';
INSERT INTO expect VALUES
  ('earlier', 1, '6 one microsecond earlier', 'nina', 'boris', '-'),
  ('earlier', 2, '6 one microsecond earlier', 'nina', NULL, 'ana,boris|-|-'),
  ('earlier', 3, '6 owner', 'boris', 'boris', 'owner');
SELECT check_stage FROM pg_temp.check_stage('earlier') check_stage;
UPDATE evidence.project SET created_at = created_at + interval '1 microsecond' WHERE id = 'project-doc-boris-z1';

-- Class 5: Marko becomes a teacher of G2 next to Nina: Boris's work was
-- started before Marko's place there, Ana's before her own; a teacher of
-- both groups gets neither. Then a handover: Nina's place in G2 ends and
-- she is assigned to it again; the works started before stay closed.
SELECT pg_temp.tick();
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_teacher({g2}, {marko}) $$), 'ok',
  'Marko becomes a teacher of G2 as well');
INSERT INTO expect VALUES
  ('two groups', 1, '5', 'marko', 'ana', '-'),
  ('two groups', 2, '5', 'marko', 'boris', '-'),
  ('two groups', 3, '5', 'marko', NULL, 'ana,boris|-|-'),
  ('two groups', 4, '3', 'nina', 'boris', 'teacher');
SELECT check_stage FROM pg_temp.check_stage('two groups') check_stage;
SELECT pg_temp.tick();
SELECT is(pg_temp.ask('vesna', v.sql), 'ok', v.what)
FROM (VALUES
  (1, $$ SELECT 'ok' FROM institution.end_group_assignment({g2}, {nina}) $$, 'Vesna ends Nina''s place in G2'),
  (2, $$ SELECT 'ok' FROM institution.assign_group_teacher({g2}, {nina}) $$, 'and assigns her to G2 again')
) AS v (n, sql, what) ORDER BY v.n;
INSERT INTO expect VALUES
  ('reassigned', 1, '5', 'nina', 'boris', '-'),
  ('reassigned', 2, '5', 'nina', 'ana', '-'),
  ('reassigned', 3, '5', 'nina', NULL, 'ana,boris|-|-'),
  ('reassigned', 4, '6 owner', 'boris', 'boris', 'owner'),
  ('reassigned', 5, '6 course teacher', 'vesna', 'boris', 'teacher');
SELECT check_stage FROM pg_temp.check_stage('reassigned') check_stage;

SELECT * FROM finish();
ROLLBACK;

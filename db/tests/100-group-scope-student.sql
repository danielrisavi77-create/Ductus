-- DAN-351, M2.5-P01, repair round 1 (#1372; review c.6584047878, QA
-- c.6584136598; contract on #1091, c.6584217904): the place of a seminar
-- group teacher holds whether or not she is also a student of the course.
-- Her own work stays hers as a student, read and written, and she is never
-- the teacher of it, not even as a member of her own group.
-- One table of expected answers per stage, over every class of the contract:
--   1 group teacher only; 2 student only; 3 group teacher and student of the
--   same course, enrolled with a code; 4 teacher of G2 and student of G1;
--   5 group teacher in her own group; 6 revoked teacher who is a student.
-- Personas of institution.inc; the works, texts and group names are invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
\ir fixtures/work-reach.inc
SELECT no_plan();

-- Works on Z1 of K1, as the evidence role writes them, each with one
-- checkpoint text; added stage by stage, once the owner is a student of K1.
CREATE TEMP TABLE work (id text PRIMARY KEY, owner text);
GRANT SELECT ON work TO PUBLIC;
CREATE FUNCTION pg_temp.add_work(p_owner text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_id text := 'doc-' || p_owner || '-z1';
BEGIN
  INSERT INTO work VALUES (v_id, p_owner);
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

-- The expected answer of every row of a stage: surfaces, can() actions and
-- the lists. "teacher", "owner" and "-" stand for the three answers a work
-- can give; a list is "who|works".
CREATE TEMP TABLE expect (stage text, pos integer, class text, actor text, doc text, want text,
                          PRIMARY KEY (stage, pos));
CREATE FUNCTION pg_temp.answer(p_want text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_want
           WHEN 'teacher' THEN 'text,comments,summary,replay,checkpoints,fast_path,comment | read,comment,open_fast_path,propose'
           -- The owner opens a thread on their own work (DAN-215, D-201 t. 3(c));
           -- can('comment') stays the teacher's action.
           WHEN 'owner' THEN 'text,comments,summary,replay,checkpoints,comment | read,write'
           WHEN '-' THEN '- | -'
         END
$$;
CREATE FUNCTION pg_temp.check_stage(p_stage text) RETURNS SETOF text
LANGUAGE sql AS $$
  SELECT is(
           CASE WHEN e.doc IS NULL THEN pg_temp.lists(e.actor)
                ELSE pg_temp.reach(e.actor, 'doc-' || e.doc || '-z1') || ' | ' || pg_temp.can(e.actor, 'doc-' || e.doc || '-z1') END,
           CASE WHEN e.doc IS NULL THEN pg_temp.all_lists(split_part(e.want, '|', 1), split_part(e.want, '|', 2))
                ELSE pg_temp.answer(e.want) END,
           format('%s, class %s: %s on %s', p_stage, e.class, e.actor, coalesce(e.doc || '''s work', 'every list')))
  FROM expect e WHERE e.stage = p_stage ORDER BY e.pos
$$;

-- Setup as in 099: Iva confirms Nina; Vesna, holder of K1, opens G1 and G2,
-- Marko (teacher of K2 only) teaches G1 and Nina (of no course) G2; Ana is
-- in G1 and Dora in G2.
INSERT INTO identity.teacher_eligibility (user_id, institution_id) VALUES (pg_temp.id('nina'), pg_temp.id('fak_a'));
SELECT is(pg_temp.ask('iva', $$ SELECT 'ok' FROM institution.confirm_teacher_role({nina}) $$), 'ok',
  'Iva confirms Nina''s teacher role');
INSERT INTO ref VALUES ('g1', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa 1') $$)),
                       ('g2', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa 2') $$));
SELECT is(pg_temp.ask('vesna', v.sql), 'ok', v.what)
FROM (VALUES
  (1, $$ SELECT 'ok' FROM institution.set_course_holder({k1}, {vesna}) $$, 'Vesna becomes the holder of K1'),
  (2, $$ SELECT 'ok' FROM institution.assign_group_teacher({g1}, {marko}) $$, 'Marko becomes the teacher of G1'),
  (3, $$ SELECT 'ok' FROM institution.assign_group_teacher({g2}, {nina}) $$, 'Nina becomes the teacher of G2'),
  (4, $$ SELECT 'ok' FROM institution.assign_group_student({g1}, {ana}) $$, 'Ana joins G1'),
  (5, $$ SELECT 'ok' FROM institution.assign_group_student({g2}, {dora}) $$, 'Dora joins G2')
) AS v (n, sql, what) ORDER BY v.n;
DO $$ BEGIN PERFORM pg_temp.add_work('ana'); PERFORM pg_temp.add_work('dora'); END $$;

-- Stage "before": classes 1 and 2.
INSERT INTO expect VALUES
  ('before', 1, '1', 'marko', 'ana', 'teacher'),
  ('before', 2, '1', 'marko', 'dora', '-'),
  ('before', 3, '1', 'marko', NULL, 'ana|doc-ana-z1'),
  ('before', 4, '2', 'ana', 'ana', 'owner'),
  ('before', 5, '2', 'ana', 'dora', '-'),
  ('before', 6, '2', 'ana', NULL, '-|-');
SELECT pg_temp.check_stage('before');

-- Between two reads, Marko and Nina enrol in K1 with the code of the course
-- (Istodobnost a: the answer after the enrolment is the same for Ana's work);
-- Vesna puts Nina into G1. Each now has a work on Z1.
SELECT is(pg_temp.ask(v.who, $$ SELECT e::text FROM institution.enroll_with_code('KOD-K1-TEST') e $$),
          format('(enrolled,%s)', pg_temp.id('k1')), initcap(v.who) || ' enrols in K1 with its code')
FROM (VALUES (1, 'marko'), (2, 'nina')) AS v (n, who) ORDER BY v.n;
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_student({g1}, {nina}) $$), 'ok',
  'Nina joins G1 as a student');
DO $$ BEGIN PERFORM pg_temp.add_work('marko'); PERFORM pg_temp.add_work('nina'); END $$;

-- Stage "student": classes 3 and 4, and a course teacher and a plain
-- student next to them.
INSERT INTO expect VALUES
  ('student', 1, '3', 'marko', 'ana', 'teacher'),
  ('student', 2, '3', 'marko', 'nina', 'teacher'),
  ('student', 3, '3', 'marko', 'dora', '-'),
  ('student', 4, '3', 'marko', 'marko', 'owner'),
  ('student', 5, '3', 'marko', NULL, 'ana,nina|doc-ana-z1,doc-nina-z1'),
  ('student', 6, '4', 'nina', 'dora', 'teacher'),
  ('student', 7, '4', 'nina', 'ana', '-'),
  ('student', 8, '4', 'nina', 'marko', '-'),
  ('student', 9, '4', 'nina', 'nina', 'owner'),
  ('student', 10, '4', 'nina', NULL, 'dora|doc-dora-z1'),
  ('student', 11, '2', 'ana', 'marko', '-'),
  ('student', 12, '2', 'ana', NULL, '-|-'),
  ('student', 13, 'course teacher', 'vesna', 'marko', 'teacher'),
  ('student', 14, 'course teacher', 'vesna', NULL,
   'ana,dora,marko,nina|doc-ana-z1,doc-dora-z1,doc-marko-z1,doc-nina-z1');
SELECT pg_temp.check_stage('student');

-- Stage "own group": Vesna puts Marko into G1, the group he teaches.
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_student({g1}, {marko}) $$), 'ok',
  'Marko joins G1, his own group, as a student');
INSERT INTO expect VALUES
  ('own group', 1, '5', 'marko', 'marko', 'owner'),
  ('own group', 2, '5', 'marko', 'ana', 'teacher'),
  ('own group', 3, '5', 'marko', NULL, 'ana,nina|doc-ana-z1,doc-nina-z1'),
  ('own group', 4, '4', 'nina', 'marko', '-');
SELECT pg_temp.check_stage('own group');

-- Stage "revoked": between two reads Iva revokes Marko's teacher role
-- (Istodobnost b); his student place in K1 and in G1 stays.
SELECT is(pg_temp.ask('iva', $$ SELECT 'ok' FROM institution.revoke_teacher_role({marko}) $$), 'ok',
  'Iva revokes Marko''s teacher role');
INSERT INTO expect VALUES
  ('revoked', 1, '6', 'marko', 'ana', '-'),
  ('revoked', 2, '6', 'marko', 'nina', '-'),
  ('revoked', 3, '6', 'marko', 'marko', 'owner'),
  ('revoked', 4, '6', 'marko', NULL, '-|-'),
  ('revoked', 5, '4', 'nina', 'dora', 'teacher'),
  ('revoked', 6, 'course teacher', 'vesna', 'marko', 'teacher');
SELECT pg_temp.check_stage('revoked');

SELECT * FROM finish();
ROLLBACK;

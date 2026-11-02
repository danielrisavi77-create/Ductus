-- DAN-351, M2.5-P01 (contract on #1091, c.6582474569): a teacher of a seminar
-- group who is not a teacher of the course reaches the students and works of
-- that group only, in every list and through every read, comment, summary,
-- replay and fast-path RPC; a teacher of the course keeps the whole course.
-- Personas of institution.inc; the works, texts and group names are invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
\ir fixtures/work-reach.inc
SELECT no_plan();

-- Ana's and Dora's works on Z1 of K1, as the evidence role writes them, each
-- with one checkpoint text.
CREATE TEMP TABLE work (id text PRIMARY KEY, owner text);
INSERT INTO work VALUES ('doc-ana-z1', 'ana'), ('doc-dora-z1', 'dora');
GRANT SELECT ON work TO PUBLIC;
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id)
SELECT 'project-' || w.id, pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id(w.owner) FROM work w;
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash)
SELECT w.id, pg_temp.id('fak_a'), 'project-' || w.id, pg_temp.id(w.owner), pg_temp.text_hash() FROM work w;
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash)
SELECT w.id, pg_temp.id('fak_a'), 0, pg_temp.id(w.owner), pg_temp.text_hash() FROM work w;
INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body, content_hash, created_at)
SELECT w.id, pg_temp.id('fak_a'), 0, 'Prvi odlomak.', pg_temp.text_hash(), now() FROM work w;
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;

-- 1. The helper: not callable by the web role, owned by the identity role.
SELECT is(
  (SELECT p.proowner::regrole::text || ' ' || p.provolatile::text || ' ' || p.prosecdef::text
          || ' ' || array_to_string(p.proconfig, ',')
   FROM pg_proc p WHERE p.oid = 'institution.actor_group_student(uuid, uuid)'::regprocedure),
  'ductus_identity s false search_path=""',
  'actor_group_student is a stable invoker function of the identity role with an empty search_path');
SELECT is_empty(
  $$ SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_evidence', 'ductus_worker', 'ductus_auth', 'public']) r
      WHERE has_function_privilege(r, 'institution.actor_group_student(uuid, uuid)', 'EXECUTE') $$,
  'no role but its owner calls actor_group_student; it is reached only through the definer RPCs');

-- 2. Groups without students. Nina becomes eligible as a teacher and Iva
-- confirms her role (Nina teaches no course); Vesna, the
-- holder of K1, opens groups G1 and G2 and makes Marko (teacher of K2 only)
-- the teacher of G1 and Nina (of no course) the teacher of G2.
INSERT INTO identity.teacher_eligibility (user_id, institution_id) VALUES (pg_temp.id('nina'), pg_temp.id('fak_a'));
SELECT is(pg_temp.ask('iva', $$ SELECT 'ok' FROM institution.confirm_teacher_role({nina}) $$), 'ok',
  'Iva confirms Nina''s teacher role');
INSERT INTO ref VALUES ('g1', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa 1') $$)),
                       ('g2', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa 2') $$));
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.set_course_holder({k1}, {vesna}) $$), 'ok',
  'Vesna becomes the holder of K1');
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_teacher({g1}, {marko}) $$), 'ok',
  'Marko becomes the teacher of G1');
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_teacher({g2}, {nina}) $$), 'ok',
  'Nina becomes the teacher of G2');
SELECT is(pg_temp.lists('marko'), pg_temp.all_lists('-', '-'),
  'a group without students gives Marko nothing, never the whole course');
SELECT is(pg_temp.reach('marko', 'doc-ana-z1'), '-', 'nor any surface of Ana''s work');
SELECT is(pg_temp.can('marko', 'doc-ana-z1'), '-', 'and can() allows him nothing on it');

-- 3. Ana in G1, Dora in G2.
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_student({g1}, {ana}) $$), 'ok',
  'Ana joins G1');
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_student({g2}, {dora}) $$), 'ok',
  'Dora joins G2');
SELECT is(pg_temp.lists('vesna'), pg_temp.all_lists('ana,dora', 'doc-ana-z1,doc-dora-z1'),
  'Vesna, holder and teacher of K1, keeps the whole course in every list');
SELECT is(pg_temp.lists('marko'), pg_temp.all_lists('ana', 'doc-ana-z1'), 'Marko gets G1 only, in every list');
SELECT is(pg_temp.lists('nina'), pg_temp.all_lists('dora', 'doc-dora-z1'), 'Nina gets G2 only, in every list');
SELECT is(pg_temp.reach('marko', 'doc-ana-z1'), 'text,comments,summary,replay,checkpoints,fast_path,comment',
  'Marko reaches every surface of Ana''s work');
SELECT is(pg_temp.can('marko', 'doc-ana-z1'), 'read,comment,open_fast_path,propose',
  'can() gives Marko a teacher''s actions on Ana''s work, never write');
SELECT is(pg_temp.reach('marko', 'doc-dora-z1'), '-',
  'Dora''s work, asked by its id, is refused to Marko on every surface, not only left out of a list');
SELECT is(pg_temp.can('marko', 'doc-dora-z1'), '-', 'and can() allows him nothing on it');
SELECT is(pg_temp.reach('nina', 'doc-dora-z1'), 'text,comments,summary,replay,checkpoints,fast_path,comment',
  'Nina reaches every surface of Dora''s work');
SELECT is(pg_temp.reach('nina', 'doc-ana-z1'), '-', 'and none of Ana''s');
SELECT is(pg_temp.reach('vesna', 'doc-dora-z1'), 'text,comments,summary,replay,checkpoints,fast_path,comment',
  'Vesna reaches every surface of Dora''s work');
SELECT is(pg_temp.reach('ana', 'doc-ana-z1'), 'text,comments,summary,replay,checkpoints',
  'Ana still reaches her own work as its owner');
SELECT is(pg_temp.can('ana', 'doc-ana-z1'), 'read,write', 'and still writes it');
SELECT is(pg_temp.reach('dora', 'doc-ana-z1'), '-', 'Dora does not reach Ana''s work');
SELECT is(pg_temp.lists('dora'), pg_temp.all_lists('-', '-'), 'nor any list of the course');
SELECT is(pg_temp.reach('iva', 'doc-ana-z1'), '-', 'Iva, administrator, reads no manuscript');
SELECT is(pg_temp.lists('iva'), pg_temp.all_lists('-', '-'), 'nor any list of students');
SELECT is(pg_temp.reach('petra', 'doc-ana-z1'), '-', 'Petra, a teacher of another institution, reaches nothing');
SELECT is(pg_temp.reach('anon', 'doc-ana-z1'), '-', 'a request without a session reaches nothing');
SELECT is((SELECT count(*)::integer FROM collaboration.comment_thread
            WHERE created_by = pg_temp.id('marko') AND document_id = 'doc-ana-z1'), 1,
  'Marko''s comment is on Ana''s work');
SELECT is((SELECT array_agg(DISTINCT surface ORDER BY surface) FROM audit.access_log
            WHERE reader_id = pg_temp.id('marko') AND document_id = 'doc-ana-z1'),
  ARRAY['fast_path', 'live_view', 'process_summary', 'replay'],
  'every opening of Ana''s work by Marko is in the access log');
SELECT is_empty($$ SELECT 1 FROM audit.access_log WHERE reader_id = pg_temp.id('marko') AND document_id = 'doc-dora-z1' $$,
  'no refused read of Dora''s work is logged');

-- 4. The teacher's place in G1 ends. A group of another course (Marko's own
-- K2) gives nothing in K1.
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.end_group_assignment({g1}, {marko}) $$), 'ok',
  'Vesna ends Marko''s place in G1');
INSERT INTO ref VALUES ('gk2', pg_temp.ask('marko', $$ SELECT institution.create_seminar_group({k2}, 'Grupa K2') $$));
SELECT is(pg_temp.ask('marko', $$ SELECT 'ok' FROM institution.assign_group_teacher({gk2}, {marko}) $$), 'ok',
  'Marko is the teacher of a group of K2');
SELECT is(pg_temp.lists('marko'), pg_temp.all_lists('-', '-'), 'Marko, no longer in G1, gets no list of K1');
SELECT is(pg_temp.reach('marko', 'doc-ana-z1'), '-', 'nor any surface of Ana''s work, his own comment included');
SELECT is(pg_temp.can('marko', 'doc-ana-z1'), '-', 'and can() allows him nothing on it');
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_teacher({g1}, {marko}) $$), 'ok',
  'Vesna makes Marko the teacher of G1 again');
SELECT is(pg_temp.reach('marko', 'doc-ana-z1'), 'text,comments,summary,replay,checkpoints,fast_path,comment',
  'and he reaches Ana''s work again');

-- 5. Ana moves from G1 to G2: one work, the same id; who reaches it moves.
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_student({g2}, {ana}) $$),
  'ZD409: conflict', 'Ana is never in two groups of K1 at once');
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.end_group_assignment({g1}, {ana}) $$), 'ok',
  'Ana leaves G1');
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_student({g2}, {ana}) $$), 'ok',
  'Ana joins G2');
SELECT is((SELECT count(*)::integer FROM evidence.document WHERE principal_id = pg_temp.id('ana')), 1,
  'Ana still has one work on Z1');
SELECT is(pg_temp.lists('nina'), pg_temp.all_lists('ana,dora', 'doc-ana-z1,doc-dora-z1'),
  'Nina now gets Ana with the same work id, and Dora');
SELECT is(pg_temp.reach('nina', 'doc-ana-z1'), 'text,comments,summary,replay,checkpoints,fast_path,comment',
  'Nina reaches every surface of Ana''s work');
SELECT is(pg_temp.lists('marko'), pg_temp.all_lists('-', '-'), 'Marko, teacher of the emptied G1, gets nothing');
SELECT is(pg_temp.reach('marko', 'doc-ana-z1'), '-', 'and loses Ana''s work at once, earlier openings or not');

-- 6. Dora leaves K1 while her place in G2 stays open.
SELECT is(pg_temp.ask('vesna', $$ SELECT institution.remove_student({k1}, {dora})::text $$), 'true',
  'Vesna removes Dora from K1');
SELECT is(pg_temp.lists('nina'), pg_temp.all_lists('ana', 'doc-ana-z1'), 'Nina no longer gets Dora');
SELECT is(pg_temp.reach('nina', 'doc-dora-z1'), '-', 'nor any surface of her work');
SELECT is(pg_temp.can('nina', 'doc-dora-z1'), '-', 'and can() allows her nothing on it');

-- 7. Iva revokes Nina's teacher role.
SELECT is(pg_temp.ask('iva', $$ SELECT 'ok' FROM institution.revoke_teacher_role({nina}) $$), 'ok',
  'Iva revokes Nina''s teacher role');
SELECT is(pg_temp.lists('nina'), pg_temp.all_lists('-', '-'), 'Nina, with her role revoked, gets no list');
SELECT is(pg_temp.reach('nina', 'doc-ana-z1'), '-', 'nor any surface of Ana''s work');
SELECT is(pg_temp.can('nina', 'doc-ana-z1'), '-', 'and can() allows her nothing on it');
SELECT is(pg_temp.lists('vesna'), pg_temp.all_lists('ana', 'doc-ana-z1'), 'Vesna keeps every student of K1');

SELECT * FROM finish();
ROLLBACK;

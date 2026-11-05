-- DAN-351, M2.7-P02 (contract on #1091, c.6578617862): one decision on what
-- the actor may do with a work, institution.can(action, document). The
-- differential below compares it with the checks the RPCs make today through
-- collaboration.actor_role, over every actor of the fixtures, every work and
-- every action, before and after changes of state. Personas of
-- institution.inc and mentorship.inc; the works and group names are invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
\ir fixtures/mentorship.inc
SELECT no_plan();

-- One work per (student, assignment), as the evidence role writes them:
-- Ana and Dora on Z1 of K1, Tomo on Z3 of K3 (fak-b), Ana on zm1 (Marko
-- mentors), Dora on zm2 (ended mentorship), Boris on zm3 (Nina's teacher
-- role is not confirmed).
CREATE TEMP TABLE work (id text PRIMARY KEY, faculty text, assignment text, owner text);
INSERT INTO work VALUES
  ('doc-ana-z1', 'fak_a', 'z1', 'ana'), ('doc-dora-z1', 'fak_a', 'z1', 'dora'),
  ('doc-tomo-z3', 'fak_b', 'z3', 'tomo'), ('doc-ana-zm1', 'fak_a', 'zm1', 'ana'),
  ('doc-dora-zm2', 'fak_a', 'zm2', 'dora'), ('doc-boris-zm3', 'fak_a', 'zm3', 'boris');
GRANT SELECT ON work TO PUBLIC;
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id)
SELECT 'project-' || w.id, pg_temp.id(w.faculty), pg_temp.id(w.assignment), pg_temp.id(w.owner) FROM work w;
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash)
SELECT w.id, pg_temp.id(w.faculty), 'project-' || w.id, pg_temp.id(w.owner), repeat('a', 64) FROM work w;
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash)
SELECT w.id, pg_temp.id(w.faculty), 0, pg_temp.id(w.owner), repeat('a', 64) FROM work w;
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;
-- A work that does not exist.
INSERT INTO work VALUES ('doc-nobody', NULL, NULL, NULL);

CREATE TEMP TABLE action (name text PRIMARY KEY);
INSERT INTO action VALUES ('read'), ('comment'), ('open_fast_path'), ('write'), ('propose');

-- The new decision, as the web process calls it.
CREATE FUNCTION pg_temp.can(p_actor text, p_action text, p_doc text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format('SELECT institution.can(%L, %L)::text', p_action, p_doc))
$$;

-- The checks of today, under the owner role (which alone may call
-- document_scope and actor_role) with the same session: read is what
-- list_comments, read_live_state, thread_for_actor and the replay and summary
-- sources ask (IS NOT NULL); comment and open_fast_path what create_comment
-- and record_fast_path_opening ask (= 'teacher'); write what
-- publish_live_state asks (= 'student'). propose has no check of today: by
-- D-34 it is the teacher's action, so it is held to the teacher's check.
CREATE FUNCTION pg_temp.legacy(p_actor text, p_action text, p_doc text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask_as('ductus_identity', p_actor, format($q$
    SELECT (CASE %L WHEN 'read' THEN r IS NOT NULL
                    WHEN 'write' THEN r IS NOT DISTINCT FROM 'student'
                    ELSE r IS NOT DISTINCT FROM 'teacher' END)::text
    FROM (SELECT collaboration.actor_role(s.institution_id, s.assignment_id, s.principal_id) AS r
          FROM collaboration.document_scope(%L) s) x
  $q$, p_action, p_doc))
$$;

-- Every actor (ten people, an expired, a closed and an unknown session and no
-- cookie) by every action by every work, in one round.
CREATE TEMP TABLE cell (round text, actor text, action text, doc text, now_says text, legacy_says text);
CREATE FUNCTION pg_temp.round(p_round text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO cell
  SELECT p_round, t.name, a.name, w.id, pg_temp.can(t.name, a.name, w.id), pg_temp.legacy(t.name, a.name, w.id)
  FROM tok t CROSS JOIN action a CROSS JOIN work w
$$;
CREATE FUNCTION pg_temp.says(p_round text, p_actor text, p_action text, p_doc text) RETURNS text
LANGUAGE sql AS $$
  SELECT now_says FROM cell WHERE round = p_round AND actor = p_actor AND action = p_action AND doc = p_doc
$$;
CREATE FUNCTION pg_temp.check_round(p_round text) RETURNS SETOF text
LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEXT is((SELECT count(*)::integer FROM cell WHERE round = p_round), 14 * 5 * 7,
    p_round || ': every actor, action and work was asked');
  RETURN NEXT is_empty(format($q$
    SELECT actor || ' ' || action || ' ' || doc || ': ' || coalesce(now_says, 'null') || ' / ' || coalesce(legacy_says, 'null')
    FROM cell WHERE round = %L AND (now_says NOT IN ('true', 'false') OR legacy_says NOT IN ('true', 'false'))
  $q$, p_round), p_round || ': every answer is true or false, none is an error');
  RETURN NEXT is_empty(format($q$
    SELECT actor || ' ' || action || ' ' || doc || ': can ' || now_says || ', today ' || legacy_says
    FROM cell WHERE round = %L AND now_says IS DISTINCT FROM legacy_says
  $q$, p_round), p_round || ': can() gives what the checks of today give, in every cell');
  RETURN NEXT is_empty(format($q$
    SELECT a.name FROM action a
    WHERE NOT EXISTS (SELECT 1 FROM cell c WHERE c.round = %1$L AND c.action = a.name AND c.now_says = 'true')
       OR NOT EXISTS (SELECT 1 FROM cell c WHERE c.round = %1$L AND c.action = a.name AND c.now_says = 'false')
  $q$, p_round), p_round || ': every action is allowed somewhere and refused somewhere');
END
$$;

-- 1. The function itself.
SELECT is(
  (SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || pg_get_function_result(p.oid)
          || ' ' || p.provolatile::text || CASE WHEN p.prosecdef THEN ' definer' ELSE '' END
          || ' ' || p.proowner::regrole::text || ' ' || array_to_string(p.proconfig, ',')
   FROM pg_proc p WHERE p.oid = 'institution.can(text, text)'::regprocedure),
  'can(p_action text, p_document_id text) boolean s definer ductus_identity search_path=""',
  'can() takes the action and the work, never the actor, and is a stable definer with an empty search_path'
);
SELECT is_empty(
  $$ SELECT r.rolname FROM (SELECT rolname::text FROM pg_roles
                            WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin AND rolname NOT IN ('ductus_app', 'ductus_identity')
                            UNION ALL SELECT 'public') AS r
     WHERE has_function_privilege(r.rolname, 'institution.can(text, text)', 'EXECUTE') $$,
  'only ductus_app (and the owner) may call can()'
);
SELECT ok(has_function_privilege('ductus_app', 'institution.can(text, text)', 'EXECUTE'), 'ductus_app may call can()');

-- 2. Rows that read as the rule, before the differential that covers them all.
SELECT pg_temp.round('base');
SELECT * FROM pg_temp.check_round('base');
SELECT is(pg_temp.says('base', 'ana', 'write', 'doc-ana-z1'), 'true', 'Ana writes her work on Z1');
SELECT is(pg_temp.says('base', 'ana', 'propose', 'doc-ana-z1'), 'false', 'Ana does not propose a change to her own work');
SELECT is(pg_temp.says('base', 'dora', 'read', 'doc-ana-z1'), 'false', 'Dora, in the same course, does not read Ana''s work');
SELECT is(pg_temp.says('base', 'vesna', 'read', 'doc-ana-z1'), 'true', 'Vesna, teacher of K1, reads Ana''s work');
SELECT is(pg_temp.says('base', 'vesna', 'write', 'doc-ana-z1'), 'false', 'Vesna does not write Ana''s work: one writer');
SELECT is(pg_temp.says('base', 'vesna', 'propose', 'doc-ana-z1'), 'true', 'D-34: Vesna proposes a change to Ana''s work');
SELECT is(pg_temp.says('base', 'marko', 'read', 'doc-ana-z1'), 'false', 'Marko, teacher of K2, does not read a work of K1');
SELECT is(pg_temp.says('base', 'iva', 'read', 'doc-ana-z1'), 'false', 'Iva, administrator, does not read a work');
SELECT is(pg_temp.says('base', 'marko', 'propose', 'doc-ana-zm1'), 'true', 'D-34: Marko proposes a change to the thesis he mentors');
SELECT is(pg_temp.says('base', 'vesna', 'propose', 'doc-dora-zm2'), 'false', 'D-34: no proposal on an ended mentorship');
SELECT is(pg_temp.says('base', 'nina', 'propose', 'doc-boris-zm3'), 'false', 'D-34, D-204: no proposal from a mentor whose teacher role nobody confirmed');
SELECT is(pg_temp.says('base', 'boris', 'write', 'doc-boris-zm3'), 'true', 'Boris writes his thesis');
SELECT is(pg_temp.says('base', 'vesna', 'read', 'doc-tomo-z3'), 'false', 'Vesna does not read a work of another institution');
SELECT is(pg_temp.says('base', 'anon', 'read', 'doc-ana-z1'), 'false', 'a request without a session reads nothing');
SELECT is(pg_temp.says('base', 'closed', 'write', 'doc-ana-z1'), 'false', 'Ana''s closed session writes nothing');
SELECT is(pg_temp.says('base', 'vesna', 'read', 'doc-nobody'), 'false', 'a work that does not exist is not readable');

-- 3. Changes of state. Vesna becomes the holder of K1 (a holder is always a
-- teacher of the course, so nothing changes) and Marko a teacher of one of
-- its groups (M2.5-P01: a right over the students of that group only); Dora
-- joins the group and leaves K1 while her place in it stays open; Ana joins
-- the group; then Iva revokes Vesna's teacher role.
INSERT INTO ref VALUES ('ga', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa A') $$));
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.set_course_holder({k1}, {vesna}) $$), 'ok',
  'Vesna becomes the holder of K1');
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_teacher({ga}, {marko}) $$), 'ok',
  'Vesna makes Marko a teacher of group A of K1');
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_student({ga}, {dora}) $$), 'ok',
  'Vesna puts Dora into group A');
SELECT is(pg_temp.ask('vesna', $$ SELECT institution.remove_student({k1}, {dora})::text $$), 'true',
  'Vesna removes Dora from K1');
SELECT pg_temp.round('team');
SELECT * FROM pg_temp.check_round('team');
SELECT is(pg_temp.says('team', 'marko', 'read', 'doc-ana-z1'), 'false', 'a group teacher of K1 does not read Ana''s work: she is not in his group');
SELECT is(pg_temp.says('team', 'marko', 'propose', 'doc-ana-z1'), 'false', 'nor proposes a change to it');
SELECT is(pg_temp.says('team', 'marko', 'read', 'doc-dora-z1'), 'false', 'nor reads Dora''s, in his group but removed from K1');
SELECT is(pg_temp.says('team', 'dora', 'write', 'doc-dora-z1'), 'false', 'Dora, removed from K1, no longer writes her work there');

SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_student({ga}, {ana}) $$), 'ok',
  'Vesna puts Ana into group A');
SELECT pg_temp.round('group');
SELECT * FROM pg_temp.check_round('group');
SELECT is(pg_temp.says('group', 'marko', 'read', 'doc-ana-z1'), 'true', 'M2.5-P01: Marko, teacher of Ana''s group, reads her work');
SELECT is(pg_temp.says('group', 'marko', 'propose', 'doc-ana-z1'), 'true', 'D-34: and proposes a change to it');
SELECT is(pg_temp.says('group', 'marko', 'write', 'doc-ana-z1'), 'false', 'but never writes it: one writer');
SELECT is(pg_temp.says('group', 'iva', 'read', 'doc-ana-z1'), 'false', 'Iva, administrator, still reads no work');

SELECT is(pg_temp.ask('iva', $$ SELECT 'ok' FROM institution.revoke_teacher_role({vesna}) $$), 'ok',
  'Iva revokes Vesna''s teacher role');
SELECT pg_temp.round('revoked');
SELECT * FROM pg_temp.check_round('revoked');
SELECT is(pg_temp.says('revoked', 'vesna', 'read', 'doc-ana-z1'), 'false', 'Vesna, with her role revoked, no longer reads Ana''s work');
SELECT is(pg_temp.says('revoked', 'vesna', 'propose', 'doc-ana-z1'), 'false', 'D-204: nor proposes a change to it');
SELECT is(pg_temp.says('revoked', 'ana', 'write', 'doc-ana-z1'), 'true', 'Ana still writes her work');

-- 4. Input.
SELECT matches(pg_temp.can('ana', 'delete', 'doc-ana-z1'), '^ZD422: ', 'an unknown action is refused, not read as no');
SELECT matches(pg_temp.can('anon', 'Read', 'doc-ana-z1'), '^ZD422: ', 'the action is matched exactly, also without a session');
SELECT matches(pg_temp.ask('ana', $$ SELECT institution.can(NULL, 'doc-ana-z1')::text $$), '^ZD422: ', 'a null action is refused');
SELECT is(pg_temp.ask('ana', $$ SELECT institution.can('read', NULL)::text $$), 'false', 'a null work is not readable');
SELECT is(pg_temp.ask('ana', $$ SELECT institution.can('read', '')::text $$), 'false', 'an empty work id is not readable');

SELECT * FROM finish();
ROLLBACK;

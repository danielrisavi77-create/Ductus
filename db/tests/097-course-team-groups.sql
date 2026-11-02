-- DAN-351, M2.7-P01 (contract on #1091, c.6569002820): the holder of a
-- course and its seminar groups with their teachers and students. A model
-- only: nothing here opens a work or a course. Personas of institution.inc;
-- the group names are invented. Marko (a confirmed teacher of fak-a, not a
-- member of K1) is the group teacher; Vesna is the teacher of K1.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
SELECT no_plan();

-- A call of a function returning void reads as "ok", or "SQLSTATE: ...".
CREATE FUNCTION pg_temp.run(p_actor text, p_call text) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.ask(p_actor, 'SELECT ''ok'' FROM ' || p_call) $$;

-- What p_actor reads of the four tables through ductus_app.
CREATE FUNCTION pg_temp.team(p_actor text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, $q$
    SELECT 'holders=' || (SELECT count(*) FROM institution.course_holder)
        || ' groups=' || (SELECT count(*) FROM institution.seminar_group)
        || ' teachers=' || (SELECT count(*) FROM institution.seminar_group_teacher)
        || ' members=' || (SELECT count(*) FROM institution.seminar_group_member)
  $q$)
$$;

-- T053, written before the model: a group teacher, and a student who left
-- the course but is still in a group, get no course role from a group. If
-- actor_course_role (and with it every policy that uses it) were widened to
-- groups, these fail.
INSERT INTO ref VALUES ('ga', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa A') $$));
SELECT ok((SELECT val FROM ref WHERE name = 'ga') ~ '^[0-9a-f-]{36}$', 'Vesna creates group A of K1');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_teacher({ga}, {marko}) $$), 'ok',
  'Vesna makes Marko a teacher of group A');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_student({ga}, {dora}) $$), 'ok',
  'Vesna puts Dora into group A');
SELECT is(pg_temp.ask('vesna', $$ SELECT institution.remove_student({k1}, {dora})::text $$), 'true',
  'Vesna removes Dora from K1');
SELECT is(pg_temp.ask('marko', $$ SELECT coalesce(institution.actor_course_role({k1}), 'null') $$), 'null',
  'T053: a group teacher has no course role in K1');
SELECT is(pg_temp.ask('dora', $$ SELECT coalesce(institution.actor_course_role({k1}), 'null') $$), 'null',
  'T053: a student removed from K1 has no course role from the group she is still in');
SELECT is(pg_temp.ask('marko', $$ SELECT count(*) FROM institution.course WHERE id = {k1} $$), '0',
  'T053: a group teacher does not read K1');
SELECT is(pg_temp.ask('marko', $$ SELECT count(*) FROM institution.course_member WHERE course_id = {k1} $$), '0',
  'T053: a group teacher reads no member of K1');
SELECT is(pg_temp.ask('marko', $$ SELECT count(*) FROM institution.assignment WHERE course_id = {k1} $$), '0',
  'T053: a group teacher reads no assignment of K1');
SELECT is(pg_temp.ask('marko', $$ SELECT coalesce(institution.actor_assignment_role({z1}), 'null') $$), 'null',
  'T053: a group teacher has no assignment role in K1');
SELECT is(pg_temp.run('marko', $$ institution.assign_group_student({ga}, {ana}) $$), 'ZD403: forbidden',
  'T053: a group teacher cannot manage the group');

-- T049: a group is created once; the same name returns it.
SELECT is(pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa A')::text $$),
  (SELECT val FROM ref WHERE name = 'ga'), 'T049: the same name again returns the same group');
SELECT is((SELECT count(*)::integer FROM institution.seminar_group WHERE course_id = pg_temp.id('k1')), 1,
  'T049: K1 still has one group');
INSERT INTO ref VALUES ('gb', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa B') $$));
INSERT INTO ref VALUES ('gk3', pg_temp.ask('petra', $$ SELECT institution.create_seminar_group({k3}, 'Grupa A') $$));
SELECT is((SELECT count(*)::integer FROM institution.seminar_group), 3,
  'T049: another name is another group, and the same name in another course is allowed');
SELECT is(pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, '')::text $$), 'ZD422: invalid input',
  'T049: an empty name is refused');
SELECT is(pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, NULL)::text $$), 'ZD422: invalid input',
  'T049: a null name is refused');
SELECT is(pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, E'Grupa\u0007C')::text $$),
  'ZD422: invalid input', 'T049: a name with a control character is refused');

-- T050: the holder is an open, confirmed teacher of the course.
SELECT is(pg_temp.run('vesna', $$ institution.set_course_holder({k1}, {vesna}) $$), 'ok', 'T050: Vesna becomes holder of K1');
SELECT is(pg_temp.run('vesna', $$ institution.set_course_holder({k1}, {vesna}) $$), 'ok', 'T050: the same holder again');
SELECT is((SELECT count(*)::integer FROM institution.course_holder WHERE course_id = pg_temp.id('k1')), 1,
  'T050: repeating it adds no row');
SELECT is(pg_temp.run('vesna', $$ institution.set_course_holder({k1}, {ana}) $$), 'ZD422: invalid input',
  'T050: a student cannot be the holder');
SELECT is(pg_temp.run('vesna', $$ institution.set_course_holder({k1}, {marko}) $$), 'ZD422: invalid input',
  'T050: a teacher who is not a member of the course cannot be the holder, a group teacher included');
SELECT is(pg_temp.run('vesna', $$ institution.set_course_holder({k1}, {nobody}) $$), 'ZD422: invalid input',
  'T050: no user cannot be the holder');

-- T051: a group teacher is a confirmed teacher of the same institution.
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_teacher({ga}, {marko}) $$), 'ok', 'T051: the same teacher again');
SELECT is((SELECT count(*)::integer FROM institution.seminar_group_teacher), 1, 'T051: repeating it adds no row');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_teacher({ga}, {nina}) $$), 'ZD422: invalid input',
  'T051: an unconfirmed teacher role is refused');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_teacher({ga}, {petra}) $$), 'ZD422: invalid input',
  'T051: a teacher of another institution is refused');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_teacher({ga}, {ana}) $$), 'ZD422: invalid input',
  'T051: a student is refused');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_teacher({ga}, {iva}) $$), 'ZD422: invalid input',
  'T051: an administrator without the teacher role is refused');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_teacher({gb}, {vesna}) $$), 'ok',
  'T051: the teacher of the course may also teach a group');

-- T052: a group student is an open student of the course, in one group.
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_student({ga}, {ana}) $$), 'ok', 'T052: Ana goes into group A');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_student({ga}, {ana}) $$), 'ok', 'T052: the same place again');
SELECT is((SELECT count(*)::integer FROM institution.seminar_group_member WHERE user_id = pg_temp.id('ana')), 1,
  'T052: repeating it adds no row');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_student({gb}, {ana}) $$), 'ZD409: conflict',
  'T052: a student in group A cannot be put into group B');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_student({gb}, {dora}) $$), 'ZD422: invalid input',
  'T052: a student removed from the course is refused');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_student({gb}, {boris}) $$), 'ZD422: invalid input',
  'T052: a student outside the course is refused');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_student({gb}, {vesna}) $$), 'ZD422: invalid input',
  'T052: a teacher of the course is not a group student');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_student({gb}, {tomo}) $$), 'ZD422: invalid input',
  'T052: a student of another institution is refused');
SELECT is(pg_temp.run('petra', $$ institution.assign_group_student({gk3}, {tomo}) $$), 'ok',
  'T052: Petra puts Tomo into her group of K3');

-- T054: only a teacher of the course manages its team. A group that does
-- not exist reads as a group of another course.
SELECT is(pg_temp.ask(v.actor, format('SELECT institution.create_seminar_group({k1}, %L)::text', 'Grupa C')),
          v.expected, 'T054: create_seminar_group on K1 as ' || v.actor)
FROM (VALUES ('ana', 'ZD403: forbidden'), ('boris', 'ZD403: forbidden'), ('marko', 'ZD403: forbidden'),
             ('iva', 'ZD403: forbidden'), ('petra', 'ZD403: forbidden'), ('nina', 'ZD403: forbidden'),
             ('anon', 'ZD401: not authenticated'), ('expired', 'ZD401: not authenticated')) AS v (actor, expected);
SELECT is(pg_temp.run(v.actor, v.call), v.expected, 'T054: ' || v.note)
FROM (VALUES
  ('ana', $$ institution.set_course_holder({k1}, {vesna}) $$, 'ZD403: forbidden', 'a student cannot name the holder'),
  ('marko', $$ institution.set_course_holder({k1}, {marko}) $$, 'ZD403: forbidden', 'a group teacher cannot name himself holder'),
  ('petra', $$ institution.assign_group_teacher({ga}, {petra}) $$, 'ZD403: forbidden', 'a teacher of another institution cannot add herself'),
  ('marko', $$ institution.assign_group_teacher({ga}, {marko}) $$, 'ZD403: forbidden', 'a group teacher cannot add teachers'),
  ('boris', $$ institution.assign_group_student({ga}, {boris}) $$, 'ZD403: forbidden', 'a student cannot add himself'),
  ('ana', $$ institution.end_group_assignment({ga}, {ana}) $$, 'ZD403: forbidden', 'a student cannot leave the group herself'),
  ('marko', $$ institution.end_group_assignment({ga}, {ana}) $$, 'ZD403: forbidden', 'a group teacher cannot end a place'),
  ('vesna', $$ institution.set_course_holder({k3}, {vesna}) $$, 'ZD403: forbidden', 'Vesna cannot touch a course of another institution'),
  ('vesna', $$ institution.set_course_holder({k2}, {vesna}) $$, 'ZD403: forbidden', 'Vesna cannot touch another course'),
  ('vesna', $$ institution.assign_group_student({gk3}, {ana}) $$, 'ZD403: forbidden', 'Vesna cannot touch a group of another institution'),
  ('vesna', $$ institution.assign_group_student({nobody}, {ana}) $$, 'ZD403: forbidden', 'a group that does not exist reads as forbidden'),
  ('vesna', $$ institution.assign_group_teacher({nobody}, {marko}) $$, 'ZD403: forbidden', 'likewise for a group teacher'),
  ('vesna', $$ institution.end_group_assignment({nobody}, {ana}) $$, 'ZD403: forbidden', 'likewise for ending a place'),
  ('anon', $$ institution.assign_group_student({ga}, {ana}) $$, 'ZD401: not authenticated', 'no session is refused')
) AS v (actor, call, expected, note);

-- T055: the client writes only through the functions; nothing directly,
-- and the helper functions are not callable.
SELECT is(pg_temp.ask('vesna', v.stmt), v.expected, 'T055: ' || v.note)
FROM (VALUES
  ($$ WITH x AS (INSERT INTO institution.seminar_group (course_id, institution_id, name, created_by)
        VALUES ({k1}, {fak_a}, 'Grupa D', {vesna}) RETURNING 1) SELECT count(*) FROM x $$,
   '42501: permission denied for table seminar_group', 'Vesna cannot insert a group directly'),
  ($$ WITH x AS (UPDATE institution.course_holder SET valid_to = now() RETURNING 1) SELECT count(*) FROM x $$,
   '42501: permission denied for table course_holder', 'Vesna cannot end a holder directly'),
  ($$ WITH x AS (UPDATE institution.seminar_group_teacher SET user_id = {vesna} RETURNING 1) SELECT count(*) FROM x $$,
   '42501: permission denied for table seminar_group_teacher', 'Vesna cannot change a group teacher directly'),
  ($$ WITH x AS (DELETE FROM institution.seminar_group_member RETURNING 1) SELECT count(*) FROM x $$,
   '42501: permission denied for table seminar_group_member', 'Vesna cannot delete a group place; history stays'),
  ($$ SELECT (institution.require_course_teacher({k1})).user_id::text $$,
   '42501: permission denied for function require_course_teacher', 'the guard is not callable by the client'),
  ($$ SELECT institution.is_confirmed_teacher({marko}, {k1})::text $$,
   '42501: permission denied for function is_confirmed_teacher', 'the teacher check is not callable by the client')
) AS v (stmt, expected, note);
SELECT is(pg_temp.ask_as('ductus_migrator', 'vesna', $$ SELECT count(*) FROM institution.seminar_group_member $$),
  '42501: permission denied for table seminar_group_member', 'T055: the migrator reads no group place');
SELECT is(pg_temp.ask_as('ductus_worker', 'vesna', $$ SELECT 'ok' FROM institution.set_course_holder({k1}, {vesna}) $$),
  '42501: permission denied for schema institution', 'T055: the worker cannot reach the functions');

-- T056: the teacher of the course reads its team; anyone else the own rows.
SELECT is(pg_temp.team(v.actor), v.expected, 'T056: ' || v.actor || ' ' || v.note)
FROM (VALUES
  (1, 'vesna', 'holders=1 groups=2 teachers=2 members=2', 'reads the holder, both groups and every place in K1, nothing of K3'),
  (2, 'marko', 'holders=0 groups=0 teachers=1 members=0', 'reads only the own place as group teacher, not the group'),
  (3, 'ana', 'holders=0 groups=0 teachers=0 members=1', 'reads only the own place'),
  (4, 'dora', 'holders=0 groups=0 teachers=0 members=1', 'removed from K1, still reads the own place'),
  (5, 'boris', 'holders=0 groups=0 teachers=0 members=0', 'outside K1 reads nothing'),
  (6, 'iva', 'holders=0 groups=0 teachers=0 members=0', 'administrator reads nothing of a course team'),
  (7, 'petra', 'holders=0 groups=1 teachers=0 members=1', 'reads her own group of K3 and nothing of fak-a'),
  (8, 'tomo', 'holders=0 groups=0 teachers=0 members=1', 'reads only the own place in K3'),
  (9, 'anon', 'holders=0 groups=0 teachers=0 members=0', 'no session reads nothing')
) AS v (n, actor, expected, note)
ORDER BY v.n;
SELECT is(pg_temp.ask('vesna', $$ SELECT string_agg(name, ', ' ORDER BY name) FROM institution.seminar_group $$),
  'Grupa A, Grupa B', 'T056: Vesna reads the names of the groups of K1');

-- T057: ending a place keeps the row; the student may then go elsewhere.
SELECT is(pg_temp.run('vesna', $$ institution.end_group_assignment({ga}, {ana}) $$), 'ok', 'T057: Vesna ends Ana''s place in A');
SELECT is(pg_temp.run('vesna', $$ institution.end_group_assignment({ga}, {ana}) $$), 'ok', 'T057: ending it again changes nothing');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_student({gb}, {ana}) $$), 'ok', 'T057: Ana may now go into group B');
SELECT is(
  (SELECT string_agg(CASE WHEN m.group_id = pg_temp.id('ga') THEN 'A' ELSE 'B' END
                     || CASE WHEN m.valid_to IS NULL THEN '' ELSE '(ended)' END, ' ' ORDER BY m.valid_to IS NULL, m.group_id)
   FROM institution.seminar_group_member m WHERE m.user_id = pg_temp.id('ana')),
  'A(ended) B', 'T057: both places of Ana stay, the first one ended');
SELECT is(pg_temp.run('vesna', $$ institution.end_group_assignment({ga}, {marko}) $$), 'ok', 'T057: Vesna ends Marko''s place');
SELECT is(pg_temp.ask('marko', $$ SELECT count(*) || '/' || count(*) FILTER (WHERE valid_to IS NULL)
                                  FROM institution.seminar_group_teacher $$),
  '1/0', 'T057: Marko still reads his ended place, and none open');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_teacher({ga}, {marko}) $$), 'ok', 'T057: Marko may be added again');
SELECT is((SELECT count(*)::integer FROM institution.seminar_group_teacher WHERE user_id = pg_temp.id('marko')), 2,
  'T057: as a new row beside the ended one');

-- T050 (end): a new holder ends the previous one. Marko becomes a teacher of
-- K1 here, so this comes after every check that he is not.
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('marko'), 'teacher');
SELECT is(pg_temp.run('vesna', $$ institution.set_course_holder({k1}, {marko}) $$), 'ok', 'T050: Marko becomes holder of K1');
SELECT is(
  (SELECT string_agg(p.name || CASE WHEN h.valid_to IS NULL THEN '' ELSE '(ended)' END, ' ' ORDER BY h.valid_to IS NULL, p.name)
   FROM institution.course_holder h JOIN person p ON p.id = h.user_id WHERE h.course_id = pg_temp.id('k1')),
  'vesna(ended) marko', 'T050: Vesna''s row stays, ended; Marko is the one open holder');
SELECT is(
  (SELECT string_agg(p.name, ' ') FROM institution.course_holder h JOIN person p ON p.id = h.assigned_by
   WHERE h.course_id = pg_temp.id('k1') AND h.valid_to IS NULL),
  'vesna', 'T050: the row names who made the change');

SELECT * FROM finish();
ROLLBACK;

-- DAN-351, M2.7-P03 (contract on #1091, c.6584738431): the editor of a
-- course, the substitution of a team member and the recipients of a
-- notification about a student's work. Written before the migration; the
-- input classes 1-7 of the contract are the sections below. Personas of
-- institution.inc plus Luka, an invented confirmed teacher of fak-a who is
-- in no course. Marko is made a second teacher of K1; Boris gets a
-- confirmed teacher role and is enrolled as a student of K1 (class 6); Nina
-- (unconfirmed) is made a teacher member of K1.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
SELECT no_plan();

INSERT INTO person VALUES
  ('luka', '00000000-0000-4000-8000-000000000111', pg_temp.id('fak_a'), 'fak-a');
INSERT INTO ref VALUES ('luka', '00000000-0000-4000-8000-000000000111');
INSERT INTO tok VALUES ('luka', repeat('L', 43));
INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
VALUES (pg_temp.id('luka'), pg_temp.id('fak_a'), 'https://issuer.test', 'sub-luka', 'luka@fak-a.example');
INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
VALUES (sha256(convert_to(repeat('L', 43), 'UTF8')), pg_temp.id('luka'), pg_temp.id('fak_a'), now() + interval '1 hour');
INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_by, confirmed_at)
SELECT pg_temp.id('fak_a'), pg_temp.id(n), 'teacher', pg_temp.id('iva'), now() FROM unnest(ARRAY['luka', 'boris']) n;
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('marko'), 'teacher'),
       (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('nina'), 'teacher'),
       (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('boris'), 'student');

-- A call of a function returning void reads as "ok", or "SQLSTATE: ...".
CREATE FUNCTION pg_temp.run(p_actor text, p_call text) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.ask(p_actor, 'SELECT ''ok'' FROM ' || p_call) $$;

-- The recipients for a work of p_student in K1, sorted names, '-' if none.
-- Read by the test's own role: no application role may call the function.
CREATE FUNCTION pg_temp.to(p_student text) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(coalesce(p.name, r::text), ',' ORDER BY p.name), '-')
  FROM institution.team_notification_recipients(pg_temp.id('k1'), pg_temp.id(p_student)) r
  LEFT JOIN person p ON p.id = r
$$;

-- Each row: label, actor, call, expected. Run in order; the refusals leave
-- the state as it was.
CREATE FUNCTION pg_temp.table_is(p_rows text[][]) RETURNS SETOF text
LANGUAGE plpgsql AS $$
DECLARE
  i integer;
BEGIN
  FOR i IN 1 .. array_length(p_rows, 1) LOOP
    RETURN NEXT is(pg_temp.run(p_rows[i][2], p_rows[i][3]), p_rows[i][4], p_rows[i][1]);
  END LOOP;
END
$$;

-- Group A of K1: Ana and Boris are its students, Boris (a student of K1)
-- and Luka (no course member) its teachers.
INSERT INTO ref VALUES ('ga', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa A') $$));
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_student({ga}, {ana}) $$), 'ok', 'Ana is in group A');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_student({ga}, {boris}) $$), 'ok', 'Boris is in group A');

-- No application role calls the reader.
SELECT is(pg_temp.ask('vesna', $$ SELECT count(*) FROM institution.team_notification_recipients({k1}, {ana}) $$),
  '42501: permission denied for function team_notification_recipients', 'ductus_app cannot read the recipients');

-- Class 1, no editor: no group teacher, no editor, no holder gives every
-- valid teacher of K1. Nina (unconfirmed) and Boris (a student) are not team.
SELECT is(pg_temp.to('ana'), 'marko,vesna', 'class 1: without group, editor or holder, all valid teachers of K1');
SELECT is(pg_temp.to('dora'), 'marko,vesna', 'class 1: the same for a student in no group');
SELECT is(pg_temp.to('tomo'), '-', 'class 1: a student of another course has no recipient in K1');
SELECT is(pg_temp.to('nobody'), '-', 'class 1: no user has no recipient');
SELECT is(pg_temp.to('marko'), '-', 'class 1: a teacher of K1 is not a student of it');
SELECT is(pg_temp.run('vesna', $$ institution.set_course_holder({k1}, {vesna}) $$), 'ok', 'Vesna is holder of K1');
SELECT is(pg_temp.to('ana'), 'vesna', 'class 1: without editor, the holder');

-- Class 7 (caller) and class 5 (recipient outside the team) for the editor.
SELECT pg_temp.table_is(ARRAY[
  ['class 7: a student cannot name the editor', 'ana', $$ institution.set_course_editor({k1}, {marko}) $$, 'ZD403: forbidden'],
  ['class 7: a student who is a teacher cannot', 'boris', $$ institution.set_course_editor({k1}, {marko}) $$, 'ZD403: forbidden'],
  ['class 7: a group teacher cannot', 'luka', $$ institution.set_course_editor({k1}, {marko}) $$, 'ZD403: forbidden'],
  ['class 7: an unconfirmed teacher member cannot', 'nina', $$ institution.set_course_editor({k1}, {marko}) $$, 'ZD403: forbidden'],
  ['class 7: an administrator cannot', 'iva', $$ institution.set_course_editor({k1}, {marko}) $$, 'ZD403: forbidden'],
  ['class 7: a teacher of another institution cannot', 'petra', $$ institution.set_course_editor({k1}, {marko}) $$, 'ZD403: forbidden'],
  ['class 7: a course that does not exist', 'vesna', $$ institution.set_course_editor({nobody}, {marko}) $$, 'ZD403: forbidden'],
  ['class 7: a null course', 'vesna', $$ institution.set_course_editor(NULL, {marko}) $$, 'ZD403: forbidden'],
  ['class 7: no session', 'anon', $$ institution.set_course_editor({k1}, {marko}) $$, 'ZD401: not authenticated'],
  ['class 7: ending the editor needs a teacher', 'ana', $$ institution.end_course_editor({k1}) $$, 'ZD403: forbidden'],
  ['class 5: a student cannot be the editor', 'vesna', $$ institution.set_course_editor({k1}, {ana}) $$, 'ZD422: invalid input'],
  ['class 6: a student with a teacher role cannot be the editor', 'vesna', $$ institution.set_course_editor({k1}, {boris}) $$, 'ZD422: invalid input'],
  ['class 5: a group teacher cannot be the editor', 'vesna', $$ institution.set_course_editor({k1}, {luka}) $$, 'ZD422: invalid input'],
  ['class 5: an unconfirmed teacher member cannot be the editor', 'vesna', $$ institution.set_course_editor({k1}, {nina}) $$, 'ZD422: invalid input'],
  ['class 5: an administrator cannot be the editor', 'vesna', $$ institution.set_course_editor({k1}, {iva}) $$, 'ZD422: invalid input'],
  ['class 5: a teacher of another institution cannot be the editor', 'vesna', $$ institution.set_course_editor({k1}, {petra}) $$, 'ZD422: invalid input'],
  ['class 5: no user cannot be the editor', 'vesna', $$ institution.set_course_editor({k1}, {nobody}) $$, 'ZD422: invalid input'],
  ['class 5: a null editor', 'vesna', $$ institution.set_course_editor({k1}, NULL) $$, 'ZD422: invalid input']
]);
SELECT is((SELECT count(*)::integer FROM institution.course_editor), 0, 'class 5 and 7: no refusal wrote an editor');

-- Class 2, two editors.
SELECT is(pg_temp.run('vesna', $$ institution.set_course_editor({k1}, {marko}) $$), 'ok', 'class 2: Marko is editor');
SELECT is(pg_temp.to('dora'), 'marko', 'class 2: the editor before the holder');
SELECT is(pg_temp.run('marko', $$ institution.set_course_editor({k1}, {marko}) $$), 'ok', 'class 2: the same editor again');
SELECT is((SELECT count(*)::integer FROM institution.course_editor), 1, 'class 2: repeating it adds no row');
SELECT is(pg_temp.run('marko', $$ institution.set_course_editor({k1}, {vesna}) $$), 'ok', 'class 2: Vesna replaces Marko');
SELECT is(
  (SELECT string_agg(p.name || CASE WHEN e.valid_to IS NULL THEN '' ELSE '(ended)' END, ' '
                     ORDER BY e.valid_to IS NULL, p.name)
   FROM institution.course_editor e JOIN person p ON p.id = e.user_id),
  'marko(ended) vesna', 'class 2: one open editor, the replaced one ended');
SELECT throws_ok(
  $$ INSERT INTO institution.course_editor (course_id, institution_id, user_id, assigned_by)
     VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('marko'), pg_temp.id('vesna')) $$,
  '23505', NULL, 'class 2: a second open editor is refused even to the owner');
SELECT is(pg_temp.run('vesna', $$ institution.set_course_editor({k1}, {marko}) $$), 'ok', 'class 2: Marko is editor again');

-- Istodobnost: a read, the end of the editor, a second read.
SELECT is(pg_temp.to('dora'), 'marko', 'Istodobnost: first read, with the editor');
SELECT is(pg_temp.run('vesna', $$ institution.end_course_editor({k1}) $$), 'ok', 'Istodobnost: Vesna ends the editor');
SELECT is(pg_temp.to('dora'), 'vesna', 'Istodobnost: the second read falls to the holder');
SELECT is(pg_temp.run('vesna', $$ institution.end_course_editor({k1}) $$), 'ok', 'ending no editor changes nothing');
SELECT is(pg_temp.run('vesna', $$ institution.set_course_editor({k1}, {marko}) $$), 'ok', 'Marko is editor again');

-- Reads through RLS.
SELECT is(pg_temp.ask('vesna', 'SELECT count(*) FROM institution.course_editor'), '4', 'a teacher of K1 reads every editor row');
SELECT is(pg_temp.ask('marko', 'SELECT count(*) FROM institution.course_editor'), '4', 'the editor, a teacher of K1, too');
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM institution.course_editor'), '0', 'a student reads no editor row');
SELECT is(pg_temp.ask('luka', 'SELECT count(*) FROM institution.course_editor'), '0', 'a group teacher reads no editor row');
SELECT is(pg_temp.ask('petra', 'SELECT count(*) FROM institution.course_editor'), '0', 'another institution reads none');
SELECT is(pg_temp.ask('vesna', $$ INSERT INTO institution.course_editor (course_id, institution_id, user_id, assigned_by)
  VALUES ({k1}, {fak_a}, {vesna}, {vesna}) RETURNING 'written' $$),
  '42501: permission denied for table course_editor', 'ductus_app does not write editors');
SELECT is(pg_temp.ask('vesna', $$ UPDATE institution.team_substitution SET ended_at = now() RETURNING 'written' $$),
  '42501: permission denied for table team_substitution', 'ductus_app does not write substitutions');

-- Class 6: Boris, a student of K1 and a teacher of group A, is no recipient,
-- not for Ana and not for himself; group A then falls to the editor.
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_teacher({ga}, {boris}) $$), 'ok', 'Boris teaches group A');
SELECT is(pg_temp.to('ana'), 'marko', 'class 6: a group with only a student as teacher falls to the editor');
SELECT is(pg_temp.to('boris'), 'marko', 'class 6: and Boris is not his own recipient');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_teacher({ga}, {luka}) $$), 'ok', 'Luka teaches group A');
SELECT is(pg_temp.to('ana'), 'luka', 'the teachers of the group come first');
SELECT is(pg_temp.to('boris'), 'luka', 'class 6: Boris gets Luka, never himself');
SELECT is(pg_temp.to('dora'), 'marko', 'a student in no group keeps the editor');

-- Class 3 (substitution that expires) and class 5 for substitutions.
SELECT pg_temp.table_is(ARRAY[
  ['class 7: a student cannot name a substitute', 'ana', $$ institution.set_team_substitution({k1}, {luka}, {vesna}, now() + interval '7 days') $$, 'ZD403: forbidden'],
  ['class 7: a group teacher cannot', 'luka', $$ institution.set_team_substitution({k1}, {luka}, {vesna}, now() + interval '7 days') $$, 'ZD403: forbidden'],
  ['class 7: another institution cannot', 'petra', $$ institution.set_team_substitution({k1}, {luka}, {vesna}, now() + interval '7 days') $$, 'ZD403: forbidden'],
  ['class 7: no session', 'anon', $$ institution.set_team_substitution({k1}, {luka}, {vesna}, now() + interval '7 days') $$, 'ZD401: not authenticated'],
  ['class 6: a student with a teacher role cannot substitute', 'vesna', $$ institution.set_team_substitution({k1}, {luka}, {boris}, now() + interval '7 days') $$, 'ZD422: invalid input'],
  ['class 5: an unconfirmed teacher cannot substitute', 'vesna', $$ institution.set_team_substitution({k1}, {luka}, {nina}, now() + interval '7 days') $$, 'ZD422: invalid input'],
  ['class 5: an administrator cannot substitute', 'vesna', $$ institution.set_team_substitution({k1}, {luka}, {iva}, now() + interval '7 days') $$, 'ZD422: invalid input'],
  ['class 5: a teacher of another institution cannot substitute', 'vesna', $$ institution.set_team_substitution({k1}, {luka}, {petra}, now() + interval '7 days') $$, 'ZD422: invalid input'],
  ['class 5: a student cannot substitute', 'vesna', $$ institution.set_team_substitution({k1}, {luka}, {ana}, now() + interval '7 days') $$, 'ZD422: invalid input'],
  ['class 5: no user cannot substitute', 'vesna', $$ institution.set_team_substitution({k1}, {luka}, {nobody}, now() + interval '7 days') $$, 'ZD422: invalid input'],
  ['class 5: nobody substitutes for himself', 'vesna', $$ institution.set_team_substitution({k1}, {luka}, {luka}, now() + interval '7 days') $$, 'ZD422: invalid input'],
  ['class 5: the absent must be in the team', 'vesna', $$ institution.set_team_substitution({k1}, {dora}, {vesna}, now() + interval '7 days') $$, 'ZD422: invalid input'],
  ['class 6: the absent cannot be a student of the course', 'vesna', $$ institution.set_team_substitution({k1}, {boris}, {vesna}, now() + interval '7 days') $$, 'ZD422: invalid input'],
  ['class 5: an unconfirmed absent is not in the team', 'vesna', $$ institution.set_team_substitution({k1}, {nina}, {vesna}, now() + interval '7 days') $$, 'ZD422: invalid input'],
  ['class 3: an end in the past', 'vesna', $$ institution.set_team_substitution({k1}, {luka}, {vesna}, now() - interval '1 second') $$, 'ZD422: invalid input'],
  ['class 3: an end now', 'vesna', $$ institution.set_team_substitution({k1}, {luka}, {vesna}, now()) $$, 'ZD422: invalid input'],
  ['class 3: no end', 'vesna', $$ institution.set_team_substitution({k1}, {luka}, {vesna}, NULL) $$, 'ZD422: invalid input'],
  ['class 3: an end after more than a year', 'vesna', $$ institution.set_team_substitution({k1}, {luka}, {vesna}, now() + interval '1 year 1 second') $$, 'ZD422: invalid input'],
  ['class 7: ending a substitution that does not exist', 'vesna', $$ institution.end_team_substitution({nobody}) $$, 'ZD403: forbidden'],
  ['class 7: ending a null substitution', 'vesna', $$ institution.end_team_substitution(NULL) $$, 'ZD403: forbidden']
]);
SELECT is((SELECT count(*)::integer FROM institution.team_substitution), 0, 'class 3 and 5: no refusal wrote a substitution');

INSERT INTO ref VALUES ('s1', pg_temp.ask('vesna',
  $$ SELECT institution.set_team_substitution({k1}, {luka}, {vesna}, date_trunc('second', now()) + interval '7 days') $$));
SELECT ok((SELECT val FROM ref WHERE name = 's1') ~ '^[0-9a-f-]{36}$', 'class 3: Vesna substitutes for Luka for a week');
SELECT is(pg_temp.to('ana'), 'vesna', 'class 3: a valid substitution replaces the recipient');
SELECT is(pg_temp.ask('marko',
  $$ SELECT institution.set_team_substitution({k1}, {luka}, {vesna}, date_trunc('second', now()) + interval '7 days')::text $$),
  (SELECT val FROM ref WHERE name = 's1'), 'class 3: the same call returns the same substitution');
SELECT is(pg_temp.ask('luka', 'SELECT count(*) FROM institution.team_substitution'), '1', 'the absent reads the own substitution');
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM institution.team_substitution'), '0', 'a student reads no substitution');
SELECT is(pg_temp.ask('petra', 'SELECT count(*) FROM institution.team_substitution'), '0', 'another institution reads none');
-- Istodobnost: the recipients are read again from the current state. A
-- read, an end of the substitution, a second read: the second read does not
-- return the substitute.
SELECT is(pg_temp.run('ana', $$ institution.end_team_substitution({s1}) $$), 'ZD403: forbidden',
  'class 7: a student cannot end a substitution');
SELECT is(pg_temp.to('ana'), 'vesna', 'Istodobnost: first read, with the substitution');
SELECT is(pg_temp.run('vesna', $$ institution.end_team_substitution({s1}) $$), 'ok', 'Istodobnost: Vesna ends it');
SELECT is(pg_temp.to('ana'), 'luka', 'Istodobnost: the second read returns the absent again');
SELECT is(pg_temp.run('vesna', $$ institution.end_team_substitution({s1}) $$), 'ok', 'ending it again changes nothing');
SELECT is((SELECT count(*)::integer FROM institution.team_substitution WHERE ended_at IS NULL), 0,
  'class 3: the ended substitution stays as history');

-- A new substitution of the same absent ends the previous one.
INSERT INTO ref VALUES ('s2', pg_temp.ask('vesna',
  $$ SELECT institution.set_team_substitution({k1}, {luka}, {marko}, now() + interval '3 days') $$));
INSERT INTO ref VALUES ('s3', pg_temp.ask('vesna',
  $$ SELECT institution.set_team_substitution({k1}, {luka}, {vesna}, now() + interval '4 days') $$));
SELECT isnt((SELECT val FROM ref WHERE name = 's3'), (SELECT val FROM ref WHERE name = 's2'),
  'class 3: another end is another substitution');
SELECT is((SELECT string_agg(p.name || CASE WHEN s.ended_at IS NULL THEN '' ELSE '(ended)' END, ' '
                             ORDER BY s.ended_at IS NULL, s.valid_to)
           FROM institution.team_substitution s JOIN person p ON p.id = s.substitute_id),
  'marko(ended) vesna(ended) vesna', 'class 3: one open substitution per absent');
SELECT is(pg_temp.to('ana'), 'vesna', 'class 3: the newer substitution applies');
SELECT is(pg_temp.run('vesna', $$ institution.end_team_substitution({s3}) $$), 'ok', 'Vesna ends it');

-- Class 3: a substitution that ended on its valid_to, or has not begun, does
-- not apply. Written by the owner, as no call can write either.
INSERT INTO institution.team_substitution (course_id, institution_id, absent_id, substitute_id, assigned_by, valid_from, valid_to)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('luka'), pg_temp.id('vesna'), pg_temp.id('vesna'),
        now() - interval '2 days', now());
SELECT is(pg_temp.to('ana'), 'luka', 'class 3: valid_to = now() is already over');
UPDATE institution.team_substitution SET ended_at = now() WHERE ended_at IS NULL;
INSERT INTO institution.team_substitution (course_id, institution_id, absent_id, substitute_id, assigned_by, valid_from, valid_to)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('luka'), pg_temp.id('vesna'), pg_temp.id('vesna'),
        now() + interval '1 hour', now() + interval '2 hours');
SELECT is(pg_temp.to('ana'), 'luka', 'class 3: a substitution that has not begun does not apply');
SELECT throws_ok(
  $$ INSERT INTO institution.team_substitution (course_id, institution_id, absent_id, substitute_id, assigned_by, valid_to)
     VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('luka'), pg_temp.id('marko'), pg_temp.id('vesna'),
             now() + interval '1 day') $$,
  '23505', NULL, 'class 3: a second open substitution of the same absent is refused even to the owner');
SELECT throws_ok(
  $$ INSERT INTO institution.team_substitution (course_id, institution_id, absent_id, substitute_id, assigned_by, valid_to)
     VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('vesna'), pg_temp.id('vesna'), pg_temp.id('vesna'),
             now() + interval '1 day') $$,
  '23514', NULL, 'class 5: nobody substitutes for himself, even when the owner writes it');
UPDATE institution.team_substitution SET ended_at = valid_from WHERE ended_at IS NULL;

-- Class 4 and Istodobnost: a read, a revocation of the substitute's teacher
-- role, a second read. The second read keeps the absent; the revoked editor
-- leaves the student in no group to the holder.
INSERT INTO ref VALUES ('s4', pg_temp.ask('vesna',
  $$ SELECT institution.set_team_substitution({k1}, {luka}, {marko}, now() + interval '7 days') $$));
SELECT is(pg_temp.to('ana'), 'marko', 'Istodobnost: first read, Marko substitutes for Luka');
SELECT is(pg_temp.to('dora'), 'marko', 'Istodobnost: first read, Marko is the editor');
SELECT is(pg_temp.ask('iva', $$ SELECT institution.revoke_teacher_role({marko})::text $$), 'true',
  'Istodobnost: Iva revokes Marko''s teacher role');
SELECT is(pg_temp.to('ana'), 'luka', 'class 4: a revoked substitute gives the absent back');
SELECT is(pg_temp.to('dora'), 'vesna', 'class 4: a revoked editor leaves it to the holder');
SELECT is(pg_temp.run('vesna', $$ institution.set_course_editor({k1}, {marko}) $$), 'ZD422: invalid input',
  'class 4: a revoked teacher cannot be named editor');
SELECT is(pg_temp.run('vesna', $$ institution.set_team_substitution({k1}, {luka}, {marko}, now() + interval '1 day') $$),
  'ZD422: invalid input', 'class 4: nor substitute');

-- Class 4: Luka's place in group A ends. The group is left with Boris, who
-- is no team member, so it falls to the editor (revoked) and then the holder.
SELECT is(pg_temp.run('vesna', $$ institution.end_group_assignment({ga}, {luka}) $$), 'ok', 'Luka leaves group A');
SELECT is(pg_temp.to('ana'), 'vesna', 'class 4: an ended group teacher opens the next level');

-- Class 4 and 1: the holder's membership ends. No valid teacher is left in
-- K1 (Marko revoked, Nina unconfirmed, Boris a student), and only then is
-- the set empty.
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('vesna');
SELECT is(pg_temp.to('ana'), '-', 'class 1 and 4: no valid teacher, no recipient');
SELECT is(pg_temp.to('dora'), '-', 'class 1 and 4: the same for a student in no group');

SELECT * FROM finish();
ROLLBACK;

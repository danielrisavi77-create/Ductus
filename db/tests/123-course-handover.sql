-- DAN-351, M2.7-P04a (contract on #1836, c.6789848494; D-265 Q19): only an
-- administrator of the course's institution hands a held course over. One
-- transaction ends the previous holder, opens the new one, leaves one
-- append-only trail row and notifies the open students of the course without
-- a name or any content. Personas of institution.inc; nothing here is real.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
SELECT no_plan();

-- The fixture's assignment version 2 already notified; only handovers count here.
CREATE FUNCTION pg_temp.trail() RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT count(*) FROM audit.course_handover $$;
CREATE FUNCTION pg_temp.notified() RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT count(*) FROM institution.notification WHERE kind = 'course_handover' $$;
CREATE FUNCTION pg_temp.holders(p_course text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT string_agg(p.name || CASE WHEN h.valid_to IS NULL THEN '' ELSE '(ended)' END, ' '
                    ORDER BY h.valid_to IS NULL, h.valid_from, p.name)
  FROM institution.course_holder h JOIN person p ON p.id = h.user_id WHERE h.course_id = pg_temp.id(p_course)
$$;
-- A handover as p_actor: the trail id is read as "id", NULL as "null".
CREATE FUNCTION pg_temp.hand(p_actor text, p_course text, p_holder text) RETURNS text
LANGUAGE sql AS $$
  SELECT regexp_replace(pg_temp.ask(p_actor, format(
    'SELECT coalesce(institution.hand_over_course(%s, %s)::text, ''null'')', p_course, p_holder)),
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', 'id')
$$;

-- Setup. Vesna names herself the first holder of K1, which a course teacher
-- still may. Marko is a group teacher of K1 and not yet on its course team.
-- Nina (unconfirmed) is on the team. Iva gets a confirmed teacher role and a
-- place on the team, so that only the rule against handing to oneself stops
-- her. Boris was a student of K1 and left it.
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.set_course_holder({k1}, {vesna}) $$), 'ok',
  'a course teacher still names the first holder');
INSERT INTO ref VALUES ('ga', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa A') $$));
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_teacher({ga}, {marko}) $$), 'ok',
  'Marko becomes a group teacher of K1');
INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at)
VALUES (pg_temp.id('fak_a'), pg_temp.id('iva'), 'teacher', now());
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
SELECT pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id(n), r
FROM (VALUES ('nina', 'teacher'), ('iva', 'teacher'), ('boris', 'student')) AS m (n, r);
SELECT is(pg_temp.ask('vesna', $$ SELECT institution.remove_student({k1}, {boris})::text $$), 'true',
  'Boris leaves K1');

-- Every refused class of caller and input: nothing is written by any of them.
SELECT is(pg_temp.hand(c.actor, c.course, c.holder), c.expected, 'refused: ' || c.note)
FROM (VALUES
  (1, 'anon', '{k1}', '{marko}', 'ZD401: not authenticated', 'a request without a session'),
  (2, 'ana', '{k1}', '{vesna}', 'ZD403: forbidden', 'a student of the course'),
  (3, 'vesna', '{k1}', '{nina}', 'ZD403: forbidden', 'the teacher and holder of the course'),
  (4, 'marko', '{k1}', '{vesna}', 'ZD403: forbidden', 'a group teacher of the course'),
  (5, 'petra', '{k1}', '{vesna}', 'ZD403: forbidden', 'a teacher of another institution'),
  (6, 'lea', '{k1}', '{vesna}', 'ZD403: forbidden', 'the administrator of another institution'),
  (7, 'lea', '{k3}', '{lea}', 'ZD403: forbidden', 'an administrator naming herself'),
  (8, 'iva', '{k1}', '{iva}', 'ZD403: forbidden', 'an administrator naming herself, though a confirmed course teacher'),
  (9, 'iva', '{nobody}', '{vesna}', 'ZD403: forbidden', 'a course that does not exist'),
  (10, 'iva', 'NULL', '{vesna}', 'ZD403: forbidden', 'no course'),
  (11, 'iva', '{k3}', '{petra}', 'ZD403: forbidden', 'a course of another institution'),
  (12, 'iva', '{k1}', 'NULL', 'ZD422: invalid input', 'no holder'),
  (13, 'iva', '{k1}', '{nobody}', 'ZD422: invalid input', 'a holder who does not exist'),
  (14, 'iva', '{k1}', '{ana}', 'ZD422: invalid input', 'a student as holder'),
  (15, 'iva', '{k1}', '{boris}', 'ZD422: invalid input', 'a former student as holder'),
  (16, 'iva', '{k1}', '{nina}', 'ZD422: invalid input', 'a course teacher whose role nobody confirmed'),
  (17, 'iva', '{k1}', '{marko}', 'ZD422: invalid input', 'a confirmed teacher who is only a group teacher'),
  (18, 'iva', '{k1}', '{petra}', 'ZD422: invalid input', 'a teacher of another institution'),
  (19, 'iva', '{k1}', '{vesna}', 'null', 'the present holder again changes nothing')
) AS c (n, actor, course, holder, expected, note)
ORDER BY c.n;
SELECT is(pg_temp.holders('k1'), 'vesna', 'Vesna is still the one holder of K1');
SELECT is(pg_temp.trail(), 0::bigint, 'no refused call left a trail row');
SELECT is(pg_temp.notified(), 0::bigint, 'no refused call notified anyone');

-- The handover. Marko joins the course team first.
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('marko'), 'teacher');
INSERT INTO ref VALUES ('h1', pg_temp.ask('iva', $$ SELECT institution.hand_over_course({k1}, {marko}) $$));
SELECT is((SELECT val FROM ref WHERE name = 'h1'), (SELECT id::text FROM audit.course_handover),
  'Iva hands K1 over to Marko and gets the trail row back');
SELECT is(pg_temp.holders('k1'), 'vesna(ended) marko', 'Vesna''s row stays, ended; Marko is the one open holder');
SELECT is(
  (SELECT p.name FROM institution.course_holder h JOIN person p ON p.id = h.assigned_by
   WHERE h.course_id = pg_temp.id('k1') AND h.valid_to IS NULL),
  'iva', 'the new holder row names the administrator');
SELECT ok(
  (SELECT n.valid_from >= o.valid_to FROM institution.course_holder n, institution.course_holder o
   WHERE n.course_id = pg_temp.id('k1') AND n.valid_to IS NULL AND o.course_id = n.course_id AND o.valid_to IS NOT NULL),
  'the new holder begins where the previous one ended');
SELECT is(
  (SELECT string_agg(f.name || '>' || t.name || ' by ' || a.name || ' in ' || (e.course_id = pg_temp.id('k1'))::text
                     || ' ' || (e.institution_id = pg_temp.id('fak_a'))::text, ', ')
   FROM audit.course_handover e
   JOIN person f ON f.id = e.from_holder_id JOIN person t ON t.id = e.to_holder_id JOIN person a ON a.id = e.actor_id),
  'vesna>marko by iva in true true', 'one trail row: from, to, who, which course and institution');
SELECT is(
  (SELECT string_agg(p.name, ' ' ORDER BY p.name) FROM institution.notification n JOIN person p ON p.id = n.recipient_id
   WHERE n.kind = 'course_handover'),
  'ana dora', 'the open students of K1 are notified; not Boris who left, nor the teachers, nor K3');
SELECT is(
  (SELECT count(*) FROM institution.notification n
   WHERE n.kind = 'course_handover' AND n.event_key = 'course_handover:' || (SELECT val FROM ref WHERE name = 'h1')
     AND n.target_id = pg_temp.id('k1') AND n.institution_id = pg_temp.id('fak_a') AND n.read_at IS NULL),
  2::bigint, 'each notification holds only the handover key and the course, unread');

-- After a handover the course teacher cannot change the holder; the same
-- holder again is still a no-op for her.
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.set_course_holder({k1}, {vesna}) $$),
  'ZD403: forbidden', 'the course teacher cannot take the course back');
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.set_course_holder({k1}, {marko}) $$), 'ok',
  'naming the present holder again changes nothing');
SELECT is(pg_temp.holders('k1'), 'vesna(ended) marko', 'the holders of K1 are as the handover left them');

-- A course without a holder: the trail records no previous one. K2 has no
-- students, so nobody is notified.
SELECT is(pg_temp.hand('iva', '{k2}', '{marko}'), 'id', 'Iva makes Marko the holder of K2, which had none');
SELECT is(
  (SELECT (e.from_holder_id IS NULL)::text FROM audit.course_handover e WHERE e.course_id = pg_temp.id('k2')),
  'true', 'the trail row has no previous holder');
SELECT is(pg_temp.notified(), 2::bigint, 'a course without students notifies nobody');

-- The last barrier: a second open holder is refused by the index.
SELECT matches(pg_temp.ask_as('ductus_identity', 'anon', $q$
  INSERT INTO institution.course_holder (course_id, institution_id, user_id, assigned_by, valid_from)
  VALUES ({k1}, {fak_a}, {vesna}, {iva}, now()) RETURNING 'ok'
$q$), '^23505:', 'a second open holder cannot be written even by the owner');

-- The trail is append-only, also for its owner, and closed to every client.
SELECT is(pg_temp.ask_as('ductus_identity', 'anon', c.stmt), 'ZD403: append-only row', 'trail: ' || c.note)
FROM (VALUES
  (1, $$ WITH x AS (UPDATE audit.course_handover SET actor_id = to_holder_id RETURNING 1) SELECT count(*) FROM x $$,
   'the owner cannot change a row'),
  (2, $$ WITH x AS (DELETE FROM audit.course_handover RETURNING 1) SELECT count(*) FROM x $$,
   'the owner cannot delete a row'),
  (3, $$ TRUNCATE audit.course_handover $$, 'the owner cannot truncate')
) AS c (n, stmt, note)
ORDER BY c.n;
SELECT is(pg_temp.trail(), 2::bigint, 'both trail rows stay');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'audit.course_handover'::regclass),
  'RLS is enabled and forced on the trail');
SELECT bag_eq(
  $$ SELECT polname::text, polroles::regrole[]::text FROM pg_policy WHERE polrelid = 'audit.course_handover'::regclass $$,
  $$ VALUES ('course_handover_owner', '{ductus_identity}') $$, 'the only policy is the owner''s');
SELECT ok(NOT has_table_privilege(r, 'audit.course_handover', p), format('%s has no %s on the trail', r, p))
FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence']) AS r
CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p;
SELECT matches(pg_temp.ask('iva', 'SELECT count(*) FROM audit.course_handover'), '^42501:',
  'the administrator reads no trail row through the application');
SELECT is(pg_temp.ask_as('ductus_worker', 'iva', $$ SELECT institution.hand_over_course({k1}, {vesna})::text $$),
  '42501: permission denied for schema institution', 'the worker cannot hand a course over');

-- The notification store accepts the new kind only in its own shape.
SELECT is(left(pg_temp.ask_as('ductus_identity', 'anon', c.stmt), 5), c.expected, 'store: ' || c.note)
FROM (VALUES
  (1, $q$ INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
     VALUES ({fak_a}, {ana}, 'course_handover', 'course_handover:55555555-5555-4555-8555-555555555555:2',
             {k1}) RETURNING 'ok' $q$, '23514', 'a handover key with a version is rejected'),
  (2, $q$ INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
     VALUES ({fak_a}, {ana}, 'course_handover', 'comment_posted:55555555-5555-4555-8555-555555555555',
             {k1}) RETURNING 'ok' $q$, '23514', 'a handover with a key of another kind is rejected'),
  (3, $q$ INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
     VALUES ({fak_a}, {ana}, 'course_handover', 'course_handover:Vesna je otišla',
             {k1}) RETURNING 'ok' $q$, '23514', 'a handover key cannot carry text'),
  (4, $q$ INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
     VALUES ({fak_a}, {ana}, 'course_handover', 'course_handover:55555555-5555-4555-8555-555555555555',
             {k1}) RETURNING 'ok' $q$, 'ok', 'a well-formed handover key is stored')
) AS c (n, stmt, expected, note)
ORDER BY c.n;

-- A holder whose teacher role was revoked cannot be handed the course.
SELECT is(pg_temp.ask('iva', $$ SELECT institution.revoke_teacher_role({vesna})::text $$), 'true',
  'Iva revokes Vesna''s teacher role');
SELECT is(pg_temp.hand('iva', '{k1}', '{vesna}'), 'ZD422: invalid input', 'refused: a teacher whose role was revoked');
SELECT is(pg_temp.holders('k1'), 'vesna(ended) marko', 'K1 keeps its holder');

SELECT * FROM finish();
ROLLBACK;

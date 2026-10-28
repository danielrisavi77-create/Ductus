-- D1: exercise the real course-assignment RPC, with synthetic fixtures only.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';
SET LOCAL ROLE ductus_identity;
DELETE FROM institution.notification;
RESET ROLE;
SELECT plan(15);

CREATE FUNCTION pg_temp.publish_version(p_actor text, p_expected integer) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format($q$
    SELECT institution.publish_assignment_version({z1}, %s, 'Izmišljeni zadatak', 'Upute.', 'essay',
      now(), now() + interval '30 days', 'partially_allowed', ARRAY['proofreading'], 'extended', true, NULL, NULL)
  $q$, p_expected))
$$;

SELECT is((SELECT count(*)::integer FROM institution.notification), 0, 'the event store starts empty');
SELECT matches(pg_temp.ask('vesna', $q$
  SELECT institution.create_assignment({k1}, 'Izmišljeni zadatak', 'Upute.', 'essay', now(),
    now() + interval '30 days', 'partially_allowed', ARRAY['proofreading'], 'extended', true, NULL, NULL)
$q$), '^[0-9a-f-]{36}$', 'a teacher can create a course assignment');
SELECT is((SELECT count(*)::integer FROM institution.notification), 0,
  'the first version does not produce a version-change notification');
SELECT is(pg_temp.publish_version('marko', 2), 'ZD403: forbidden', 'a teacher of another course cannot publish');
SELECT is((SELECT count(*)::integer FROM institution.notification), 0, 'a refused publication leaves no event');
SELECT is(pg_temp.publish_version('vesna', 2), '3', 'the real RPC publishes version 3');
SELECT is((SELECT string_agg(p.name, ',' ORDER BY p.name) FROM institution.notification n JOIN person p ON p.id = n.recipient_id),
  'ana,dora', 'only the two active students of this course are notified');
SELECT ok((SELECT bool_and(n.institution_id = pg_temp.id('fak_a') AND n.kind = 'assignment_version'
    AND n.target_id = pg_temp.id('z1') AND n.event_key = 'assignment_version:' || pg_temp.id('z1')::text || ':3')
  FROM institution.notification n), 'the notification contains only the actual event metadata');
SELECT is(pg_temp.publish_version('vesna', 2), 'ZD409: conflict', 'retrying the stale version conflicts');
SELECT is((SELECT count(*)::integer FROM institution.notification), 2, 'the retry does not duplicate notifications');
SELECT is(pg_temp.ask('vesna', 'SELECT institution.remove_student({k1}, {dora})::text'), 'true',
  'the teacher removes one student through the real membership RPC');
SELECT is(pg_temp.publish_version('vesna', 3), '4', 'the teacher publishes another version');
SELECT is((SELECT string_agg(p.name, ',' ORDER BY p.name) FROM institution.notification n JOIN person p ON p.id = n.recipient_id
  WHERE n.event_key = 'assignment_version:' || pg_temp.id('z1')::text || ':4'), 'ana',
  'the removed student receives no new event');

SAVEPOINT before_publication;
SELECT pg_temp.publish_version('vesna', 4);
ROLLBACK TO SAVEPOINT before_publication;
SELECT is((SELECT current_version FROM institution.assignment WHERE id = pg_temp.id('z1')), 4,
  'a rolled-back publication does not change the assignment');
SELECT is((SELECT count(*)::integer FROM institution.notification), 3,
  'the same rollback removes the notifications');

SELECT * FROM finish();
ROLLBACK;

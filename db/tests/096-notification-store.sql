-- D1 storage only: all people and identifiers are synthetic.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';
-- The fixture's existing version 2 now emits real synthetic notifications.
SET LOCAL ROLE ductus_identity;
DELETE FROM institution.notification;
RESET ROLE;
SELECT plan(43);

SELECT bag_eq(
  $$ SELECT attname::text FROM pg_attribute
     WHERE attrelid = 'institution.notification'::regclass AND attnum > 0 AND NOT attisdropped $$,
  ARRAY['id', 'institution_id', 'recipient_id', 'kind', 'event_key', 'target_id', 'created_at', 'read_at'],
  'the store contains identifiers and state, not notification or work content'
);

SELECT is(pg_temp.ask_as('ductus_identity', 'anon', $q$
  WITH n AS (INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
    VALUES ({fak_a}, {ana}, 'comment_posted', 'comment_posted:11111111-1111-4111-8111-111111111111',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') RETURNING 1) SELECT count(*) FROM n
$q$), '1', 'the owner can store a notification through its RLS policy');
SELECT is(pg_temp.ask_as('ductus_identity', 'anon', $q$
  WITH n AS (INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
    VALUES ({fak_a}, {dora}, 'comment_posted', 'comment_posted:11111111-1111-4111-8111-111111111111',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') RETURNING 1) SELECT count(*) FROM n
$q$), '1', 'one event can notify more than one recipient');
SELECT matches(pg_temp.ask_as('ductus_identity', 'anon', $q$
  INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
  VALUES ({fak_a}, {ana}, 'comment_posted', 'comment_posted:11111111-1111-4111-8111-111111111111',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') RETURNING id
$q$), '^23505:', 'a repeated event cannot create a second notification for the recipient');
SELECT matches(pg_temp.ask_as('ductus_identity', 'anon', $q$
  INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
  VALUES ({fak_b}, {ana}, 'comment_posted', 'comment_posted:22222222-2222-4222-8222-222222222222',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') RETURNING id
$q$), '^23503:', 'the recipient and notification must belong to the same institution');
SELECT matches(pg_temp.ask_as('ductus_identity', 'anon', $q$
  INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
  VALUES ({fak_a}, {ana}, 'comment_posted', 'submission_recorded:22222222-2222-4222-8222-222222222222',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') RETURNING id
$q$), '^23514:', 'the event key must agree with the kind');
SELECT matches(pg_temp.ask_as('ductus_identity', 'anon', $q$
  INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
  VALUES ({fak_a}, {ana}, 'comment_posted', '<img src=x>',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') RETURNING id
$q$), '^23514:', 'arbitrary content is rejected as an event key');
SELECT matches(pg_temp.ask_as('ductus_identity', 'anon', $q$
  INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
  VALUES ({fak_a}, {ana}, 'unknown', 'unknown:22222222-2222-4222-8222-222222222222',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') RETURNING id
$q$), '^23514:', 'an unknown notification kind is rejected');
SELECT matches(pg_temp.ask_as('ductus_identity', 'anon', $q$
  INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
  VALUES ({fak_a}, {ana}, 'assignment_version', 'assignment_version:22222222-2222-4222-8222-222222222222',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') RETURNING id
$q$), '^23514:', 'an assignment event key needs a version');
SELECT is(pg_temp.ask_as('ductus_identity', 'anon', $q$
  WITH n AS (INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
    VALUES ({fak_a}, {ana}, 'assignment_version', 'assignment_version:22222222-2222-4222-8222-222222222222:2',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') RETURNING 1) SELECT count(*) FROM n
$q$), '1', 'a properly formed assignment version event can be stored');
SELECT matches(pg_temp.ask_as('ductus_identity', 'anon', $q$
  INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
  VALUES ({fak_a}, {ana}, 'submission_recorded', 'submission_recorded:33333333-3333-4333-8333-333333333333',
          NULL) RETURNING id
$q$), '^23502:', 'a notification cannot have a missing target');
SELECT is(pg_temp.ask_as('ductus_identity', 'anon', 'SELECT count(*) FROM institution.notification'), '3',
  'the owner sees the three accepted records');
SELECT ok(NOT has_table_privilege('ductus_app', 'institution.notification', 'SELECT'),
  'the application has no direct read grant');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'institution.notification'::regclass),
  'RLS is enabled and forced');

-- Prove denial by RLS itself, even after a mistaken grant. Everything below
-- is inside this synthetic transaction and is rolled back at its end.
GRANT USAGE ON SCHEMA institution TO ductus_app, ductus_worker, ductus_retention, ductus_auth,
  ductus_evidence, ductus_migrator, ductus_test_stranger;
GRANT SELECT, INSERT, UPDATE, DELETE ON institution.notification TO ductus_app, ductus_worker, ductus_retention,
  ductus_auth, ductus_evidence, ductus_migrator, ductus_test_stranger;

CREATE FUNCTION pg_temp.notification_probe(p_role text, p_op text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask_as(p_role, 'ana', CASE p_op
    WHEN 'SELECT' THEN 'SELECT count(*) FROM institution.notification'
    WHEN 'INSERT' THEN $q$WITH n AS (INSERT INTO institution.notification
      (institution_id, recipient_id, kind, event_key, target_id)
      VALUES ({fak_a}, {ana}, 'comment_posted', 'comment_posted:44444444-4444-4444-8444-444444444444',
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') RETURNING 1) SELECT count(*) FROM n$q$
    WHEN 'UPDATE' THEN $q$WITH n AS (UPDATE institution.notification SET read_at = now() RETURNING 1)
      SELECT count(*) FROM n$q$
    WHEN 'DELETE' THEN 'WITH n AS (DELETE FROM institution.notification RETURNING 1) SELECT count(*) FROM n'
  END)
$$;
SELECT CASE WHEN op = 'INSERT'
  THEN matches(pg_temp.notification_probe(role, op), '^42501: new row violates row-level security policy',
       format('%s is refused %s by RLS even with a grant', role, op))
  ELSE is(pg_temp.notification_probe(role, op), '0', format('%s sees zero rows for %s even with a grant', role, op))
  END
FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth',
                  'ductus_evidence', 'ductus_migrator', 'ductus_test_stranger']) AS role
CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS op;
SELECT is(pg_temp.ask_as('ductus_identity', 'anon', 'SELECT count(*) FROM institution.notification'), '3',
  'the denied attempts left the records unchanged');

SELECT * FROM finish();
ROLLBACK;

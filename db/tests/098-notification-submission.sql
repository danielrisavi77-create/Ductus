-- D1: exercise the real submission path. All people, documents and hashes are synthetic.
BEGIN;
\ir fixtures/evidence-acceptance.inc
SET LOCAL lc_messages TO 'C';
SELECT no_plan();
SET LOCAL ROLE ductus_identity;
DELETE FROM institution.notification;
RESET ROLE;

-- Marko is a confirmed teacher of another course; Nina's role is unconfirmed.
-- Both are made members of this course only to exercise the role check.
INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES
  (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('marko'), 'teacher'),
  (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('nina'), 'teacher');
UPDATE institution.institution_role SET revoked_at = now()
WHERE user_id = pg_temp.id('marko') AND institution_id = pg_temp.id('fak_a') AND role = 'teacher';

SELECT is(pg_temp.call('ana', 'pkg-a', 'submission-segment', pg_temp.descriptor(),
  0, repeat('a', 64), repeat('d', 64), repeat('b', 64)), 'reserved', 'the student commits a synthetic revision');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a', 1) $$),
  'requested', 'the student requests a submission');
INSERT INTO ref SELECT 'request_a', id::text FROM evidence.submission_request WHERE principal_id = pg_temp.id('ana');
SELECT is((SELECT count(*)::integer FROM institution.notification WHERE kind = 'submission_recorded'), 0,
  'a submission request alone does not create a submission notification');
SELECT is(pg_temp.ask('dora', format($q$ SELECT outcome FROM app.record_submission({request_a}, %L) $q$, pg_temp.h('d'))),
  'unauthorized', 'another student cannot record the request');
SELECT is(pg_temp.ask('ana', $q$ SELECT outcome FROM app.record_submission({request_a}, repeat('f', 64)) $q$),
  'artifact_mismatch', 'a mismatched reconstruction is refused');
SELECT is((SELECT count(*)::integer FROM institution.notification WHERE kind = 'submission_recorded'), 0,
  'refused recordings create no event');

SAVEPOINT before_record;
DO $$
DECLARE
  v_outcome text;
  v_count integer;
BEGIN
  v_outcome := pg_temp.ask('ana', format($q$ SELECT outcome FROM app.record_submission({request_a}, %L) $q$, pg_temp.h('d')));
  SELECT count(*) INTO v_count FROM institution.notification WHERE kind = 'submission_recorded';
  IF v_outcome IS DISTINCT FROM 'recorded' OR v_count <> 2 THEN
    RAISE EXCEPTION 'the pre-rollback result is %, with % notifications', v_outcome, v_count;
  END IF;
END
$$;
ROLLBACK TO SAVEPOINT before_record;
SELECT is((SELECT count(*)::integer FROM evidence.submission), 0, 'rollback removes the submission');
SELECT is((SELECT count(*)::integer FROM institution.notification WHERE kind = 'submission_recorded'), 0,
  'the same rollback removes its notifications');

SELECT is(pg_temp.ask('ana', format($q$ SELECT outcome FROM app.record_submission({request_a}, %L) $q$, pg_temp.h('d'))),
  'recorded', 'recording again after rollback succeeds');
SELECT is((SELECT string_agg(p.name, ',' ORDER BY p.name) FROM institution.notification n
  JOIN person p ON p.id = n.recipient_id WHERE n.kind = 'submission_recorded'), 'ana,vesna',
  'the student and currently authorised course teacher receive one event each');
SELECT ok((SELECT bool_and(n.institution_id = s.institution_id AND n.target_id = s.id
  AND n.event_key = 'submission_recorded:' || s.id::text)
  FROM institution.notification n JOIN evidence.submission s ON n.target_id = s.id
  WHERE n.kind = 'submission_recorded'), 'the stored target and event identify the real submission only');
SELECT is((SELECT count(*)::integer FROM institution.notification WHERE kind = 'submission_recorded'), 2,
  'unconfirmed, revoked, unrelated and foreign teachers receive no event');
SELECT is(pg_temp.ask('ana', format($q$ SELECT outcome FROM app.record_submission({request_a}, %L) $q$, pg_temp.h('d'))),
  'existing', 'retry returns the existing submission');
SELECT is((SELECT count(*)::integer FROM institution.notification WHERE kind = 'submission_recorded'), 2,
  'retrying does not create duplicate notifications');
INSERT INTO ref SELECT 'submission_a', id::text FROM evidence.submission WHERE principal_id = pg_temp.id('ana');
UPDATE institution.institution_role SET revoked_at = NULL
WHERE user_id = pg_temp.id('marko') AND institution_id = pg_temp.id('fak_a') AND role = 'teacher';

SELECT ok(NOT has_table_privilege('ductus_app', 'institution.notification', 'INSERT'),
  'the app cannot insert notifications directly');
SELECT ok(NOT has_schema_privilege('ductus_identity', 'evidence', 'USAGE')
  AND NOT has_schema_privilege('ductus_evidence', 'institution', 'USAGE'),
  'neither role gains direct access to the other role''s schema');
SELECT ok(NOT has_function_privilege('ductus_app', 'app.submission_notification_scope(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_app', 'app.notify_submission(uuid)', 'EXECUTE'),
  'the browser-facing app cannot execute either internal bridge');
SELECT is(pg_temp.ask_as('ductus_identity', 'ana',
  $q$ SELECT count(*) FROM app.submission_notification_scope({nobody}) $q$), '0',
  'the evidence bridge returns no scope for a missing submission');
SELECT is(pg_temp.ask_as('ductus_evidence', 'ana',
  $q$ SELECT 'done' FROM app.notify_submission({submission_a}) $q$), 'done',
  'an ordinary direct call with a real id returns without replaying the event');
SELECT is((SELECT count(*)::integer FROM institution.notification WHERE kind = 'submission_recorded'), 2,
  'an ordinary direct call does not add a newly eligible teacher to an old event');

SELECT * FROM finish();
ROLLBACK;

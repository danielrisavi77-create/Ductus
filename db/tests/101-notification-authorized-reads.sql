-- D1: current authorisation is checked against real comments and submissions.
-- Every person, document, comment and hash here is synthetic.
BEGIN;
\ir fixtures/evidence-acceptance.inc
SET CONSTRAINTS ALL DEFERRED;
\ir fixtures/mentorship.inc
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS evidence.evidence_document_current_revision_fkey DEFERRED;
SET LOCAL lc_messages TO 'C';
SELECT no_plan();
SET LOCAL ROLE ductus_identity;
DELETE FROM institution.notification;
RESET ROLE;

-- A second synthetic document is tied to Ana's real active mentorship.
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id)
VALUES ('mentor-project', pg_temp.id('fak_a'), pg_temp.id('zm1'), pg_temp.id('ana'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash)
VALUES ('mentor-doc', pg_temp.id('fak_a'), 'mentor-project', pg_temp.id('ana'), pg_temp.h('a'));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash)
VALUES ('mentor-doc', pg_temp.id('fak_a'), 0, pg_temp.id('ana'), pg_temp.h('a'));
RESET ROLE;
INSERT INTO ref VALUES ('anchor', '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"izmišljeno","prefix":"","suffix":"","startHint":0,"endHint":10}');

INSERT INTO ref SELECT 'thread', pg_temp.ask('vesna', $$
  SELECT collaboration.create_comment('doc-a', 'Izmišljeni komentar.', {anchor}) $$);
SELECT matches((SELECT val FROM ref WHERE name = 'thread'), '^[0-9a-f-]{36}$', 'the course teacher opens a thread');
SELECT matches(pg_temp.ask('ana', $$ SELECT collaboration.reply_comment({thread}, 'Izmišljeni odgovor.') $$),
  '^[0-9a-f-]{36}$', 'the student replies');
INSERT INTO ref SELECT 'comment_student', id::text FROM institution.notification
WHERE kind = 'comment_posted' AND target_id = pg_temp.id('thread') AND recipient_id = pg_temp.id('ana');
INSERT INTO ref SELECT 'comment_teacher', id::text FROM institution.notification
WHERE kind = 'comment_posted' AND target_id = pg_temp.id('thread') AND recipient_id = pg_temp.id('vesna');

INSERT INTO ref SELECT 'mentor_thread', pg_temp.ask('marko', $$
  SELECT collaboration.create_comment('mentor-doc', 'Izmišljeni komentar mentora.', {anchor}) $$);
SELECT matches(pg_temp.ask('ana', $$ SELECT collaboration.reply_comment({mentor_thread}, 'Izmišljeni odgovor mentoru.') $$),
  '^[0-9a-f-]{36}$', 'the student replies to the mentor');
INSERT INTO ref SELECT 'comment_mentor', id::text FROM institution.notification
WHERE kind = 'comment_posted' AND target_id = pg_temp.id('mentor_thread') AND recipient_id = pg_temp.id('marko');

SELECT is(pg_temp.call('ana', 'pkg-a', 'read-fixture', pg_temp.descriptor(),
  0, repeat('a', 64), repeat('d', 64), repeat('b', 64)), 'reserved', 'the student commits revision 1');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a', 1) $$), 'requested',
  'the student requests the revision');
INSERT INTO ref SELECT 'request_a', id::text FROM evidence.submission_request WHERE principal_id = pg_temp.id('ana');
SELECT is(pg_temp.ask('ana', format($q$ SELECT outcome FROM app.record_submission({request_a}, %L) $q$, pg_temp.h('d'))),
  'recorded', 'the actual submission is recorded');
INSERT INTO ref SELECT 'submission_student', id::text FROM institution.notification
WHERE kind = 'submission_recorded' AND recipient_id = pg_temp.id('ana');
INSERT INTO ref SELECT 'submission_teacher', id::text FROM institution.notification
WHERE kind = 'submission_recorded' AND recipient_id = pg_temp.id('vesna');
-- A second authorised teacher joins after these events. Current target access
-- must never substitute for being the event's actual recipient.
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('marko'), 'teacher');
CREATE TEMP TABLE acknowledgments_before AS SELECT count(*) AS n FROM institution.notice_acknowledgment;

SELECT is(pg_temp.ask('ana', $q$ SELECT kind || '|' || target_id::text || '|' || is_read::text
  FROM institution.read_comment_notification({comment_student}) $q$),
  'comment_posted|' || pg_temp.id('thread')::text || '|false', 'the owner reads her real comment notification');
SELECT is(pg_temp.ask('vesna', $q$ SELECT kind || '|' || target_id::text
  FROM institution.read_comment_notification({comment_teacher}) $q$),
  'comment_posted|' || pg_temp.id('thread')::text, 'the teacher reads her own reply notification');
SELECT is(pg_temp.ask('marko', $q$ SELECT kind || '|' || target_id::text
  FROM institution.read_comment_notification({comment_mentor}) $q$),
  'comment_posted|' || pg_temp.id('mentor_thread')::text, 'the active mentor reads his notification');
SELECT is(pg_temp.ask('ana', $q$ SELECT kind || '|' || is_read::text
  FROM institution.read_submission_notification({submission_student}) $q$),
  'submission_recorded|false', 'the submitting student reads her own recorded submission event');
SELECT is(pg_temp.ask('vesna', $q$ SELECT kind || '|' || is_read::text
  FROM institution.read_submission_notification({submission_teacher}) $q$),
  'submission_recorded|false', 'the active course teacher reads her submission event');
SELECT is(pg_temp.ask('ana', $q$ SELECT extract(epoch FROM created_window)::bigint % 300
  FROM institution.read_comment_notification({comment_student}) $q$), '0', 'comment time is a five-minute window');
SELECT is(pg_temp.ask('ana', $q$ SELECT extract(epoch FROM created_window)::bigint % 300
  FROM institution.read_submission_notification({submission_student}) $q$), '0', 'submission event time is a five-minute window');

SELECT is(pg_temp.ask(a.actor, a.query), '0', a.label)
FROM (VALUES
  ('dora', 'SELECT count(*) FROM institution.read_comment_notification({comment_student})', 'another student reads no comment event'),
  ('petra', 'SELECT count(*) FROM institution.read_comment_notification({comment_student})', 'another institution reads no comment event'),
  ('ana', 'SELECT count(*) FROM institution.read_comment_notification({comment_teacher})', 'the student reads no teacher event'),
  ('marko', 'SELECT count(*) FROM institution.read_comment_notification({comment_teacher})', 'another authorised teacher reads no recipient event'),
  ('dora', 'SELECT count(*) FROM institution.read_submission_notification({submission_student})', 'another student reads no submission event'),
  ('petra', 'SELECT count(*) FROM institution.read_submission_notification({submission_teacher})', 'another institution reads no submission event'),
  ('marko', 'SELECT count(*) FROM institution.read_submission_notification({submission_teacher})', 'another authorised teacher reads no recipient submission'),
  ('ana', 'SELECT count(*) FROM institution.read_submission_notification({comment_student})', 'the wrong event type is invisible'),
  ('ana', 'SELECT count(*) FROM institution.read_comment_notification({nobody})', 'a missing comment event is invisible'),
  ('ana', 'SELECT count(*) FROM institution.read_submission_notification({nobody})', 'a missing submission event is invisible')
) AS a (actor, query, label);
SELECT is(pg_temp.ask(a.actor, a2.query), 'ZD401: not authenticated', a.actor || ' cannot read without an active session')
FROM (VALUES ('anon'), ('closed'), ('expired'), ('unknown')) AS a (actor)
CROSS JOIN (VALUES
  ('SELECT count(*) FROM institution.read_comment_notification({comment_student})'),
  ('SELECT count(*) FROM institution.read_submission_notification({submission_student})')
) AS a2 (query);

-- A valid-looking notification must still point to a real event in its target.
INSERT INTO ref SELECT 'fake_comment', pg_temp.ask_as('ductus_identity', 'anon', $q$
  INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
  VALUES ({fak_a}, {ana}, 'comment_posted', 'comment_posted:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {thread})
  RETURNING id $q$);
INSERT INTO ref SELECT 'fake_submission', pg_temp.ask_as('ductus_identity', 'anon', $q$
  INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
  VALUES ({fak_a}, {ana}, 'submission_recorded', 'submission_recorded:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') RETURNING id $q$);
INSERT INTO ref SELECT 'actual_submission', target_id::text FROM institution.notification
WHERE id = pg_temp.id('submission_student');
INSERT INTO ref SELECT 'wrong_submission_source', pg_temp.ask_as('ductus_identity', 'anon', $q$
  INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
  VALUES ({fak_a}, {ana}, 'submission_recorded', 'submission_recorded:cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          {actual_submission}) RETURNING id $q$);
INSERT INTO ref SELECT 'wrong_submission_recipient', pg_temp.ask_as('ductus_identity', 'anon', $q$
  INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
  VALUES ({fak_a}, {dora}, 'submission_recorded', 'submission_recorded:' || {actual_submission}::uuid::text,
          {actual_submission}) RETURNING id $q$);
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM institution.read_comment_notification({fake_comment})'), '0',
  'a forged comment source is not displayed');
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM institution.read_submission_notification({fake_submission})'), '0',
  'a forged submission source is not displayed');
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM institution.read_submission_notification({wrong_submission_source})'), '0',
  'an event key for another submission cannot point at a real submission');
SELECT is(pg_temp.ask('dora', 'SELECT count(*) FROM institution.read_submission_notification({wrong_submission_recipient})'), '0',
  'even a wrongly delivered event cannot give a student access to another student''s submission');

-- A privileged fixture forges a thread whose document belongs to a different
-- assignment. The app cannot insert this, and the reader must fail closed.
INSERT INTO ref SELECT 'wrong_thread', pg_temp.ask_as('ductus_identity', 'anon', $q$
  INSERT INTO collaboration.comment_thread (institution_id, document_id, assignment_id, owner_id, anchor, created_by)
  VALUES ({fak_a}, 'mentor-doc', {z1}, {ana}, {anchor}::jsonb, {vesna}) RETURNING id $q$);
SELECT matches(pg_temp.ask_as('ductus_identity', 'anon', $q$
  INSERT INTO collaboration.comment (thread_id, institution_id, position, author_id, author_role, body)
  VALUES ({wrong_thread}, {fak_a}, 1, {vesna}, 'teacher', 'Izmišljeni komentar.') RETURNING id $q$),
  '^[0-9a-f-]{36}$', 'the privileged forged fixture creates a source comment');
INSERT INTO ref SELECT 'wrong_document_notice', id::text FROM institution.notification
WHERE target_id = pg_temp.id('wrong_thread') AND recipient_id = pg_temp.id('ana');
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM institution.read_comment_notification({wrong_document_notice})'), '0',
  'a real comment cannot be exposed through a mismatched document scope');
SET LOCAL ROLE ductus_identity;
UPDATE institution.notification SET read_at = timestamptz '2026-01-01 00:00:00+00'
WHERE id = pg_temp.id('comment_teacher');
RESET ROLE;
SELECT is(pg_temp.ask('vesna', 'SELECT is_read::text FROM institution.read_comment_notification({comment_teacher})'), 'true',
  'an already read notification retains its read status');
CREATE TEMP TABLE read_state_before AS SELECT id, read_at FROM institution.notification;

SELECT is(pg_temp.ask('vesna', 'SELECT institution.remove_student({k1}, {ana})::text'), 'true',
  'the teacher removes the student through the normal RPC');
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM institution.read_comment_notification({comment_student})'), '0',
  'a former student can no longer read the comment event');
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM institution.read_submission_notification({submission_student})'), '0',
  'a former student can no longer read the submission event');
SELECT is(pg_temp.ask('vesna', 'SELECT count(*) FROM institution.read_submission_notification({submission_teacher})'), '0',
  'the teacher cannot use the event to bypass the submission roster after the student leaves');
SELECT is(pg_temp.ask('vesna', 'SELECT institution.allow_student_return({k1}, {ana})::text'), 'true', 'return is allowed');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM institution.enroll_with_code('KOD-K1-TEST') $$), 'enrolled',
  'the student returns through the normal enrollment flow');
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM institution.read_submission_notification({submission_student})'), '1',
  'current access is restored without changing the stored event');
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM institution.read_comment_notification({comment_student})'), '1',
  'the comment notification also reappears when the student returns');
SELECT is(pg_temp.ask('vesna', 'SELECT count(*) FROM institution.read_submission_notification({submission_teacher})'), '1',
  'the teacher again sees the event when the student returns to the roster');
UPDATE institution.institution_role SET revoked_at = now()
WHERE institution_id = pg_temp.id('fak_a') AND user_id = pg_temp.id('vesna') AND role = 'teacher';
SELECT is(pg_temp.ask('vesna', 'SELECT count(*) FROM institution.read_comment_notification({comment_teacher})'), '0',
  'a revoked teacher cannot read a comment event');
SELECT is(pg_temp.ask('vesna', 'SELECT count(*) FROM institution.read_submission_notification({submission_teacher})'), '0',
  'a revoked teacher cannot read a submission event');
UPDATE institution.mentorship SET ended_at = now() WHERE id = pg_temp.id('ms1');
SELECT is(pg_temp.ask('marko', 'SELECT count(*) FROM institution.read_comment_notification({comment_mentor})'), '0',
  'an ended mentorship hides its comment event');

SELECT is_empty($q$ SELECT n.id FROM institution.notification n JOIN read_state_before b ON b.id = n.id
  WHERE n.read_at IS DISTINCT FROM b.read_at $q$, 'reading preserves each original read timestamp');
SELECT is((SELECT count(*) FROM institution.notice_acknowledgment), (SELECT n FROM acknowledgments_before),
  'reading these notifications does not acknowledge assignment instructions');
SELECT matches(pg_temp.ask('ana', 'SELECT count(*) FROM institution.notification'), '^42501:',
  'the web role still cannot read the notification table directly');
SELECT is(pg_get_function_result('institution.read_comment_notification(uuid)'::regprocedure),
  'TABLE(notification_id uuid, kind text, target_id uuid, created_window timestamp with time zone, is_read boolean)',
  'comment results expose no person id, event key, text or exact time');
SELECT is(pg_get_function_result('institution.read_submission_notification(uuid)'::regprocedure),
  'TABLE(notification_id uuid, kind text, target_id uuid, created_window timestamp with time zone, is_read boolean)',
  'submission results expose no person id, hash or exact time');
SELECT * FROM finish();
ROLLBACK;

-- D1: comment notifications follow real comment RPCs. All fixtures are synthetic.
BEGIN;
\ir fixtures/institution.inc
\ir fixtures/mentorship.inc
SET LOCAL lc_messages TO 'C';
SELECT no_plan();

-- The base fixture's earlier assignment version is not part of these cases.
SET LOCAL ROLE ductus_identity;
DELETE FROM institution.notification;
RESET ROLE;

SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.domain (id, institution_id, region)
VALUES ('00000000-0000-4000-8000-0000000000e1', pg_temp.id('fak_a'), 'eu-central-1');
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES
  ('comment-project', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('ana')),
  ('mentor-project', pg_temp.id('fak_a'), pg_temp.id('zm1'), pg_temp.id('ana'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash) VALUES
  ('comment-doc', pg_temp.id('fak_a'), 'comment-project', pg_temp.id('ana'), repeat('a', 64)),
  ('mentor-doc', pg_temp.id('fak_a'), 'mentor-project', pg_temp.id('ana'), repeat('b', 64));
RESET ROLE;
INSERT INTO ref VALUES ('anchor', '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"izmišljeno","prefix":"","suffix":"","startHint":0,"endHint":10}');

-- Marko has the teacher role but initially belongs only to another course.
INSERT INTO ref SELECT 'thread', pg_temp.ask('vesna', $$
  SELECT collaboration.create_comment('comment-doc', 'Izmišljeni komentar.', {anchor}) $$);
SELECT matches((SELECT val FROM ref WHERE name = 'thread'), '^[0-9a-f-]{36}$', 'the real teacher opens a thread');
SELECT is((SELECT string_agg(p.name, ',' ORDER BY p.name)
  FROM institution.notification n JOIN person p ON p.id = n.recipient_id WHERE n.kind = 'comment_posted'),
  'ana', 'the teacher comment notifies only the owner of the work');
SELECT ok((SELECT bool_and(n.target_id = pg_temp.id('thread') AND n.institution_id = pg_temp.id('fak_a')
  AND n.event_key = 'comment_posted:' || c.id::text)
  FROM institution.notification n JOIN collaboration.comment c ON c.thread_id = n.target_id
  WHERE n.kind = 'comment_posted'), 'the event identifies the real thread and comment, not its text');

SELECT matches(pg_temp.ask('ana', $$ SELECT collaboration.reply_comment({thread}, 'Izmišljeni odgovor.') $$),
  '^[0-9a-f-]{36}$', 'the student replies through the real RPC');
SELECT is((SELECT string_agg(p.name, ',' ORDER BY p.name) FROM institution.notification n
  JOIN person p ON p.id = n.recipient_id JOIN collaboration.comment c
    ON n.event_key = 'comment_posted:' || c.id::text
  WHERE c.thread_id = pg_temp.id('thread') AND c.position = 2), 'vesna',
  'the reply notifies the participating teacher');
SELECT is(pg_temp.ask('petra', $$ SELECT collaboration.reply_comment({thread}, 'Nedopušten odgovor.') $$),
  'ZD403: forbidden', 'a teacher at another institution cannot reply');
SELECT is((SELECT count(*)::integer FROM institution.notification WHERE kind = 'comment_posted'), 2,
  'the rejected reply creates no event');

-- A second authorised teacher joins the thread. A non-participant is not added.
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('marko'), 'teacher');
SELECT matches(pg_temp.ask('marko', $$ SELECT collaboration.reply_comment({thread}, 'Dopuna drugog nastavnika.') $$),
  '^[0-9a-f-]{36}$', 'a second course teacher joins the thread');
SELECT is((SELECT string_agg(p.name, ',' ORDER BY p.name) FROM institution.notification n
  JOIN person p ON p.id = n.recipient_id JOIN collaboration.comment c
    ON n.event_key = 'comment_posted:' || c.id::text
  WHERE c.thread_id = pg_temp.id('thread') AND c.position = 3), 'ana',
  'a teacher reply notifies the student, not the teacher');
SELECT matches(pg_temp.ask('ana', $$ SELECT collaboration.reply_comment({thread}, 'Novi odgovor.') $$),
  '^[0-9a-f-]{36}$', 'the student answers both participating teachers');
SELECT is((SELECT string_agg(p.name, ',' ORDER BY p.name) FROM institution.notification n
  JOIN person p ON p.id = n.recipient_id JOIN collaboration.comment c
    ON n.event_key = 'comment_posted:' || c.id::text
  WHERE c.thread_id = pg_temp.id('thread') AND c.position = 4), 'marko,vesna',
  'each currently authorised participating teacher gets one notification');
SELECT is((SELECT count(*)::integer FROM institution.notification n JOIN collaboration.comment c
  ON n.event_key = 'comment_posted:' || c.id::text WHERE c.thread_id = pg_temp.id('thread') AND c.position = 4),
  2, 'the same event is not duplicated for either recipient');

-- A closed membership or revoked teacher role must not receive later events.
UPDATE institution.course_member SET member_to = now()
WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('marko') AND member_to IS NULL;
SELECT matches(pg_temp.ask('ana', $$ SELECT collaboration.reply_comment({thread}, 'Još jedan odgovor.') $$),
  '^[0-9a-f-]{36}$', 'the student can still reply after a teacher leaves');
SELECT is((SELECT string_agg(p.name, ',' ORDER BY p.name) FROM institution.notification n
  JOIN person p ON p.id = n.recipient_id JOIN collaboration.comment c
    ON n.event_key = 'comment_posted:' || c.id::text
  WHERE c.thread_id = pg_temp.id('thread') AND c.position = 5), 'vesna',
  'a teacher whose course membership ended receives no new event');

-- If the student has left, a still-authorised teacher can write but must not
-- send that student a notification while the work is inaccessible.
UPDATE institution.course_member SET member_to = now()
WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('ana') AND member_to IS NULL;
SELECT matches(pg_temp.ask('vesna', $$ SELECT collaboration.reply_comment({thread}, 'Dopuna nakon odlaska.') $$),
  '^[0-9a-f-]{36}$', 'the current teacher can still write the domain comment');
SELECT is((SELECT count(*)::integer FROM institution.notification n JOIN collaboration.comment c
  ON n.event_key = 'comment_posted:' || c.id::text WHERE c.thread_id = pg_temp.id('thread') AND c.position = 6),
  0, 'a student with no current assignment access gets no event');
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('ana'), 'student');
UPDATE institution.institution_role SET revoked_at = now()
WHERE institution_id = pg_temp.id('fak_a') AND user_id = pg_temp.id('vesna') AND role = 'teacher';
SELECT matches(pg_temp.ask('ana', $$ SELECT collaboration.reply_comment({thread}, 'Odgovor nakon opoziva.') $$),
  '^[0-9a-f-]{36}$', 'the student may reply after the teacher role is revoked');
SELECT is((SELECT count(*)::integer FROM institution.notification n JOIN collaboration.comment c
  ON n.event_key = 'comment_posted:' || c.id::text WHERE c.thread_id = pg_temp.id('thread') AND c.position = 7),
  0, 'a revoked teacher and a former course member receive no event');

-- The same connection works for an actual mentorship, without involving a
-- teacher of the student's unrelated course.
INSERT INTO ref SELECT 'mentor_thread', pg_temp.ask('marko', $$
  SELECT collaboration.create_comment('mentor-doc', 'Izmišljeni komentar mentora.', {anchor}) $$);
SELECT matches((SELECT val FROM ref WHERE name = 'mentor_thread'), '^[0-9a-f-]{36}$', 'the mentor opens a thread');
SELECT is((SELECT string_agg(p.name, ',' ORDER BY p.name) FROM institution.notification n
  JOIN person p ON p.id = n.recipient_id WHERE n.target_id = pg_temp.id('mentor_thread')), 'ana',
  'the mentor comment notifies the mentored student');
SELECT matches(pg_temp.ask('marko', $$ SELECT collaboration.reply_comment({mentor_thread}, 'Druga mentorska napomena.') $$),
  '^[0-9a-f-]{36}$', 'the same mentor participates again');
SELECT matches(pg_temp.ask('ana', $$ SELECT collaboration.reply_comment({mentor_thread}, 'Odgovor mentorici ili mentoru.') $$),
  '^[0-9a-f-]{36}$', 'the mentored student replies');
SELECT is((SELECT string_agg(p.name, ',' ORDER BY p.name) FROM institution.notification n
  JOIN person p ON p.id = n.recipient_id JOIN collaboration.comment c
    ON n.event_key = 'comment_posted:' || c.id::text
  WHERE c.thread_id = pg_temp.id('mentor_thread') AND c.position = 3), 'marko',
  'two earlier comments by the same mentor produce only one notification for this reply');

UPDATE institution.institution_role SET revoked_at = now()
WHERE institution_id = pg_temp.id('fak_a') AND user_id = pg_temp.id('marko') AND role = 'teacher';
SELECT matches(pg_temp.ask('ana', $$ SELECT collaboration.reply_comment({mentor_thread}, 'Odgovor nakon opoziva mentora.') $$),
  '^[0-9a-f-]{36}$', 'the student still has her side of the open mentorship');
SELECT is((SELECT count(*)::integer FROM institution.notification n JOIN collaboration.comment c
  ON n.event_key = 'comment_posted:' || c.id::text WHERE c.thread_id = pg_temp.id('mentor_thread') AND c.position = 4),
  0, 'the mentor with a revoked teacher role receives no new event');
UPDATE institution.institution_role SET revoked_at = NULL
WHERE institution_id = pg_temp.id('fak_a') AND user_id = pg_temp.id('marko') AND role = 'teacher';

CREATE TEMP TABLE notification_count AS SELECT count(*)::integer AS n FROM institution.notification;
SAVEPOINT before_reply;
SELECT pg_temp.ask('ana', $$ SELECT collaboration.reply_comment({mentor_thread}, 'Odgovor koji se povlači.') $$);
ROLLBACK TO SAVEPOINT before_reply;
SELECT is((SELECT count(*)::integer FROM institution.notification), (SELECT n FROM notification_count),
  'rolling back the comment also rolls back its notification');
UPDATE institution.mentorship SET ended_at = now() WHERE id = pg_temp.id('ms1');
SELECT is(pg_temp.ask('ana', $$ SELECT collaboration.reply_comment({mentor_thread}, 'Odgovor po završetku.') $$),
  'ZD403: forbidden', 'the ended mentorship no longer accepts a reply');
SELECT is((SELECT count(*)::integer FROM institution.notification), (SELECT n FROM notification_count),
  'a refused reply after the mentorship ended creates no notification');
SELECT ok(NOT has_table_privilege('ductus_app', 'institution.notification', 'INSERT'),
  'the app cannot create notifications directly');
SELECT ok(NOT has_function_privilege('ductus_app', 'collaboration.notify_comment()', 'EXECUTE'),
  'the app cannot call the internal trigger function');

SELECT * FROM finish();
ROLLBACK;

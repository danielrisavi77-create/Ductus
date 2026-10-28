-- DAN-305: item access uses synthetic institutions, people and sessions.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';
SELECT plan(46);

-- The fixture publishes version 2. The real trigger creates one event each
-- for Ana and Dora. Neither id is passed as the actor's identity.
INSERT INTO ref (name, val)
SELECT 'notice_' || p.name, n.id::text
FROM institution.notification n JOIN person p ON p.id = n.recipient_id
WHERE p.name IN ('ana', 'dora') AND n.kind = 'assignment_version';

-- Internal malformed or future-kind rows must not become visible by accident.
INSERT INTO institution.notification (id, institution_id, recipient_id, kind, event_key, target_id)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_temp.id('fak_a'), pg_temp.id('ana'), 'assignment_version',
   'assignment_version:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:2', pg_temp.id('z1')),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', pg_temp.id('fak_a'), pg_temp.id('ana'), 'comment_posted',
   'comment_posted:dddddddd-dddd-4ddd-8ddd-dddddddddddd', pg_temp.id('z1'));
INSERT INTO ref VALUES ('forged_notice', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('future_notice', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');

SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM institution.read_notification({notice_ana})'), '1',
  'Ana reads her own notification for her accessible assignment');
SELECT is(pg_temp.ask('dora', 'SELECT count(*) FROM institution.read_notification({notice_ana})'), '0',
  'another student of the same course cannot read it');
SELECT is(pg_temp.ask('vesna', 'SELECT count(*) FROM institution.read_notification({notice_ana})'), '0',
  'the teacher does not become the recipient');
SELECT is(pg_temp.ask('tomo', 'SELECT count(*) FROM institution.read_notification({notice_ana})'), '0',
  'another institution cannot read it');
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM institution.read_notification({nobody})'), '0',
  'a nonexistent notification returns the same empty result');
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM institution.read_notification({future_notice})'), '0',
  'a future kind is not exposed without its own authorization');
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM institution.read_notification({forged_notice})'), '0',
  'an event key that does not name its actual target is not exposed');
SELECT is(pg_temp.ask('ana', $q$ SELECT (extract(epoch FROM created_window)::bigint % 300 = 0)::text
  FROM institution.read_notification({notice_ana}) $q$), 'true', 'the returned time is a five-minute window');
SELECT is(pg_temp.ask('ana', 'SELECT is_read::text FROM institution.read_notification({notice_ana})'), 'false',
  'reading an unread notification does not mark it read');

SELECT is(pg_temp.ask('ana', 'SELECT institution.mark_notification_read({notice_dora})::text'), 'false',
  'a student cannot mark another recipient notification');
SELECT is(pg_temp.ask('tomo', 'SELECT institution.mark_notification_read({notice_ana})::text'), 'false',
  'another institution cannot mark it');
SELECT is(pg_temp.ask('ana', 'SELECT institution.mark_notification_read({nobody})::text'), 'false',
  'a nonexistent notification gets the same answer');
SELECT is(pg_temp.ask('ana', 'SELECT institution.mark_notification_read({future_notice})::text'), 'false',
  'a future kind cannot be marked by this assignment-only function');
SELECT is(pg_temp.ask('ana', 'SELECT institution.mark_notification_read({forged_notice})::text'), 'false',
  'a forged event target cannot be marked');
SELECT ok((SELECT read_at IS NULL FROM institution.notification WHERE id = pg_temp.id('notice_dora')),
  'the refused attempt leaves the other recipient unread');

SELECT is(pg_temp.ask('ana', 'SELECT institution.mark_notification_read({notice_ana})::text'), 'true',
  'the recipient explicitly marks the notification');
CREATE TEMP TABLE first_read AS SELECT read_at FROM institution.notification WHERE id = pg_temp.id('notice_ana');
SELECT is(pg_temp.ask('ana', 'SELECT is_read::text FROM institution.read_notification({notice_ana})'), 'true',
  'the item reports the saved read state');
SELECT is(pg_temp.ask('ana', 'SELECT institution.mark_notification_read({notice_ana})::text'), 'true',
  'a repeat of the same action succeeds');
SELECT ok((SELECT n.read_at = f.read_at FROM institution.notification n CROSS JOIN first_read f
  WHERE n.id = pg_temp.id('notice_ana')), 'the repeat keeps the first read time');
SELECT is(pg_temp.ask('dora', 'SELECT institution.mark_notification_read({notice_dora})::text'), 'true',
  'the other student can mark her own notification');
SELECT is((SELECT count(*)::integer FROM institution.notice_acknowledgment
  WHERE assignment_id = pg_temp.id('z1') AND version_no = 2 AND student_id = pg_temp.id('dora')), 0,
  'marking a notification does not acknowledge assignment instructions');

SELECT is(pg_temp.ask('vesna', $q$ SELECT institution.publish_assignment_version({z1}, 2, 'Izmišljeni zadatak',
  'Upute.', 'essay', now(), now() + interval '30 days', 'partially_allowed', ARRAY['proofreading'],
  'extended', true, NULL, NULL) $q$), '3', 'a new version creates another event');
INSERT INTO ref (name, val)
SELECT 'notice_ana_new', id::text FROM institution.notification
WHERE recipient_id = pg_temp.id('ana') AND event_key = 'assignment_version:' || pg_temp.id('z1')::text || ':3';
SELECT is(pg_temp.ask('ana', 'SELECT is_read::text FROM institution.read_notification({notice_ana_new})'), 'false',
  'the new event starts unread');
SELECT is(pg_temp.ask('vesna', 'SELECT institution.remove_student({k1}, {ana})::text'), 'true',
  'the teacher removes Ana from the course');
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM institution.read_notification({notice_ana})'), '0',
  'the notification stops being visible when access is revoked');
SELECT is(pg_temp.ask('ana', 'SELECT institution.mark_notification_read({notice_ana})::text'), 'false',
  'the former recipient cannot mark or repeat after revocation');
SELECT ok((SELECT n.read_at = f.read_at FROM institution.notification n CROSS JOIN first_read f
  WHERE n.id = pg_temp.id('notice_ana')), 'revocation and refused retry preserve the prior state');
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM institution.read_notification({notice_ana_new})'), '0',
  'the previously unread notification is hidden after revocation');
SELECT is(pg_temp.ask('ana', 'SELECT institution.mark_notification_read({notice_ana_new})::text'), 'false',
  'an unread notification is not marked after revocation');
SELECT ok((SELECT read_at IS NULL FROM institution.notification WHERE id = pg_temp.id('notice_ana_new')),
  'the hidden notification remains unread');
SELECT is(pg_temp.ask('dora', 'SELECT count(*) FROM institution.read_notification({notice_dora})'), '1',
  'another active recipient still has access');
SELECT is(pg_temp.ask('vesna', 'SELECT institution.allow_student_return({k1}, {ana})::text'), 'true',
  'the teacher allows Ana to return');
SELECT is(pg_temp.ask('ana', $q$ SELECT outcome FROM institution.enroll_with_code('KOD-K1-TEST') $q$), 'enrolled',
  'Ana returns through the normal enrollment flow');
SELECT is(pg_temp.ask('ana', 'SELECT is_read::text FROM institution.read_notification({notice_ana_new})'), 'false',
  'when access returns the hidden event is still unread');
SELECT is(pg_temp.ask('ana', 'SELECT is_read::text FROM institution.read_notification({notice_ana})'), 'true',
  'the previously read event remains read');
SELECT ok((SELECT n.read_at = f.read_at FROM institution.notification n CROSS JOIN first_read f
  WHERE n.id = pg_temp.id('notice_ana')), 'restored access retains the original read time');

SELECT is(pg_temp.ask(a.actor, c.sql), 'ZD401: not authenticated',
  format('%s is refused %s', a.actor, c.label))
FROM unnest(ARRAY['anon', 'expired', 'closed', 'unknown']) AS a (actor)
CROSS JOIN (VALUES
  ('read', 'SELECT count(*) FROM institution.read_notification({notice_ana})'),
  ('mark', 'SELECT institution.mark_notification_read({notice_ana})::text')
) AS c (label, sql);
SELECT matches(pg_temp.ask('ana', 'SELECT count(*) FROM institution.notification'), '^42501:',
  'the web role still has no direct table access');
SELECT is(pg_get_function_result('institution.read_notification(uuid)'::regprocedure),
  'TABLE(notification_id uuid, kind text, target_id uuid, created_window timestamp with time zone, is_read boolean)',
  'the result has no event key, exact timestamp or other person identity');

SELECT * FROM finish();
ROLLBACK;

-- DAN-338 (F-141 t. 2; owner decision of 26 Oct 2026; contract on #747,
-- comment 6410308090): the audit trail of removals and allowed returns. Every
-- membership that remove_student ends and every membership whose return
-- allow_student_return allows has exactly one row of its kind, written in the
-- same transaction with the teacher from the session; a call that changes no
-- membership writes nothing. The table is append-only, owner-only and
-- forced-RLS. Every person and course below is invented (fixtures/institution.inc).
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';
SELECT no_plan();

CREATE FUNCTION pg_temp.as_owner(p_sql text) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.ask_as('ductus_identity', 'anon', p_sql) $$;
CREATE FUNCTION pg_temp.events() RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT count(*) FROM audit.course_member_event $$;
-- The memberships of a student in a course, oldest first.
CREATE FUNCTION pg_temp.membership(p_student text, p_course text, p_nth integer DEFAULT 1) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT id FROM institution.course_member
   WHERE user_id = pg_temp.id(p_student) AND course_id = pg_temp.id(p_course)
   ORDER BY member_from, member_to NULLS LAST, id OFFSET p_nth - 1 LIMIT 1
$$;
-- The events of one membership as "kind actor student course institution", by kind.
CREATE FUNCTION pg_temp.event(p_membership uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT string_agg(e.kind || ' ' || a.name || ' ' || s.name || ' ' || c.name || ' ' || f.name, ', ' ORDER BY e.kind)
    FROM audit.course_member_event e
    JOIN person a ON a.id = e.actor_id
    JOIN person s ON s.id = e.student_id
    JOIN ref c ON c.val = e.course_id::text
    JOIN ref f ON f.val = e.institution_id::text
   WHERE e.membership_id = p_membership
$$;
INSERT INTO ref VALUES ('ana_k1', pg_temp.membership('ana', 'k1')::text);

-- Catalogue: owner, forced RLS, the only policy, the columns, one row per membership and kind.
SELECT has_table('audit', 'course_member_event', 'removals and returns have their own table');
SELECT row_eq(
  $$ SELECT relowner::regrole::text, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'audit.course_member_event'::regclass $$,
  ROW('ductus_identity'::text, true, true), 'the identity role owns the table and RLS is enabled and forced');
SELECT bag_eq(
  $$ SELECT polname::text, polroles::regrole[]::text FROM pg_policy WHERE polrelid = 'audit.course_member_event'::regclass $$,
  $$ VALUES ('course_member_event_owner', '{ductus_identity}') $$, 'the only policy is the owner''s');
SELECT columns_are('audit', 'course_member_event', ARRAY[
  'id', 'institution_id', 'course_id', 'membership_id', 'student_id', 'kind', 'actor_id', 'occurred_at'
], 'the table has exactly the listed columns: no session, no address, no reason');
SELECT col_is_unique('audit', 'course_member_event', ARRAY['membership_id', 'kind'], 'one row per membership and kind');

-- Nobody but the owner reaches the table.
SELECT is_empty(
  $$ SELECT a.grantee::regrole::text FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid = 'audit.course_member_event'::regclass AND a.grantee <> c.relowner $$,
  'no role but the owner has any privilege on the table');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p
  CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence', 'ductus_migrator']) AS r
  WHERE has_table_privilege(r, 'audit.course_member_event', p)
), 'no other role reads, writes or empties the table directly');
SELECT is(pg_temp.ask('vesna', 'SELECT count(*) FROM audit.course_member_event'),
  '42501: permission denied for schema audit', 'the web role cannot read the events');
SELECT is(pg_temp.ask('vesna', $$ INSERT INTO audit.course_member_event (institution_id, course_id, membership_id, student_id, kind, actor_id, occurred_at)
  VALUES ({fak_a}, {k1}, {ana_k1}, {ana}, 'removed', {vesna}, now()) RETURNING 'written' $$),
  '42501: permission denied for schema audit', 'the web role cannot write an event');
SELECT is(pg_temp.events(), 0::bigint, 'the fixture starts without events');

-- Refused calls write nothing (no session, not a teacher of the course,
-- another institution, a course that does not exist).
SELECT is(pg_temp.ask(v.actor, format('SELECT institution.%s', v.call)), v.answer, v.actor || ': ' || v.call)
FROM (VALUES
  (1, 'anon', 'remove_student({k1}, {ana})', 'ZD401: not authenticated'),
  (2, 'closed', 'allow_student_return({k1}, {ana})', 'ZD401: not authenticated'),
  (3, 'marko', 'remove_student({k1}, {ana})', 'ZD403: forbidden'),
  (4, 'dora', 'remove_student({k1}, {ana})', 'ZD403: forbidden'),
  (5, 'petra', 'remove_student({k1}, {ana})', 'ZD403: forbidden'),
  (6, 'vesna', 'remove_student({k3}, {tomo})', 'ZD403: forbidden'),
  (7, 'vesna', 'remove_student({nobody}, {ana})', 'ZD403: forbidden'),
  (8, 'marko', 'allow_student_return({k1}, {ana})', 'ZD403: forbidden')
) AS v (n, actor, call, answer)
ORDER BY v.n;
-- Calls that find nothing to change answer false and write nothing.
SELECT is(pg_temp.ask('vesna', 'SELECT institution.allow_student_return({k1}, {ana})::text'), 'false',
  'a student who was not removed has nothing to allow');
SELECT is(pg_temp.ask('vesna', 'SELECT institution.remove_student({k1}, {boris})::text'), 'false',
  'a person who is not a student of the course is not removed');
SELECT is(pg_temp.events(), 0::bigint, 'the refused and empty calls wrote no event');
SELECT is((SELECT count(*) FROM institution.course_member WHERE member_to IS NOT NULL), 0::bigint, 'and ended no membership');

-- Removal: one 'removed' row for the membership it ended, by the caller.
SELECT is(pg_temp.ask('vesna', 'SELECT institution.remove_student({k1}, {ana})::text'), 'true', 'Vesna removes Ana from K1');
SELECT is(pg_temp.event(pg_temp.id('ana_k1')), 'removed vesna ana k1 fak_a', 'the ended membership has its row: kind, who, whom, course, institution');
SELECT is((SELECT occurred_at FROM audit.course_member_event WHERE membership_id = pg_temp.id('ana_k1')), now(),
  'the time is the database time of the change');
SELECT is(pg_temp.ask('vesna', 'SELECT institution.remove_student({k1}, {ana})::text'), 'false', 'Ana is no longer there to remove');
SELECT is(pg_temp.events(), 1::bigint, 'and the second call wrote nothing');

-- Return: one 'return_allowed' row for the same membership.
SELECT is(pg_temp.ask('vesna', 'SELECT institution.allow_student_return({k1}, {ana})::text'), 'true', 'Vesna lets Ana back');
SELECT is(pg_temp.event(pg_temp.id('ana_k1')), 'removed vesna ana k1 fak_a, return_allowed vesna ana k1 fak_a',
  'the membership now has both rows');
SELECT is(pg_temp.ask('vesna', 'SELECT institution.allow_student_return({k1}, {ana})::text'), 'false', 'the return is already allowed');
SELECT is(pg_temp.events(), 2::bigint, 'and the second call wrote nothing');

-- Ana comes back with the code; removing her again ends the new membership
-- and writes a row for it, not for the old one.
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM institution.enroll_with_code('KOD-K1-TEST') $$), 'enrolled', 'Ana enrols again');
INSERT INTO ref VALUES ('ana_k1_again', pg_temp.membership('ana', 'k1', 2)::text);
SELECT isnt(pg_temp.id('ana_k1_again'), pg_temp.id('ana_k1'), 'as a new membership');
SELECT is(pg_temp.ask('vesna', 'SELECT institution.remove_student({k1}, {ana})::text'), 'true', 'Vesna removes Ana again');
SELECT is(pg_temp.event(pg_temp.id('ana_k1_again')), 'removed vesna ana k1 fak_a', 'the new membership has its own row');
SELECT is(pg_temp.events(), 3::bigint, 'three rows on two memberships');
-- Another institution's row carries its own institution.
SELECT is(pg_temp.ask('petra', 'SELECT institution.remove_student({k3}, {tomo})::text'), 'true', 'Petra removes Tomo from K3');
SELECT is(pg_temp.event(pg_temp.membership('tomo', 'k3')), 'removed petra tomo k3 fak_b', 'with fak_b in the row');
SELECT is(
  (SELECT count(*) FROM institution.course_member m
    WHERE m.removed_by IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM audit.course_member_event e WHERE e.membership_id = m.id AND e.kind = 'removed')),
  0::bigint, 'every removed membership has its removed row');

-- No change without its row: when the row cannot be written, nothing changes.
CREATE TRIGGER course_member_event_refuse_insert BEFORE INSERT ON audit.course_member_event
  FOR EACH ROW EXECUTE FUNCTION audit.reject_change();
SELECT is(pg_temp.ask('vesna', 'SELECT institution.remove_student({k1}, {dora})::text'), 'ZD403: append-only row',
  'a removal whose row cannot be written fails');
SELECT is(pg_temp.ask('vesna', 'SELECT institution.allow_student_return({k1}, {ana})::text'), 'ZD403: append-only row',
  'a return whose row cannot be written fails');
DROP TRIGGER course_member_event_refuse_insert ON audit.course_member_event;
SELECT is((SELECT member_to FROM institution.course_member WHERE id = pg_temp.membership('dora', 'k1')), NULL::timestamptz,
  'so Dora is still a member');
SELECT is((SELECT return_allowed_at FROM institution.course_member WHERE id = pg_temp.id('ana_k1_again')), NULL::timestamptz,
  'and Ana''s second removal still blocks her');
SELECT is(pg_temp.events(), 4::bigint, 'and no row was written');

-- Append-only, for the owner too; the checks hold.
SELECT is(pg_temp.as_owner($$ UPDATE audit.course_member_event SET kind = 'return_allowed' RETURNING 'changed' $$),
  'ZD403: append-only row', 'the owner cannot change a row');
SELECT is(pg_temp.as_owner($$ UPDATE audit.course_member_event SET actor_id = {marko} RETURNING 'changed' $$),
  'ZD403: append-only row', 'the owner cannot rewrite who acted');
SELECT is(pg_temp.as_owner($$ DELETE FROM audit.course_member_event RETURNING 'deleted' $$),
  'ZD403: append-only row', 'the owner cannot delete a row');
SELECT is(pg_temp.as_owner('TRUNCATE audit.course_member_event'), 'ZD403: append-only row', 'the owner cannot empty the table');
SELECT is(left(pg_temp.as_owner($$ INSERT INTO audit.course_member_event (institution_id, course_id, membership_id, student_id, kind, actor_id, occurred_at)
  VALUES ({fak_a}, {k1}, {ana_k1}, {ana}, 'removed', {vesna}, now()) RETURNING 'written' $$), 6), '23505:', 'a second row of one kind for one membership is refused');
SELECT is(left(pg_temp.as_owner($$ INSERT INTO audit.course_member_event (institution_id, course_id, membership_id, student_id, kind, actor_id, occurred_at)
  VALUES ({fak_a}, {k1}, {ana_k1}, {ana}, 'enrolled', {vesna}, now()) RETURNING 'written' $$), 6), '23514:', 'a kind outside the list is refused');
SELECT is(left(pg_temp.as_owner($$ INSERT INTO audit.course_member_event (institution_id, course_id, membership_id, student_id, kind, actor_id, occurred_at)
  VALUES ({fak_a}, {k1}, {ana_k1_again}, {ana}, 'return_allowed', {petra}, now()) RETURNING 'written' $$), 6), '23503:', 'an actor of another institution is refused');
SELECT is(left(pg_temp.as_owner($$ INSERT INTO audit.course_member_event (institution_id, course_id, membership_id, student_id, kind, actor_id, occurred_at)
  VALUES ({fak_a}, {k1}, {ana_k1_again}, {tomo}, 'return_allowed', {vesna}, now()) RETURNING 'written' $$), 6), '23503:', 'a student of another institution is refused');
SELECT is(left(pg_temp.as_owner($$ INSERT INTO audit.course_member_event (institution_id, course_id, membership_id, student_id, kind, actor_id, occurred_at)
  VALUES ({fak_a}, {k3}, {ana_k1_again}, {ana}, 'return_allowed', {vesna}, now()) RETURNING 'written' $$), 6), '23503:', 'a course of another institution is refused');
SELECT is(left(pg_temp.as_owner($$ INSERT INTO audit.course_member_event (institution_id, course_id, membership_id, student_id, kind, actor_id, occurred_at)
  VALUES ({fak_a}, {k1}, {nobody}, {ana}, 'return_allowed', {vesna}, now()) RETURNING 'written' $$), 6), '23503:', 'a membership that does not exist is refused');
SELECT is(pg_temp.events(), 4::bigint, 'no refused row was stored');

-- Forced RLS is the protection, not only the missing grants.
GRANT USAGE ON SCHEMA audit TO ductus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON audit.course_member_event TO ductus_app;
SELECT is(pg_temp.ask('vesna', 'SELECT count(*) FROM audit.course_member_event'), '0',
  'with a mistaken grant the web role still reads no row');
SELECT is(left(pg_temp.ask('vesna', $$ INSERT INTO audit.course_member_event (institution_id, course_id, membership_id, student_id, kind, actor_id, occurred_at)
  VALUES ({fak_a}, {k1}, {ana_k1_again}, {ana}, 'return_allowed', {vesna}, now()) RETURNING 'written' $$), 6),
  '42501:', 'with a mistaken grant the web role still writes no row');
REVOKE SELECT, INSERT, UPDATE, DELETE ON audit.course_member_event FROM ductus_app;
REVOKE USAGE ON SCHEMA audit FROM ductus_app;
SELECT is(pg_temp.events(), 4::bigint, 'the rows are unchanged');

SELECT * FROM finish();
ROLLBACK;

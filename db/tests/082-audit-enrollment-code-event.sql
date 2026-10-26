-- DAN-292: the audit trail of enrollment codes (owner decisions of 25 Oct
-- 2026; contract on #747, comments 6404499871 and 6404516621). Every code
-- that stops being active through revoke_enrollment_code or
-- create_enrollment_code has exactly one row of its kind, written in the same
-- transaction with the caller from the session; a call that switches off no
-- code writes nothing. The table is append-only, owner-only and forced-RLS.
-- Every person, course and code below is invented (fixtures/institution.inc).
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';
SELECT no_plan();

CREATE FUNCTION pg_temp.as_owner(p_sql text) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.ask_as('ductus_identity', 'anon', p_sql) $$;
CREATE FUNCTION pg_temp.events() RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT count(*) FROM audit.enrollment_code_event $$;
CREATE FUNCTION pg_temp.code_id(p_code text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT id FROM institution.course_enrollment_code WHERE code_hash = pg_temp.code_hash(p_code) $$;
CREATE FUNCTION pg_temp.active_id(p_course text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT id FROM institution.course_enrollment_code WHERE course_id = pg_temp.id(p_course) AND active $$;
-- One event as "kind actor course institution", by the code it names.
CREATE FUNCTION pg_temp.event(p_code_id uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT e.kind || ' ' || p.name || ' ' || c.name || ' ' || f.name
    FROM audit.enrollment_code_event e
    JOIN person p ON p.id = e.actor_id
    JOIN ref c ON c.val = e.course_id::text
    JOIN ref f ON f.val = e.institution_id::text
   WHERE e.code_id = p_code_id
$$;
INSERT INTO ref VALUES ('code_k1', pg_temp.code_id('KOD-K1-TEST')::text);

-- Catalogue: owner, forced RLS, the only policy, the columns, one row per code.
SELECT has_table('audit', 'enrollment_code_event', 'enrollment code events have their own table');
SELECT row_eq(
  $$ SELECT relowner::regrole::text, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'audit.enrollment_code_event'::regclass $$,
  ROW('ductus_identity'::text, true, true), 'the identity role owns the table and RLS is enabled and forced');
SELECT bag_eq(
  $$ SELECT polname::text, polroles::regrole[]::text FROM pg_policy WHERE polrelid = 'audit.enrollment_code_event'::regclass $$,
  $$ VALUES ('enrollment_code_event_owner', '{ductus_identity}') $$, 'the only policy is the owner''s');
SELECT columns_are('audit', 'enrollment_code_event', ARRAY[
  'id', 'institution_id', 'course_id', 'code_id', 'kind', 'actor_id', 'occurred_at'
], 'the table has exactly the listed columns: no code text, no session, no address');
SELECT col_is_unique('audit', 'enrollment_code_event', 'code_id', 'a code stops being active at most once');

-- Nobody but the owner reaches the table.
SELECT is_empty(
  $$ SELECT a.grantee::regrole::text FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid = 'audit.enrollment_code_event'::regclass AND a.grantee <> c.relowner $$,
  'no role but the owner has any privilege on the table');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p
  CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence', 'ductus_migrator']) AS r
  WHERE has_table_privilege(r, 'audit.enrollment_code_event', p)
), 'no other role reads, writes or empties the table directly');
SELECT is(pg_temp.ask('vesna', 'SELECT count(*) FROM audit.enrollment_code_event'),
  '42501: permission denied for schema audit', 'the web role cannot read the events');
SELECT is(pg_temp.ask('vesna', $$ INSERT INTO audit.enrollment_code_event (institution_id, course_id, code_id, kind, actor_id, occurred_at)
  VALUES ({fak_a}, {k1}, {code_k1}, 'revoked', {vesna}, now()) RETURNING 'written' $$),
  '42501: permission denied for schema audit', 'the web role cannot write an event');
SELECT is(pg_temp.events(), 0::bigint, 'the fixture starts without events');

-- Refused calls write nothing (no session, not a teacher of the course,
-- another institution, a course that does not exist, an invalid time).
SELECT is(pg_temp.ask(v.actor, format('SELECT institution.%s', v.call)), v.answer, v.actor || ': ' || v.call)
FROM (VALUES
  (1, 'anon', 'revoke_enrollment_code({k1})', 'ZD401: not authenticated'),
  (2, 'closed', $$create_enrollment_code({k1}, now() + interval '1 day')$$, 'ZD401: not authenticated'),
  (3, 'marko', 'revoke_enrollment_code({k1})', 'ZD403: forbidden'),
  (4, 'ana', $$create_enrollment_code({k1}, now() + interval '1 day')$$, 'ZD403: forbidden'),
  (5, 'petra', 'revoke_enrollment_code({k1})', 'ZD403: forbidden'),
  (6, 'vesna', 'revoke_enrollment_code({k3})', 'ZD403: forbidden'),
  (7, 'vesna', 'revoke_enrollment_code({nobody})', 'ZD403: forbidden'),
  (8, 'vesna', $$create_enrollment_code({k1}, now() - interval '1 day')$$, 'ZD422: invalid input')
) AS v (n, actor, call, answer)
ORDER BY v.n;
SELECT is(pg_temp.events(), 0::bigint, 'the refused calls wrote no event');
SELECT is((SELECT count(*) FROM institution.course_enrollment_code WHERE active), 3::bigint, 'and switched off no code');

-- Revocation: one 'revoked' row for the code that was active, by the caller.
SELECT is(pg_temp.ask('vesna', 'SELECT institution.revoke_enrollment_code({k1})::text'), 'true', 'Vesna revokes the code of K1');
SELECT is(pg_temp.event(pg_temp.code_id('KOD-K1-TEST')), 'revoked vesna k1 fak_a', 'the revoked code has its row: kind, who, course, institution');
SELECT is((SELECT occurred_at FROM audit.enrollment_code_event WHERE code_id = pg_temp.code_id('KOD-K1-TEST')), now(),
  'the time is the database time of the change');
SELECT is(pg_temp.ask('vesna', 'SELECT institution.revoke_enrollment_code({k1})::text'), 'false', 'nothing is left to revoke');
SELECT is(pg_temp.events(), 1::bigint, 'and the second call wrote nothing');
SELECT is(pg_temp.event(pg_temp.code_id('KOD-K1-STARI')), NULL::text, 'the code that was already inactive has no row');

-- Replacement: the first code of a course replaces nothing; the next one
-- writes 'replaced' for exactly the code it switched off.
SELECT matches(pg_temp.ask('vesna', $$ SELECT institution.create_enrollment_code({k1}, now() + interval '7 days') $$), '^[0-9A-F]{4}(-[0-9A-F]{4}){3}$', 'Vesna issues a new code');
SELECT is(pg_temp.events(), 1::bigint, 'with no active code nothing was replaced and nothing written');
INSERT INTO ref VALUES ('first_new', pg_temp.active_id('k1')::text);
SELECT matches(pg_temp.ask('vesna', $$ SELECT institution.create_enrollment_code({k1}, now() + interval '7 days') $$), '^[0-9A-F]{4}(-[0-9A-F]{4}){3}$', 'Vesna issues another code');
SELECT is(pg_temp.event(pg_temp.id('first_new')), 'replaced vesna k1 fak_a', 'the code it switched off has a replaced row');
SELECT is(pg_temp.event(pg_temp.active_id('k1')), NULL::text, 'the new active code has none');
-- An expired code still marked active is switched off by the new code too.
SELECT matches(pg_temp.ask('marko', $$ SELECT institution.create_enrollment_code({k2}, now() + interval '7 days') $$), '^[0-9A-F]{4}(-[0-9A-F]{4}){3}$', 'Marko replaces the expired code of K2');
SELECT is(pg_temp.event(pg_temp.code_id('KOD-K2-ISTEKAO')), 'replaced marko k2 fak_a', 'the expired code that was still active has its row');
SELECT matches(pg_temp.ask('petra', $$ SELECT institution.create_enrollment_code({k3}, now() + interval '7 days') $$), '^[0-9A-F]{4}(-[0-9A-F]{4}){3}$', 'Petra replaces the code of K3');
SELECT is(pg_temp.event(pg_temp.code_id('KOD-K3-TEST')), 'replaced petra k3 fak_b', 'another institution''s row carries its own institution');
SELECT is(pg_temp.events(), 4::bigint, 'one row per code that stopped being active');
SELECT is(
  (SELECT count(*) FROM institution.course_enrollment_code c
    WHERE NOT c.active AND NOT EXISTS (SELECT 1 FROM audit.enrollment_code_event e WHERE e.code_id = c.id)),
  1::bigint, 'every inactive code has a row except the one that was inactive before this migration');

-- No change without its row: when the row cannot be written, the code stays.
CREATE TRIGGER enrollment_code_event_refuse_insert BEFORE INSERT ON audit.enrollment_code_event
  FOR EACH ROW EXECUTE FUNCTION audit.reject_change();
INSERT INTO ref VALUES ('k1_active', pg_temp.active_id('k1')::text);
SELECT is(pg_temp.ask('vesna', 'SELECT institution.revoke_enrollment_code({k1})::text'), 'ZD403: append-only row',
  'a revocation whose row cannot be written fails');
SELECT is(pg_temp.ask('vesna', $$ SELECT institution.create_enrollment_code({k1}, now() + interval '7 days') $$), 'ZD403: append-only row',
  'a replacement whose row cannot be written fails');
DROP TRIGGER enrollment_code_event_refuse_insert ON audit.enrollment_code_event;
SELECT is(pg_temp.active_id('k1'), pg_temp.id('k1_active'), 'and the code of K1 is still the active one');
SELECT is((SELECT count(*) FROM institution.course_enrollment_code WHERE course_id = pg_temp.id('k1')), 4::bigint, 'with no new code issued');
SELECT is(pg_temp.events(), 4::bigint, 'and no row written');

-- Append-only, for the owner too; the checks hold.
SELECT is(pg_temp.as_owner($$ UPDATE audit.enrollment_code_event SET kind = 'replaced' RETURNING 'changed' $$),
  'ZD403: append-only row', 'the owner cannot change a row');
SELECT is(pg_temp.as_owner($$ UPDATE audit.enrollment_code_event SET actor_id = {marko} RETURNING 'changed' $$),
  'ZD403: append-only row', 'the owner cannot rewrite who acted');
SELECT is(pg_temp.as_owner($$ DELETE FROM audit.enrollment_code_event RETURNING 'deleted' $$),
  'ZD403: append-only row', 'the owner cannot delete a row');
SELECT is(pg_temp.as_owner('TRUNCATE audit.enrollment_code_event'), 'ZD403: append-only row', 'the owner cannot empty the table');
SELECT is(left(pg_temp.as_owner($$ INSERT INTO audit.enrollment_code_event (institution_id, course_id, code_id, kind, actor_id, occurred_at)
  VALUES ({fak_a}, {k1}, {code_k1}, 'replaced', {vesna}, now()) RETURNING 'written' $$), 6), '23505:', 'a second row for one code is refused');
SELECT is(left(pg_temp.as_owner($$ INSERT INTO audit.enrollment_code_event (institution_id, course_id, code_id, kind, actor_id, occurred_at)
  VALUES ({fak_a}, {k1}, {k1_active}, 'issued', {vesna}, now()) RETURNING 'written' $$), 6), '23514:', 'a kind outside the list is refused');
SELECT is(left(pg_temp.as_owner($$ INSERT INTO audit.enrollment_code_event (institution_id, course_id, code_id, kind, actor_id, occurred_at)
  VALUES ({fak_a}, {k1}, {k1_active}, 'revoked', {petra}, now()) RETURNING 'written' $$), 6), '23503:', 'an actor of another institution is refused');
SELECT is(left(pg_temp.as_owner($$ INSERT INTO audit.enrollment_code_event (institution_id, course_id, code_id, kind, actor_id, occurred_at)
  VALUES ({fak_a}, {k3}, {k1_active}, 'revoked', {vesna}, now()) RETURNING 'written' $$), 6), '23503:', 'a course of another institution is refused');
SELECT is(pg_temp.events(), 4::bigint, 'no refused row was stored');

-- Forced RLS is the protection, not only the missing grants.
GRANT USAGE ON SCHEMA audit TO ductus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON audit.enrollment_code_event TO ductus_app;
SELECT is(pg_temp.ask('vesna', 'SELECT count(*) FROM audit.enrollment_code_event'), '0',
  'with a mistaken grant the web role still reads no row');
SELECT is(left(pg_temp.ask('vesna', $$ INSERT INTO audit.enrollment_code_event (institution_id, course_id, code_id, kind, actor_id, occurred_at)
  VALUES ({fak_a}, {k1}, {k1_active}, 'revoked', {vesna}, now()) RETURNING 'written' $$), 6),
  '42501:', 'with a mistaken grant the web role still writes no row');
REVOKE SELECT, INSERT, UPDATE, DELETE ON audit.enrollment_code_event FROM ductus_app;
REVOKE USAGE ON SCHEMA audit FROM ductus_app;
SELECT is(pg_temp.events(), 4::bigint, 'the rows are unchanged');

SELECT * FROM finish();
ROLLBACK;

-- DAN-497 (M2.2-P03, #1263, Poznate granice t. 1; contract on #1091,
-- comment 6581690986): the audit trail of confirmed and revoked teacher roles.
-- Every role row that confirm_teacher_role confirms and every role row that
-- revoke_teacher_role revokes has exactly one row of its kind, written in the
-- same transaction with the administrator from the session; a call that
-- changes no role writes nothing. The table is append-only, owner-only and
-- forced-RLS. Every person below is invented (fixtures/institution.inc).
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';
SELECT no_plan();

-- The right from the last login (DAN-304) for the candidates confirmed below;
-- Ana has none.
INSERT INTO identity.teacher_eligibility (user_id, institution_id)
SELECT id, institution_id FROM identity.user_account
 WHERE id IN (pg_temp.id('nina'), pg_temp.id('boris'), pg_temp.id('dora'), pg_temp.id('vesna'), pg_temp.id('marko'));

CREATE FUNCTION pg_temp.as_owner(p_sql text) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.ask_as('ductus_identity', 'anon', p_sql) $$;
-- Counts stay inside the fixture's two institutions, so rows another suite left
-- on a shared stack never move them.
CREATE FUNCTION pg_temp.ours(p_institution uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT p_institution IN (pg_temp.id('fak_a'), pg_temp.id('fak_b')) $$;
CREATE FUNCTION pg_temp.events() RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT count(*) FROM audit.teacher_role_event WHERE pg_temp.ours(institution_id) $$;
-- The teacher role rows of a person, the one in force first.
CREATE FUNCTION pg_temp.role_row(p_name text, p_nth integer DEFAULT 1) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT id FROM institution.institution_role
   WHERE user_id = pg_temp.id(p_name) AND role = 'teacher'
   ORDER BY revoked_at NULLS FIRST, id OFFSET p_nth - 1 LIMIT 1
$$;
-- The events of one role row as "kind actor teacher role institution", by kind.
CREATE FUNCTION pg_temp.event(p_role uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT string_agg(e.kind || ' ' || a.name || ' ' || t.name || ' ' || e.role || ' ' || f.name, ', ' ORDER BY e.kind)
    FROM audit.teacher_role_event e
    JOIN person a ON a.id = e.actor_id
    JOIN person t ON t.id = e.teacher_id
    JOIN ref f ON f.val = e.institution_id::text
   WHERE e.role_id = p_role
$$;
INSERT INTO ref VALUES
  ('vesna_role', pg_temp.role_row('vesna')::text),
  ('nina_role', pg_temp.role_row('nina')::text),
  ('iva_admin', (SELECT id FROM institution.institution_role WHERE user_id = pg_temp.id('iva') AND role = 'admin')::text);

-- Catalogue: owner, forced RLS, the only policy, the columns, one row per role row and kind.
SELECT has_table('audit', 'teacher_role_event', 'confirmations and revocations have their own table');
SELECT row_eq(
  $$ SELECT relowner::regrole::text, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'audit.teacher_role_event'::regclass $$,
  ROW('ductus_identity'::text, true, true), 'the identity role owns the table and RLS is enabled and forced');
SELECT bag_eq(
  $$ SELECT polname::text, polroles::regrole[]::text FROM pg_policy WHERE polrelid = 'audit.teacher_role_event'::regclass $$,
  $$ VALUES ('teacher_role_event_owner', '{ductus_identity}') $$, 'the only policy is the owner''s');
SELECT columns_are('audit', 'teacher_role_event', ARRAY[
  'id', 'institution_id', 'role_id', 'teacher_id', 'role', 'kind', 'actor_id', 'occurred_at'
], 'the table has exactly the listed columns: no session, no address, no reason');
SELECT col_is_unique('audit', 'teacher_role_event', ARRAY['role_id', 'kind'], 'one row per role row and kind');
SELECT fk_ok('audit', 'teacher_role_event', ARRAY['role_id', 'institution_id', 'teacher_id', 'role'],
  'institution', 'institution_role', ARRAY['id', 'institution_id', 'user_id', 'role'],
  'the event row names its role row with institution, teacher and role');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger WHERE tgrelid = 'audit.teacher_role_event'::regclass AND tgname = 'teacher_role_event_append_only'
), 'the table has its append-only trigger');

-- Nobody but the owner reaches the table.
SELECT is_empty(
  $$ SELECT a.grantee::regrole::text FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid = 'audit.teacher_role_event'::regclass AND a.grantee <> c.relowner $$,
  'no role but the owner has any privilege on the table');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p
  CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence', 'ductus_migrator']) AS r
  WHERE has_table_privilege(r, 'audit.teacher_role_event', p)
), 'no other role reads, writes or empties the table directly');
SELECT is(pg_temp.ask('iva', 'SELECT count(*) FROM audit.teacher_role_event'),
  '42501: permission denied for schema audit', 'the web role cannot read the events, not even as an administrator');
SELECT is(pg_temp.ask('iva', $$ INSERT INTO audit.teacher_role_event (institution_id, role_id, teacher_id, role, kind, actor_id, occurred_at)
  VALUES ({fak_a}, {vesna_role}, {vesna}, 'teacher', 'revoked', {iva}, now()) RETURNING 'written' $$),
  '42501: permission denied for schema audit', 'the web role cannot write an event');
SELECT is(pg_temp.events(), 0::bigint, 'the fixture starts without events');

-- Refused calls write nothing (no session, not an administrator, another
-- institution, the own account, no right from the login).
SELECT is(pg_temp.ask(v.actor, format('SELECT institution.%s', v.call)), v.answer, v.actor || ': ' || v.call)
FROM (VALUES
  (1, 'anon', 'confirm_teacher_role({boris})', 'ZD401: not authenticated'),
  (2, 'closed', 'revoke_teacher_role({vesna})', 'ZD401: not authenticated'),
  (3, 'vesna', 'confirm_teacher_role({boris})', 'ZD403: forbidden'),
  (4, 'lea', 'confirm_teacher_role({nina})', 'ZD403: forbidden'),
  (5, 'iva', 'confirm_teacher_role({tomo})', 'ZD403: forbidden'),
  (6, 'iva', 'confirm_teacher_role({iva})', 'ZD403: forbidden'),
  (7, 'iva', 'confirm_teacher_role({ana})', 'ZD403: forbidden'),
  (8, 'iva', 'confirm_teacher_role({nobody})', 'ZD403: forbidden'),
  (9, 'vesna', 'revoke_teacher_role({marko})', 'ZD403: forbidden'),
  (10, 'ana', 'revoke_teacher_role({vesna})', 'ZD403: forbidden')
) AS v (n, actor, call, answer)
ORDER BY v.n;
-- Calls that find nothing to change write nothing.
SELECT is(pg_temp.ask(v.actor, format('SELECT institution.revoke_teacher_role(%s)::text', v.teacher)), 'false', v.actor || ': ' || v.why)
FROM (VALUES
  (1, 'iva', '{nina}', 'a role nobody confirmed is not revoked'),
  (2, 'iva', '{ana}', 'a person without a teacher role has nothing to revoke'),
  (3, 'iva', '{iva}', 'an administrator role is not a teacher role'),
  (4, 'lea', '{vesna}', 'a teacher of another institution is not revoked')
) AS v (n, actor, teacher, why)
ORDER BY v.n;
SELECT is(pg_temp.ask('iva', $$ SELECT 'done' FROM institution.confirm_teacher_role({marko}) $$), 'done',
  'confirming a teacher already confirmed succeeds');
SELECT is(pg_temp.events(), 0::bigint, 'the refused and empty calls wrote no event');
SELECT is(
  (SELECT count(*) || ' ' || count(*) FILTER (WHERE confirmed_at IS NULL) || ' ' || count(*) FILTER (WHERE revoked_at IS NOT NULL)
     FROM institution.institution_role WHERE pg_temp.ours(institution_id)),
  '6 1 0', 'and changed no role');

-- Confirmation of a role row that exists unconfirmed: one 'confirmed' row by the caller.
SELECT is(pg_temp.ask('iva', $$ SELECT 'done' FROM institution.confirm_teacher_role({nina}) $$), 'done', 'Iva confirms Nina');
SELECT is(pg_temp.event(pg_temp.id('nina_role')), 'confirmed iva nina teacher fak_a',
  'the confirmed role row has its row: kind, who, whom, role, institution');
SELECT is((SELECT occurred_at FROM audit.teacher_role_event WHERE role_id = pg_temp.id('nina_role')), now(),
  'the time is the database time of the change');
SELECT is(
  (SELECT r.confirmed_by = e.actor_id AND r.confirmed_at = e.occurred_at
     FROM institution.institution_role r JOIN audit.teacher_role_event e ON e.role_id = r.id
    WHERE r.id = pg_temp.id('nina_role')),
  true, 'the row agrees with the confirmation on the role row');
SELECT is(pg_temp.ask('iva', $$ SELECT 'done' FROM institution.confirm_teacher_role({nina}) $$), 'done', 'confirming Nina again succeeds');
SELECT is(pg_temp.events(), 1::bigint, 'and wrote nothing');

-- Confirmation of a person with no role row: the new role row has its row.
SELECT is(pg_temp.ask('iva', $$ SELECT 'done' FROM institution.confirm_teacher_role({boris}) $$), 'done', 'Iva confirms Boris');
SELECT is(pg_temp.event(pg_temp.role_row('boris')), 'confirmed iva boris teacher fak_a', 'the new role row has its row');
SELECT is(pg_temp.events(), 2::bigint, 'two rows on two role rows');

-- Revocation: one 'revoked' row for the role row it ends.
SELECT is(pg_temp.ask('iva', 'SELECT institution.revoke_teacher_role({vesna})::text'), 'true', 'Iva revokes the teacher role of Vesna');
SELECT is(pg_temp.event(pg_temp.id('vesna_role')), 'revoked iva vesna teacher fak_a', 'the revoked role row has its row');
SELECT is(
  (SELECT r.revoked_at = e.occurred_at FROM institution.institution_role r JOIN audit.teacher_role_event e ON e.role_id = r.id
    WHERE r.id = pg_temp.id('vesna_role')),
  true, 'at the time the role row was revoked');
SELECT is(pg_temp.ask('iva', 'SELECT institution.revoke_teacher_role({vesna})::text'), 'false', 'revoking it again finds nothing');
SELECT is(pg_temp.events(), 3::bigint, 'and wrote nothing');

-- Vesna confirmed anew is a new role row with its own row; the old one keeps its own.
SELECT is(pg_temp.ask('iva', $$ SELECT 'done' FROM institution.confirm_teacher_role({vesna}) $$), 'done', 'Iva confirms Vesna anew');
INSERT INTO ref VALUES ('vesna_role_again', pg_temp.role_row('vesna', 1)::text);
SELECT isnt(pg_temp.id('vesna_role_again'), pg_temp.id('vesna_role'), 'as a new role row');
SELECT is(pg_temp.event(pg_temp.id('vesna_role_again')), 'confirmed iva vesna teacher fak_a', 'the new role row has its own row');
SELECT is(pg_temp.event(pg_temp.id('vesna_role')), 'revoked iva vesna teacher fak_a', 'and the old one only its revocation');
-- Another institution's row carries its own institution and administrator.
SELECT is(pg_temp.ask('lea', 'SELECT institution.revoke_teacher_role({petra})::text'), 'true', 'Lea revokes the teacher role of Petra');
SELECT is(pg_temp.event(pg_temp.role_row('petra')), 'revoked lea petra teacher fak_b', 'with fak_b and Lea in the row');
SELECT is(
  (SELECT count(*) FROM institution.institution_role r
    WHERE r.revoked_at IS NOT NULL AND pg_temp.ours(r.institution_id)
      AND NOT EXISTS (SELECT 1 FROM audit.teacher_role_event e WHERE e.role_id = r.id AND e.kind = 'revoked')),
  0::bigint, 'every revoked role row has its revoked row');
SELECT is(pg_temp.events(), 5::bigint, 'five rows in all');

-- No change without its row: when the row cannot be written, nothing changes.
CREATE TRIGGER teacher_role_event_refuse_insert BEFORE INSERT ON audit.teacher_role_event
  FOR EACH ROW EXECUTE FUNCTION audit.reject_change();
SELECT is(pg_temp.ask('iva', 'SELECT institution.confirm_teacher_role({dora})::text'), 'ZD403: append-only row',
  'a confirmation whose row cannot be written fails');
SELECT is(pg_temp.ask('iva', 'SELECT institution.revoke_teacher_role({marko})::text'), 'ZD403: append-only row',
  'a revocation whose row cannot be written fails');
DROP TRIGGER teacher_role_event_refuse_insert ON audit.teacher_role_event;
SELECT is(pg_temp.ask('dora', $$ SELECT institution.actor_has_role('teacher')::text $$), 'false', 'so Dora holds no teacher role');
SELECT is((SELECT count(*) FROM institution.institution_role WHERE user_id = pg_temp.id('dora')), 0::bigint, 'and has no role row');
SELECT is(pg_temp.ask('marko', $$ SELECT institution.actor_has_role('teacher')::text $$), 'true', 'and Marko still holds his');
SELECT is(pg_temp.events(), 5::bigint, 'and no row was written');

-- Append-only, for the owner too; the checks hold.
SELECT is(pg_temp.as_owner($$ UPDATE audit.teacher_role_event SET kind = 'confirmed' RETURNING 'changed' $$),
  'ZD403: append-only row', 'the owner cannot change a row');
SELECT is(pg_temp.as_owner($$ UPDATE audit.teacher_role_event SET actor_id = {marko} RETURNING 'changed' $$),
  'ZD403: append-only row', 'the owner cannot rewrite who acted');
SELECT is(pg_temp.as_owner($$ DELETE FROM audit.teacher_role_event RETURNING 'deleted' $$),
  'ZD403: append-only row', 'the owner cannot delete a row');
SELECT is(pg_temp.as_owner('TRUNCATE audit.teacher_role_event'), 'ZD403: append-only row', 'the owner cannot empty the table');
SELECT is(left(pg_temp.as_owner(format($$ INSERT INTO audit.teacher_role_event (institution_id, role_id, teacher_id, role, kind, actor_id, occurred_at)
  VALUES ({fak_a}, {vesna_role}, {vesna}, 'teacher', %L, {iva}, now()) RETURNING 'written' $$, v.kind)), 6), v.code, v.why)
FROM (VALUES
  (1, 'revoked', '23505:', 'a second row of one kind for one role row is refused'),
  (2, 'removed', '23514:', 'a kind outside the list is refused')
) AS v (n, kind, code, why)
ORDER BY v.n;
SELECT is(left(pg_temp.as_owner(format($$ INSERT INTO audit.teacher_role_event (institution_id, role_id, teacher_id, role, kind, actor_id, occurred_at)
  VALUES (%s, %s, %s, %L, 'confirmed', %s, now()) RETURNING 'written' $$, v.inst, v.role_id, v.teacher, v.role, v.actor)), 6), v.code, v.why)
FROM (VALUES
  (1, '{fak_a}', '{vesna_role}', '{vesna}', 'teacher', '{lea}', '23503:', 'an actor of another institution is refused'),
  (2, '{fak_a}', '{nobody}', '{vesna}', 'teacher', '{iva}', '23503:', 'a role row that does not exist is refused'),
  (3, '{fak_a}', '{vesna_role}', '{marko}', 'teacher', '{iva}', '23503:', 'another teacher of the same institution is refused for Vesna''s role row'),
  (4, '{fak_b}', '{vesna_role}', '{vesna}', 'teacher', '{lea}', '23503:', 'another institution is refused for Vesna''s role row'),
  (5, '{fak_a}', '{iva_admin}', '{iva}', 'teacher', '{iva}', '23503:', 'an administrator role row is refused as a teacher role'),
  (6, '{fak_a}', '{iva_admin}', '{iva}', 'admin', '{iva}', '23514:', 'a role other than teacher is refused')
) AS v (n, inst, role_id, teacher, role, actor, code, why)
ORDER BY v.n;
SELECT is(pg_temp.events(), 5::bigint, 'no refused row was stored');

-- Forced RLS is the protection, not only the missing grants.
GRANT USAGE ON SCHEMA audit TO ductus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON audit.teacher_role_event TO ductus_app;
SELECT is(pg_temp.ask('iva', 'SELECT count(*) FROM audit.teacher_role_event'), '0',
  'with a mistaken grant the web role still reads no row');
SELECT is(left(pg_temp.ask('iva', $$ INSERT INTO audit.teacher_role_event (institution_id, role_id, teacher_id, role, kind, actor_id, occurred_at)
  VALUES ({fak_a}, {nina_role}, {nina}, 'teacher', 'revoked', {iva}, now()) RETURNING 'written' $$), 6),
  '42501:', 'with a mistaken grant the web role still writes no row');
REVOKE SELECT, INSERT, UPDATE, DELETE ON audit.teacher_role_event FROM ductus_app;
REVOKE USAGE ON SCHEMA audit FROM ductus_app;
SELECT is(pg_temp.events(), 5::bigint, 'the rows are unchanged');

SELECT * FROM finish();
ROLLBACK;

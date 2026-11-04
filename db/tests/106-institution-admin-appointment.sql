-- DAN-525 (M2.A, D-262 Q04; contract on #1091, comment 6644919534): only the
-- operator appoints and revokes an institution administrator, on the
-- faculty's written request, and the reference to that request is written to
-- the trail (audit.teacher_role_event, role 'admin', no actor). The web role
-- and every other login role reach neither procedure; a direct write of an
-- active administrator, by the owner too, is refused at commit, and so is a
-- revocation outside the procedure that would leave the institution without
-- an administrator. Every person and request below is invented
-- (fixtures/institution.inc); the fixture already appoints Iva (fak_a) and
-- Lea (fak_b) through the procedure.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';
SELECT no_plan();

-- The commit-time checks run at the end of each statement here.
SET CONSTRAINTS ALL IMMEDIATE;

-- The operator is the superuser of the database; the owner is the role that
-- owns the tables. Both return "SQLSTATE: message" on failure.
CREATE FUNCTION pg_temp.op(p_sql text) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.ask_as('ductus', 'anon', p_sql) $$;
CREATE FUNCTION pg_temp.as_owner(p_sql text) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.ask_as('ductus_identity', 'anon', p_sql) $$;
CREATE FUNCTION pg_temp.admin_events() RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM audit.teacher_role_event
   WHERE institution_id IN (pg_temp.id('fak_a'), pg_temp.id('fak_b')) AND role = 'admin'
$$;
-- The administrator rows of a person as "confirmed? revoked?" in creation order.
CREATE FUNCTION pg_temp.admin_rows(p_name text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg((confirmed_at IS NOT NULL)::text || ' ' || (revoked_at IS NOT NULL)::text, ', '
                             ORDER BY revoked_at NULLS LAST, id), '')
    FROM institution.institution_role WHERE user_id = pg_temp.id(p_name) AND role = 'admin'
$$;
-- The trail of a person's administrator rows as "kind institution ref actor?".
CREATE FUNCTION pg_temp.trail(p_name text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT string_agg(e.kind || ' ' || f.name || ' ' || e.request_ref || ' ' || (e.actor_id IS NULL)::text, ', '
                    ORDER BY e.occurred_at, e.kind)
    FROM audit.teacher_role_event e
    JOIN institution.institution_role r ON r.id = e.role_id AND r.institution_id = e.institution_id
    JOIN ref f ON f.val = e.institution_id::text
   WHERE e.teacher_id = pg_temp.id(p_name) AND e.role = 'admin'
$$;

-- 1. Catalogue: definer procedures, and EXECUTE for no login role at all.
SELECT is(
  (SELECT string_agg(p.proname || ' ' || p.prosecdef::text, ', ' ORDER BY p.proname)
     FROM pg_proc p WHERE p.pronamespace = 'institution'::regnamespace
      AND p.proname IN ('appoint_institution_admin', 'revoke_institution_admin', 'require_admin_request')),
  'appoint_institution_admin true, require_admin_request false, revoke_institution_admin true',
  'the two procedures run as the owner; the shared check runs as its caller');
SELECT is_empty(
  $$ SELECT r.rolname || ' ' || f.fn
       FROM pg_roles r,
            unnest(ARRAY['institution.appoint_institution_admin(uuid, text)', 'institution.revoke_institution_admin(uuid, text)',
                         'institution.require_admin_request(uuid, text)', 'institution.check_admin_appointment()',
                         'institution.check_last_admin()']) AS f (fn)
      WHERE r.rolname IN ('ductus_app', 'ductus_worker', 'ductus_auth', 'ductus_retention', 'ductus_evidence', 'ductus_migrator')
        AND has_function_privilege(r.rolname, f.fn::regprocedure, 'EXECUTE') $$,
  'no login role, web or background, may execute the procedures or their checks');
SELECT is_empty(
  $$ SELECT p.proname FROM pg_proc p, aclexplode(p.proacl) a
      WHERE p.pronamespace = 'institution'::regnamespace AND a.grantee = 0
        AND p.proname IN ('appoint_institution_admin', 'revoke_institution_admin', 'require_admin_request',
                          'check_admin_appointment', 'check_last_admin') $$,
  'PUBLIC has no EXECUTE on any of them');

-- 2. Nobody through the web role can appoint or revoke: not a student, not a
-- teacher, not the administrator of the same institution, not the
-- administrator of another one.
SELECT is(left(pg_temp.ask(v.actor, format($$ SELECT institution.%s(%s, 'Zahtjev 7/2026')::text $$, v.fn, v.target)), 6),
  '42501:', v.why)
FROM (VALUES
  (1, 'ana', 'appoint_institution_admin', '{ana}', 'a student cannot appoint herself'),
  (2, 'vesna', 'appoint_institution_admin', '{vesna}', 'a teacher cannot appoint herself'),
  (3, 'vesna', 'appoint_institution_admin', '{marko}', 'a teacher cannot appoint a colleague'),
  (4, 'iva', 'appoint_institution_admin', '{marko}', 'an administrator cannot appoint another administrator'),
  (5, 'lea', 'appoint_institution_admin', '{vesna}', 'the administrator of another institution cannot appoint'),
  (6, 'iva', 'revoke_institution_admin', '{iva}', 'an administrator cannot revoke herself'),
  (7, 'lea', 'revoke_institution_admin', '{iva}', 'the administrator of another institution cannot revoke'),
  (8, 'iva', 'require_admin_request', '{marko}', 'the web role cannot reach the shared check either')
) AS v (n, actor, fn, target, why)
ORDER BY v.n;
SELECT is(left(pg_temp.ask_as(v.role, 'anon', $$ SELECT institution.appoint_institution_admin({marko}, 'Zahtjev 7/2026')::text $$), 6),
  '42501:', v.role || ' cannot appoint')
FROM unnest(ARRAY['ductus_worker', 'ductus_auth', 'ductus_retention', 'ductus_evidence']) AS v (role);
SELECT is(pg_temp.admin_rows('marko'), '', 'none of the refused calls wrote a role row');
SELECT is(pg_temp.admin_events(), 2::bigint, 'and none wrote an event: only the fixture''s two appointments');

-- 3. The request reference must be a plain label: present, at most 200
-- characters, without surrounding space, line breaks or invisible marks.
SELECT is(pg_temp.op(format('SELECT institution.appoint_institution_admin(%s, %s)::text', '{marko}', v.ref)),
  'ZD422: invalid input', v.why)
FROM (VALUES
  (1, 'NULL', 'a missing reference is refused'),
  (2, $$''$$, 'an empty reference is refused'),
  (3, $$'   '$$, 'a reference of spaces is refused'),
  (4, $$' Zahtjev 1/2026'$$, 'a leading space is refused'),
  (5, $$'Zahtjev 1/2026 '$$, 'a trailing space is refused'),
  (6, $$E'Zahtjev\n1/2026'$$, 'a line break is refused'),
  (7, $$E'Zahtjev\t1/2026'$$, 'a tab is refused'),
  (8, $$U&'Zahtjev\200B1/2026'$$, 'a zero-width space is refused'),
  (9, $$repeat('a', 201)$$, 'a reference of 201 characters is refused')
) AS v (n, ref, why)
ORDER BY v.n;
SELECT is(pg_temp.op(v.sql), 'ZD422: invalid input', v.why)
FROM (VALUES
  (1, $$ SELECT institution.appoint_institution_admin(NULL, 'Zahtjev 1/2026')::text $$, 'a missing person is refused'),
  (2, $$ SELECT institution.appoint_institution_admin({nobody}, 'Zahtjev 1/2026')::text $$, 'an unknown person is refused'),
  (3, $$ SELECT institution.revoke_institution_admin({nobody}, 'Zahtjev 1/2026')::text $$, 'revoking an unknown person is refused')
) AS v (n, sql, why)
ORDER BY v.n;
SELECT is(pg_temp.admin_events(), 2::bigint, 'no refused call wrote an event');

-- 4. The operator appoints: the person's own institution, the reference in
-- the trail, no actor; a second call for an active administrator is a no-op.
SELECT is(pg_temp.op($$ SELECT institution.appoint_institution_admin({vesna}, 'Dopis dekanata 12/2026, točka 3')::text $$),
  'true', 'the operator appoints a teacher of fak_a on a request with diacritics');
SELECT is(pg_temp.admin_rows('vesna'), 'true false', 'she has one confirmed active administrator row');
SELECT is((SELECT confirmed_by IS NULL FROM institution.institution_role
            WHERE user_id = pg_temp.id('vesna') AND role = 'admin' AND revoked_at IS NULL),
  true, 'confirmed by nobody in the institution: the operator is not a user');
SELECT is(pg_temp.trail('vesna'), 'confirmed fak_a Dopis dekanata 12/2026, točka 3 true',
  'the trail holds her institution and the reference, bound to her role row, with no actor');
SELECT is(pg_temp.op($$ SELECT institution.appoint_institution_admin({vesna}, 'Dopis dekanata 13/2026')::text $$),
  'false', 'appointing an active administrator again changes nothing');
SELECT is(pg_temp.admin_events(), 3::bigint, 'and writes no second event');
SELECT is(pg_temp.op(format('SELECT institution.appoint_institution_admin({petra}, %L)::text', repeat('b', 200))),
  'true', 'a reference of exactly 200 characters is accepted, in the person''s own fak_b');
SELECT is((SELECT f.name FROM institution.institution_role r JOIN ref f ON f.val = r.institution_id::text
            WHERE r.user_id = pg_temp.id('petra') AND r.role = 'admin'), 'fak_b',
  'the institution is always the person''s own');

-- A pending administrator row (written before this procedure, never
-- confirmed) is confirmed by the operator, not duplicated.
SELECT is(pg_temp.as_owner($$ INSERT INTO institution.institution_role (institution_id, user_id, role)
  VALUES ({fak_a}, {marko}, 'admin') RETURNING 'written' $$), 'written', 'an unconfirmed administrator row is not an administrator');
SELECT is(pg_temp.op($$ SELECT institution.appoint_institution_admin({marko}, 'Zahtjev 2/2026')::text $$),
  'true', 'the operator confirms the pending row');
SELECT is(pg_temp.admin_rows('marko'), 'true false', 'still one row, now confirmed');
SELECT is(pg_temp.trail('marko'), 'confirmed fak_a Zahtjev 2/2026 true', 'with its confirmation in the trail');

-- 5. The operator revokes, again with a reference; a second call and a person
-- who is not an administrator change nothing; a new appointment is a new row.
SELECT is(pg_temp.op($$ SELECT institution.revoke_institution_admin({marko}, 'Zahtjev 3/2026')::text $$),
  'true', 'the operator revokes an administrator');
SELECT is(pg_temp.admin_rows('marko'), 'true true', 'the row is revoked, not deleted');
SELECT is(pg_temp.trail('marko'), 'confirmed fak_a Zahtjev 2/2026 true, revoked fak_a Zahtjev 3/2026 true',
  'the revocation and its reference are in the trail');
SELECT is(pg_temp.op($$ SELECT institution.revoke_institution_admin({marko}, 'Zahtjev 3/2026')::text $$),
  'false', 'revoking again changes nothing');
SELECT is(pg_temp.op($$ SELECT institution.revoke_institution_admin({ana}, 'Zahtjev 4/2026')::text $$),
  'false', 'revoking a person who is not an administrator changes nothing');
SELECT is(pg_temp.admin_events(), 6::bigint, 'and neither wrote an event');
SELECT is(pg_temp.op($$ SELECT institution.appoint_institution_admin({marko}, 'Zahtjev 5/2026')::text $$),
  'true', 'the operator appoints him again');
SELECT is(pg_temp.admin_rows('marko'), 'true true, true false', 'on a new row beside the revoked one');

-- 6. Outside the procedure an active administrator cannot be written, by the
-- owner either: not inserted, not confirmed, not promoted, not restored.
SELECT is(pg_temp.as_owner(v.sql), 'ZD409: administrator not appointed by the operator', v.why)
FROM (VALUES
  (1, $$ INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at)
         VALUES ({fak_a}, {dora}, 'admin', now()) RETURNING 'written' $$,
      'a confirmed administrator row cannot be inserted directly'),
  (2, $$ UPDATE institution.institution_role SET role = 'admin', confirmed_at = now()
          WHERE user_id = {nina} AND role = 'teacher' RETURNING 'written' $$,
      'a pending teacher row cannot be turned into a confirmed administrator row')
) AS v (n, sql, why)
ORDER BY v.n;
-- A revoked row restored: Marko's active row is revoked through the procedure
-- first, so only the trigger can refuse the restore of his first one.
SELECT is(pg_temp.op($$ SELECT institution.revoke_institution_admin({marko}, 'Zahtjev 6/2026')::text $$), 'true',
  'the operator revokes Marko''s second row');
SELECT is(pg_temp.as_owner($$ UPDATE institution.institution_role SET revoked_at = NULL
  WHERE id = (SELECT id FROM institution.institution_role WHERE user_id = {marko} AND role = 'admin' ORDER BY id LIMIT 1)
  RETURNING 'written' $$), 'ZD409: administrator not appointed by the operator',
  'a revoked administrator row cannot be restored directly');
SELECT is(pg_temp.as_owner($$ INSERT INTO institution.institution_role (institution_id, user_id, role)
  VALUES ({fak_a}, {dora}, 'admin') RETURNING 'written' $$), 'written', 'a pending administrator row for Dora can be written');
SELECT is(pg_temp.as_owner($$ UPDATE institution.institution_role SET confirmed_at = now()
  WHERE user_id = {dora} AND role = 'admin' RETURNING 'written' $$), 'ZD409: administrator not appointed by the operator',
  'but not confirmed directly');
SELECT is(pg_temp.admin_rows('dora'), 'false false', 'Dora keeps only her pending row');
SELECT is((SELECT role || ' ' || (confirmed_at IS NOT NULL)::text FROM institution.institution_role WHERE user_id = pg_temp.id('nina')),
  'teacher false', 'and Nina only her pending teacher row');

-- 7. The last administrator: outside the procedure the owner cannot revoke
-- the only one of fak_b, but may revoke one of several; the operator may
-- revoke the last one.
SELECT is(pg_temp.op($$ SELECT institution.revoke_institution_admin({petra}, 'Zahtjev 8/2026')::text $$), 'true',
  'the operator revokes Petra, so Lea is again the only administrator of fak_b');
SELECT is(pg_temp.as_owner($$ UPDATE institution.institution_role SET revoked_at = now()
  WHERE user_id = {lea} AND role = 'admin' AND revoked_at IS NULL RETURNING 'written' $$),
  'ZD409: last administrator', 'the last administrator cannot be revoked outside the procedure');
SELECT is(left(pg_temp.as_owner($$ UPDATE institution.institution_role SET role = 'teacher'
  WHERE user_id = {lea} AND role = 'admin' AND revoked_at IS NULL RETURNING 'written' $$), 6),
  '23503:', 'nor turned into a teacher row: the trail''s foreign key holds the row''s role');
SELECT is(pg_temp.as_owner($$ UPDATE institution.institution_role SET confirmed_at = NULL
  WHERE user_id = {lea} AND role = 'admin' AND revoked_at IS NULL RETURNING 'written' $$),
  'ZD409: last administrator', 'nor made pending again');
SELECT is(pg_temp.admin_rows('lea'), 'true false', 'Lea is still the administrator of fak_b');
SELECT is(pg_temp.as_owner($$ UPDATE institution.institution_role SET revoked_at = now()
  WHERE user_id = {vesna} AND role = 'admin' AND revoked_at IS NULL RETURNING 'written' $$),
  'written', 'with Iva still in office, Vesna''s row can be closed without the procedure');
SELECT is(pg_temp.op($$ SELECT institution.revoke_institution_admin({lea}, 'Dopis fakulteta 9/2026')::text $$), 'true',
  'the operator revokes the last administrator of fak_b');
SELECT is(pg_temp.admin_rows('lea'), 'true true', 'fak_b now has no administrator');
SELECT is(pg_temp.trail('lea'), 'confirmed fak_b Zahtjev lea/2026 true, revoked fak_b Dopis fakulteta 9/2026 true',
  'both of Lea''s rows in the trail carry the operator''s references');

-- 8. The operator's rows in the trail are append-only like the others.
SELECT is(pg_temp.as_owner($$ UPDATE audit.teacher_role_event SET request_ref = 'Drugi zahtjev'
  WHERE teacher_id = {lea} RETURNING 'changed' $$), 'ZD403: append-only row', 'a reference cannot be rewritten');

-- 9. An administrator row written before this migration has no event in the
-- trail (a known limit, #1091 c.6645346165). Here Boris's row stands in for
-- one: the appointment check is switched off for this one insert, as no check
-- existed then. The checks look only at a change of state, so such a row is
-- not refused on its first update and the operator can still revoke it.
ALTER TABLE institution.institution_role DISABLE TRIGGER institution_role_admin_appointed;
INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at)
VALUES (pg_temp.id('fak_a'), pg_temp.id('boris'), 'admin', now() - interval '1 year');
ALTER TABLE institution.institution_role ENABLE TRIGGER institution_role_admin_appointed;
SELECT is(pg_temp.trail('boris'), NULL, 'Boris''s older administrator row has no event');
SELECT is(pg_temp.as_owner($$ UPDATE institution.institution_role SET confirmed_at = now()
  WHERE user_id = {boris} AND role = 'admin' RETURNING 'written' $$), 'written',
  'an update that keeps the older row in office is not refused');
SELECT is(pg_temp.op($$ SELECT institution.revoke_institution_admin({boris}, 'Zahtjev 10/2026')::text $$), 'true',
  'the operator revokes the older row');
SELECT is(pg_temp.trail('boris'), 'revoked fak_a Zahtjev 10/2026 true', 'and the trail holds only that revocation');

SELECT * FROM finish();
ROLLBACK;

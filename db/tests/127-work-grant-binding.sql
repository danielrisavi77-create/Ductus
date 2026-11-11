-- DAN-379, M2.8-P02 (contract on #1836, c.6790935730): a grant stays bound
-- to the rows that made it live when it was given, so a revocation, a removal
-- or an ended mentorship ends it for good. A role confirmed again or a teacher
-- added back is a new row, and an old grant does not come back to life. One
-- row per class of input B0 to B13 of the contract, in the order of the
-- contract's table where the state allows it. Personas of institution.inc and
-- mentorship.inc; Ema, Filip, Goran and Hana are four more invented teachers
-- of fak-a.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
\ir fixtures/mentorship.inc
SELECT no_plan();

INSERT INTO person
SELECT p.name, ('00000000-0000-4000-8000-0000000001' || p.n)::uuid, pg_temp.id('fak_a'), 'fak-a'
FROM (VALUES ('ema', '11'), ('filip', '12'), ('goran', '13'), ('hana', '14')) AS p (name, n);
INSERT INTO tok VALUES ('ema', repeat('K', 43)), ('filip', repeat('L', 43)), ('goran', repeat('M', 43)), ('hana', repeat('N', 43));
INSERT INTO ref SELECT name, id::text FROM person WHERE name IN ('ema', 'filip', 'goran', 'hana');
INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
SELECT id, institution_id, 'https://issuer.test', 'sub-' || name, name || '@fak-a.example'
FROM person WHERE name IN ('ema', 'filip', 'goran', 'hana');
INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
SELECT sha256(convert_to(t.token, 'UTF8')), p.id, p.institution_id, now() + interval '1 hour'
FROM person p JOIN tok t USING (name) WHERE p.name IN ('ema', 'filip', 'goran', 'hana');
INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_by, confirmed_at)
SELECT p.institution_id, p.id, 'teacher', pg_temp.id('iva'), now()
FROM person p WHERE p.name IN ('ema', 'filip', 'goran', 'hana');
-- Ema and Marko may be confirmed again through confirm_teacher_role.
INSERT INTO identity.teacher_eligibility (user_id, institution_id)
SELECT p.id, p.institution_id FROM person p WHERE p.name IN ('ema', 'marko');

-- One work per (student, assignment), as in 102.
CREATE TEMP TABLE work (id text PRIMARY KEY, faculty text, assignment text, owner text);
INSERT INTO work VALUES
  ('doc-ana-z1', 'fak_a', 'z1', 'ana'), ('doc-dora-z1', 'fak_a', 'z1', 'dora'), ('doc-ana-zm1', 'fak_a', 'zm1', 'ana');
GRANT SELECT ON work TO PUBLIC;
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id)
SELECT 'project-' || w.id, pg_temp.id(w.faculty), pg_temp.id(w.assignment), pg_temp.id(w.owner) FROM work w;
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash)
SELECT w.id, pg_temp.id(w.faculty), 'project-' || w.id, pg_temp.id(w.owner), repeat('a', 64) FROM work w;
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash)
SELECT w.id, pg_temp.id(w.faculty), 0, pg_temp.id(w.owner), repeat('a', 64) FROM work w;
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;

-- grant_can() of p_actor, as the web process asks it.
CREATE FUNCTION pg_temp.can(p_actor text, p_action text, p_doc text) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.ask(p_actor, format('SELECT institution.grant_can(%L, %L)::text', p_action, p_doc)) $$;
-- The live (confirmed, unrevoked) teacher role row of a person, and the open
-- teacher membership of a person in a course.
CREATE FUNCTION pg_temp.role_row(p_name text) RETURNS uuid
LANGUAGE sql AS $$
  SELECT r.id FROM institution.institution_role r
  WHERE r.user_id = pg_temp.id(p_name) AND r.role = 'teacher' AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
$$;
CREATE FUNCTION pg_temp.member_row(p_name text, p_course text) RETURNS uuid
LANGUAGE sql AS $$
  SELECT m.id FROM institution.course_member m
  WHERE m.user_id = pg_temp.id(p_name) AND m.course_id = pg_temp.id(p_course) AND m.role = 'teacher' AND m.member_to IS NULL
$$;
-- The three bindings of a grant, as "grantee_role granter_role granter_member"
-- with the names of the ref rows they equal, or "null" or "other".
CREATE FUNCTION pg_temp.bound(p_grant text) RETURNS text
LANGUAGE sql AS $$
  SELECT concat_ws(' ',
    coalesce((SELECT r.name FROM ref r WHERE r.val = g.grantee_role_id::text AND r.name LIKE 'r\_%'), CASE WHEN g.grantee_role_id IS NULL THEN 'null' ELSE 'other' END),
    coalesce((SELECT r.name FROM ref r WHERE r.val = g.granter_role_id::text AND r.name LIKE 'r\_%'), CASE WHEN g.granter_role_id IS NULL THEN 'null' ELSE 'other' END),
    coalesce((SELECT r.name FROM ref r WHERE r.val = g.granter_member_id::text AND r.name LIKE 'm\_%'), CASE WHEN g.granter_member_id IS NULL THEN 'null' ELSE 'other' END))
  FROM institution.work_grant g WHERE g.id = pg_temp.id(p_grant)
$$;

-- 1. The columns, the trigger and its function.
SELECT fk_ok('institution', 'work_grant', ARRAY['grantee_role_id', 'institution_id'], 'institution', 'institution_role', ARRAY['id', 'institution_id'],
  'grantee_role_id names a row of institution_role of its institution');
SELECT fk_ok('institution', 'work_grant', ARRAY['granter_role_id', 'institution_id'], 'institution', 'institution_role', ARRAY['id', 'institution_id'],
  'granter_role_id names a row of institution_role of its institution');
SELECT fk_ok('institution', 'work_grant', ARRAY['granter_member_id', 'institution_id'], 'institution', 'course_member', ARRAY['id', 'institution_id'],
  'granter_member_id names a row of course_member of its institution');
SELECT trigger_is('institution', 'work_grant', 'work_grant_binding_fill', 'institution', 'work_grant_binding_fill',
  'the bindings are set by a trigger on work_grant');
SELECT is(
  (SELECT CASE WHEN p.prosecdef THEN 'definer' ELSE 'invoker' END
          || CASE WHEN has_function_privilege('ductus_app', p.oid, 'EXECUTE') THEN ' app' ELSE '' END
   FROM pg_proc p WHERE p.oid = 'institution.work_grant_binding_fill()'::regprocedure),
  'invoker', 'the trigger function runs with the rights of the writer and ductus_app cannot call it'
);
SELECT is(
  (SELECT string_agg(column_name, ' ' ORDER BY column_name) FROM information_schema.column_privileges
   WHERE table_schema = 'institution' AND table_name = 'work_grant' AND grantee = 'ductus_app'
     AND privilege_type <> 'SELECT' AND column_name LIKE '%\_id'),
  NULL, 'ductus_app writes no column of work_grant, bindings included'
);

-- 2. The grants of the table. Vesna teaches K1 (Z1), Marko mentors Ana (zm1).
INSERT INTO ref VALUES
  ('r_ema1', pg_temp.role_row('ema')::text), ('r_filip', pg_temp.role_row('filip')::text),
  ('r_goran', pg_temp.role_row('goran')::text), ('r_hana', pg_temp.role_row('hana')::text),
  ('r_vesna', pg_temp.role_row('vesna')::text), ('r_marko1', pg_temp.role_row('marko')::text),
  ('m_vesna1', pg_temp.member_row('vesna', 'k1')::text), ('m_marko', pg_temp.member_row('marko', 'k2')::text);
INSERT INTO ref VALUES
  ('g_ema', pg_temp.ask('vesna', $$ SELECT institution.grant_work_access({z1}, {ana}, {ema}, 'co_mentor', '{read_text,comment}', NULL, now() + interval '1 day') $$)),
  ('g_filip', pg_temp.ask('vesna', $$ SELECT institution.grant_work_access({z1}, {ana}, {filip}, 'committee', '{read_text}', NULL, now() + interval '1 day') $$)),
  ('g_goran', pg_temp.ask('marko', $$ SELECT institution.grant_work_access({zm1}, {ana}, {goran}, 'co_mentor', '{read_text}', NULL, now() + interval '1 day') $$)),
  ('g_hana', pg_temp.ask('marko', $$ SELECT institution.grant_work_access({zm1}, {ana}, {hana}, 'committee', '{read_text}', NULL, now() + interval '1 day') $$));
SELECT is_empty(
  $$ SELECT name || ': ' || val FROM ref WHERE name LIKE 'g\_%' AND val !~ '^[0-9a-f-]{36}$' $$,
  'every grant of the table was made through grant_work_access'
);
SELECT is(pg_temp.bound('g_ema'), 'r_ema1 r_vesna m_vesna1', 'a grant on a course work binds both roles and the granter''s membership');
SELECT is(pg_temp.bound('g_goran'), 'r_goran r_marko1 null', 'a grant on a thesis binds both roles and no membership');

-- B0: a live grant whose bound rows are all in force.
SELECT is(
  (SELECT string_agg(c.actor || ' ' || pg_temp.can(c.actor, 'read_text', c.doc), ', ' ORDER BY c.actor)
   FROM (VALUES ('ema', 'doc-ana-z1'), ('filip', 'doc-ana-z1'), ('goran', 'doc-ana-zm1'), ('hana', 'doc-ana-zm1')) AS c (actor, doc)),
  'ema true, filip true, goran true, hana true', 'B0: every grant of the table reads true'
);

-- 3. The grantee's role.
SELECT is(pg_temp.ask('iva', $$ SELECT institution.revoke_teacher_role({ema})::text $$), 'true', 'Iva revokes Ema''s teacher role');
SELECT is(pg_temp.can('ema', 'read_text', 'doc-ana-z1'), 'false', 'B1: the grantee''s role is revoked');
SELECT is(pg_temp.can('filip', 'read_text', 'doc-ana-z1'), 'true', 'B8: another grant on the same work, its rows untouched');
SELECT is(pg_temp.ask('iva', $$ SELECT 'ok' FROM institution.confirm_teacher_role({ema}) $$), 'ok', 'Iva confirms Ema again');
INSERT INTO ref VALUES ('r_ema2', pg_temp.role_row('ema')::text);
SELECT isnt(pg_temp.id('r_ema2'), pg_temp.id('r_ema1'), 'the confirmation after a revocation is a new row');
SELECT is(pg_temp.can('ema', 'read_text', 'doc-ana-z1'), 'false', 'B2: revoked and confirmed again, the old grant stays ended');
SELECT is(pg_temp.can('ema', 'comment', 'doc-ana-z1'), 'false', 'B2: for every action of the grant');
INSERT INTO ref VALUES ('g_ema2', pg_temp.ask('vesna',
  $$ SELECT institution.grant_work_access({z1}, {ana}, {ema}, 'co_mentor', '{read_text}', NULL, now() + interval '1 day') $$));
SELECT is(pg_temp.bound('g_ema2'), 'r_ema2 r_vesna m_vesna1', 'B9: a new grant binds the new row');
SELECT is(pg_temp.bound('g_ema'), 'r_ema1 r_vesna m_vesna1', 'B9: the old grant keeps the old row');
SELECT is(pg_temp.can('ema', 'read_text', 'doc-ana-z1'), 'true', 'B9: the new grant reads true');
SELECT is(pg_temp.can('ema', 'comment', 'doc-ana-z1'), 'false', 'B11: an action outside the new grant, though the old one had it');
SELECT is(pg_temp.ask('vesna', $$ SELECT institution.revoke_work_access({g_ema2})::text $$), 'true', 'Vesna revokes the new grant');
SELECT is(pg_temp.can('ema', 'read_text', 'doc-ana-z1'), 'false', 'B11: a revoked grant');

-- 4. The granter's membership of the course. No procedure removes a
-- teacher from a course yet; the owner role ends the row, as in 118.
UPDATE institution.course_member SET member_to = now() WHERE id = pg_temp.id('m_vesna1');
SELECT is(pg_temp.can('filip', 'read_text', 'doc-ana-z1'), 'false', 'B5: the granter is removed from the course');
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('vesna'), 'teacher');
INSERT INTO ref VALUES ('m_vesna2', pg_temp.member_row('vesna', 'k1')::text);
SELECT isnt(pg_temp.id('m_vesna2'), pg_temp.id('m_vesna1'), 'adding a teacher back is a new row');
SELECT is(pg_temp.can('filip', 'read_text', 'doc-ana-z1'), 'false', 'B6: removed and added back, the old grant stays ended');
INSERT INTO ref VALUES ('g_filip2', pg_temp.ask('vesna',
  $$ SELECT institution.grant_work_access({z1}, {ana}, {filip}, 'committee', '{read_text}', NULL, now() + interval '1 day') $$));
SELECT is(pg_temp.bound('g_filip2'), 'r_filip r_vesna m_vesna2', 'B9: a new grant binds the new membership');
SELECT is(pg_temp.can('filip', 'read_text', 'doc-ana-z1'), 'true', 'B9: and reads true');
SELECT is(pg_temp.can('filip', 'read_text', 'doc-dora-z1'), 'false', 'B11: not on another work of the same assignment');

-- 5. The granter's role, and the mentorship.
SELECT is(pg_temp.ask('iva', $$ SELECT institution.revoke_teacher_role({marko})::text $$), 'true', 'Iva revokes Marko''s teacher role');
SELECT is(pg_temp.can('goran', 'read_text', 'doc-ana-zm1'), 'false', 'B3: the granter''s role is revoked');
SELECT is(pg_temp.can('hana', 'read_text', 'doc-ana-zm1'), 'false', 'B3: for every grant he gave');
SELECT is(pg_temp.ask('iva', $$ SELECT 'ok' FROM institution.confirm_teacher_role({marko}) $$), 'ok', 'Iva confirms Marko again');
INSERT INTO ref VALUES ('r_marko2', pg_temp.role_row('marko')::text);
SELECT is(pg_temp.can('goran', 'read_text', 'doc-ana-zm1'), 'false', 'B4: revoked and confirmed again, the grants he gave stay ended');
SELECT is(pg_temp.can('hana', 'read_text', 'doc-ana-zm1'), 'false', 'B4: Hana''s as well');
INSERT INTO ref VALUES ('g_goran2', pg_temp.ask('marko',
  $$ SELECT institution.grant_work_access({zm1}, {ana}, {goran}, 'co_mentor', '{read_text}', NULL, now() + interval '1 day') $$));
SELECT is(pg_temp.bound('g_goran2'), 'r_goran r_marko2 null', 'B9: a new grant on the thesis binds the granter''s new row');
SELECT is(pg_temp.can('goran', 'read_text', 'doc-ana-zm1'), 'true', 'B9: and reads true');
SELECT is(pg_temp.can('goran', 'comment', 'doc-ana-zm1'), 'false', 'B11: an action outside the grant');
UPDATE institution.mentorship SET ended_at = now() WHERE id = pg_temp.id('ms1');
SELECT is(pg_temp.can('goran', 'read_text', 'doc-ana-zm1'), 'false', 'B7: the mentorship of the thesis has ended');

-- 6. Expiry is decided per statement, as in P01.
INSERT INTO ref VALUES ('g_hana2', pg_temp.ask('vesna',
  $$ SELECT institution.grant_work_access({z1}, {ana}, {hana}, 'committee', '{read_text}', NULL, clock_timestamp() + interval '80 milliseconds') $$));
SELECT is(pg_temp.can('hana', 'read_text', 'doc-ana-z1'), 'true', 'Hana reads within her 80 ms');
SELECT pg_sleep(0.1);
SELECT is(pg_temp.can('hana', 'read_text', 'doc-ana-z1'), 'false', 'B11: the next statement after the end reads false');

-- 7. The bindings themselves. Writes by the owner role, the only role that
-- may write the table apart from grant_work_access.
CREATE FUNCTION pg_temp.owner_grant(p_grantee text, p_extra_cols text, p_extra_vals text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask_as('ductus_identity', 'anon', format(
    'INSERT INTO institution.work_grant (institution_id, assignment_id, student_id, grantee_id, kind, actions, valid_from, valid_to, granted_by%s)'
    ' VALUES ({fak_a}, {z1}, {ana}, {%s}, ''committee'', ''{read_text}'', now(), now() + interval ''1 day'', {vesna}%s) RETURNING id::text',
    p_extra_cols, p_grantee, p_extra_vals))
$$;
-- B10: Nina's role is not confirmed, so her grant binds nothing; confirming
-- the same row later does not bring it to life.
INSERT INTO ref VALUES ('g_nina', pg_temp.owner_grant('nina', '', ''));
SELECT is(pg_temp.bound('g_nina'), 'null r_vesna m_vesna2', 'B10: a grantee without a live role binds null');
UPDATE institution.institution_role SET confirmed_by = pg_temp.id('iva'), confirmed_at = now()
 WHERE user_id = pg_temp.id('nina') AND role = 'teacher' AND revoked_at IS NULL;
SELECT is(pg_temp.can('nina', 'read_text', 'doc-ana-z1'), 'false', 'B10: a null binding reads false, also once the role is confirmed');
-- B12: the insert names Marko's old role and his K2 membership; the trigger
-- writes Hana's and Vesna's rows in force.
INSERT INTO ref VALUES ('g_hana3', pg_temp.owner_grant('hana', ', grantee_role_id, granter_role_id, granter_member_id',
  ', {r_marko1}, {r_marko1}, {m_marko}'));
SELECT is(pg_temp.bound('g_hana3'), 'r_hana r_vesna m_vesna2', 'B12: whatever the insert names, the rows in force are bound');
SELECT is(pg_temp.can('hana', 'read_text', 'doc-ana-z1'), 'true', 'B12: and the grant reads true');
-- B13: no binding changes after the insert, not even to the same value.
SELECT is(
  regexp_replace(pg_temp.ask_as('ductus_identity', 'anon', format(
    'UPDATE institution.work_grant SET %I = %s WHERE id = {g_ema} RETURNING ''changed''', c.col, c.val)), ':.*$', ''),
  'ZD403', format('B13: the owner role does not change %s', c.col)
)
FROM (VALUES ('grantee_role_id', '{r_ema2}'), ('granter_role_id', '{r_vesna}'), ('granter_member_id', '{m_vesna2}'),
             ('grantee_role_id', 'grantee_role_id')) AS c (col, val);
SELECT is(pg_temp.bound('g_ema'), 'r_ema1 r_vesna m_vesna1', 'B13: the old grant is still bound to the old rows');
SELECT is(pg_temp.ask('vesna', $$ SELECT institution.revoke_work_access({g_hana3})::text $$), 'true',
  'a revocation still works: it changes no binding');
SELECT is(pg_temp.can('hana', 'read_text', 'doc-ana-z1'), 'false', 'B11: and the revoked grant reads false');

SELECT * FROM finish();
ROLLBACK;

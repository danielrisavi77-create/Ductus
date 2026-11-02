-- identity.teacher_eligibility and the eight-argument open_session (DAN-304,
-- M1.3; plan of attack #1181): only the fact of the teacher right is kept,
-- every login writes or removes it, nobody reads it directly, and an
-- administrator confirms a teacher role only for a colleague who has it.
-- Synthetic fixtures only: every person, name and organisation is invented.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';

SELECT plan(84);

-- The fixture has institutions without a home organisation or an issuer;
-- the login needs both. fak-a also trusts a second issuer (item 20).
UPDATE identity.institution SET aai_home_org = 'fak-a.example' WHERE id = pg_temp.id('fak_a');
UPDATE identity.institution SET aai_home_org = 'fak-b.example' WHERE id = pg_temp.id('fak_b');
INSERT INTO identity.institution_issuer (institution_id, oidc_issuer) VALUES
  (pg_temp.id('fak_a'), 'https://issuer.test'),
  (pg_temp.id('fak_b'), 'https://issuer.test'),
  (pg_temp.id('fak_a'), 'https://issuer-2.test');

-- One login of a fixture person as ductus_auth, through the eight-argument
-- form; 'ok' or the SQLSTATE and message of the refusal.
CREATE FUNCTION pg_temp.login(
  p_who text, p_eligible boolean, p_given text DEFAULT NULL, p_family text DEFAULT NULL,
  p_subject text DEFAULT NULL, p_issuer text DEFAULT 'https://issuer.test', p_home_org text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_org text;
  v_subject text;
  v_hash bytea := sha256(convert_to(gen_random_uuid()::text, 'UTF8'));
  v_result text := 'ok';
BEGIN
  SELECT coalesce(p_home_org, faculty || '.example'), coalesce(p_subject, 'sub-' || name)
    INTO STRICT v_org, v_subject FROM person WHERE name = p_who;
  SET LOCAL ROLE ductus_auth;
  BEGIN
    PERFORM identity.open_session(p_issuer, v_subject, p_who || '@' || v_org, v_org, v_hash, p_given, p_family, p_eligible);
  EXCEPTION WHEN OTHERS THEN
    v_result := SQLSTATE || ': ' || SQLERRM;
  END;
  RESET ROLE;
  RETURN v_result;
END
$$;
CREATE FUNCTION pg_temp.has_right(p_name text) RETURNS boolean
LANGUAGE sql AS $$ SELECT EXISTS (SELECT 1 FROM identity.teacher_eligibility WHERE user_id = pg_temp.id(p_name)) $$;
CREATE FUNCTION pg_temp.teacher_role(p_name text) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(CASE WHEN confirmed_at IS NULL THEN 'unconfirmed' ELSE 'confirmed' END, ','), 'none')
  FROM institution.institution_role
  WHERE user_id = pg_temp.id(p_name) AND role = 'teacher' AND revoked_at IS NULL
$$;
CREATE FUNCTION pg_temp.name_of(p_name text) RETURNS text
LANGUAGE sql AS $$
  SELECT given_name || ' / ' || family_name FROM identity.person_name WHERE user_id = pg_temp.id(p_name)
$$;
CREATE FUNCTION pg_temp.confirm(p_admin text, p_candidate text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_admin, format($q$ SELECT 'done' FROM institution.confirm_teacher_role({%s}) $q$, p_candidate))
$$;

-- 1. The catalogue (items 21 and 23): a forced-RLS table of ductus_identity
-- holding the fact alone, and the login as definer for ductus_auth alone.
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'identity.teacher_eligibility'::regclass),
  'teacher_eligibility has ENABLE and FORCE ROW LEVEL SECURITY');
SELECT is((SELECT pg_get_userbyid(relowner)::text FROM pg_class WHERE oid = 'identity.teacher_eligibility'::regclass),
  'ductus_identity', 'teacher_eligibility belongs to ductus_identity');
SELECT bag_eq(
  $$ SELECT policyname || ' ' || cmd || ' to ' || array_to_string(roles, ',') FROM pg_policies
     WHERE schemaname = 'identity' AND tablename = 'teacher_eligibility' $$,
  ARRAY['teacher_eligibility_owner ALL to ductus_identity'],
  'the only policy on teacher_eligibility is the owner policy'
);
SELECT columns_are('identity', 'teacher_eligibility', ARRAY['user_id', 'institution_id', 'updated_at'],
  'teacher_eligibility keeps the fact and its time, never an affiliation value');
SELECT ok(p.prosecdef, 'the eight-argument open_session is SECURITY DEFINER')
FROM pg_proc p WHERE p.oid = 'identity.open_session(text, text, text, text, bytea, text, text, boolean)'::regprocedure;
SELECT is(pg_get_userbyid(p.proowner)::text, 'ductus_identity', 'the eight-argument open_session belongs to ductus_identity')
FROM pg_proc p WHERE p.oid = 'identity.open_session(text, text, text, text, bytea, text, text, boolean)'::regprocedure;
SELECT is(p.proconfig, ARRAY['search_path=""'], 'the eight-argument open_session runs with an empty search_path')
FROM pg_proc p WHERE p.oid = 'identity.open_session(text, text, text, text, bytea, text, text, boolean)'::regprocedure;
SELECT ok(has_function_privilege('ductus_auth', 'identity.open_session(text, text, text, text, bytea, text, text, boolean)', 'EXECUTE'),
  'ductus_auth may execute the eight-argument open_session');
SELECT is_empty(
  $$ SELECT r.rolname FROM (SELECT rolname::text FROM pg_roles
                            WHERE rolname LIKE 'ductus\_%'
                              -- ductus_auth_local inherits ductus_auth and nothing else (010).
                              AND rolname NOT IN ('ductus_auth', 'ductus_identity', 'ductus_auth_local')
                            UNION ALL SELECT 'public') AS r (rolname)
     WHERE has_function_privilege(r.rolname, 'identity.open_session(text, text, text, text, bytea, text, text, boolean)', 'EXECUTE') $$,
  'no role but ductus_auth, its local login and the owner, nor PUBLIC, may execute the eight-argument open_session'
);
SELECT matches(
  pg_temp.ask('anon', $$ SELECT identity.open_session('https://issuer.test', 'sub-x', 'x@fak-a.example', 'fak-a.example',
                                                      sha256('x'), NULL, NULL, true)::text $$),
  '^42501: ', 'ductus_app may not log in, so it cannot give itself the right'
);
-- Item 13: the login role has no form left that opens a session and leaves
-- the right as it was.
SELECT is_empty(
  $$ SELECT f FROM unnest(ARRAY['identity.open_session(text, text, text, text, bytea)',
                                'identity.open_session(text, text, text, text, bytea, text, text)']) AS f
     WHERE has_function_privilege('ductus_auth', f, 'EXECUTE') $$,
  'ductus_auth executes neither the five- nor the seven-argument open_session'
);
SELECT is(
  pg_temp.ask_as('ductus_auth', 'anon',
    $$ SELECT identity.open_session('https://issuer.test', 'sub-nina', 'nina@fak-a.example', 'fak-a.example', sha256('old'))::text $$),
  '42501: permission denied for function open_session',
  'an old caller of the five-argument form is refused before any session'
);

-- 2. Nobody reads or writes the right directly (item 22).
SELECT is_empty(
  $$ SELECT r.rolname || ' ' || c FROM (SELECT rolname::text FROM pg_roles
                                        WHERE rolname LIKE 'ductus\_%' AND rolname <> 'ductus_identity'
                                        UNION ALL SELECT 'public') AS r (rolname)
     CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS c
     WHERE has_table_privilege(r.rolname, 'identity.teacher_eligibility', c) $$,
  'no role but the owner, nor PUBLIC, holds any privilege on teacher_eligibility'
);
SELECT is_empty(
  $$ SELECT r || ' ' || left(s, 6) FROM unnest(ARRAY['ductus_app', 'ductus_auth', 'ductus_worker', 'ductus_retention',
                                                     'ductus_test_stranger']) AS r
     CROSS JOIN unnest(ARRAY[
       'SELECT count(*)::text FROM identity.teacher_eligibility',
       'INSERT INTO identity.teacher_eligibility (user_id, institution_id) VALUES ({boris}, {fak_a})',
       'UPDATE identity.teacher_eligibility SET updated_at = now()',
       'DELETE FROM identity.teacher_eligibility'
     ]) AS s
     WHERE coalesce(pg_temp.ask_as(r, 'boris', s), 'ok') !~ '^42501: ' $$,
  'every role is refused SELECT, INSERT, UPDATE and DELETE on teacher_eligibility'
);
SELECT is(pg_temp.has_right('boris'), false, 'the refused INSERT left no right');

-- 3. A login gives the right with true and takes it with false or NULL.
SELECT is(pg_temp.login('nina', true), 'ok', 'a login with the right opens the session');
SELECT ok(pg_temp.has_right('nina'), 'the login gave Nina the right');
SELECT is((SELECT institution_id FROM identity.teacher_eligibility WHERE user_id = pg_temp.id('nina')),
  pg_temp.id('fak_a'), 'the right carries the institution of its account');
SELECT is(pg_temp.login('nina', true), 'ok', 'a second login with the right');
SELECT is((SELECT count(*)::integer FROM identity.teacher_eligibility WHERE user_id = pg_temp.id('nina')), 1,
  'a second login with the right keeps one row');
SELECT is(pg_temp.login('nina', false), 'ok', 'a login without the right still opens the session');
SELECT is(pg_temp.has_right('nina'), false, 'a login without the right takes it away');
SELECT is(pg_temp.login('nina', true), 'ok', 'the right comes back with the next login');
SELECT is(pg_temp.login('nina', NULL), 'ok', 'a login that does not know still opens the session');
SELECT is(pg_temp.has_right('nina'), false, 'NULL takes the right away like false');

-- A mistaken grant still shows ductus_app nothing: the policy names the
-- owner alone.
GRANT SELECT ON identity.teacher_eligibility TO ductus_app;
SELECT is(pg_temp.login('marko', true), 'ok', 'Marko logs in with the right');
SELECT is(pg_temp.ask('marko', 'SELECT count(*)::text FROM identity.teacher_eligibility'), '0',
  'with a mistaken SELECT grant ductus_app still sees no right');
REVOKE SELECT ON identity.teacher_eligibility FROM ductus_app;

-- 4. Items 10 and 11: the administrator confirms only after a login with the
-- right, and the refusal changes nothing.
SELECT is(pg_temp.confirm('iva', 'nina'), 'ZD403: forbidden', 'Iva cannot confirm Nina without the right');
SELECT is(pg_temp.teacher_role('nina'), 'unconfirmed', 'the refused confirmation leaves Nina''s role as it was');
SELECT is(pg_temp.login('nina', true), 'ok', 'Nina logs in with the right');
SELECT is(pg_temp.confirm('iva', 'nina'), 'done', 'Iva confirms Nina once she has the right');
SELECT is(pg_temp.teacher_role('nina'), 'confirmed', 'Nina''s teacher role is confirmed');
SELECT is(pg_temp.confirm('iva', 'nina'), 'done', 'confirming Nina again succeeds');
SELECT is(
  (SELECT count(*)::integer FROM institution.institution_role
   WHERE user_id = pg_temp.id('nina') AND role = 'teacher' AND revoked_at IS NULL AND confirmed_by = pg_temp.id('iva')),
  1, 'Nina has one confirmed teacher role, by Iva'
);

-- D-200 P7: a later login without the right takes the right, never the role.
SELECT is(pg_temp.login('nina', false), 'ok', 'Nina logs in without the right');
SELECT is(pg_temp.has_right('nina'), false, 'that login takes Nina''s right');
SELECT is(pg_temp.teacher_role('nina'), 'confirmed', 'the confirmed role stays when the right goes');

-- 5. Item 12: a refused login changes no right.
SELECT is(pg_temp.login('nina', true, NULL, NULL, NULL, 'https://issuer.test', 'x.example'), 'ZD503: institution not set up',
  'a login from an unknown home organisation is refused');
SELECT is(pg_temp.has_right('nina'), false, 'the refused login gave no right');
SELECT is(pg_temp.login('boris', true, NULL, NULL, 'sub-drugi'), 'ZD403: forbidden',
  'a login of Boris''s unique id with another subject is refused');
SELECT is(pg_temp.has_right('boris'), false, 'the refused login gave Boris no right');
SELECT is(pg_temp.login('marko', false, NULL, NULL, 'sub-drugi'), 'ZD403: forbidden',
  'a login of Marko''s unique id with another subject is refused');
SELECT ok(pg_temp.has_right('marko'), 'the refused login did not take Marko''s right');
SELECT is(pg_temp.login('marko', NULL, NULL, NULL, NULL, 'https://unrecorded.test'), 'ZD503: institution not set up',
  'a login from an issuer not recorded for the institution is refused');
SELECT ok(pg_temp.has_right('marko'), 'that refusal did not take Marko''s right either');

-- 6. Item 20: the same unique id from another issuer of the institution is
-- another account, with a right of its own.
SELECT is(pg_temp.login('marko', false, NULL, NULL, NULL, 'https://issuer-2.test'), 'ok',
  'Marko''s unique id logs in from the second issuer');
SELECT ok(pg_temp.has_right('marko'), 'the login from the second issuer leaves the first account''s right');
SELECT is(
  (SELECT count(*)::integer FROM identity.teacher_eligibility e JOIN identity.user_account u ON u.id = e.user_id
   WHERE u.oidc_issuer = 'https://issuer-2.test'),
  0, 'the account from the second issuer has no right'
);
SELECT is(pg_temp.login('marko', true, NULL, NULL, NULL, 'https://issuer-2.test'), 'ok',
  'the second account logs in with the right');
SELECT is(
  (SELECT count(DISTINCT e.user_id)::integer FROM identity.teacher_eligibility e JOIN identity.user_account u ON u.id = e.user_id
   WHERE u.hr_edu_person_unique_id = 'marko@fak-a.example'),
  2, 'each account of the unique id has its own right'
);
SELECT is(pg_temp.login('marko', false), 'ok', 'Marko logs in from the first issuer without the right');
SELECT is(
  (SELECT u.oidc_issuer FROM identity.teacher_eligibility e JOIN identity.user_account u ON u.id = e.user_id
   WHERE u.hr_edu_person_unique_id = 'marko@fak-a.example'),
  'https://issuer-2.test', 'only the account of the second issuer keeps a right'
);

-- 7. Items 15 to 19: the right does not cross the other conditions, and the
-- refusal is the same refusal every time.
SELECT is(pg_temp.confirm('iva', 'boris'), 'ZD403: forbidden', 'Iva cannot confirm Boris, who has no right');
SELECT is(pg_temp.teacher_role('boris'), 'none', 'the refusal writes no role row for Boris');
SELECT is(pg_temp.login('dora', true), 'ok', 'Dora logs in with the right');
SELECT is(pg_temp.confirm('lea', 'dora'), 'ZD403: forbidden',
  'Lea of B cannot confirm Dora of A, who has the right');
SELECT is(pg_temp.confirm('lea', 'ana'), 'ZD403: forbidden',
  'Lea of B cannot confirm Ana of A, who has none: the same refusal');
SELECT is(pg_temp.confirm('lea', 'tomo'), 'ZD403: forbidden',
  'Lea cannot confirm Tomo of her own institution without the right: the same refusal');
SELECT is(pg_temp.teacher_role('dora'), 'none', 'the refusals write no role row for Dora');
SELECT is(pg_temp.confirm('vesna', 'dora'), 'ZD403: forbidden', 'Vesna, a teacher and no administrator, cannot confirm Dora');
SELECT is(pg_temp.login('iva', true), 'ok', 'Iva logs in with the right');
SELECT is(pg_temp.confirm('iva', 'iva'), 'ZD403: forbidden', 'Iva cannot confirm herself, right or not');
SELECT is(pg_temp.teacher_role('iva'), 'none', 'Iva has no teacher role row');
SELECT is(pg_temp.ask('iva', 'SELECT institution.confirm_teacher_role(NULL)'), 'ZD403: forbidden',
  'a confirmation of nobody is refused');
SELECT is(pg_temp.confirm('iva', 'dora'), 'done', 'Iva confirms Dora, who has the right');
SELECT is(pg_temp.teacher_role('dora'), 'confirmed', 'Dora''s teacher role is confirmed');
SELECT is(pg_temp.login('tomo', true), 'ok', 'Tomo logs in with the right');
SELECT is(pg_temp.confirm('iva', 'tomo'), 'ZD403: forbidden', 'Iva cannot confirm Tomo of B, though he has the right');
SELECT is(pg_temp.confirm('lea', 'tomo'), 'done', 'Lea confirms Tomo once he has the right');
SELECT is(pg_temp.teacher_role('tomo'), 'confirmed', 'Tomo''s teacher role is confirmed');

-- 8. Item 26: the name and the right are decided apart; a bad name never
-- costs the right, and a good name never brings it.
SELECT is(pg_temp.login('ana', true, 'Ana', 'Testić'), 'ok', 'Ana logs in with the right and a name');
SELECT ok(pg_temp.has_right('ana'), 'Ana has the right');
SELECT is(pg_temp.name_of('ana'), 'Ana / Testić', 'Ana''s name is stored');
SELECT is(pg_temp.login('ana', true, 'An' || chr(1) || 'a', 'Testić'), 'ok', 'a login with a control character in the name');
SELECT ok(pg_temp.has_right('ana'), 'the unusable name does not cost the right');
SELECT is(pg_temp.name_of('ana'), NULL, 'the unusable name is removed');
SELECT is(pg_temp.login('ana', false, 'Ana', 'Testić'), 'ok', 'a login with a name and without the right');
SELECT is(pg_temp.has_right('ana'), false, 'the good name does not keep the right');
SELECT is(pg_temp.name_of('ana'), 'Ana / Testić', 'the name is stored again');

-- 9. Item 25: the right does not cascade (033); the account goes only after
-- its right.
SELECT is(pg_temp.login('boris', true), 'ok', 'Boris logs in with the right');
DELETE FROM identity.session WHERE user_id = pg_temp.id('boris');
SELECT throws_ok(
  format('DELETE FROM identity.user_account WHERE id = %L', pg_temp.id('boris')),
  '23503', NULL, 'the account cannot be deleted while its right exists'
);
SELECT ok(pg_temp.has_right('boris'), 'the failed delete leaves the right');
DELETE FROM identity.teacher_eligibility WHERE user_id = pg_temp.id('boris');
SELECT lives_ok(
  format('DELETE FROM identity.user_account WHERE id = %L', pg_temp.id('boris')),
  'once the right is gone the account can be deleted'
);
SELECT is((SELECT count(*)::integer FROM identity.user_account WHERE id = pg_temp.id('boris')), 0, 'Boris''s account is gone');

SELECT * FROM finish();
ROLLBACK;

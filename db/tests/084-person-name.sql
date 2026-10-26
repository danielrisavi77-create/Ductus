-- identity.person_name and the seven-argument open_session (B-11a, #757
-- O1; plan of attack #758): who may read or write a name, what a login
-- writes, refreshes and removes, and that a name never outlives its
-- account. Synthetic fixtures only: every name below is invented.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL lc_messages TO 'C';
CREATE ROLE ductus_test_stranger NOLOGIN;
GRANT USAGE ON SCHEMA public TO ductus_app, ductus_worker, ductus_retention, ductus_auth, ductus_test_stranger;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ductus_app, ductus_worker, ductus_retention, ductus_auth, ductus_test_stranger;

SELECT plan(55);

INSERT INTO identity.institution (id, slug, aai_home_org) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'test-a', 'a.example'),
  ('00000000-0000-4000-8000-00000000000b', 'test-b', 'b.example');

CREATE FUNCTION pg_temp.h(p_name text) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(convert_to(p_name, 'UTF8')) $$;
-- One login of a fixture person, under the caller's role; the result is
-- 'ok' or the SQLSTATE and message of the refusal.
CREATE FUNCTION pg_temp.login(p_who text, p_home_org text, p_hash text, p_given text, p_family text, p_subject text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM identity.open_session('https://issuer.test', coalesce(p_subject, 'sub-' || p_who), p_who || '@' || p_home_org,
                                p_home_org, pg_temp.h(p_hash), p_given, p_family);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ': ' || SQLERRM;
END
$$;
-- The stored name of a fixture person, or NULL when there is none.
CREATE FUNCTION pg_temp.name_of(p_unique_id text) RETURNS text
LANGUAGE sql AS $$
  SELECT n.given_name || ' / ' || n.family_name FROM identity.person_name n
  JOIN identity.user_account u ON u.id = n.user_id WHERE u.hr_edu_person_unique_id = p_unique_id
$$;
CREATE FUNCTION pg_temp.names() RETURNS bigint
LANGUAGE sql AS $$
  SELECT count(*) FROM identity.person_name
  WHERE institution_id IN ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b')
$$;

-- 1. The catalogue: a forced-RLS table of ductus_identity, and the new
-- open_session as definer with an empty search_path, for ductus_auth alone.
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'identity.person_name'::regclass),
  'person_name has ENABLE and FORCE ROW LEVEL SECURITY');
SELECT is((SELECT pg_get_userbyid(relowner)::text FROM pg_class WHERE oid = 'identity.person_name'::regclass),
  'ductus_identity', 'person_name belongs to ductus_identity');
SELECT bag_eq(
  $$ SELECT policyname || ' ' || cmd || ' to ' || array_to_string(roles, ',') FROM pg_policies
     WHERE schemaname = 'identity' AND tablename = 'person_name' $$,
  ARRAY['person_name_owner ALL to ductus_identity'],
  'the only policy on person_name is the owner policy'
);
SELECT ok(p.prosecdef, 'open_session with names is SECURITY DEFINER')
FROM pg_proc p WHERE p.oid = 'identity.open_session(text, text, text, text, bytea, text, text)'::regprocedure;
SELECT is(pg_get_userbyid(p.proowner)::text, 'ductus_identity', 'open_session with names belongs to ductus_identity')
FROM pg_proc p WHERE p.oid = 'identity.open_session(text, text, text, text, bytea, text, text)'::regprocedure;
SELECT is(p.proconfig, ARRAY['search_path=""'], 'open_session with names runs with an empty search_path')
FROM pg_proc p WHERE p.oid = 'identity.open_session(text, text, text, text, bytea, text, text)'::regprocedure;
SELECT ok(has_function_privilege('ductus_auth', 'identity.open_session(text, text, text, text, bytea, text, text)', 'EXECUTE'),
  'ductus_auth may execute open_session with names');
SELECT is_empty(
  $$ SELECT r.rolname FROM (SELECT rolname::text FROM pg_roles
                            WHERE rolname LIKE 'ductus\_%'
                              AND rolname NOT IN ('ductus_auth', 'ductus_identity', 'ductus_auth_local')
                            UNION ALL SELECT 'public') AS r (rolname)
     WHERE has_function_privilege(r.rolname, 'identity.open_session(text, text, text, text, bytea, text, text)', 'EXECUTE') $$,
  'no role but ductus_auth, its local login and the owner, nor PUBLIC, may execute open_session with names'
);

-- 2. No role reads or writes a name directly; ductus_auth only logs in.
SET LOCAL ROLE ductus_app;
SELECT throws_ok('SELECT count(*) FROM identity.person_name', '42501', NULL, 'ductus_app: SELECT on person_name is denied');
SELECT throws_ok(
  $$ INSERT INTO identity.person_name (user_id, institution_id, given_name, family_name)
     VALUES (gen_random_uuid(), '00000000-0000-4000-8000-00000000000a', 'Ime', 'Prezime') $$,
  '42501', NULL, 'ductus_app: INSERT on person_name is denied'
);
SELECT throws_ok($$ UPDATE identity.person_name SET given_name = 'Ime' $$, '42501', NULL, 'ductus_app: UPDATE on person_name is denied');
SELECT throws_ok($$ DELETE FROM identity.person_name $$, '42501', NULL, 'ductus_app: DELETE on person_name is denied');
SELECT throws_ok(
  $$ SELECT identity.open_session('https://issuer.test', 'sub-x', 'x@a.example', 'a.example', sha256('x'), 'Ime', 'Prezime') $$,
  '42501', NULL, 'ductus_app: open_session with names is denied'
);
RESET ROLE;
SET LOCAL ROLE ductus_auth;
SELECT throws_ok('SELECT count(*) FROM identity.person_name', '42501', NULL, 'ductus_auth: SELECT on person_name is denied');
SELECT throws_ok($$ DELETE FROM identity.person_name $$, '42501', NULL, 'ductus_auth: DELETE on person_name is denied');
RESET ROLE;
SET LOCAL ROLE ductus_worker;
SELECT throws_ok('SELECT count(*) FROM identity.person_name', '42501', NULL, 'ductus_worker: SELECT on person_name is denied');
RESET ROLE;
SET LOCAL ROLE ductus_retention;
SELECT throws_ok('SELECT count(*) FROM identity.person_name', '42501', NULL, 'ductus_retention: SELECT on person_name is denied');
RESET ROLE;
SET LOCAL ROLE ductus_test_stranger;
SELECT throws_ok('SELECT count(*) FROM identity.person_name', '42501', NULL, 'role without grants: SELECT on person_name is denied');
RESET ROLE;

-- 3. A login writes the name, the next one refreshes it, and nobody else's
-- name moves.
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.login('ana', 'a.example', 'a1', ' Ana ', 'Testić'), 'ok', 'a login with both names opens a session');
SELECT is(pg_temp.login('ivo', 'a.example', 'i1', 'Ivo', 'Primjerić'), 'ok', 'a second person logs in');
RESET ROLE;
SELECT is(pg_temp.name_of('ana@a.example'), 'Ana / Testić', 'the name is stored, trimmed');
SELECT is(
  (SELECT n.institution_id FROM identity.person_name n JOIN identity.user_account u ON u.id = n.user_id
   WHERE u.hr_edu_person_unique_id = 'ana@a.example'),
  '00000000-0000-4000-8000-00000000000a'::uuid, 'the name carries the institution of its account'
);
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.login('ana', 'a.example', 'a2', 'Ana Marija', 'Testić-Drugić'), 'ok', 'a later login with other names');
RESET ROLE;
SELECT is(pg_temp.name_of('ana@a.example'), 'Ana Marija / Testić-Drugić', 'the later login replaces the name');
SELECT is(pg_temp.name_of('ivo@a.example'), 'Ivo / Primjerić', 'the other person keeps their name');

-- 4. A login without a usable pair removes the name rather than keeping a
-- stale one, and never costs the login itself.
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.login('ana', 'a.example', 'a3', 'Ana', NULL), 'ok', 'a login without a family name still opens a session');
RESET ROLE;
SELECT is(pg_temp.name_of('ana@a.example'), NULL, 'without a family name the stored name is removed');
SELECT is(pg_temp.name_of('ivo@a.example'), 'Ivo / Primjerić', 'removing one name leaves the other person''s');
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.login('ana', 'a.example', 'a4', 'Ana', 'Testić'), 'ok', 'names come back with the next login');
SELECT is(pg_temp.login('ana', 'a.example', 'a5', '  ', 'Testić'), 'ok', 'a blank given name still logs in');
RESET ROLE;
SELECT is(pg_temp.name_of('ana@a.example'), NULL, 'a blank given name removes the name');
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.login('ivo', 'a.example', 'i2', 'Ivo', 'Primje' || chr(1) || 'rić'), 'ok', 'a control character still logs in');
RESET ROLE;
SELECT is(pg_temp.name_of('ivo@a.example'), NULL, 'a name with a control character is not stored');
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.login('ivo', 'a.example', 'i3', repeat('I', 256), 'Primjerić'), 'ok', 'a 256-character name still logs in');
RESET ROLE;
SELECT is(pg_temp.name_of('ivo@a.example'), NULL, 'a 256-character name is not stored');
-- Every space separator is blank and every character claims.ts refuses is
-- refused here too; each removal starts from a stored name.
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.login('ivo', 'a.example', 'i4', 'Ivo' || chr(160) || 'Ante', 'Primjerić'), 'ok', 'a name with an inner no-break space logs in');
RESET ROLE;
SELECT is(pg_temp.name_of('ivo@a.example'), 'Ivo' || chr(160) || 'Ante / Primjerić', 'an inner no-break space is kept');
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.login('ivo', 'a.example', 'i5', 'Ivo', chr(160) || chr(12288)), 'ok', 'a family name of no-break spaces still logs in');
RESET ROLE;
SELECT is(pg_temp.name_of('ivo@a.example'), NULL, 'a name of no-break spaces is blank and removes the name');
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.login('ivo', 'a.example', 'i6', 'Ivo', 'Primjerić'), 'ok', 'Ivo logs in with his name again');
RESET ROLE;
SELECT is(pg_temp.name_of('ivo@a.example'), 'Ivo / Primjerić', 'the name is stored again');
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.login('ivo', 'a.example', 'i7', 'Ivo' || chr(8203), 'Primjerić'), 'ok', 'a zero-width space still logs in');
RESET ROLE;
SELECT is(pg_temp.name_of('ivo@a.example'), NULL, 'a name with a zero-width space (Cf) is not stored');
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.login('ivo', 'a.example', 'i8', 'Ivo', 'Primjerić'), 'ok', 'Ivo logs in with his name once more');
RESET ROLE;
SELECT is(pg_temp.name_of('ivo@a.example'), 'Ivo / Primjerić', 'the name is stored once more');
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.login('ivo', 'a.example', 'i9', 'Ivo', 'Primje' || chr(8232) || 'rić'), 'ok', 'a line separator still logs in');
RESET ROLE;
SELECT is(pg_temp.name_of('ivo@a.example'), NULL, 'a name with a line separator (Zl) is not stored');

-- 5. A refused login writes no name, under the same refusal as before.
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.login('ana', 'a.example', 'm1', 'Mala', 'Lažić', 'sub-mallory'), 'ZD403: forbidden',
  'a login under another subject is refused as before');
SELECT is(pg_temp.login('eve', 'x.example', 'e1', 'Eva', 'Nepoznatić'), 'ZD503: institution not set up',
  'a login from an unknown home organisation is refused as before');
RESET ROLE;
SELECT is(pg_temp.names(), 0::bigint, 'no refused login left a name behind');

-- 6. Even with a grant by mistake, RLS shows ductus_app nothing.
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.login('ana', 'a.example', 'a6', 'Ana', 'Testić'), 'ok', 'Ana logs in with her name again');
RESET ROLE;
GRANT SELECT ON identity.person_name TO ductus_app;
SET LOCAL ROLE ductus_app;
SELECT is((SELECT count(*) FROM identity.person_name), 0::bigint, 'mistaken grant: ductus_app still sees no names');
RESET ROLE;
REVOKE SELECT ON identity.person_name FROM ductus_app;

-- 7. A name stays with its account's institution, and an account cannot be
-- deleted from under its name: the deletion has to take the name first.
SELECT throws_ok(
  $$ INSERT INTO identity.person_name (user_id, institution_id, given_name, family_name)
     SELECT id, '00000000-0000-4000-8000-00000000000b', 'Ivo', 'Primjerić'
     FROM identity.user_account WHERE hr_edu_person_unique_id = 'ivo@a.example' $$,
  '23503', NULL, 'a name under another institution than its account is refused'
);
DELETE FROM identity.session WHERE user_id = (SELECT id FROM identity.user_account WHERE hr_edu_person_unique_id = 'ana@a.example');
SELECT throws_ok(
  $$ DELETE FROM identity.user_account WHERE hr_edu_person_unique_id = 'ana@a.example' $$,
  '23503', NULL, 'an account with a stored name cannot be deleted on its own'
);
DELETE FROM identity.person_name WHERE user_id = (SELECT id FROM identity.user_account WHERE hr_edu_person_unique_id = 'ana@a.example');
DELETE FROM identity.user_account WHERE hr_edu_person_unique_id = 'ana@a.example';
SELECT is(pg_temp.names(), 0::bigint, 'after the account and its name are deleted, no name is left');

SELECT * FROM finish();
ROLLBACK;

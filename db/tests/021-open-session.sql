-- identity.open_session (B-6a): who may open a session, which identities it
-- accepts and what a refusal leaves behind (plan of attack on issue #154,
-- items 9, 10, 12, 14, 15 and 29). Synthetic fixtures only.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL lc_messages TO 'C';
CREATE ROLE ductus_test_stranger NOLOGIN;
GRANT USAGE ON SCHEMA public TO ductus_app, ductus_worker, ductus_retention, ductus_auth, ductus_test_stranger;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ductus_app, ductus_worker, ductus_retention, ductus_auth, ductus_test_stranger;

SELECT plan(51);

INSERT INTO identity.institution (id, slug, aai_home_org) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'test-a', 'a.example'),
  ('00000000-0000-4000-8000-00000000000b', 'test-b', 'b.example'),
  ('00000000-0000-4000-8000-00000000000c', 'test-c', NULL),
  ('00000000-0000-4000-8000-00000000000d', 'test-k', 'k.example');

-- Token hashes stand in for sha256(token); the function never sees a token.
CREATE FUNCTION pg_temp.h(p_name text) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(convert_to(p_name, 'UTF8')) $$;
CREATE FUNCTION pg_temp.open(p_issuer text, p_subject text, p_unique_id text, p_home_org text, p_hash bytea)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM identity.open_session(p_issuer, p_subject, p_unique_id, p_home_org, p_hash);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ': ' || SQLERRM;
END
$$;
CREATE FUNCTION pg_temp.counts() RETURNS text
LANGUAGE sql AS $$
  -- Fixture institutions only: the database may already hold other rows.
  WITH f(id) AS (VALUES
    ('00000000-0000-4000-8000-00000000000a'::uuid), ('00000000-0000-4000-8000-00000000000b'),
    ('00000000-0000-4000-8000-00000000000c'), ('00000000-0000-4000-8000-00000000000d'))
  SELECT (SELECT count(*) FROM identity.user_account WHERE institution_id IN (SELECT id FROM f)) || ' users, '
      || (SELECT count(*) FROM identity.session WHERE institution_id IN (SELECT id FROM f)) || ' sessions'
$$;
CREATE FUNCTION pg_temp.as_app(p_token text) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  PERFORM set_config('app.session_token', p_token, true);
  SET LOCAL ROLE ductus_app;
  v := app.current_user_id();
  RESET ROLE;
  PERFORM set_config('app.session_token', '', true);
  RETURN v;
END
$$;

-- 1. The function from the catalogue: definer, owner, empty search_path,
-- and EXECUTE for ductus_auth alone (plan 15).
SELECT ok(p.prosecdef, 'open_session is SECURITY DEFINER')
FROM pg_proc p WHERE p.oid = 'identity.open_session(text, text, text, text, bytea)'::regprocedure;
SELECT is(pg_get_userbyid(p.proowner), 'ductus_identity', 'open_session belongs to ductus_identity')
FROM pg_proc p WHERE p.oid = 'identity.open_session(text, text, text, text, bytea)'::regprocedure;
SELECT is(p.proconfig, ARRAY['search_path=""'], 'open_session runs with an empty search_path')
FROM pg_proc p WHERE p.oid = 'identity.open_session(text, text, text, text, bytea)'::regprocedure;
SELECT ok(has_function_privilege('ductus_auth', 'identity.open_session(text, text, text, text, bytea)', 'EXECUTE'),
  'ductus_auth may execute open_session');
SELECT is_empty(
  $$ SELECT r.rolname FROM (SELECT rolname::text FROM pg_roles
                            WHERE rolname LIKE 'ductus\_%' AND rolname NOT IN ('ductus_auth', 'ductus_identity')
                            UNION ALL SELECT 'public') AS r (rolname)
     WHERE has_function_privilege(r.rolname, 'identity.open_session(text, text, text, text, bytea)', 'EXECUTE') $$,
  'no role but ductus_auth and the owner, nor PUBLIC, may execute open_session'
);
SET LOCAL ROLE ductus_app;
SELECT throws_ok(
  $$ SELECT identity.open_session('https://issuer.test', 'sub-x', 'x@a.example', 'a.example', sha256('x')) $$,
  '42501', NULL, 'ductus_app: open_session is denied'
);
RESET ROLE;

-- 2. ductus_auth opens sessions and reads nothing.
SET LOCAL ROLE ductus_auth;
SELECT throws_ok('SELECT count(*) FROM identity.session', '42501', NULL, 'ductus_auth: SELECT on session is denied');
SELECT throws_ok('SELECT count(*) FROM identity.user_account', '42501', NULL, 'ductus_auth: SELECT on user_account is denied');
SELECT throws_ok('SELECT * FROM app.current_actor()', '42501', NULL, 'ductus_auth: current_actor() is denied');
SELECT throws_ok('SELECT identity.close_current_session()', '42501', NULL, 'ductus_auth: close_current_session() is denied');

SELECT is(
  identity.open_session('https://issuer.test', 'sub-ana', 'ana@a.example', 'a.example', pg_temp.h(repeat('A', 43))),
  now() + interval '12 hours', 'first login opens a session that ends in 12 hours'
);
RESET ROLE;
SELECT is(pg_temp.counts(), '1 users, 1 sessions', 'first login creates the account and one session');
SELECT is(
  (SELECT institution_id FROM identity.user_account WHERE hr_edu_person_unique_id = 'ana@a.example'),
  '00000000-0000-4000-8000-00000000000a'::uuid, 'the account belongs to the institution of its home organisation'
);
SELECT is(
  pg_temp.as_app(repeat('A', 43)),
  (SELECT id FROM identity.user_account WHERE hr_edu_person_unique_id = 'ana@a.example'),
  'the token of the new session makes ductus_app act as the new user'
);

-- 3. Every login is a new session with a new token (plan 12); a token hash
-- already in use is refused, not shared.
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.open('https://issuer.test', 'sub-ana', 'ana@a.example', 'a.example', pg_temp.h(repeat('a', 43))),
  'ok', 'second login of the same person opens a second session');
SELECT is(pg_temp.open('https://issuer.test', 'sub-ana', 'ana@a.example', 'a.example', pg_temp.h(repeat('a', 43))),
  'ZD409: conflict', 'a token hash already in use is refused');
RESET ROLE;
SELECT is(pg_temp.counts(), '1 users, 2 sessions', 'second login reuses the account');

-- 4. Identity cases (plan 9). The function has no e-mail parameter at all.
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.open('https://issuer.test', 'sub-ivo', 'ivo@a.example', 'a.example', pg_temp.h('ivo')),
  'ok', 'another unique id is another person');
SELECT is(pg_temp.open('https://other-issuer.test', 'sub-ana', 'ana@a.example', 'a.example', pg_temp.h('ana-other')),
  'ok', 'the same unique id from another issuer is another account');
SELECT is(pg_temp.open('https://issuer.test', 'sub-mallory', 'ana@a.example', 'a.example', pg_temp.h('m1')),
  'ZD403: forbidden', 'a known unique id with another subject is refused');
SELECT is(pg_temp.open('https://issuer.test', 'sub-ana', 'mallory@a.example', 'a.example', pg_temp.h('m2')),
  'ZD403: forbidden', 'a known subject with another unique id is refused');
SELECT is(pg_temp.open('https://issuer.test', 'sub-ana', 'ana@a.example', 'b.example', pg_temp.h('m3')),
  'ZD403: forbidden', 'a known person arriving from another home organisation is refused');
RESET ROLE;
SELECT is(pg_temp.counts(), '3 users, 4 sessions', 'refused identities create neither an account nor a session');

-- 5. Home organisation: unknown, missing or of an institution without
-- logins is one answer that names nothing.
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.open('https://issuer.test', 'sub-eve', 'eve@x.example', 'x.example', pg_temp.h('e1')),
  'ZD503: institution not set up', 'unknown home organisation is refused');
SELECT is(pg_temp.open('https://issuer.test', 'sub-eve', 'eve@x.example', NULL, pg_temp.h('e2')),
  'ZD503: institution not set up', 'missing home organisation is refused');
SELECT is(pg_temp.open('https://issuer.test', 'sub-eve', 'eve@x.example', '', pg_temp.h('e3')),
  'ZD503: institution not set up', 'empty home organisation is refused');
SELECT is(pg_temp.open('https://issuer.test', 'sub-eve', 'eve@x.example', 'test-c', pg_temp.h('e4')),
  'ZD503: institution not set up', 'an institution slug is not a home organisation');
-- Case and edge spaces are normalised; look-alike letters are not letters.
SELECT is(pg_temp.open('https://issuer.test', 'sub-ivo', 'ivo@a.example', ' A.Example' || chr(9), pg_temp.h('n1')),
  'ok', 'home organisation in other case with edge spaces finds the institution');
SELECT is(pg_temp.open('https://issuer.test', 'sub-eve', 'eve@a.example', chr(1072) || '.example', pg_temp.h('n2')),
  'ZD503: institution not set up', 'Cyrillic look-alike of a.example is refused');
SELECT is(pg_temp.open('https://issuer.test', 'sub-eve', 'eve@k.example', chr(8490) || '.example', pg_temp.h('n3')),
  'ZD503: institution not set up', 'Kelvin sign in place of k is refused');
SELECT is(pg_temp.open('https://issuer.test', 'sub-eve', 'eve@a.example', 'a.example.', pg_temp.h('n4')),
  'ZD503: institution not set up', 'a home organisation is matched whole, not as a prefix');
RESET ROLE;
-- An institution stops taking logins when its home organisation is cleared;
-- its known users are refused with the same answer as strangers.
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.open('https://issuer.test', 'sub-bob', 'bob@b.example', 'b.example', pg_temp.h('b1')),
  'ok', 'a user of institution B logs in');
RESET ROLE;
UPDATE identity.institution SET aai_home_org = NULL WHERE slug = 'test-b';
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.open('https://issuer.test', 'sub-bob', 'bob@b.example', 'b.example', pg_temp.h('b2')),
  'ZD503: institution not set up', 'after deactivation the same user is refused');

-- 6. Invalid input (plan 9c, 10): refused before any lookup, and the
-- message carries none of it.
SELECT is(pg_temp.open('https://issuer.test', 'sub-eve', NULL, 'a.example', pg_temp.h('i1')),
  'ZD422: invalid input', 'missing hrEduPersonUniqueID is refused');
SELECT is(pg_temp.open('https://issuer.test', 'sub-eve', '', 'a.example', pg_temp.h('i2')),
  'ZD422: invalid input', 'empty hrEduPersonUniqueID is refused');
SELECT is(pg_temp.open('https://issuer.test', 'sub-eve', repeat('u', 256), 'a.example', pg_temp.h('i3')),
  'ZD422: invalid input', 'hrEduPersonUniqueID of 256 characters is refused');
SELECT is(pg_temp.open('https://issuer.test', repeat('s', 256), 'eve@a.example', 'a.example', pg_temp.h('i4')),
  'ZD422: invalid input', 'subject of 256 characters is refused');
SELECT is(pg_temp.open(NULL, 'sub-eve', 'eve@a.example', 'a.example', pg_temp.h('i5')),
  'ZD422: invalid input', 'missing issuer is refused');
SELECT is(pg_temp.open('https://issuer.test', 'sub-eve', 'eve@a.example', 'a.example', substring(pg_temp.h('i6') FROM 1 FOR 31)),
  'ZD422: invalid input', 'a hash of 31 bytes is refused');
SELECT is(pg_temp.open('https://issuer.test', 'sub-eve', 'eve@a.example', 'a.example', NULL),
  'ZD422: invalid input', 'a missing hash is refused');
SELECT is(pg_temp.open('https://issuer.test', 'sub-eve', repeat('u', 255), 'a.example', pg_temp.h('i7')),
  'ok', 'hrEduPersonUniqueID of exactly 255 characters is accepted');
RESET ROLE;
SELECT is(pg_temp.counts(), '5 users, 7 sessions', 'refused input creates neither an account nor a session');

-- 7. Only the hash is stored (plan 14): no column of the session holds the
-- token itself.
SELECT is_empty(
  $$ SELECT 1 FROM identity.session s
     WHERE position(convert_to(repeat('A', 43), 'UTF8') IN s.token_hash) > 0 $$,
  'the token does not appear in the session table'
);

-- 8. The home organisation column is data of the owner alone.
SET LOCAL ROLE ductus_app;
SELECT throws_ok($$ UPDATE identity.institution SET aai_home_org = 'x.example' $$, '42501', NULL,
  'ductus_app: UPDATE of aai_home_org is denied');
RESET ROLE;
SET LOCAL ROLE ductus_auth;
SELECT throws_ok($$ UPDATE identity.institution SET aai_home_org = 'x.example' $$, '42501', NULL,
  'ductus_auth: UPDATE of aai_home_org is denied');
RESET ROLE;
SELECT throws_ok($$ INSERT INTO identity.institution (slug, aai_home_org) VALUES ('test-e', 'E.example') $$, '23514', NULL,
  'aai_home_org in upper case cannot be stored');
-- QA of #191: open_session picks the institution by this value, so two
-- institutions must never share it.
SELECT throws_ok($$ INSERT INTO identity.institution (slug, aai_home_org) VALUES ('test-dup', 'a.example') $$, '23505', NULL,
  'two institutions cannot share an aai_home_org');
SELECT col_is_unique('identity', 'institution', ARRAY['aai_home_org'], 'aai_home_org is unique');
CREATE FUNCTION pg_temp.home_org_stored(p_value text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO identity.institution (slug, aai_home_org) VALUES ('test-check', p_value);
  RAISE EXCEPTION 'stored' USING ERRCODE = 'P0001';
EXCEPTION
  WHEN check_violation THEN RETURN false;
  WHEN raise_exception THEN RETURN true;
END
$$;
SELECT is(
  (SELECT array_agg(v ORDER BY v) FROM unnest(ARRAY['a.example.', '.', '-', '..', 'a..b', '-a.example', 'a-.example', 'example',
                                                    repeat('a', 251) || '.hr']) AS t (v)
    WHERE pg_temp.home_org_stored(v)),
  NULL,
  'aai_home_org refuses trailing dots, empty labels, edge hyphens, single labels and names over 253 characters'
);
SELECT ok(pg_temp.home_org_stored('demo-fakultet.ductus.test'), 'aai_home_org stores a valid DNS name');
SELECT is_empty(
  $$ SELECT r.rolname FROM (SELECT rolname::text FROM pg_roles
                            WHERE rolname LIKE 'ductus\_%' AND rolname <> 'ductus_identity'
                            UNION ALL SELECT 'public') AS r (rolname)
     CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) AS p (privilege)
     WHERE has_column_privilege(r.rolname, 'identity.institution', 'aai_home_org', p.privilege) $$,
  'no role but ductus_identity holds a privilege on institution.aai_home_org'
);

SELECT * FROM finish();
ROLLBACK;

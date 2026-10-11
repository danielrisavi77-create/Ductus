-- Access matrix for identity.session and current_actor() (B-5,
-- docs/BACKEND.md 4.3). Synthetic fixtures only.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
-- Inside this transaction only: the roles under test may call pgTAP (the
-- roles migration takes USAGE on public away from PUBLIC).
CREATE ROLE ductus_test_stranger NOLOGIN;
GRANT USAGE ON SCHEMA public TO ductus_app, ductus_worker, ductus_retention, ductus_auth, ductus_test_stranger;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ductus_app, ductus_worker, ductus_retention, ductus_auth, ductus_test_stranger;

SELECT plan(39);

INSERT INTO identity.institution (id, slug) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'test-a'),
  ('00000000-0000-4000-8000-00000000000b', 'test-b');
INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id) VALUES
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a', 'https://issuer.test', 'sub-a', 'a@test-a.example'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000b', 'https://issuer.test', 'sub-b', 'b@test-b.example');

-- Tokens are 43 base64url characters; the stored value is their SHA-256.
CREATE TEMP TABLE tok (name text PRIMARY KEY, token text NOT NULL);
GRANT SELECT ON tok TO PUBLIC;
INSERT INTO tok VALUES
  ('a', repeat('A', 43)),
  ('b', repeat('B', 43)),
  ('expired', repeat('E', 43)),
  ('closed', repeat('C', 43)),
  ('unknown', repeat('U', 43));

INSERT INTO identity.session (token_hash, user_id, institution_id, created_at, expires_at, closed_at, close_reason)
SELECT sha256(convert_to(t.token, 'UTF8')), s.user_id::uuid, s.institution_id::uuid,
       s.created_at, s.expires_at, s.closed_at, s.close_reason
FROM (VALUES
  ('a', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a',
   now(), now() + interval '1 hour', NULL::timestamptz, NULL),
  ('b', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000b',
   now(), now() + interval '1 hour', NULL, NULL),
  ('expired', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a',
   now() - interval '2 hours', now() - interval '1 hour', NULL, NULL),
  ('closed', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a',
   now() - interval '1 hour', now() + interval '1 hour', now(), 'logout')
) AS s (name, user_id, institution_id, created_at, expires_at, closed_at, close_reason)
JOIN tok t USING (name);

-- 1. ductus_app cannot touch the session table at all.
SET LOCAL ROLE ductus_app;
SELECT throws_ok('SELECT count(*) FROM identity.session', '42501', NULL, 'ductus_app: SELECT on session is denied');
SELECT throws_ok($$ UPDATE identity.session SET closed_at = NULL $$, '42501', NULL, 'ductus_app: UPDATE on session is denied');
SELECT throws_ok($$ DELETE FROM identity.session $$, '42501', NULL, 'ductus_app: DELETE on session is denied');
SELECT throws_ok(
  $$ INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
     VALUES (sha256('x'), '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a', now() + interval '1 hour') $$,
  '42501', NULL, 'ductus_app: INSERT on session is denied'
);
SELECT throws_ok('SELECT count(*) FROM identity.user_account', '42501', NULL, 'ductus_app: SELECT on user_account is denied');
SELECT throws_ok('SELECT count(*) FROM identity.institution', '42501', NULL, 'ductus_app: SELECT on institution is denied');
-- Rewriting an identifier would turn one account into another person's.
-- The updates read no column, so they need the UPDATE privilege alone.
SELECT throws_ok(
  $$ INSERT INTO identity.user_account (institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
     VALUES ('00000000-0000-4000-8000-00000000000a', 'https://issuer.test', 'sub-x', 'x@test-a.example') $$,
  '42501', NULL, 'ductus_app: INSERT on user_account is denied'
);
SELECT throws_ok($$ UPDATE identity.user_account SET created_at = now() $$, '42501', NULL, 'ductus_app: UPDATE on user_account is denied');
SELECT throws_ok($$ DELETE FROM identity.user_account $$, '42501', NULL, 'ductus_app: DELETE on user_account is denied');
SELECT throws_ok(
  $$ INSERT INTO identity.institution (slug) VALUES ('test-c') $$,
  '42501', NULL, 'ductus_app: INSERT on institution is denied'
);
SELECT throws_ok($$ UPDATE identity.institution SET created_at = now() $$, '42501', NULL, 'ductus_app: UPDATE on institution is denied');
SELECT throws_ok($$ DELETE FROM identity.institution $$, '42501', NULL, 'ductus_app: DELETE on institution is denied');

-- 2. Even with SELECT granted by mistake, RLS returns no rows.
RESET ROLE;
GRANT SELECT ON identity.session, identity.user_account, identity.institution TO ductus_app;
SET LOCAL ROLE ductus_app;
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'a'), true);
SELECT is((SELECT count(*) FROM identity.session), 0::bigint, 'mistaken grant: ductus_app still sees no session rows');
SELECT is((SELECT count(*) FROM identity.user_account), 0::bigint, 'mistaken grant: ductus_app still sees no user rows');
SELECT is((SELECT count(*) FROM identity.institution), 0::bigint, 'mistaken grant: ductus_app still sees no institution rows');
RESET ROLE;
REVOKE SELECT ON identity.session, identity.user_account, identity.institution FROM ductus_app;

-- 3. current_actor() under ductus_app.
SET LOCAL ROLE ductus_app;
SELECT set_config('app.session_token', '', true);
SELECT ok((SELECT user_id IS NULL AND institution_id IS NULL FROM app.current_actor()), 'no token: anonymous');

SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'a'), true);
SELECT is(app.current_user_id(), '00000000-0000-4000-8000-0000000000a1'::uuid, 'token A: user A');
SELECT is(app.current_institution_id(), '00000000-0000-4000-8000-00000000000a'::uuid, 'token A: institution A');

SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'b'), true);
SELECT is(app.current_user_id(), '00000000-0000-4000-8000-0000000000b1'::uuid, 'token B: user B, never A');

SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'expired'), true);
SELECT is(app.current_user_id(), NULL, 'expired session: anonymous');

SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'closed'), true);
SELECT is(app.current_user_id(), NULL, 'closed session: anonymous');

SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'unknown'), true);
SELECT is(app.current_user_id(), NULL, 'unknown token: anonymous');

SELECT set_config('app.session_token', left((SELECT token FROM tok WHERE name = 'a'), 42), true);
SELECT is(app.current_user_id(), NULL, 'truncated token: anonymous');

SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'a') || ' ', true);
SELECT is(app.current_user_id(), NULL, 'token with trailing space: anonymous');

-- A raw user id in any GUC is ignored.
SELECT set_config('app.session_token', '', true);
SELECT set_config('app.user_id', '00000000-0000-4000-8000-0000000000a1', true);
SELECT is(app.current_user_id(), NULL, 'app.user_id GUC does not make anyone user A');

-- The hash itself is not a token.
SELECT set_config('app.session_token', encode(sha256(convert_to((SELECT token FROM tok WHERE name = 'a'), 'UTF8')), 'hex'), true);
SELECT is(app.current_user_id(), NULL, 'stored hash used as token: anonymous');

-- 4. Logout closes only the caller's session, and repeating it is harmless.
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'a'), true);
SELECT is(identity.close_current_session(), true, 'logout with token A closes a session');
SELECT is(app.current_user_id(), NULL, 'after logout token A is anonymous');
SELECT is(identity.close_current_session(), false, 'second logout is a no-op');
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'b'), true);
SELECT is(app.current_user_id(), '00000000-0000-4000-8000-0000000000b1'::uuid, 'logout of A leaves B open');
SELECT set_config('app.session_token', '', true);
SELECT is(identity.close_current_session(), false, 'logout without a token is a no-op');
RESET ROLE;

-- 5. Other roles get neither the table nor the functions.
SET LOCAL ROLE ductus_worker;
SELECT throws_ok('SELECT count(*) FROM identity.session', '42501', NULL, 'ductus_worker: SELECT on session is denied');
SELECT throws_ok('SELECT * FROM app.current_actor()', '42501', NULL, 'ductus_worker: current_actor() is denied');
RESET ROLE;
SET LOCAL ROLE ductus_retention;
SELECT throws_ok('SELECT count(*) FROM identity.session', '42501', NULL, 'ductus_retention: SELECT on session is denied');
RESET ROLE;
SET LOCAL ROLE ductus_auth;
SELECT throws_ok('SELECT count(*) FROM identity.session', '42501', NULL, 'ductus_auth: SELECT on session is denied (it only executes open_session)');
RESET ROLE;
SET LOCAL ROLE ductus_test_stranger;
SELECT throws_ok('SELECT * FROM app.current_actor()', '42501', NULL, 'role without grants: current_actor() is denied');
RESET ROLE;
-- The migrator owns the schema, so this denial comes from the table itself.
SET LOCAL ROLE ductus_migrator;
SELECT throws_ok('SELECT count(*) FROM identity.session', '42501', NULL, 'ductus_migrator: SELECT on session is denied (DDL, not data)');
RESET ROLE;

-- 6. The whole matrix from the catalogue. Several denials above come from a
-- missing USAGE on the schema, so they would survive a table grant; here no
-- role except the owner may hold any privilege on any identity table, and a
-- policy for another role is a failure even before a grant makes it usable.
SELECT is_empty(
  $$ SELECT r.rolname || ': ' || p.privilege || ' on ' || c.relname
     FROM (SELECT rolname::text FROM pg_roles WHERE rolname LIKE 'ductus\_%' AND rolname <> 'ductus_identity'
           UNION ALL SELECT 'public') AS r
     CROSS JOIN pg_class c
     CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p (privilege)
     WHERE c.relnamespace = 'identity'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
       AND (has_table_privilege(r.rolname, c.oid, p.privilege)
            OR (p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                AND has_any_column_privilege(r.rolname, c.oid, p.privilege))) $$,
  'no role but ductus_identity, nor PUBLIC, holds a table or column privilege on any identity table'
);
SELECT is_empty(
  $$ SELECT tablename || '.' || policyname FROM pg_policies
     WHERE schemaname = 'identity' AND roles <> ARRAY['ductus_identity']::name[] $$,
  'every policy on an identity table is for ductus_identity alone'
);

SELECT * FROM finish();
ROLLBACK;

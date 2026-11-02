-- Sessions closed by a change to their institution, and by the operator
-- function close_user_sessions (F-036, DAN-169). Synthetic fixtures only.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL lc_messages TO 'C';
CREATE ROLE ductus_test_stranger NOLOGIN;
GRANT USAGE ON SCHEMA public TO ductus_app, ductus_worker, ductus_retention, ductus_auth, ductus_migrator,
  ductus_identity, ductus_test_stranger;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ductus_app, ductus_worker, ductus_retention, ductus_auth,
  ductus_migrator, ductus_identity, ductus_test_stranger;

SELECT plan(42);

-- A takes idp-1 and idp-2, B takes idp-1. a1 and b1 come through idp-1,
-- a2 through idp-2.
INSERT INTO identity.institution (id, slug, aai_home_org) VALUES
  ('00000000-0000-4000-8000-0000000025a0', 'f36-a', 'a.f36.test'),
  ('00000000-0000-4000-8000-0000000025b0', 'f36-b', 'b.f36.test');
INSERT INTO identity.institution_issuer (institution_id, oidc_issuer) VALUES
  ('00000000-0000-4000-8000-0000000025a0', 'https://idp-1.f36.test'),
  ('00000000-0000-4000-8000-0000000025a0', 'https://idp-2.f36.test'),
  ('00000000-0000-4000-8000-0000000025b0', 'https://idp-1.f36.test');
INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id) VALUES
  ('00000000-0000-4000-8000-0000000025a1', '00000000-0000-4000-8000-0000000025a0', 'https://idp-1.f36.test', 'sub-a1', 'a1@a.f36.test'),
  ('00000000-0000-4000-8000-0000000025a2', '00000000-0000-4000-8000-0000000025a0', 'https://idp-2.f36.test', 'sub-a2', 'a2@a.f36.test'),
  ('00000000-0000-4000-8000-0000000025b1', '00000000-0000-4000-8000-0000000025b0', 'https://idp-1.f36.test', 'sub-b1', 'b1@b.f36.test');

CREATE FUNCTION pg_temp.tok(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT rpad(p_name, 43, 'x') $$;
CREATE FUNCTION pg_temp.h(p_name text) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(convert_to(pg_temp.tok(p_name), 'UTF8')) $$;
-- A live session p_name for p_user, opened directly.
CREATE FUNCTION pg_temp.live(p_name text, p_user uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
  SELECT pg_temp.h(p_name), u.id, u.institution_id, now() + interval '1 hour'
  FROM identity.user_account u WHERE u.id = p_user
$$;
-- close_reason of session p_name, 'open' while it is open.
CREATE FUNCTION pg_temp.state(p_name text) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(close_reason, 'open') FROM identity.session WHERE token_hash = pg_temp.h(p_name)
$$;
-- The user current_actor() gives ductus_app for session p_name.
CREATE FUNCTION pg_temp.actor(p_name text) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  PERFORM set_config('app.session_token', pg_temp.tok(p_name), true);
  SET LOCAL ROLE ductus_app;
  v := app.current_user_id();
  RESET ROLE;
  PERFORM set_config('app.session_token', '', true);
  RETURN v;
END
$$;

SELECT pg_temp.live('a1-1', '00000000-0000-4000-8000-0000000025a1');
SELECT pg_temp.live('a2-1', '00000000-0000-4000-8000-0000000025a2');
SELECT pg_temp.live('b1-1', '00000000-0000-4000-8000-0000000025b1');
-- Closed and expired sessions of a1, which nothing below may touch.
INSERT INTO identity.session (token_hash, user_id, institution_id, created_at, expires_at, closed_at, close_reason) VALUES
  (pg_temp.h('a1-closed'), '00000000-0000-4000-8000-0000000025a1', '00000000-0000-4000-8000-0000000025a0',
   now() - interval '2 hours', now() + interval '1 hour', '2026-01-02 03:04:05+00', 'logout'),
  (pg_temp.h('a1-expired'), '00000000-0000-4000-8000-0000000025a1', '00000000-0000-4000-8000-0000000025a0',
   now() - interval '3 hours', now() - interval '1 hour', NULL, NULL);
CREATE TEMP TABLE before_close AS
  SELECT token_hash, closed_at, close_reason FROM identity.session
  WHERE token_hash IN (pg_temp.h('a1-closed'), pg_temp.h('a1-expired'));

-- 1. Removing one issuer of A closes the sessions of its users in A only.
SET LOCAL ROLE ductus_identity;
UPDATE identity.institution_issuer SET created_at = created_at - interval '1 day'
 WHERE institution_id = '00000000-0000-4000-8000-0000000025a0';
RESET ROLE;
SELECT is(pg_temp.state('a1-1') || ' ' || pg_temp.state('a2-1'), 'open open', 'issuer row rewritten to the same values closes nothing');

SET LOCAL ROLE ductus_identity;
DELETE FROM identity.institution_issuer
 WHERE institution_id = '00000000-0000-4000-8000-0000000025a0' AND oidc_issuer = 'https://idp-1.f36.test';
RESET ROLE;
SELECT is(pg_temp.state('a1-1'), 'issuer_removed', 'deleting idp-1 of A closes the session of a1');
SELECT is(pg_temp.state('a2-1'), 'open', 'deleting idp-1 of A leaves a2 of idp-2 in A open');
SELECT is(pg_temp.state('b1-1'), 'open', 'deleting idp-1 of A leaves b1 of idp-1 in B open');
SELECT is(pg_temp.actor('a1-1'), NULL, 'after the issuer is removed the a1 token is anonymous');
SELECT is(pg_temp.actor('b1-1'), '00000000-0000-4000-8000-0000000025b1'::uuid, 'the b1 token is still b1');

-- 2. Rewriting the issuer of a row closes the sessions of the old issuer.
SET LOCAL ROLE ductus_identity;
UPDATE identity.institution_issuer SET oidc_issuer = 'https://idp-3.f36.test'
 WHERE institution_id = '00000000-0000-4000-8000-0000000025a0' AND oidc_issuer = 'https://idp-2.f36.test';
RESET ROLE;
SELECT is(pg_temp.state('a2-1'), 'issuer_removed', 'rewriting idp-2 of A closes the session of a2');
SELECT is(pg_temp.state('b1-1'), 'open', 'rewriting idp-2 of A leaves B open');

-- 3. The home organisation of A. Fresh sessions, idp-1 and idp-2 back.
INSERT INTO identity.institution_issuer (institution_id, oidc_issuer) VALUES
  ('00000000-0000-4000-8000-0000000025a0', 'https://idp-1.f36.test'),
  ('00000000-0000-4000-8000-0000000025a0', 'https://idp-2.f36.test');
SELECT pg_temp.live('a1-2', '00000000-0000-4000-8000-0000000025a1');
SELECT pg_temp.live('a2-2', '00000000-0000-4000-8000-0000000025a2');

SET LOCAL ROLE ductus_identity;
UPDATE identity.institution SET aai_home_org = 'a.f36.test' WHERE id = '00000000-0000-4000-8000-0000000025a0';
UPDATE identity.institution SET slug = 'f36-a-renamed' WHERE id = '00000000-0000-4000-8000-0000000025a0';
RESET ROLE;
SELECT is(pg_temp.state('a1-2') || ' ' || pg_temp.state('a2-2'), 'open open',
  'the same aai_home_org or another column closes nothing');

SET LOCAL ROLE ductus_identity;
UPDATE identity.institution SET aai_home_org = 'a2.f36.test' WHERE id = '00000000-0000-4000-8000-0000000025a0';
RESET ROLE;
SELECT is(pg_temp.state('a1-2') || ' ' || pg_temp.state('a2-2'), 'institution_changed institution_changed',
  'a new aai_home_org closes every live session of A');
SELECT is(pg_temp.state('b1-1'), 'open', 'a new aai_home_org of A leaves B open');
SELECT is(pg_temp.actor('a1-2'), NULL, 'after the change the a1 token is anonymous');
SELECT is(pg_temp.actor('a2-2'), NULL, 'after the change the a2 token is anonymous');

-- 4. With the old value back, a login works as before; deactivation closes it.
SET LOCAL ROLE ductus_identity;
UPDATE identity.institution SET aai_home_org = 'a.f36.test' WHERE id = '00000000-0000-4000-8000-0000000025a0';
RESET ROLE;
SET LOCAL ROLE ductus_auth;
SELECT lives_ok(
  $$ SELECT identity.open_session('https://idp-1.f36.test', 'sub-a1', 'a1@a.f36.test', 'a.f36.test', pg_temp.h('a1-3'),
                                  'Ana', 'Testić', false) $$,
  'with the value restored a1 signs in again'
);
RESET ROLE;
SELECT is(pg_temp.actor('a1-3'), '00000000-0000-4000-8000-0000000025a1'::uuid, 'the new a1 token is a1');
SELECT is(pg_temp.state('a1-2'), 'institution_changed', 'restoring the value does not reopen the old session');

SET LOCAL ROLE ductus_identity;
UPDATE identity.institution SET aai_home_org = NULL WHERE id = '00000000-0000-4000-8000-0000000025a0';
RESET ROLE;
SELECT is(pg_temp.state('a1-3'), 'institution_changed', 'deactivating A (aai_home_org NULL) closes its session');
SELECT is(pg_temp.actor('a1-3'), NULL, 'after deactivation the a1 token is anonymous');
SELECT is(pg_temp.state('b1-1'), 'open', 'deactivating A leaves B open');

-- 5. Closed and expired sessions keep what they had.
SELECT is_empty(
  $$ SELECT b.token_hash FROM before_close b JOIN identity.session s USING (token_hash)
     WHERE s.closed_at IS DISTINCT FROM b.closed_at OR s.close_reason IS DISTINCT FROM b.close_reason $$,
  'a closed session keeps its reason and time, an expired one stays as it was'
);

-- 6. The operator function.
-- A first value (from NULL) closes nothing: no login opens a session without one.
SELECT pg_temp.live('a2-first', '00000000-0000-4000-8000-0000000025a2');
UPDATE identity.institution SET aai_home_org = 'a.f36.test' WHERE id = '00000000-0000-4000-8000-0000000025a0';
SELECT is(pg_temp.state('a2-first'), 'open', 'setting aai_home_org from NULL closes nothing');

SELECT pg_temp.live('a1-4', '00000000-0000-4000-8000-0000000025a1');
SELECT pg_temp.live('a1-5', '00000000-0000-4000-8000-0000000025a1');
SELECT pg_temp.live('a2-4', '00000000-0000-4000-8000-0000000025a2');
SET LOCAL ROLE ductus_identity;
SELECT is(identity.close_user_sessions('00000000-0000-4000-8000-0000000025a1'), 2,
  'close_user_sessions closes the two live sessions of a1');
SELECT is(identity.close_user_sessions('00000000-0000-4000-8000-0000000025a1'), 0, 'a second call closes nothing');
SELECT throws_ok('SELECT identity.close_user_sessions(NULL)', 'ZD422', 'invalid input', 'a NULL user is refused');
RESET ROLE;
SELECT is(pg_temp.state('a1-4') || ' ' || pg_temp.state('a1-5'), 'operator operator', 'both a1 sessions carry the reason operator');
SELECT is(pg_temp.state('a2-4'), 'open', 'close_user_sessions of a1 leaves a2 open');
SELECT is(pg_temp.actor('a1-4'), NULL, 'after close_user_sessions the a1 token is anonymous');
SELECT is_empty(
  $$ SELECT b.token_hash FROM before_close b JOIN identity.session s USING (token_hash)
     WHERE s.closed_at IS DISTINCT FROM b.closed_at OR s.close_reason IS DISTINCT FROM b.close_reason $$,
  'close_user_sessions keeps the closed and expired sessions of a1 as they were'
);

-- 7. TRUNCATE of the issuers closes every live session.
SET LOCAL ROLE ductus_identity;
TRUNCATE identity.institution_issuer;
RESET ROLE;
SELECT is(pg_temp.state('a2-4') || ' ' || pg_temp.state('b1-1'), 'issuer_removed issuer_removed',
  'TRUNCATE of institution_issuer closes the live sessions');

-- 8. Nobody but the owner may run close_user_sessions.
SET LOCAL ROLE ductus_app;
SELECT throws_ok($$ SELECT identity.close_user_sessions('00000000-0000-4000-8000-0000000025b1') $$, '42501', NULL,
  'ductus_app: close_user_sessions is denied');
RESET ROLE;
SET LOCAL ROLE ductus_auth;
SELECT throws_ok($$ SELECT identity.close_user_sessions('00000000-0000-4000-8000-0000000025b1') $$, '42501', NULL,
  'ductus_auth: close_user_sessions is denied');
RESET ROLE;
SET LOCAL ROLE ductus_worker;
SELECT throws_ok($$ SELECT identity.close_user_sessions('00000000-0000-4000-8000-0000000025b1') $$, '42501', NULL,
  'ductus_worker: close_user_sessions is denied');
RESET ROLE;
SET LOCAL ROLE ductus_retention;
SELECT throws_ok($$ SELECT identity.close_user_sessions('00000000-0000-4000-8000-0000000025b1') $$, '42501', NULL,
  'ductus_retention: close_user_sessions is denied');
RESET ROLE;
SET LOCAL ROLE ductus_test_stranger;
SELECT throws_ok($$ SELECT identity.close_user_sessions('00000000-0000-4000-8000-0000000025b1') $$, '42501', NULL,
  'role without grants: close_user_sessions is denied');
RESET ROLE;
SELECT is_empty(
  $$ SELECT r.rolname || ': ' || p.oid::regprocedure::text
     FROM (SELECT rolname::text FROM pg_roles WHERE rolname LIKE 'ductus\_%' AND rolname <> 'ductus_identity'
           UNION ALL SELECT 'public') AS r
     CROSS JOIN pg_proc p
     WHERE p.pronamespace = 'identity'::regnamespace
       AND p.proname IN ('close_user_sessions', 'close_sessions_on_home_org_change',
                         'close_sessions_on_issuer_removal', 'close_sessions_on_issuer_truncate')
       AND has_function_privilege(r.rolname, p.oid, 'EXECUTE') $$,
  'no role but ductus_identity, nor PUBLIC, may execute the new session functions'
);
SELECT is(
  (SELECT count(*)::integer FROM pg_proc
   WHERE pronamespace = 'identity'::regnamespace
     AND proname IN ('close_user_sessions', 'close_sessions_on_home_org_change',
                     'close_sessions_on_issuer_removal', 'close_sessions_on_issuer_truncate')
     AND proowner = 'ductus_identity'::regrole),
  4, 'ductus_identity owns all four functions'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'identity.close_user_sessions(uuid)'::regprocedure)
  AND NOT EXISTS (SELECT 1 FROM pg_proc
                  WHERE pronamespace = 'identity'::regnamespace AND prosecdef
                    AND proname LIKE 'close\_sessions\_on\_%'),
  'only close_user_sessions is SECURITY DEFINER; the trigger functions run as the changing role'
);

-- 9. The triggers exist where they must, and are enabled.
SELECT is(
  (SELECT string_agg(tgrelid::regclass::text || ':' || tgname, ' ' ORDER BY tgname)
   FROM pg_trigger WHERE tgname LIKE 'close\_sessions\_on\_%' AND tgenabled = 'O'),
  'identity.institution:close_sessions_on_home_org_change identity.institution_issuer:close_sessions_on_issuer_removal identity.institution_issuer:close_sessions_on_issuer_truncate',
  'the three closing triggers are on institution and institution_issuer and enabled'
);

-- 10. close_reason takes the new values and nothing else.
SELECT throws_ok(
  $$ INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at, closed_at, close_reason)
     VALUES (pg_temp.h('bad'), '00000000-0000-4000-8000-0000000025b1', '00000000-0000-4000-8000-0000000025b0',
             now() + interval '1 hour', now(), 'expired') $$,
  '23514', NULL, 'an unknown close_reason is refused'
);
SELECT lives_ok(
  $$ INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at, closed_at, close_reason)
     SELECT pg_temp.h('ok-' || r), '00000000-0000-4000-8000-0000000025b1', '00000000-0000-4000-8000-0000000025b0',
            now() + interval '1 hour', now(), r
     FROM unnest(ARRAY['logout', 'backchannel_logout', 'logout_all', 'institution_changed', 'issuer_removed', 'operator']) AS r $$,
  'every listed close_reason is accepted'
);

-- 11. A change that cannot close the sessions does not happen.
CREATE ROLE ductus_test_editor NOLOGIN;
GRANT USAGE ON SCHEMA identity, public TO ductus_test_editor;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ductus_test_editor;
GRANT SELECT, UPDATE ON identity.institution TO ductus_test_editor;
CREATE POLICY test_editor ON identity.institution TO ductus_test_editor USING (true) WITH CHECK (true);
SELECT pg_temp.live('b1-2', '00000000-0000-4000-8000-0000000025b1');
SET LOCAL ROLE ductus_test_editor;
SELECT throws_ok(
  $$ UPDATE identity.institution SET aai_home_org = 'b2.f36.test' WHERE id = '00000000-0000-4000-8000-0000000025b0' $$,
  '42501', NULL, 'a role that may change the institution but not the sessions cannot change aai_home_org'
);
RESET ROLE;
SELECT is(
  (SELECT aai_home_org FROM identity.institution WHERE id = '00000000-0000-4000-8000-0000000025b0') || ' ' || pg_temp.state('b1-2'),
  'b.f36.test open', 'the refused change left the value and the session as they were'
);

SELECT * FROM finish();
ROLLBACK;

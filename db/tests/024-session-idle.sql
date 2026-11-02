-- Idle expiry, activity, "sign me out everywhere" and retention of ended
-- sessions (DAN-296 B4, D-200 P2; attack plan #1244). Synthetic fixtures
-- only: institutions a.example and b.example, nina and ana in A, lea in B.
-- now() is fixed for the transaction, so every boundary below is exact.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
CREATE ROLE ductus_test_stranger NOLOGIN;
GRANT USAGE ON SCHEMA public TO ductus_app, ductus_worker, ductus_retention, ductus_auth, ductus_test_stranger;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ductus_app, ductus_worker, ductus_retention, ductus_auth, ductus_test_stranger;

SELECT plan(63);

INSERT INTO identity.institution (id, slug) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'test-a'),
  ('00000000-0000-4000-8000-00000000000b', 'test-b');
INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id) VALUES
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a', 'https://issuer.test', 'sub-nina', 'nina@a.example'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-00000000000a', 'https://issuer.test', 'sub-ana', 'ana@a.example'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000b', 'https://issuer.test', 'sub-lea', 'lea@b.example');

-- One row per fixture session; the token is the name padded to 43 base64url
-- characters, and the row stores its SHA-256.
CREATE TEMP TABLE fx (
  name text PRIMARY KEY, person text NOT NULL,
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL, closed_at timestamptz, close_reason text
);
INSERT INTO fx VALUES
  -- Idle limit (#1244 items 1-3): 1 h 59 min live; 2 h and 2 h 1 min not.
  ('live_n',   'nina', now() - interval '3 hours', now() + interval '9 hours', now() - interval '1 hour 59 minutes', NULL, NULL),
  ('idle_2h',  'nina', now() - interval '3 hours', now() + interval '9 hours', now() - interval '2 hours', NULL, NULL),
  ('idle_2h1', 'nina', now() - interval '3 hours', now() + interval '9 hours', now() - interval '2 hours 1 minute', NULL, NULL),
  -- Active a minute ago, but twelve hours since login.
  ('max_n',    'nina', now() - interval '12 hours', now(), now() - interval '1 minute', NULL, NULL),
  ('closed_n', 'nina', now() - interval '1 hour', now() + interval '11 hours', now() - interval '1 minute', now() - interval '10 minutes', 'logout'),
  -- Throttle: 30 s since the last write is too soon, 61 s is due.
  ('fresh_n',  'nina', now() - interval '1 hour', now() + interval '11 hours', now() - interval '30 seconds', NULL, NULL),
  ('due_n',    'nina', now() - interval '1 hour', now() + interval '11 hours', now() - interval '61 seconds', NULL, NULL),
  ('live_a',   'ana',  now() - interval '1 hour', now() + interval '11 hours', now() - interval '5 minutes', NULL, NULL),
  ('live_l',   'lea',  now() - interval '1 hour', now() + interval '11 hours', now() - interval '5 minutes', NULL, NULL),
  -- Retention (#1244 item 23): ended more than 30 days ago by closing, by
  -- the twelve hours or by idleness goes; exactly 30 days, or idle that
  -- ended 29 days 23 hours ago, stays.
  ('p_closed_old',  'lea', now() - interval '30 days 2 hours', now() - interval '29 days', now() - interval '30 days 1 hour', now() - interval '30 days 1 second', 'logout'),
  ('p_closed_edge', 'lea', now() - interval '30 days 2 hours', now() - interval '29 days', now() - interval '30 days 1 hour', now() - interval '30 days', 'logout'),
  ('p_expired_old', 'lea', now() - interval '31 days 12 hours', now() - interval '31 days', now() - interval '31 days 1 hour', NULL, NULL),
  ('p_idle_old',    'lea', now() - interval '32 days', now() - interval '20 days', now() - interval '31 days', NULL, NULL),
  ('p_idle_kept',   'lea', now() - interval '31 days', now() - interval '20 days', now() - interval '30 days 1 hour', NULL, NULL);

CREATE TEMP TABLE tok (name text PRIMARY KEY, token text NOT NULL);
GRANT SELECT ON tok TO PUBLIC;
INSERT INTO tok SELECT name, rpad(name, 43, '_') FROM fx;
INSERT INTO tok VALUES ('unknown', repeat('U', 43));

CREATE TEMP TABLE person (name text PRIMARY KEY, user_id uuid NOT NULL, institution_id uuid NOT NULL);
INSERT INTO person VALUES
  ('nina', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a'),
  ('ana',  '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-00000000000a'),
  ('lea',  '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000b');

INSERT INTO identity.session (token_hash, user_id, institution_id, created_at, expires_at, last_seen_at, closed_at, close_reason)
SELECT sha256(convert_to(t.token, 'UTF8')), p.user_id, p.institution_id,
       f.created_at, f.expires_at, f.last_seen_at, f.closed_at, f.close_reason
FROM fx f JOIN tok t USING (name) JOIN person p ON p.name = f.person;

-- Read only as the test owner: the session row of a fixture, and a digest of
-- every session row, to show that a call changed nothing.
CREATE FUNCTION pg_temp.ses(p_name text) RETURNS identity.session
LANGUAGE sql AS $$
  SELECT s.* FROM identity.session s JOIN tok t ON s.token_hash = sha256(convert_to(t.token, 'UTF8'))
  WHERE t.name = p_name
$$;
CREATE FUNCTION pg_temp.digest(p_except text DEFAULT NULL) RETURNS text
LANGUAGE sql AS $$
  SELECT md5(coalesce(string_agg(s::text, ',' ORDER BY s.id), ''))
  FROM identity.session s
  WHERE p_except IS NULL OR s.token_hash <> sha256(convert_to(rpad(p_except, 43, '_'), 'UTF8'))
$$;
CREATE TEMP TABLE snap (label text PRIMARY KEY, val text NOT NULL);
GRANT SELECT ON snap TO PUBLIC;

-- 1. current_actor() under ductus_app (#1244 items 1-3, 5).
SET LOCAL ROLE ductus_app;
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'live_n'), true);
SELECT is(app.current_user_id(), '00000000-0000-4000-8000-0000000000a1'::uuid, 'last activity 1 h 59 min ago: nina');
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'idle_2h'), true);
SELECT is(app.current_user_id(), NULL, 'last activity exactly 2 h ago: anonymous');
SELECT is(app.current_institution_id(), NULL, 'exactly 2 h: no institution either');
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'idle_2h1'), true);
SELECT is(app.current_user_id(), NULL, 'last activity 2 h 1 min ago: anonymous');
SELECT ok((SELECT user_id IS NULL AND institution_id IS NULL FROM app.current_actor()), '2 h 1 min: current_actor() gives nulls');
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'max_n'), true);
SELECT is(app.current_user_id(), NULL, 'active a minute ago but 12 h since login: anonymous');

-- 2. touch_current_session() (#1244 items 3, 4, 6-8).
RESET ROLE;
INSERT INTO snap VALUES ('before_touch', pg_temp.digest());
SET LOCAL ROLE ductus_app;
SELECT set_config('app.session_token', '', true);
SELECT is(identity.touch_current_session(), false, 'touch without a token writes nothing');
SELECT set_config('app.session_token', left((SELECT token FROM tok WHERE name = 'live_n'), 42), true);
SELECT is(identity.touch_current_session(), false, 'touch with a malformed token writes nothing');
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'unknown'), true);
SELECT is(identity.touch_current_session(), false, 'touch with an unknown token writes nothing');
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'idle_2h1'), true);
SELECT is(identity.touch_current_session(), false, 'touch does not revive a session idle for 2 h 1 min');
SELECT is(app.current_user_id(), NULL, 'after the touch that session is still anonymous');
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'idle_2h'), true);
SELECT is(identity.touch_current_session(), false, 'touch does not revive a session idle for exactly 2 h');
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'max_n'), true);
SELECT is(identity.touch_current_session(), false, 'touch does not revive a session past its 12 h');
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'closed_n'), true);
SELECT is(identity.touch_current_session(), false, 'touch does not revive a closed session');
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'fresh_n'), true);
SELECT is(identity.touch_current_session(), false, 'touch 30 s after the last write is skipped');
RESET ROLE;
SELECT is(pg_temp.digest(), (SELECT val FROM snap WHERE label = 'before_touch'), 'no refused or skipped touch changed any session row');

INSERT INTO snap VALUES ('others', pg_temp.digest('due_n'));
SET LOCAL ROLE ductus_app;
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'due_n'), true);
SELECT is(identity.touch_current_session(), true, 'touch 61 s after the last write records activity');
SELECT is(identity.touch_current_session(), false, 'a second touch at the same moment is skipped');
RESET ROLE;
SELECT is((pg_temp.ses('due_n')).last_seen_at, now(), 'the touch wrote the database clock');
SELECT is((pg_temp.ses('due_n')).expires_at, (SELECT expires_at FROM fx WHERE name = 'due_n'), 'activity never moves expires_at');
SELECT is(pg_temp.digest('due_n'), (SELECT val FROM snap WHERE label = 'others'), 'nina''s touch changed only her own row');
SELECT is(
  ARRAY(SELECT pronargs::int FROM pg_proc
        WHERE oid IN ('identity.touch_current_session()'::regprocedure,
                      'identity.close_all_sessions_for_identity()'::regprocedure,
                      'identity.purge_ended_sessions()'::regprocedure)),
  ARRAY[0, 0, 0],
  'no new function takes an argument: no caller supplies a time or a session'
);

-- 3. close_all_sessions_for_identity() (#1244 items 15-17).
RESET ROLE;
INSERT INTO snap VALUES ('before_all', pg_temp.digest());
SET LOCAL ROLE ductus_app;
SELECT set_config('app.session_token', '', true);
SELECT lives_ok('SELECT identity.close_all_sessions_for_identity()', 'sign out everywhere without a token: no error');
SELECT set_config('app.session_token', left((SELECT token FROM tok WHERE name = 'live_n'), 42), true);
SELECT lives_ok('SELECT identity.close_all_sessions_for_identity()', 'with a malformed token: no error');
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'unknown'), true);
SELECT lives_ok('SELECT identity.close_all_sessions_for_identity()', 'with an unknown token: no error');
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'closed_n'), true);
SELECT lives_ok('SELECT identity.close_all_sessions_for_identity()', 'with a closed session: no error');
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'max_n'), true);
SELECT lives_ok('SELECT identity.close_all_sessions_for_identity()', 'with a session past 12 h: no error');
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'idle_2h1'), true);
SELECT lives_ok('SELECT identity.close_all_sessions_for_identity()', 'with an idle session: no error');
SELECT is(
  (SELECT pg_typeof(identity.close_all_sessions_for_identity())::text),
  'void',
  'the outcome carries nothing: it never tells whether other sessions exist'
);
RESET ROLE;
SELECT is(pg_temp.digest(), (SELECT val FROM snap WHERE label = 'before_all'), 'without a live session nothing was closed');

SET LOCAL ROLE ductus_app;
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'live_n'), true);
SELECT lives_ok('SELECT identity.close_all_sessions_for_identity()', 'nina signs out everywhere');
SELECT is(app.current_user_id(), NULL, 'the calling session is closed too');
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'fresh_n'), true);
SELECT is(app.current_user_id(), NULL, 'nina''s other session is anonymous');
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'live_a'), true);
SELECT is(app.current_user_id(), '00000000-0000-4000-8000-0000000000a2'::uuid, 'ana in the same institution stays signed in');
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'live_l'), true);
SELECT is(app.current_user_id(), '00000000-0000-4000-8000-0000000000b1'::uuid, 'lea in the other institution stays signed in');
RESET ROLE;
SELECT is(
  ARRAY(SELECT f.name FROM fx f WHERE (pg_temp.ses(f.name)).close_reason = 'logout_all' ORDER BY f.name),
  ARRAY['due_n', 'fresh_n', 'live_n'],
  'exactly nina''s three live sessions are closed, with reason logout_all'
);
SELECT is((pg_temp.ses('live_n')).closed_at, now(), 'closed at the database clock');
SELECT ok(
  (pg_temp.ses('closed_n')).close_reason = 'logout'
  AND (pg_temp.ses('closed_n')).closed_at = (SELECT closed_at FROM fx WHERE name = 'closed_n'),
  'a session closed earlier keeps its reason and time'
);
SELECT is(
  ARRAY(SELECT f.name FROM fx f WHERE f.name IN ('idle_2h', 'idle_2h1', 'max_n')
          AND (pg_temp.ses(f.name)).closed_at IS NULL ORDER BY f.name),
  ARRAY['idle_2h', 'idle_2h1', 'max_n'],
  'sessions that already ended by time are not rewritten'
);
INSERT INTO snap VALUES ('after_all', pg_temp.digest());
SET LOCAL ROLE ductus_app;
SELECT set_config('app.session_token', (SELECT token FROM tok WHERE name = 'live_n'), true);
SELECT lives_ok('SELECT identity.close_all_sessions_for_identity()', 'a repeat is harmless');
RESET ROLE;
SELECT is(pg_temp.digest(), (SELECT val FROM snap WHERE label = 'after_all'), 'the repeat changed nothing');

-- 4. purge_ended_sessions() (#1244 items 23-25).
INSERT INTO snap VALUES
  ('accounts', (SELECT count(*)::text FROM identity.user_account)),
  ('institutions', (SELECT count(*)::text FROM identity.institution)),
  -- Rows outside these fixtures that the rule would also remove.
  ('foreign_old', (SELECT count(*)::text FROM identity.session s
                   WHERE LEAST(s.closed_at, s.expires_at, s.last_seen_at + interval '2 hours') < now() - interval '30 days'
                     AND s.token_hash NOT IN (SELECT sha256(convert_to(token, 'UTF8')) FROM tok)));

SET LOCAL ROLE ductus_app;
SELECT throws_ok('SELECT identity.purge_ended_sessions()', '42501', NULL, 'ductus_app: purge is denied');
RESET ROLE;
SET LOCAL ROLE ductus_auth;
SELECT throws_ok('SELECT identity.purge_ended_sessions()', '42501', NULL, 'ductus_auth: purge is denied');
RESET ROLE;
SET LOCAL ROLE ductus_worker;
SELECT throws_ok('SELECT identity.purge_ended_sessions()', '42501', NULL, 'ductus_worker: purge is denied');
RESET ROLE;
SET LOCAL ROLE ductus_test_stranger;
SELECT throws_ok('SELECT identity.purge_ended_sessions()', '42501', NULL, 'role without grants: purge is denied');
RESET ROLE;

SET LOCAL ROLE ductus_retention;
SELECT is(identity.purge_ended_sessions(), 3 + (SELECT val::bigint FROM snap WHERE label = 'foreign_old'),
  'ductus_retention purges the three rows that ended more than 30 days ago');
SELECT is(identity.purge_ended_sessions(), 0::bigint, 'a repeated purge removes nothing');
SELECT throws_ok('SELECT count(*) FROM identity.session', '42501', NULL, 'ductus_retention still cannot read the session table');
RESET ROLE;
SELECT is(
  ARRAY(SELECT f.name FROM fx f WHERE (pg_temp.ses(f.name)).id IS NULL ORDER BY f.name),
  ARRAY['p_closed_old', 'p_expired_old', 'p_idle_old'],
  'gone: closed 30 days 1 s ago, past 12 h 31 days ago, idle ended 30 days 22 h ago'
);
SELECT ok((pg_temp.ses('p_closed_edge')).id IS NOT NULL, 'closed exactly 30 days ago: kept');
SELECT ok((pg_temp.ses('p_idle_kept')).id IS NOT NULL, 'idle ended 29 days 23 h ago: kept');
SELECT ok((pg_temp.ses('live_l')).id IS NOT NULL AND (pg_temp.ses('closed_n')).id IS NOT NULL, 'open and recently closed sessions: kept');
SELECT is((SELECT count(*)::text FROM identity.user_account), (SELECT val FROM snap WHERE label = 'accounts'), 'purge removes no account');
SELECT is((SELECT count(*)::text FROM identity.institution), (SELECT val FROM snap WHERE label = 'institutions'), 'purge removes no institution');
SELECT is_empty(
  $$ SELECT conrelid::regclass::text FROM pg_constraint WHERE confrelid = 'identity.session'::regclass $$,
  'no table refers to a session row, so a purge leaves nothing without its reference'
);
SELECT ok(
  (SELECT prorettype = 'bigint'::regtype AND NOT proretset FROM pg_proc WHERE oid = 'identity.purge_ended_sessions()'::regprocedure),
  'purge returns one count, never tokens or identifiers'
);

-- 5. The column and the reasons (#1244 items 9, 27).
SELECT columns_are('identity', 'session',
  ARRAY['id', 'token_hash', 'user_id', 'institution_id', 'created_at', 'expires_at', 'closed_at', 'close_reason', 'last_seen_at'],
  'a session row holds no address, browser or device');
SELECT col_not_null('identity', 'session', 'last_seen_at', 'last_seen_at is NOT NULL');
SELECT col_default_is('identity', 'session', 'last_seen_at', 'now()', 'a new row starts its idle time at the database clock');
SELECT throws_ok(
  $$ INSERT INTO identity.session (token_hash, user_id, institution_id, created_at, expires_at, last_seen_at)
     VALUES (sha256('back'), '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a',
             now(), now() + interval '1 hour', now() - interval '1 second') $$,
  '23514', NULL, 'activity before login is refused'
);
SELECT throws_ok(
  $$ UPDATE identity.session SET close_reason = 'bogus' WHERE close_reason = 'logout_all' $$,
  '23514', NULL, 'a reason outside the list is refused'
);
SELECT lives_ok(
  $$ INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
     VALUES (sha256('fresh'), '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a', now() + interval '12 hours') $$,
  'an insert that names no last_seen_at, as open_session does, still works'
);
SELECT is(
  (SELECT last_seen_at FROM identity.session WHERE token_hash = sha256('fresh')), now(),
  'and its idle time starts now'
);

SELECT * FROM finish();
ROLLBACK;

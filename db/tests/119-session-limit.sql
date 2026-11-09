-- At most five live sessions per account (DAN-296, D-200 P2). A sixth login
-- closes the least active other session as superseded and never the new one.
-- Synthetic fixtures only: institutions a.example and b.example, nina, ana
-- and ivo in A, lea in B. now() is fixed for the transaction.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL lc_messages TO 'C';
GRANT USAGE ON SCHEMA public TO ductus_app, ductus_auth;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ductus_app, ductus_auth;

SELECT plan(43);

INSERT INTO identity.institution (id, slug, aai_home_org) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'test-a', 'a.example'),
  ('00000000-0000-4000-8000-00000000000b', 'test-b', 'b.example');
INSERT INTO identity.institution_issuer (institution_id, oidc_issuer) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'https://issuer.test'),
  ('00000000-0000-4000-8000-00000000000b', 'https://issuer.test');
INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id) VALUES
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a', 'https://issuer.test', 'sub-nina', 'nina@a.example'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-00000000000a', 'https://issuer.test', 'sub-ana', 'ana@a.example'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000b', 'https://issuer.test', 'sub-lea', 'lea@b.example');

CREATE TEMP TABLE person (name text PRIMARY KEY, user_id uuid NOT NULL, institution_id uuid NOT NULL);
INSERT INTO person VALUES
  ('nina', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a'),
  ('ana',  '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-00000000000a'),
  ('lea',  '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000b');

-- The token of a fixture is its name padded to 43 base64url characters.
CREATE FUNCTION pg_temp.tok(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT rpad(p_name, 43, '_') $$;
CREATE FUNCTION pg_temp.h(p_name text) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(convert_to(rpad(p_name, 43, '_'), 'UTF8')) $$;
-- One fixture session; minutes since login and since last activity, and
-- optionally an end. Each call is its own INSERT, so the trigger sees it alone.
CREATE FUNCTION pg_temp.add(p_name text, p_person text, p_created_min int, p_seen_min int,
                            p_expires timestamptz DEFAULT NULL, p_closed boolean DEFAULT false,
                            p_sid text DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO identity.session (token_hash, user_id, institution_id, created_at, expires_at, last_seen_at,
                                closed_at, close_reason, oidc_sid_hash)
  SELECT pg_temp.h(p_name), p.user_id, p.institution_id,
         now() - make_interval(mins => p_created_min),
         coalesce(p_expires, now() - make_interval(mins => p_created_min) + interval '12 hours'),
         now() - make_interval(mins => p_seen_min),
         CASE WHEN p_closed THEN now() - interval '1 minute' END,
         CASE WHEN p_closed THEN 'logout' END,
         CASE WHEN p_sid IS NOT NULL THEN sha256(convert_to(p_sid, 'UTF8')) END
  FROM person p WHERE p.name = p_person
$$;
CREATE FUNCTION pg_temp.ses(p_name text) RETURNS identity.session
LANGUAGE sql AS $$ SELECT s.* FROM identity.session s WHERE s.token_hash = pg_temp.h(p_name) $$;
CREATE FUNCTION pg_temp.state(p_name text) RETURNS text
LANGUAGE sql AS $$
  SELECT CASE WHEN s.closed_at IS NULL THEN 'open' ELSE s.close_reason END
  FROM identity.session s WHERE s.token_hash = pg_temp.h(p_name)
$$;
CREATE FUNCTION pg_temp.live(p_user uuid) RETURNS bigint
LANGUAGE sql AS $$
  SELECT count(*) FROM identity.session s
  WHERE s.user_id = p_user AND s.closed_at IS NULL AND s.expires_at > now()
    AND s.last_seen_at > now() - interval '2 hours'
$$;
-- A digest of the session rows matching a filter, to show nothing changed.
CREATE FUNCTION pg_temp.digest(p_where text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE 'SELECT md5(coalesce(string_agg(s::text, '','' ORDER BY s.id), '''')) FROM identity.session s WHERE ' || p_where
  INTO v;
  RETURN v;
END
$$;
CREATE TEMP TABLE snap (label text PRIMARY KEY, val text NOT NULL);
GRANT SELECT ON snap TO PUBLIC;

-- 1. The trigger and its function from the catalogue.
SELECT is(
  (SELECT t.tgtype::int FROM pg_trigger t
   WHERE t.tgrelid = 'identity.session'::regclass AND t.tgname = 'enforce_session_limit'),
  5, 'enforce_session_limit is an AFTER INSERT FOR EACH ROW trigger on identity.session'
);
SELECT ok(
  (SELECT t.tgenabled = 'O' FROM pg_trigger t
   WHERE t.tgrelid = 'identity.session'::regclass AND t.tgname = 'enforce_session_limit'),
  'the trigger is enabled'
);
SELECT ok(NOT p.prosecdef, 'enforce_session_limit is not SECURITY DEFINER')
FROM pg_proc p WHERE p.oid = 'identity.enforce_session_limit()'::regprocedure;
SELECT is(pg_get_userbyid(p.proowner), 'ductus_identity', 'enforce_session_limit belongs to ductus_identity')
FROM pg_proc p WHERE p.oid = 'identity.enforce_session_limit()'::regprocedure;
SELECT is(p.proconfig, ARRAY['search_path=""'], 'enforce_session_limit runs with an empty search_path')
FROM pg_proc p WHERE p.oid = 'identity.enforce_session_limit()'::regprocedure;
SELECT is_empty(
  $$ SELECT r.rolname FROM (SELECT rolname::text FROM pg_roles
                            WHERE rolname LIKE 'ductus\_%' AND rolname <> 'ductus_identity'
                            UNION ALL SELECT 'public') AS r (rolname)
     WHERE has_function_privilege(r.rolname, 'identity.enforce_session_limit()', 'EXECUTE') $$,
  'no role but the owner, nor PUBLIC, may execute enforce_session_limit'
);
-- The refusal under REPEATABLE READ cannot be reached inside this test's
-- transaction; the integration test session-limit-race drives it.
SELECT ok(
  (SELECT p.prosrc LIKE '%read committed required%' AND p.prosrc LIKE '%25000%'
   FROM pg_proc p WHERE p.oid = 'identity.enforce_session_limit()'::regprocedure),
  'the function refuses an isolation level above read committed with 25000'
);
SELECT ok(
  pg_get_constraintdef((SELECT c.oid FROM pg_constraint c
                        WHERE c.conrelid = 'identity.session'::regclass AND c.conname = 'session_close_reason_check'))
    LIKE '%superseded%',
  'superseded is an allowed close reason'
);

-- 2. Five live sessions in one statement are all kept: each firing counts
-- the four others, so nothing goes.
INSERT INTO identity.session (token_hash, user_id, institution_id, created_at, expires_at, last_seen_at)
SELECT pg_temp.h('ana' || g), p.user_id, p.institution_id,
       now() - interval '1 hour', now() + interval '11 hours', now() - make_interval(mins => g)
FROM person p, generate_series(1, 5) AS g WHERE p.name = 'ana';
SELECT is(pg_temp.live('00000000-0000-4000-8000-0000000000a2'), 5::bigint, 'five live sessions of one account are all kept');

-- 3. Nina: four live sessions, plus ended rows that do not count.
SELECT pg_temp.add('n1', 'nina', 300, 50);
SELECT pg_temp.add('n2', 'nina', 300, 40);
SELECT pg_temp.add('n3', 'nina', 240, 40, p_sid => 'sid-n3');
SELECT pg_temp.add('n4', 'nina', 240, 30);
SELECT pg_temp.add('n_closed',  'nina', 60, 1, p_closed => true);
SELECT pg_temp.add('n_expired', 'nina', 720, 1, p_expires => now());
SELECT pg_temp.add('n_idle',    'nina', 180, 120);
SELECT pg_temp.add('l1', 'lea', 60, 5);
SELECT is(pg_temp.live('00000000-0000-4000-8000-0000000000a1'), 4::bigint, 'nina starts with four live sessions');

INSERT INTO snap VALUES
  ('ended_n', pg_temp.digest($$s.token_hash IN (sha256(convert_to(rpad('n_closed', 43, '_'), 'UTF8')),
                                                sha256(convert_to(rpad('n_expired', 43, '_'), 'UTF8')),
                                                sha256(convert_to(rpad('n_idle', 43, '_'), 'UTF8')))$$)),
  ('others', pg_temp.digest($$s.user_id <> '00000000-0000-4000-8000-0000000000a1'$$));

-- A fifth live session is within the limit.
SELECT pg_temp.add('n5', 'nina', 120, 20);
SELECT is(pg_temp.live('00000000-0000-4000-8000-0000000000a1'), 5::bigint, 'a fifth login keeps all five');
SELECT is(
  (SELECT count(*) FROM identity.session WHERE user_id = '00000000-0000-4000-8000-0000000000a1' AND close_reason = 'superseded'),
  0::bigint, 'the fifth login supersedes nothing'
);

-- A sixth closes the least active of the others.
SELECT pg_temp.add('n6', 'nina', 60, 10);
SELECT is(pg_temp.state('n1'), 'superseded', 'the sixth login supersedes the least active session');
SELECT is((pg_temp.ses('n1')).closed_at, now(), 'the superseded session is closed now');
SELECT is(pg_temp.state('n6'), 'open', 'the new session is open');
SELECT is(pg_temp.live('00000000-0000-4000-8000-0000000000a1'), 5::bigint, 'five live sessions remain');
SELECT ok(pg_temp.state('n2') = 'open' AND pg_temp.state('n3') = 'open' AND pg_temp.state('n4') = 'open'
          AND pg_temp.state('n5') = 'open', 'the four more active sessions stay open');

-- n2 and n3 were last active at the same time: the older login goes.
SELECT pg_temp.add('n7', 'nina', 30, 5);
SELECT is(pg_temp.state('n2'), 'superseded', 'on equal activity the older login is superseded');
SELECT is(pg_temp.state('n3'), 'open', 'the newer login of equal activity stays');

-- A new session that is the least active of all still stays; the least active
-- of the others goes in its place, and its provider sid is cleared.
SELECT is((pg_temp.ses('n3')).oidc_sid_hash IS NOT NULL, true, 'n3 has a provider sid before');
SELECT pg_temp.add('n8', 'nina', 119, 119);
SELECT is(pg_temp.state('n8'), 'open', 'the new session is never superseded, even when it is the least active');
SELECT is(pg_temp.state('n3'), 'superseded', 'the least active of the others goes instead');
SELECT is((pg_temp.ses('n3')).oidc_sid_hash, NULL, 'a superseded session keeps no provider sid');
SELECT is(pg_temp.live('00000000-0000-4000-8000-0000000000a1'), 5::bigint, 'still five live sessions');
SELECT is(
  (SELECT count(*) FROM identity.session WHERE user_id = '00000000-0000-4000-8000-0000000000a1' AND close_reason = 'superseded'),
  3::bigint, 'three logins past the limit superseded three sessions'
);

-- Ended rows were neither counted nor touched, and no other account changed.
SELECT is(
  pg_temp.digest($$s.token_hash IN (sha256(convert_to(rpad('n_closed', 43, '_'), 'UTF8')),
                                    sha256(convert_to(rpad('n_expired', 43, '_'), 'UTF8')),
                                    sha256(convert_to(rpad('n_idle', 43, '_'), 'UTF8')))$$),
  (SELECT val FROM snap WHERE label = 'ended_n'), 'closed, expired and idle sessions are not touched'
);
SELECT is(pg_temp.digest($$s.user_id <> '00000000-0000-4000-8000-0000000000a1'$$),
  (SELECT val FROM snap WHERE label = 'others'), 'no session of another account changed');

-- 4. A new row that is not live supersedes nothing.
INSERT INTO snap VALUES ('nina_before_dead', pg_temp.digest($$s.user_id = '00000000-0000-4000-8000-0000000000a1'$$));
SELECT pg_temp.add('d_closed',  'nina', 10, 1, p_closed => true);
SELECT pg_temp.add('d_expired', 'nina', 720, 1, p_expires => now());
SELECT pg_temp.add('d_idle',    'nina', 180, 120);
SELECT is(
  pg_temp.digest($$s.user_id = '00000000-0000-4000-8000-0000000000a1'
                   AND s.token_hash NOT IN (sha256(convert_to(rpad('d_closed', 43, '_'), 'UTF8')),
                                            sha256(convert_to(rpad('d_expired', 43, '_'), 'UTF8')),
                                            sha256(convert_to(rpad('d_idle', 43, '_'), 'UTF8')))$$),
  (SELECT val FROM snap WHERE label = 'nina_before_dead'),
  'inserting a closed, expired or idle session supersedes nothing'
);
SELECT is(pg_temp.live('00000000-0000-4000-8000-0000000000a1'), 5::bigint, 'still five live sessions after the dead rows');

-- 5. A superseded token no longer acts, and touch does not revive it.
SET LOCAL ROLE ductus_app;
SELECT set_config('app.session_token', pg_temp.tok('n1'), true);
SELECT is(app.current_user_id(), NULL, 'a superseded token is anonymous');
SELECT is(identity.touch_current_session(), false, 'touch does not revive a superseded session');
SELECT set_config('app.session_token', pg_temp.tok('n8'), true);
SELECT is(app.current_user_id(), '00000000-0000-4000-8000-0000000000a1'::uuid, 'the new session acts as nina');
SELECT set_config('app.session_token', '', true);
RESET ROLE;
SELECT is(pg_temp.state('n1'), 'superseded', 'the superseded session is still closed after the touch');

-- 6. ductus_app cannot supersede by hand: it may not write session rows.
SET LOCAL ROLE ductus_app;
SELECT throws_ok(
  $$ UPDATE identity.session SET close_reason = 'superseded', closed_at = now() $$,
  '42501', NULL, 'ductus_app: UPDATE on session is denied'
);
RESET ROLE;

-- 7. The login path: six logins of a new account through open_session.
SET LOCAL ROLE ductus_auth;
SELECT identity.open_session('https://issuer.test', 'sub-ivo', 'ivo@a.example', 'a.example', pg_temp.h('ivo' || g), NULL, NULL, false)
FROM generate_series(1, 5) AS g;
RESET ROLE;
-- Spread their activity so the least active is known: ivo1 is the oldest.
UPDATE identity.session s SET created_at = now() - interval '1 hour', last_seen_at = now() - make_interval(mins => 60 - g)
FROM generate_series(1, 5) AS g WHERE s.token_hash = pg_temp.h('ivo' || g);
CREATE TEMP TABLE ivo AS SELECT id FROM identity.user_account WHERE hr_edu_person_unique_id = 'ivo@a.example';
GRANT SELECT ON ivo TO PUBLIC;
SELECT is(pg_temp.live((SELECT id FROM ivo)), 5::bigint, 'five logins through open_session keep five sessions');
SET LOCAL ROLE ductus_auth;
SELECT is(
  identity.open_session('https://issuer.test', 'sub-ivo', 'ivo@a.example', 'a.example', pg_temp.h('ivo6'), NULL, NULL, false),
  now() + interval '12 hours', 'the sixth login through open_session succeeds'
);
RESET ROLE;
SELECT is(pg_temp.state('ivo1'), 'superseded', 'open_session: the least active session is superseded');
SELECT is(pg_temp.state('ivo6'), 'open', 'open_session: the new session is open');
SELECT is(pg_temp.live((SELECT id FROM ivo)), 5::bigint, 'open_session: five live sessions remain');
SELECT ok(pg_temp.state('ivo2') = 'open' AND pg_temp.state('ivo3') = 'open' AND pg_temp.state('ivo4') = 'open'
          AND pg_temp.state('ivo5') = 'open', 'open_session: the other four stay open');

-- 8. The provider-sid layer: the sid is written on the new session after the
-- limit closed another one.
SET LOCAL ROLE ductus_auth;
SELECT ok(
  identity.open_session('https://issuer.test', 'sub-ivo', 'ivo@a.example', 'a.example', pg_temp.h('ivo7'), NULL, NULL, false, 'sid-ivo7')
    IS NOT NULL,
  'a login with a provider sid succeeds at the limit'
);
RESET ROLE;
SELECT is(pg_temp.state('ivo2'), 'superseded', 'sid login: the least active session is superseded');
SELECT ok((pg_temp.ses('ivo7')).oidc_sid_hash = sha256(convert_to('sid-ivo7', 'UTF8')), 'sid login: the new session keeps its sid');

SELECT * FROM finish();
ROLLBACK;

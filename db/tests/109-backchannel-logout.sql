-- identity.backchannel_logout, the nine-argument open_session and the sid
-- hash of a session (DAN-474, M1.4b, D-200 P4; plan of attack #1620, contract
-- on #1091 c.6683556284). A logout token only closes sessions (D-09), only
-- the open ones of the account and login session it names, once per `jti`,
-- and no closed session keeps the hash. The race of two calls with one token
-- runs on two connections in
-- tests/integration/backchannel-logout-race.integration.test.ts.
-- Synthetic fixtures only: every person, sid and jti is invented.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';

SELECT plan(92);

UPDATE identity.institution SET aai_home_org = 'fak-a.example' WHERE id = pg_temp.id('fak_a');
UPDATE identity.institution SET aai_home_org = 'fak-b.example' WHERE id = pg_temp.id('fak_b');
INSERT INTO identity.institution_issuer (institution_id, oidc_issuer) VALUES
  (pg_temp.id('fak_a'), 'https://issuer.test'),
  (pg_temp.id('fak_b'), 'https://issuer.test'),
  (pg_temp.id('fak_a'), 'https://issuer-2.test');

-- A second account with Ana's subject, at another issuer (C4).
INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
VALUES ('00000000-0000-4000-8000-0000000002a4', pg_temp.id('fak_a'), 'https://issuer-2.test', 'sub-ana', 'ana-2@fak-a.example');
INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at, oidc_sid_hash)
VALUES (sha256('ana-2'), '00000000-0000-4000-8000-0000000002a4', pg_temp.id('fak_a'), now() + interval '1 hour', sha256('sid-ana-2'));

CREATE FUNCTION pg_temp.sid(p_sid text) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(convert_to(p_sid, 'UTF8')) $$;
-- Gives the fixture session of a person (its cookie token) a sid.
CREATE FUNCTION pg_temp.give_sid(p_name text, p_sid text) RETURNS void
LANGUAGE sql AS $$
  UPDATE identity.session SET oidc_sid_hash = pg_temp.sid(p_sid)
  WHERE token_hash = (SELECT sha256(convert_to(token, 'UTF8')) FROM tok WHERE name = p_name)
$$;
-- The state of the fixture session of a person: 'open' or its close reason.
CREATE FUNCTION pg_temp.state(p_name text) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(close_reason, 'open') FROM identity.session
  WHERE token_hash = (SELECT sha256(convert_to(token, 'UTF8')) FROM tok WHERE name = p_name)
$$;
CREATE FUNCTION pg_temp.hash_of(p_name text) RETURNS bytea
LANGUAGE sql AS $$
  SELECT oidc_sid_hash FROM identity.session
  WHERE token_hash = (SELECT sha256(convert_to(token, 'UTF8')) FROM tok WHERE name = p_name)
$$;
-- One call as p_role; the count of closed sessions or "SQLSTATE: message".
CREATE FUNCTION pg_temp.bcl(
  p_subject text, p_sid text, p_jti text, p_issuer text DEFAULT 'https://issuer.test', p_role text DEFAULT 'ductus_auth'
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_result text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    v_result := identity.backchannel_logout(p_issuer, p_subject, p_sid, p_jti)::text;
  EXCEPTION WHEN OTHERS THEN
    v_result := SQLSTATE || ': ' || SQLERRM;
  END;
  RESET ROLE;
  RETURN v_result;
END
$$;
-- One login of a fixture person as ductus_auth through the nine-argument
-- form; the sid hash of the session it opened, or the refusal.
CREATE FUNCTION pg_temp.login(p_who text, p_sid text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_org text;
  v_hash bytea := sha256(convert_to(gen_random_uuid()::text, 'UTF8'));
  v_result text;
BEGIN
  SELECT faculty || '.example' INTO STRICT v_org FROM person WHERE name = p_who;
  SET LOCAL ROLE ductus_auth;
  BEGIN
    PERFORM identity.open_session('https://issuer.test', 'sub-' || p_who, p_who || '@' || v_org, v_org, v_hash,
                                  NULL, NULL, false, p_sid);
  EXCEPTION WHEN OTHERS THEN
    v_result := SQLSTATE || ': ' || SQLERRM;
  END;
  RESET ROLE;
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;
  SELECT coalesce(encode(oidc_sid_hash, 'hex'), 'no sid') INTO STRICT v_result FROM identity.session WHERE token_hash = v_hash AND closed_at IS NULL;
  RETURN v_result;
END
$$;

-- 1. The catalogue (F2): the column and its two checks, the trigger, a
-- forced-RLS jti table of ductus_identity, and definers for ductus_auth alone.
SELECT col_type_is('identity', 'session', 'oidc_sid_hash', 'bytea', 'oidc_sid_hash is bytea');
SELECT col_is_null('identity', 'session', 'oidc_sid_hash', 'oidc_sid_hash may be NULL: a login without sid has none');
SELECT bag_eq(
  $$ SELECT conname::text FROM pg_constraint WHERE conrelid = 'identity.session'::regclass AND conname LIKE 'session_oidc_sid_hash%' $$,
  ARRAY['session_oidc_sid_hash_check', 'session_oidc_sid_hash_closed_check'],
  'the sid hash has its length check and the check that a closed session holds none'
);
SELECT has_trigger('identity', 'session', 'clear_session_sid', 'every close of a session clears its sid hash');
SELECT is(pg_get_userbyid(p.proowner)::text, 'ductus_identity', 'clear_session_sid belongs to ductus_identity')
FROM pg_proc p WHERE p.oid = 'identity.clear_session_sid()'::regprocedure;
SELECT ok(NOT p.prosecdef AND p.proconfig = ARRAY['search_path=""'],
  'clear_session_sid is no definer and runs with an empty search_path')
FROM pg_proc p WHERE p.oid = 'identity.clear_session_sid()'::regprocedure;
SELECT ok(NOT has_function_privilege('public', 'identity.clear_session_sid()', 'EXECUTE'),
  'PUBLIC may not execute clear_session_sid');

SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'identity.logout_token_jti'::regclass),
  'logout_token_jti has ENABLE and FORCE ROW LEVEL SECURITY');
SELECT is((SELECT pg_get_userbyid(relowner)::text FROM pg_class WHERE oid = 'identity.logout_token_jti'::regclass),
  'ductus_identity', 'logout_token_jti belongs to ductus_identity');
SELECT bag_eq(
  $$ SELECT policyname || ' ' || cmd || ' to ' || array_to_string(roles, ',') FROM pg_policies
     WHERE schemaname = 'identity' AND tablename = 'logout_token_jti' $$,
  ARRAY['logout_token_jti_owner ALL to ductus_identity'],
  'the only policy on logout_token_jti is the owner policy'
);
SELECT columns_are('identity', 'logout_token_jti', ARRAY['oidc_issuer', 'jti_hash', 'expires_at'],
  'logout_token_jti keeps the issuer, a hash and its end, never the token or a person');
SELECT col_is_pk('identity', 'logout_token_jti', ARRAY['oidc_issuer', 'jti_hash'], 'a jti is unique per issuer');
SELECT is_empty(
  $$ SELECT r.rolname || ' ' || c FROM (SELECT rolname::text FROM pg_roles
                                        WHERE rolname LIKE 'ductus\_%' AND rolname <> 'ductus_identity'
                                        UNION ALL SELECT 'public') AS r (rolname)
     CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS c
     WHERE has_table_privilege(r.rolname, 'identity.logout_token_jti', c) $$,
  'no role but the owner, nor PUBLIC, holds any privilege on logout_token_jti'
);

SELECT t FROM unnest(ARRAY['identity.backchannel_logout(text, text, text, text)',
                           'identity.open_session(text, text, text, text, bytea, text, text, boolean, text)']) AS f
JOIN pg_proc p ON p.oid = f::regprocedure
CROSS JOIN LATERAL (VALUES
  (ok(p.prosecdef, f || ' is SECURITY DEFINER')),
  (is(pg_get_userbyid(p.proowner)::text, 'ductus_identity', f || ' belongs to ductus_identity')),
  (is(p.proconfig, ARRAY['search_path=""'], f || ' runs with an empty search_path')),
  (ok(has_function_privilege('ductus_auth', f, 'EXECUTE'), 'ductus_auth may execute ' || f))
) AS v (t);
SELECT is_empty(
  $$ SELECT r.rolname || ' ' || f FROM (SELECT rolname::text FROM pg_roles
                                        WHERE rolname LIKE 'ductus\_%'
                                          -- ductus_auth_local inherits ductus_auth and nothing else (010).
                                          AND rolname NOT IN ('ductus_auth', 'ductus_identity', 'ductus_auth_local')
                                        UNION ALL SELECT 'public') AS r (rolname)
     CROSS JOIN unnest(ARRAY['identity.backchannel_logout(text, text, text, text)',
                             'identity.open_session(text, text, text, text, bytea, text, text, boolean, text)']) AS f
     WHERE has_function_privilege(r.rolname, f, 'EXECUTE') $$,
  'no role but ductus_auth, its local login and the owner, nor PUBLIC, may execute either function'
);
SELECT is((SELECT prorettype::regtype FROM pg_proc WHERE oid = 'identity.backchannel_logout(text, text, text, text)'::regprocedure),
  'integer'::regtype, 'backchannel_logout returns a count, never a session or an identifier');

-- 2. F1: every other role is refused before anything is closed.
SELECT pg_temp.give_sid('dora', 'sid-dora');
-- A role without USAGE on the schema is refused there, the others at the function.
SELECT is(left(pg_temp.bcl('sub-dora', NULL, 'jti-role-' || r, p_role => r), 5), '42501',
  r || ' may not call backchannel_logout')
FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_migrator', 'ductus_evidence', 'ductus_test_stranger']) AS r;
SELECT is(pg_temp.ask('dora', $$ SELECT count(*)::text FROM identity.logout_token_jti $$),
  '42501: permission denied for table logout_token_jti', 'the web process cannot read the jti record');
SELECT is(pg_temp.state('dora'), 'open', 'no refused call closed Dora''s session');
SELECT is((SELECT count(*)::integer FROM identity.logout_token_jti), 0, 'no refused call left a jti record');

-- 3. ZD422: the shape of the input is checked again (A11, A13, A14).
SELECT is(pg_temp.bcl(a.sub, a.sid, a.jti, a.iss), 'ZD422: invalid input', a.what)
FROM (VALUES
  ('sub-dora', NULL, 'j', NULL, 'a NULL issuer'),
  ('sub-dora', NULL, 'j', '', 'an empty issuer'),
  ('sub-dora', NULL, 'j', repeat('i', 256), 'an issuer of 256 characters'),
  ('sub-dora', NULL, NULL, 'https://issuer.test', 'a NULL jti'),
  ('sub-dora', NULL, '', 'https://issuer.test', 'an empty jti'),
  ('sub-dora', NULL, repeat('j', 256), 'https://issuer.test', 'a jti of 256 characters'),
  (NULL, NULL, 'j', 'https://issuer.test', 'neither sub nor sid'),
  ('', NULL, 'j', 'https://issuer.test', 'an empty sub'),
  (repeat('s', 256), NULL, 'j', 'https://issuer.test', 'a sub of 256 characters'),
  ('sub-' || chr(10) || 'dora', NULL, 'j', 'https://issuer.test', 'a sub with a control character'),
  (NULL, '', 'j', 'https://issuer.test', 'an empty sid'),
  (NULL, repeat('s', 256), 'j', 'https://issuer.test', 'a sid of 256 characters'),
  -- chr(0) is no text value in PostgreSQL; the escape character stands in.
  (NULL, 'sid-' || chr(27) || 'x', 'j', 'https://issuer.test', 'a sid with a control character')
) AS a (sub, sid, jti, iss, what);
SELECT is(pg_temp.state('dora'), 'open', 'no invalid call closed Dora''s session');
SELECT is((SELECT count(*)::integer FROM identity.logout_token_jti), 0, 'no invalid call left a jti record');

-- 4. What closes (C1 to C6).
SELECT pg_temp.give_sid('ana', 'sid-ana-1');
INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at, oidc_sid_hash)
VALUES (sha256('ana-second'), pg_temp.id('ana'), pg_temp.id('fak_a'), now() + interval '1 hour', pg_temp.sid('sid-ana-2'));
SELECT pg_temp.give_sid('marko', 'sid-marko');
SELECT pg_temp.give_sid('tomo', 'sid-tomo');

SELECT is(pg_temp.bcl('sub-ana', 'sid-marko', 'jti-c3'), '0', 'C3: Ana''s sub with Marko''s sid closes nothing');
SELECT is(pg_temp.state('marko'), 'open', 'C3: Marko''s session stays open');
SELECT is(pg_temp.bcl(NULL, 'sid-unknown', 'jti-c6'), '0', 'C6: a sid Ductus never stored closes nothing');
SELECT is(pg_temp.bcl('sub-ana', 'sid-ana-1', 'jti-c1'), '1', 'C1: Ana''s sub and sid close one session');
SELECT is(pg_temp.state('ana'), 'backchannel_logout', 'C1: that session is closed by the back-channel');
SELECT is((SELECT coalesce(close_reason, 'open') FROM identity.session WHERE token_hash = sha256('ana-second')), 'open',
  'C1: Ana''s other session, another sid, stays open');
SELECT is(pg_temp.hash_of('ana'), NULL, 'E2: the closed session holds no sid hash');
SELECT is(pg_temp.bcl(NULL, 'sid-tomo', 'jti-sid-only'), '1', 'a sid alone closes the session that holds it');
SELECT is(pg_temp.state('tomo'), 'backchannel_logout', 'Tomo''s session is closed');

SELECT is(pg_temp.bcl('sub-ana', NULL, 'jti-c2'), '1', 'C2: Ana''s sub alone closes her other open session');
SELECT is((SELECT close_reason FROM identity.session WHERE token_hash = sha256('ana-second')), 'backchannel_logout',
  'C2: the second session is closed');
SELECT is(
  (SELECT string_agg(t.name || '=' || coalesce(s.close_reason, 'open'), ',' ORDER BY t.name)
   FROM tok t JOIN identity.session s ON s.token_hash = sha256(convert_to(t.token, 'UTF8'))
   WHERE t.name IN ('expired', 'closed')),
  'closed=logout,expired=open',
  'C5: Ana''s closed and expired sessions keep their state and reason'
);
SELECT is((SELECT coalesce(close_reason, 'open') FROM identity.session WHERE token_hash = sha256('ana-2')), 'open',
  'C4: the same sub at another issuer stays open');
SELECT is(pg_temp.bcl('sub-ana', NULL, 'jti-c4', 'https://issuer-2.test'), '1', 'C4: that issuer closes its own account''s session');
SELECT is(pg_temp.bcl('sub-ana', NULL, 'jti-c5'), '0', 'C5: a token for sessions already closed closes nothing');
SELECT is(
  (SELECT string_agg(name || '=' || pg_temp.state(name), ',' ORDER BY name) FROM person WHERE name IN ('dora', 'marko', 'vesna')),
  'dora=open,marko=open,vesna=open',
  'C2: no other account''s session was touched'
);

-- 5. F3: the call touches only closed_at, close_reason and the hash; it opens nothing.
-- Twelve fixture sessions, Ana's second one and the one at issuer-2.
SELECT is((SELECT count(*)::integer FROM identity.session
            WHERE institution_id IN (pg_temp.id('fak_a'), pg_temp.id('fak_b'))), 14, 'no session was opened');
SELECT is(
  (SELECT string_agg(p.name || '@' || u.institution_id::text, ',' ORDER BY p.name)
   FROM person p JOIN identity.user_account u ON u.id = p.id WHERE p.name IN ('ana', 'tomo')),
  'ana@' || pg_temp.id('fak_a') || ',tomo@' || pg_temp.id('fak_b'),
  'the accounts keep their institution'
);

-- 6. B1, B3, B4: one token counts once per issuer, and its record ends.
SELECT is(pg_temp.bcl('sub-dora', NULL, 'jti-c1'), 'ZD409: logout token replayed', 'B1: a jti used before is refused');
SELECT is(pg_temp.state('dora'), 'open', 'B1: the replay closed nothing, though its sub names an open session');
SELECT is(pg_temp.bcl('sub-ana', NULL, 'jti-c1', 'https://issuer-2.test'), '0', 'B3: the same jti from another issuer is its own');
SELECT is((SELECT count(*)::integer FROM identity.logout_token_jti WHERE jti_hash = pg_temp.sid('jti-c1')), 2,
  'B3: one record per issuer');
SELECT ok((SELECT bool_and(expires_at BETWEEN now() + interval '59 minutes' AND now() + interval '1 hour')
           FROM identity.logout_token_jti), 'E3: a record is kept for one hour');
UPDATE identity.logout_token_jti SET expires_at = now() - interval '1 second' WHERE jti_hash = pg_temp.sid('jti-c6');
SELECT is(pg_temp.bcl(NULL, 'sid-unknown-2', 'jti-b4'), '0', 'another call');
SELECT is((SELECT count(*)::integer FROM identity.logout_token_jti WHERE jti_hash = pg_temp.sid('jti-c6')), 0,
  'B4: the next call removes the records past their end');
SELECT is(pg_temp.bcl(NULL, 'sid-unknown', 'jti-c6'), '0', 'B4: so a jti past its hour counts again; the route refuses it by iat');

-- 7. E2: every close path clears the hash, and the check refuses a closed row that keeps it.
SELECT pg_temp.give_sid(name, 'sid-' || name) FROM person WHERE name IN ('dora', 'vesna', 'iva', 'boris', 'nina', 'lea', 'petra');
SELECT is(pg_temp.ask('dora', $$ SELECT identity.close_current_session()::text $$), 'true', 'Dora logs out');
SELECT is(pg_temp.ask('vesna', $$ SELECT 'done' FROM identity.close_all_sessions_for_identity() $$), 'done', 'Vesna logs out everywhere');
SELECT is(identity.close_user_sessions(pg_temp.id('iva')), 1, 'the operator closes Iva''s session');
UPDATE identity.session SET closed_at = now(), close_reason = 'logout'
WHERE token_hash = (SELECT sha256(convert_to(token, 'UTF8')) FROM tok WHERE name = 'marko');
DELETE FROM identity.institution_issuer WHERE institution_id = pg_temp.id('fak_b') AND oidc_issuer = 'https://issuer.test';
UPDATE identity.institution SET aai_home_org = 'fak-a-novi.example' WHERE id = pg_temp.id('fak_a');
SELECT is(
  (SELECT string_agg(name || '=' || pg_temp.state(name) || ':' || coalesce(encode(pg_temp.hash_of(name), 'hex'), '-'), ',' ORDER BY name)
   FROM person WHERE name IN ('boris', 'dora', 'iva', 'lea', 'marko', 'nina', 'petra', 'vesna')),
  'boris=institution_changed:-,dora=logout:-,iva=operator:-,lea=issuer_removed:-,marko=logout:-,nina=institution_changed:-,petra=issuer_removed:-,vesna=logout_all:-',
  'logout, logout_all, operator, issuer removal, institution change and a plain UPDATE all clear the hash'
);
SELECT is((SELECT count(*)::integer FROM identity.session WHERE closed_at IS NOT NULL AND oidc_sid_hash IS NOT NULL), 0,
  'E2: no closed session holds a sid hash');
ALTER TABLE identity.session DISABLE TRIGGER clear_session_sid;
INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at, oidc_sid_hash)
VALUES (sha256('check'), pg_temp.id('ana'), pg_temp.id('fak_a'), now() + interval '1 hour', pg_temp.sid('sid-check'));
SELECT throws_ok(
  $$ UPDATE identity.session SET closed_at = now(), close_reason = 'logout' WHERE token_hash = sha256('check') $$,
  '23514', NULL, 'without the trigger the check refuses a closed session that keeps the hash'
);
ALTER TABLE identity.session ENABLE TRIGGER clear_session_sid;
SELECT throws_ok(
  $$ INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at, closed_at, close_reason, oidc_sid_hash)
     VALUES (sha256('closed-with-sid'), pg_temp.id('ana'), pg_temp.id('fak_a'), now() + interval '1 hour', now(), 'logout', sha256('x')) $$,
  '23514', NULL, 'a session cannot be stored closed with a sid hash'
);
SELECT throws_ok(
  $$ UPDATE identity.session SET oidc_sid_hash = '\x00'::bytea WHERE token_hash = sha256('check') $$,
  '23514', NULL, 'a sid hash is 32 bytes'
);

-- 8. E1, E5: the login keeps the hash of a usable sid and nothing else, and
-- a sid it cannot use is left out while the login stands.
UPDATE identity.institution SET aai_home_org = 'fak-a.example' WHERE id = pg_temp.id('fak_a');
SELECT is(pg_temp.login('ana', 'sid-ana-login'), encode(pg_temp.sid('sid-ana-login'), 'hex'),
  'E1: a login with a sid keeps its SHA-256');
-- DAN-296: an account keeps five live sessions, and the logins below would
-- make more. They all share this transaction's now(), so only the id would
-- order them; the session the back-channel closes at the end of this section
-- is dated a minute ahead, so it is never the one superseded.
UPDATE identity.session SET last_seen_at = now() + interval '1 minute' WHERE oidc_sid_hash = pg_temp.sid('sid-ana-login');
SELECT is(pg_temp.login('ana', l.sid), 'no sid', 'E5: a login with ' || l.what || ' stands without a sid')
FROM (VALUES (NULL, 'no sid'), ('', 'an empty sid'), (repeat('s', 256), 'a sid of 256 characters'),
             ('sid' || chr(9) || 'x', 'a tab in the sid'), ('sid' || chr(127) || 'x', 'a DEL in the sid')) AS l (sid, what);
SELECT is(pg_temp.login('ana', repeat('s', 255)), encode(pg_temp.sid(repeat('s', 255)), 'hex'), 'a sid of 255 characters is kept');
SELECT is(
  pg_temp.ask_as('ductus_auth', 'anon', $$ SELECT identity.open_session('https://issuer.test', 'sub-ana', 'dora@fak-a.example',
                                                       'fak-a.example', sha256('refused'), NULL, NULL, false, 'sid-r')::text $$),
  'ZD403: forbidden', 'the nine-argument form keeps every refusal of the eight-argument one'
);
SELECT is((SELECT count(*)::integer FROM identity.session WHERE token_hash = sha256('refused')), 0, 'the refused login opened nothing');
SELECT is(pg_temp.bcl(NULL, 'sid-ana-login', 'jti-login'), '1', 'the back-channel closes the session the login gave that sid');

-- 9. F4: a snapshot older than the call would hide a login that committed
-- meanwhile, so another isolation level is refused (two connections:
-- tests/integration/backchannel-logout-race.integration.test.ts).
SELECT is(
  (SELECT p.prosrc ~ 'transaction_isolation' FROM pg_proc p WHERE p.oid = 'identity.backchannel_logout(text, text, text, text)'::regprocedure),
  true, 'backchannel_logout checks the isolation level'
);

SELECT * FROM finish();
ROLLBACK;

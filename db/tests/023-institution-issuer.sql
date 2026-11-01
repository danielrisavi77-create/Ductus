-- identity.institution_issuer and open_session (DAN-159, F-021; D-104;
-- plan of attack #1142): an institution takes logins only from an issuer
-- recorded for it, compared by equality alone, on every login, with the
-- ZD503 of an unknown home organisation. Synthetic fixtures only.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL lc_messages TO 'C';
CREATE ROLE ductus_test_stranger NOLOGIN;
GRANT USAGE ON SCHEMA public TO ductus_app, ductus_worker, ductus_retention, ductus_auth, ductus_migrator, ductus_test_stranger;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ductus_app, ductus_worker, ductus_retention, ductus_auth, ductus_migrator, ductus_test_stranger;

SELECT plan(43);

INSERT INTO identity.institution (id, slug, aai_home_org) VALUES
  ('00000000-0000-4000-8000-0000000023a1', 'iss-a', 'a.issuer.test'),
  ('00000000-0000-4000-8000-0000000023a2', 'iss-b', 'b.issuer.test'),
  ('00000000-0000-4000-8000-0000000023a3', 'iss-c', 'c.issuer.test');
-- idp-a serves A alone, idp-b serves B alone, idp-shared serves A and C.
INSERT INTO identity.institution_issuer (institution_id, oidc_issuer) VALUES
  ('00000000-0000-4000-8000-0000000023a1', 'https://idp-a.test'),
  ('00000000-0000-4000-8000-0000000023a2', 'https://idp-b.test'),
  ('00000000-0000-4000-8000-0000000023a1', 'https://idp-shared.test'),
  ('00000000-0000-4000-8000-0000000023a3', 'https://idp-shared.test');

CREATE FUNCTION pg_temp.h(p_name text) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(convert_to(p_name, 'UTF8')) $$;
-- 'ok' or the SQLSTATE, the message and any detail or hint of the refusal.
CREATE FUNCTION pg_temp.open(p_issuer text, p_unique_id text, p_home_org text, p_hash text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_detail text; v_hint text;
BEGIN
  PERFORM identity.open_session(p_issuer, 'sub-' || p_unique_id, p_unique_id, p_home_org, pg_temp.h(p_hash));
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL, v_hint = PG_EXCEPTION_HINT;
  RETURN SQLSTATE || ': ' || SQLERRM || v_detail || v_hint;
END
$$;
-- The issuers of p_issuers that did not give exactly the ZD503 of an
-- unknown home organisation for a person of A.
CREATE FUNCTION pg_temp.not_refused(p_issuers text[], p_tag text) RETURNS text[]
LANGUAGE plpgsql AS $$
DECLARE v text; i integer := 0; v_bad text[] := '{}';
BEGIN
  FOREACH v IN ARRAY p_issuers LOOP
    i := i + 1;
    IF pg_temp.open(v, 'ana@a.issuer.test', 'a.issuer.test', p_tag || i) <> 'ZD503: institution not set up' THEN
      v_bad := v_bad || v;
    END IF;
  END LOOP;
  RETURN v_bad;
END
$$;
CREATE FUNCTION pg_temp.counts() RETURNS text
LANGUAGE sql AS $$
  WITH f(id) AS (VALUES ('00000000-0000-4000-8000-0000000023a1'::uuid), ('00000000-0000-4000-8000-0000000023a2'),
                        ('00000000-0000-4000-8000-0000000023a3'))
  SELECT (SELECT count(*) FROM identity.user_account WHERE institution_id IN (SELECT id FROM f)) || ' users, '
      || (SELECT count(*) FROM identity.session WHERE institution_id IN (SELECT id FROM f)) || ' sessions, '
      || (SELECT count(*) FROM identity.person_name WHERE institution_id IN (SELECT id FROM f)) || ' names'
$$;
-- The SQLSTATE of storing one issuer row, or 'ok'.
CREATE FUNCTION pg_temp.stored(p_institution uuid, p_issuer text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO identity.institution_issuer (institution_id, oidc_issuer) VALUES (p_institution, p_issuer);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;
-- Reads of p_table by one login, from the live counters of this transaction.
CREATE FUNCTION pg_temp.reads(p_table regclass, p_issuer text, p_unique_id text, p_home_org text, p_hash text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_before bigint; v_after bigint;
BEGIN
  SELECT coalesce(seq_scan, 0) + coalesce(idx_scan, 0) INTO v_before
  FROM pg_catalog.pg_stat_xact_user_tables WHERE relid = p_table;
  PERFORM pg_temp.open(p_issuer, p_unique_id, p_home_org, p_hash);
  SELECT coalesce(seq_scan, 0) + coalesce(idx_scan, 0) INTO v_after
  FROM pg_catalog.pg_stat_xact_user_tables WHERE relid = p_table;
  RETURN v_after - v_before;
END
$$;

-- 1. The catalogue (plan 9): forced RLS, owned by ductus_identity, the owner
-- policy alone, one row per institution and issuer.
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'identity.institution_issuer'::regclass),
  'institution_issuer has ENABLE and FORCE ROW LEVEL SECURITY');
SELECT is((SELECT pg_get_userbyid(relowner)::text FROM pg_class WHERE oid = 'identity.institution_issuer'::regclass),
  'ductus_identity', 'institution_issuer belongs to ductus_identity');
SELECT bag_eq(
  $$ SELECT policyname || ' ' || cmd || ' to ' || array_to_string(roles, ',') FROM pg_policies
     WHERE schemaname = 'identity' AND tablename = 'institution_issuer' $$,
  ARRAY['institution_issuer_owner ALL to ductus_identity'],
  'the only policy on institution_issuer is the owner policy'
);
SELECT col_is_pk('identity', 'institution_issuer', ARRAY['institution_id', 'oidc_issuer'],
  'the key of institution_issuer is the institution and the issuer');

-- 2. No service role, the migrator, nor a role without grants reads or
-- writes the table (plan 9).
CREATE FUNCTION pg_temp.denied(p_role text) RETURNS text[]
LANGUAGE plpgsql AS $$
DECLARE v_sql text; v_bad text[] := '{}';
BEGIN
  FOREACH v_sql IN ARRAY ARRAY[
    'SELECT count(*) FROM identity.institution_issuer',
    $q$INSERT INTO identity.institution_issuer (institution_id, oidc_issuer) VALUES ('00000000-0000-4000-8000-0000000023a2', 'https://idp-x.test')$q$,
    $q$UPDATE identity.institution_issuer SET oidc_issuer = 'https://idp-x.test'$q$,
    'DELETE FROM identity.institution_issuer'] LOOP
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', p_role);
      EXECUTE v_sql;
      RESET ROLE;
      v_bad := v_bad || ('allowed: ' || v_sql);
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;
    WHEN OTHERS THEN
      RESET ROLE;
      v_bad := v_bad || (SQLSTATE || ': ' || v_sql);
    END;
  END LOOP;
  RETURN v_bad;
END
$$;
SELECT is(pg_temp.denied('ductus_app'), '{}'::text[], 'ductus_app: SELECT, INSERT, UPDATE and DELETE on institution_issuer are denied');
SELECT is(pg_temp.denied('ductus_auth'), '{}'::text[], 'ductus_auth: SELECT, INSERT, UPDATE and DELETE on institution_issuer are denied');
SELECT is(pg_temp.denied('ductus_worker'), '{}'::text[], 'ductus_worker: SELECT, INSERT, UPDATE and DELETE on institution_issuer are denied');
SELECT is(pg_temp.denied('ductus_retention'), '{}'::text[], 'ductus_retention: SELECT, INSERT, UPDATE and DELETE on institution_issuer are denied');
SELECT is(pg_temp.denied('ductus_migrator'), '{}'::text[], 'ductus_migrator: SELECT, INSERT, UPDATE and DELETE on institution_issuer are denied');
SELECT is(pg_temp.denied('ductus_test_stranger'), '{}'::text[], 'role without grants: SELECT, INSERT, UPDATE and DELETE on institution_issuer are denied');
SELECT is((SELECT count(*) FROM identity.institution_issuer WHERE institution_id = '00000000-0000-4000-8000-0000000023a2'),
  1::bigint, 'the denied writes left the rows as they were');

-- 3. RLS holds without the grant (plan 10): a table grant added by mistake
-- still shows ductus_app no row.
GRANT SELECT ON identity.institution_issuer TO ductus_app;
SET LOCAL ROLE ductus_app;
SELECT is((SELECT count(*) FROM identity.institution_issuer), 0::bigint,
  'with a SELECT grant, ductus_app still reads no row of institution_issuer');
RESET ROLE;
REVOKE SELECT ON identity.institution_issuer FROM ductus_app;

-- 4. What can be stored (plan 11).
SELECT is(
  ARRAY[pg_temp.stored('00000000-0000-4000-8000-0000000023a2', ''),
        pg_temp.stored('00000000-0000-4000-8000-0000000023a2', 'https://' || repeat('a', 248)),
        pg_temp.stored('00000000-0000-4000-8000-0000000023a2', 'https://idp .test'),
        pg_temp.stored('00000000-0000-4000-8000-0000000023a2', 'https://idp.test' || chr(10)),
        pg_temp.stored('00000000-0000-4000-8000-0000000023a2', 'https://' || chr(1110) || 'dp.test'),
        pg_temp.stored('00000000-0000-4000-8000-0000000023a2', 'ftp://idp.test'),
        pg_temp.stored('00000000-0000-4000-8000-0000000023a2', 'idp.test'),
        pg_temp.stored('00000000-0000-4000-8000-0000000023a2', NULL)],
  ARRAY['23514', '23514', '23514', '23514', '23514', '23514', '23514', '23502'],
  'an empty, overlong, spaced, control, non-ASCII, non-http or missing issuer cannot be stored'
);
SELECT is(pg_temp.stored('00000000-0000-4000-8000-0000000023a2', 'https://' || repeat('a', 247)), 'ok',
  'an issuer of exactly 255 characters can be stored');
SELECT is(pg_temp.stored('00000000-0000-4000-8000-0000000023a2', 'https://idp-b.test'), '23505',
  'the same institution and issuer cannot be stored twice');
SELECT is(pg_temp.stored('00000000-0000-4000-8000-0000000023ff', 'https://idp-b.test'), '23503',
  'an issuer row needs an institution');
DELETE FROM identity.institution_issuer
 WHERE institution_id = '00000000-0000-4000-8000-0000000023a2' AND oidc_issuer = 'https://' || repeat('a', 247);

-- 5. Recorded issuers log in (plan 3): one issuer serves two institutions,
-- each login lands by home organisation, and the realm still binds.
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.open('https://idp-a.test', 'ana@a.issuer.test', 'a.issuer.test', 'a1'), 'ok',
  'the issuer recorded for A logs a person of A in');
SELECT is(pg_temp.open('https://idp-shared.test', 'ivo@a.issuer.test', 'a.issuer.test', 's1'), 'ok',
  'the shared issuer logs a person of A in');
SELECT is(pg_temp.open('https://idp-shared.test', 'cvita@c.issuer.test', 'c.issuer.test', 's2'), 'ok',
  'the shared issuer logs a person of C in');
SELECT is(pg_temp.open('https://idp-shared.test', 'eve@c.issuer.test', 'a.issuer.test', 's3'), 'ZD503: institution not set up',
  'the shared issuer with the realm of C and the home organisation of A is refused');
RESET ROLE;
SELECT is(
  (SELECT array_agg(i.slug || ' ' || u.hr_edu_person_unique_id ORDER BY u.hr_edu_person_unique_id)
     FROM identity.user_account u JOIN identity.institution i ON i.id = u.institution_id
    WHERE u.institution_id IN ('00000000-0000-4000-8000-0000000023a1', '00000000-0000-4000-8000-0000000023a3')),
  ARRAY['iss-a ana@a.issuer.test', 'iss-c cvita@c.issuer.test', 'iss-a ivo@a.issuer.test'],
  'each account belongs to the institution of its home organisation'
);
SELECT is(pg_temp.counts(), '3 users, 3 sessions, 0 names', 'three logins made three accounts and three sessions');

-- 6. An issuer not recorded for the institution is refused (plans 1, 2):
-- unknown to every institution, or recorded for another one.
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.open('https://idp-none.test', 'mallory@a.issuer.test', 'a.issuer.test', 'n1'), 'ZD503: institution not set up',
  'an issuer recorded for no institution is refused');
SELECT is(pg_temp.open('https://idp-b.test', 'mallory@a.issuer.test', 'a.issuer.test', 'n2'), 'ZD503: institution not set up',
  'the issuer of B is refused for a person of A');
SELECT is(pg_temp.open('https://idp-a.test', 'mallory@c.issuer.test', 'c.issuer.test', 'n3'), 'ZD503: institution not set up',
  'the issuer of A is refused for a person of C');
-- The seven-argument login (plan 7) is held to the same rule and stores no name.
SELECT throws_ok(
  $$ SELECT identity.open_session('https://idp-none.test', 'sub-mallory', 'mallory@a.issuer.test', 'a.issuer.test',
                                  sha256('n4'), 'Ime', 'Prezime') $$,
  'ZD503', 'institution not set up', 'the login with names from an unrecorded issuer is refused'
);
RESET ROLE;
SELECT is(pg_temp.counts(), '3 users, 3 sessions, 0 names', 'refused issuers leave no account, session or name');

-- 7. The database compares by equality alone (plan 4): any spelling other
-- than the recorded one is refused, and a known person gains nothing by it.
SET LOCAL ROLE ductus_auth;
SELECT is(
  pg_temp.not_refused(ARRAY[
    'https://idp-a.test/', 'https://IDP-A.test', 'https://idp-a.test:443', ' https://idp-a.test',
    'https://idp-a.test' || chr(10), 'https://' || chr(1110) || 'dp-a.test', 'https://idp-a.tes',
    'https://idp-a.test.', 'http://idp-a.test', 'https://idp-a.test' || chr(8203)], 'v'),
  '{}'::text[], 'no other spelling of a recorded issuer logs a person in'
);
RESET ROLE;
SELECT is(pg_temp.counts(), '3 users, 3 sessions, 0 names', 'other spellings leave no account or session');

-- 8. One refusal (plan 6): an unknown institution, a refused realm and an
-- unrecorded issuer give the same answer with nothing more, and each runs
-- the institution lookup and the issuer lookup once.
SET LOCAL ROLE ductus_auth;
SELECT is(
  ARRAY[pg_temp.open('https://idp-a.test', 'eve@x.issuer.test', 'x.issuer.test', 'r1'),
        pg_temp.open('https://idp-a.test', 'eve@b.issuer.test', 'a.issuer.test', 'r2'),
        pg_temp.open('https://idp-b.test', 'eve@a.issuer.test', 'a.issuer.test', 'r3')],
  ARRAY['ZD503: institution not set up', 'ZD503: institution not set up', 'ZD503: institution not set up'],
  'an unknown institution, a refused realm and an unrecorded issuer give one answer, without detail or hint'
);
RESET ROLE;
SELECT is(
  ARRAY[pg_temp.reads('identity.institution_issuer', 'https://idp-a.test', 'eve@x.issuer.test', 'x.issuer.test', 'q1'),
        pg_temp.reads('identity.institution_issuer', 'https://idp-a.test', 'eve@b.issuer.test', 'a.issuer.test', 'q2'),
        pg_temp.reads('identity.institution_issuer', 'https://idp-b.test', 'eve@a.issuer.test', 'a.issuer.test', 'q3'),
        pg_temp.reads('identity.institution_issuer', 'https://idp-a.test', 'ana@a.issuer.test', 'a.issuer.test', 'q4')],
  ARRAY[1, 1, 1, 1]::bigint[],
  'an unknown institution, a refused realm, an unrecorded issuer and a login each read the issuers once'
);
SELECT is(
  ARRAY[pg_temp.reads('identity.institution', 'https://idp-a.test', 'eve@x.issuer.test', 'x.issuer.test', 'q5'),
        pg_temp.reads('identity.institution', 'https://idp-b.test', 'eve@a.issuer.test', 'a.issuer.test', 'q6')],
  ARRAY[1, 1]::bigint[],
  'an unknown institution and an unrecorded issuer each read the institutions once'
);

-- 9. Every login is checked, existing accounts too (plan 5): once the row
-- of idp-a goes, Ana is refused, keeps her account and gets no session; the
-- shared issuer still logs Ivo in; the row back, Ana logs in again.
SELECT is(pg_temp.counts(), '3 users, 4 sessions, 0 names', 'the counts before the row goes');
DELETE FROM identity.institution_issuer
 WHERE institution_id = '00000000-0000-4000-8000-0000000023a1' AND oidc_issuer = 'https://idp-a.test';
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.open('https://idp-a.test', 'ana@a.issuer.test', 'a.issuer.test', 'e1'), 'ZD503: institution not set up',
  'a known person is refused once her issuer is no longer recorded');
SELECT is(pg_temp.open('https://idp-shared.test', 'ivo@a.issuer.test', 'a.issuer.test', 'e2'), 'ok',
  'a person of the same institution from a recorded issuer still logs in');
RESET ROLE;
SELECT is(pg_temp.counts(), '3 users, 5 sessions, 0 names', 'the refused login kept the account and opened no session');
INSERT INTO identity.institution_issuer (institution_id, oidc_issuer)
VALUES ('00000000-0000-4000-8000-0000000023a1', 'https://idp-a.test');
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.open('https://idp-a.test', 'ana@a.issuer.test', 'a.issuer.test', 'e3'), 'ok',
  'with the row back, the same person logs in to the same account');
RESET ROLE;
SELECT is(pg_temp.counts(), '3 users, 6 sessions, 0 names', 'the login reused the account');

-- 10. Invalid issuers stay invalid input (plan 8), before any lookup.
SET LOCAL ROLE ductus_auth;
SELECT is(
  ARRAY[pg_temp.open(NULL, 'ana@a.issuer.test', 'a.issuer.test', 'i1'),
        pg_temp.open('', 'ana@a.issuer.test', 'a.issuer.test', 'i2'),
        pg_temp.open('https://' || repeat('a', 248), 'ana@a.issuer.test', 'a.issuer.test', 'i3')],
  ARRAY['ZD422: invalid input', 'ZD422: invalid input', 'ZD422: invalid input'],
  'a missing, empty or overlong issuer is invalid input'
);
RESET ROLE;

-- 11. The login function keeps its boundary: definer, owner, empty
-- search_path, and EXECUTE for ductus_auth alone.
SELECT ok(p.prosecdef, 'open_session is SECURITY DEFINER')
FROM pg_proc p WHERE p.oid = 'identity.open_session(text, text, text, text, bytea)'::regprocedure;
SELECT is(pg_get_userbyid(p.proowner)::text, 'ductus_identity', 'open_session belongs to ductus_identity')
FROM pg_proc p WHERE p.oid = 'identity.open_session(text, text, text, text, bytea)'::regprocedure;
SELECT is(p.proconfig, ARRAY['search_path=""'], 'open_session runs with an empty search_path')
FROM pg_proc p WHERE p.oid = 'identity.open_session(text, text, text, text, bytea)'::regprocedure;
SELECT is_empty(
  $$ SELECT r.rolname FROM (SELECT rolname::text FROM pg_roles
                            WHERE rolname LIKE 'ductus\_%'
                              AND rolname NOT IN ('ductus_auth', 'ductus_identity', 'ductus_auth_local')
                            UNION ALL SELECT 'public') AS r (rolname)
     WHERE has_function_privilege(r.rolname, 'identity.open_session(text, text, text, text, bytea)', 'EXECUTE') $$,
  'no role but ductus_auth, its local login and the owner, nor PUBLIC, may execute open_session'
);

SELECT * FROM finish();
ROLLBACK;

-- identity.open_session: the realm of hrEduPersonUniqueID must equal
-- hrEduPersonHomeOrg after the same normalisation. A refusal is the ZD503 of
-- an unknown home organisation and leaves no row. Synthetic fixtures only.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL lc_messages TO 'C';
GRANT USAGE ON SCHEMA public TO ductus_auth;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ductus_auth;

SELECT plan(36);

INSERT INTO identity.institution (id, slug, aai_home_org) VALUES
  ('00000000-0000-4000-8000-0000000002a1', 'test-realm', 'realm.test'),
  ('00000000-0000-4000-8000-0000000002a2', 'test-other', 'other.test'),
  ('00000000-0000-4000-8000-0000000002a3', 'test-b', 'b.test'),
  ('00000000-0000-4000-8000-0000000002a4', 'test-c', 'c.test'),
  ('00000000-0000-4000-8000-0000000002a5', 'test-kit', 'kit.test');

CREATE FUNCTION pg_temp.h(p_name text) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(convert_to(p_name, 'UTF8')) $$;
-- Returns 'ok' or the SQLSTATE, the message and any detail or hint, so a
-- test sees everything a refusal carries.
CREATE FUNCTION pg_temp.open_as(p_unique_id text, p_home_org text, p_subject text, p_hash text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_detail text; v_hint text;
BEGIN
  PERFORM identity.open_session('https://issuer.test', p_subject, p_unique_id, p_home_org, pg_temp.h(p_hash));
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL, v_hint = PG_EXCEPTION_HINT;
  RETURN SQLSTATE || ': ' || SQLERRM || v_detail || v_hint;
END
$$;
CREATE FUNCTION pg_temp.open(p_unique_id text, p_home_org text, p_hash text)
RETURNS text LANGUAGE sql AS $$ SELECT pg_temp.open_as(p_unique_id, p_home_org, 'sub-' || p_hash, p_hash) $$;
CREATE FUNCTION pg_temp.counts() RETURNS text
LANGUAGE sql AS $$
  WITH f(id) AS (VALUES
    ('00000000-0000-4000-8000-0000000002a1'::uuid), ('00000000-0000-4000-8000-0000000002a2'),
    ('00000000-0000-4000-8000-0000000002a3'), ('00000000-0000-4000-8000-0000000002a4'),
    ('00000000-0000-4000-8000-0000000002a5'))
  SELECT (SELECT count(*) FROM identity.user_account WHERE institution_id IN (SELECT id FROM f)) || ' users, '
      || (SELECT count(*) FROM identity.session WHERE institution_id IN (SELECT id FROM f)) || ' sessions'
$$;
-- Refused values: each must give exactly the ZD503 of an unknown home
-- organisation. Returns the values that gave anything else.
CREATE FUNCTION pg_temp.not_refused(p_values text[], p_home_org text, p_tag text) RETURNS text[]
LANGUAGE plpgsql AS $$
DECLARE v text; i integer := 0; v_bad text[] := '{}';
BEGIN
  FOREACH v IN ARRAY p_values LOOP
    i := i + 1;
    IF pg_temp.open(v, p_home_org, p_tag || i) <> 'ZD503: institution not set up' THEN
      v_bad := v_bad || v;
    END IF;
  END LOOP;
  RETURN v_bad;
END
$$;

-- 1. Accepted: the realm equals the home organisation.
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.open('ana@realm.test', 'realm.test', 'a1'), 'ok', 'realm equal to the home organisation is accepted');
SELECT is(pg_temp.open('ana.mari' || chr(263) || '-x_1+t%@realm.test', 'realm.test', 'a2'), 'ok',
  'a local part with dots, hyphens, signs and non-ASCII letters is accepted');
SELECT is(pg_temp.open('x@b.test@c.test', 'b.test', 'a3'), 'ZD503: institution not set up',
  'a part before the last @ is not the realm');
-- Case and edge spaces as far as the home organisation normalisation allows.
SELECT is(pg_temp.open('ivo@REALM.Test', 'realm.test', 'a4'), 'ok', 'realm in other case is accepted');
SELECT is(pg_temp.open('eva@realm.test ' || chr(9) || chr(13) || chr(10), ' Realm.TEST' || chr(9), 'a5'), 'ok',
  'edge space, tab, CR and LF are trimmed from both values');
SELECT is(pg_temp.not_refused(ARRAY['eva@realm .test', 'eva@realm.test' || chr(11), 'eva@realm.test' || chr(12),
                                    'eva@realm.test' || chr(160), 'eva@' || chr(8203) || 'realm.test'],
                              'realm.test', 'w'),
  '{}'::text[], 'inner space, vertical tab, form feed, no-break and zero-width space are refused');

-- 2. The unique id must be local@realm.
SELECT is(pg_temp.not_refused(ARRAY['ana.realm.test', 'realm.test', 'x@', '@realm.test', '@', '@@', 'x@@realm.test',
                                    '@@realm.test', 'x@@@realm.test'],
                              'realm.test', 's'),
  '{}'::text[], 'no @, empty local part, empty realm and @ before the realm are refused');
SELECT is(pg_temp.not_refused(ARRAY['a@b.test@realm.test', 'x@ @realm.test', 'x@' || chr(160) || '@realm.test',
                                    'x@' || chr(9) || '@realm.test', 'x@' || chr(8203) || '@realm.test'],
                              'realm.test', 'q'),
  '{}'::text[], 'a second @ is refused, also with a space, no-break space, tab or zero-width space before the realm');
SELECT is(pg_temp.not_refused(ARRAY[' @realm.test', '  @realm.test', chr(160) || '@realm.test', chr(9) || '@realm.test',
                                    ' ana@realm.test', 'ana @realm.test', 'a na@realm.test', 'a' || chr(160) || 'na@realm.test',
                                    'a' || chr(5760) || 'na@realm.test', 'a' || chr(8194) || 'na@realm.test',
                                    'a' || chr(8239) || 'na@realm.test', 'a' || chr(8287) || 'na@realm.test',
                                    'a' || chr(12288) || 'na@realm.test', 'a' || chr(8232) || 'na@realm.test',
                                    'a' || chr(8233) || 'na@realm.test'],
                              'realm.test', 'z'),
  '{}'::text[], 'a local part that is or holds a space or a line or paragraph separator is refused');
SELECT is(pg_temp.not_refused(ARRAY['a' || chr(1) || 'na@realm.test', 'a' || chr(9) || 'na@realm.test',
                                    'a' || chr(10) || 'na@realm.test', 'a' || chr(13) || 'na@realm.test',
                                    'a' || chr(27) || 'na@realm.test', 'ana' || chr(127) || '@realm.test',
                                    'a' || chr(133) || 'na@realm.test', 'a' || chr(159) || 'na@realm.test'],
                              'realm.test', 'k'),
  '{}'::text[], 'a local part with a control character is refused');
SELECT is(pg_temp.not_refused(ARRAY['a' || chr(173) || 'na@realm.test', 'a' || chr(1564) || 'na@realm.test',
                                    'a' || chr(6158) || 'na@realm.test', 'a' || chr(8203) || 'na@realm.test',
                                    'a' || chr(8205) || 'na@realm.test', 'a' || chr(8206) || 'na@realm.test',
                                    'a' || chr(8238) || 'na@realm.test', 'a' || chr(8288) || 'na@realm.test',
                                    'a' || chr(8294) || 'na@realm.test', 'a' || chr(65279) || 'na@realm.test',
                                    'a' || chr(65529) || 'na@realm.test', 'a' || chr(917505) || 'na@realm.test',
                                    'a' || chr(917631) || 'na@realm.test'],
                              'realm.test', 'f'),
  '{}'::text[], 'a local part with an invisible format character is refused');

-- 3. Equality only.
SELECT is(pg_temp.open('ana@other.test', 'realm.test', 'm1'), 'ZD503: institution not set up',
  'a realm of another institution is refused');
SELECT is(pg_temp.open('ana@realm.test', 'other.test', 'm2'), 'ZD503: institution not set up',
  'a home organisation of another institution is refused');
SELECT is(pg_temp.open('ana@unknown.test', 'unknown.test', 'm3'),
  pg_temp.open('ana@other.test', 'realm.test', 'm4'),
  'a mismatch and an unknown institution give the same answer');
SELECT is(pg_temp.not_refused(ARRAY['eve@realm.test.', 'eve@sub.realm.test', 'eve@xrealm.test', 'eve@realm.test.drugo.test',
                                    'eve@realm.drugo.test', 'eve@realm.tes', 'eve@ealm.test', 'eve@realm.test@'],
                              'realm.test', 'e'),
  '{}'::text[], 'trailing dot, subdomain, prefix, suffix and part of the realm are refused');
SELECT is(pg_temp.not_refused(ARRAY['eve@%', 'eve@_ealm.test', 'eve@realm.tes_', 'eve@realm.tes%', 'eve@%.test',
                                    'eve@*', 'eve@.*', 'eve@realm\.test', 'eve@[r]ealm.test', 'eve@realm.test|x',
                                    'eve@^realm.test$', 'eve@realm.tes.', 'eve@(realm).test'],
                              'realm.test', 'p'),
  '{}'::text[], 'LIKE and regular expression characters match nothing');

-- 4. Look-alikes are not letters.
SELECT is(pg_temp.open('eve@kit.test', 'kit.test', 'l0'), 'ok', 'the ASCII realm is accepted');
SELECT is(pg_temp.not_refused(ARRAY['eve@' || chr(8490) || 'it.test', 'eve@k' || chr(305) || 't.test',
                                    'eve@K' || chr(304) || 'T.test', 'eve@' || chr(65355) || 'it.test',
                                    'eve@kit.t' || chr(1077) || 'st', 'eve@' || chr(1082) || 'it.test'],
                              'kit.test', 'l'),
  '{}'::text[], 'Kelvin sign, dotless and dotted i, full-width and Cyrillic look-alikes are refused');
SELECT is(pg_temp.open('eve@kit.test', chr(8490) || 'it.test', 'l9'), 'ZD503: institution not set up',
  'a look-alike home organisation is refused even with an ASCII realm');

-- 5. Controls. Text cannot carry NUL, so no value is cut at one.
SELECT is(pg_temp.not_refused(ARRAY['eve@realm.test' || chr(1), 'eve@realm.test' || chr(27), 'eve@realm.test' || chr(127),
                                    'eve@realm' || chr(8) || '.test', 'eve@' || chr(133) || 'realm.test',
                                    'eve@realm.test' || chr(8238)],
                              'realm.test', 'c'),
  '{}'::text[], 'control and bidi characters are refused');
RESET ROLE;
SELECT throws_ok($$ SELECT chr(0) $$, '54000', NULL, 'NUL cannot be built as text');
SELECT throws_ok($$ SELECT convert_from('\x657665407265616c6d2e7465737400'::bytea, 'UTF8') $$, '22021', NULL,
  'NUL cannot reach the function as text');

-- 6. Length: 255 characters with the realm, nothing truncated.
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.open(repeat('u', 244) || '@realm.test', 'realm.test', 'n1'), 'ok',
  'a unique id of exactly 255 characters with the realm is accepted');
SELECT is(pg_temp.open(repeat('u', 245) || '@realm.test', 'realm.test', 'n2'), 'ZD422: invalid input',
  'a unique id of 256 characters is refused, not truncated');
SELECT is(pg_temp.open('u@' || repeat('r', 244) || '.test', 'realm.test', 'n3'), 'ZD503: institution not set up',
  'a long realm is compared whole');
RESET ROLE;
SELECT is(
  (SELECT hr_edu_person_unique_id FROM identity.user_account WHERE oidc_subject = 'sub-n1'),
  repeat('u', 244) || '@realm.test', 'the stored unique id is the value as given'
);
SELECT is(
  (SELECT hr_edu_person_unique_id FROM identity.user_account WHERE oidc_subject = 'sub-a5'),
  'eva@realm.test ' || chr(9) || chr(13) || chr(10), 'normalisation applies to the comparison, not to the stored value'
);

-- 7. Same issuer and local part in two realms: two people, two accounts.
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.open('ana@other.test', 'other.test', 't1'), 'ok', 'the same local part in another realm logs in');
RESET ROLE;
SELECT is(
  (SELECT array_agg(i.slug ORDER BY i.slug) FROM identity.user_account u JOIN identity.institution i ON i.id = u.institution_id
    WHERE u.hr_edu_person_unique_id IN ('ana@realm.test', 'ana@other.test')),
  ARRAY['test-other', 'test-realm'], 'each account belongs to the institution of its realm'
);

-- 8. Refusals leave no row.
SELECT is(pg_temp.counts(), '7 users, 7 sessions', 'refused logins create neither an account nor a session');

-- 8a. A refused shape or realm runs the same institution lookup as an
-- unknown institution. Counts of this transaction are read live.
CREATE FUNCTION pg_temp.lookups(p_unique_id text, p_home_org text, p_hash text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_before bigint; v_after bigint;
BEGIN
  SELECT coalesce(seq_scan, 0) + coalesce(idx_scan, 0) INTO v_before
  FROM pg_catalog.pg_stat_xact_user_tables WHERE relid = 'identity.institution'::regclass;
  PERFORM pg_temp.open(p_unique_id, p_home_org, p_hash);
  SELECT coalesce(seq_scan, 0) + coalesce(idx_scan, 0) INTO v_after
  FROM pg_catalog.pg_stat_xact_user_tables WHERE relid = 'identity.institution'::regclass;
  RETURN v_after - v_before;
END
$$;
SELECT is(ARRAY[pg_temp.lookups('ana@realm.test', 'realm.test', 'y1'), pg_temp.lookups('x@ @realm.test', 'realm.test', 'y2'),
                pg_temp.lookups('ana@other.test', 'realm.test', 'y3'), pg_temp.lookups('ana.realm.test', 'realm.test', 'y4'),
                pg_temp.lookups('ana@realm.test', 'Realm!test', 'y5')],
  ARRAY[1, 1, 1, 1, 1]::bigint[], 'an unknown institution, a refused shape and a refused realm each run the lookup once');

-- 9. An account created before this check is held to it on its next login.
INSERT INTO identity.user_account (institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
VALUES ('00000000-0000-4000-8000-0000000002a1', 'https://issuer.test', 'sub-old', 'old@other.test');
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.open_as('old@other.test', 'realm.test', 'sub-old', 'o1'), 'ZD503: institution not set up',
  'an existing account with another realm is refused');
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM identity.session s JOIN identity.user_account u ON u.id = s.user_id WHERE u.oidc_subject = 'sub-old'),
  0::bigint, 'the existing account gets no session'
);
INSERT INTO identity.user_account (institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
VALUES ('00000000-0000-4000-8000-0000000002a1', 'https://issuer.test', 'sub-bare', 'bare-unique-id');
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.open_as('bare-unique-id', 'realm.test', 'sub-bare', 'o2'), 'ZD503: institution not set up',
  'an existing account without a realm is refused');
RESET ROLE;
SELECT is(pg_temp.counts(), '9 users, 7 sessions', 'existing accounts refused get no session');

-- 10. The token hash rule still holds with the realm check in place.
SET LOCAL ROLE ductus_auth;
SELECT is(pg_temp.open_as('ana@realm.test', 'realm.test', 'sub-a1', 'a1'), 'ZD409: conflict',
  'a token hash already in use is still refused');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

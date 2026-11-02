-- institution.teachers_without_affiliation() (DAN-478, M1.3b; D-200 P7;
-- contract on #1091, c.6566888616): an administrator sees the confirmed,
-- unrevoked teachers of their own institution whose last login gave no
-- teacher right. The mark is computed on read, writes nothing and never
-- revokes a role; it returns the fact alone, never an attribute value or a
-- name.
-- Synthetic fixtures only: every person, name and organisation is invented.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';

SELECT plan(50);

-- The login needs a home organisation and an issuer (as in 024); fak-a also
-- trusts a second issuer (item 7).
UPDATE identity.institution SET aai_home_org = 'fak-a.example' WHERE id = pg_temp.id('fak_a');
UPDATE identity.institution SET aai_home_org = 'fak-b.example' WHERE id = pg_temp.id('fak_b');
INSERT INTO identity.institution_issuer (institution_id, oidc_issuer) VALUES
  (pg_temp.id('fak_a'), 'https://issuer.test'),
  (pg_temp.id('fak_b'), 'https://issuer.test'),
  (pg_temp.id('fak_a'), 'https://issuer-2.test');

-- One login of a fixture person as ductus_auth through the eight-argument
-- open_session; 'ok' or the SQLSTATE and message of the refusal.
CREATE FUNCTION pg_temp.login(p_who text, p_eligible boolean, p_issuer text DEFAULT 'https://issuer.test')
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_org text;
  v_hash bytea := sha256(convert_to(gen_random_uuid()::text, 'UTF8'));
  v_result text := 'ok';
BEGIN
  SELECT faculty || '.example' INTO STRICT v_org FROM person WHERE name = p_who;
  SET LOCAL ROLE ductus_auth;
  BEGIN
    PERFORM identity.open_session(p_issuer, 'sub-' || p_who, p_who || '@' || v_org, v_org, v_hash, NULL, NULL, p_eligible);
  EXCEPTION WHEN OTHERS THEN
    v_result := SQLSTATE || ': ' || SQLERRM;
  END;
  RESET ROLE;
  RETURN v_result;
END
$$;

-- The marked teachers as p_admin sees them, by fixture name in order ('other'
-- for an id outside the fixture, '-' for none), or the refusal as returned.
-- The ids are mapped back to names outside the caller's role.
CREATE FUNCTION pg_temp.flagged(p_admin text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  v := pg_temp.ask(p_admin, $q$ SELECT coalesce(string_agg(user_id::text, ',' ORDER BY user_id), '')
                                FROM institution.teachers_without_affiliation() $q$);
  IF position(': ' IN v) > 0 THEN
    RETURN v;
  END IF;
  SELECT coalesce(string_agg(coalesce(p.name, 'other'), ',' ORDER BY coalesce(p.name, 'other')), '-') INTO v
  FROM unnest(string_to_array(nullif(v, ''), ',')) AS u (id)
  LEFT JOIN person p ON p.id = u.id::uuid;
  RETURN v;
END
$$;

CREATE FUNCTION pg_temp.teacher_role(p_name text) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(CASE WHEN confirmed_at IS NULL THEN 'unconfirmed' ELSE 'confirmed' END, ','), 'none')
  FROM institution.institution_role
  WHERE user_id = pg_temp.id(p_name) AND role = 'teacher' AND revoked_at IS NULL
$$;

-- The whole content of the role and right tables, to show a read wrote nothing.
CREATE FUNCTION pg_temp.state() RETURNS text
LANGUAGE sql AS $$
  SELECT md5(
    (SELECT coalesce(string_agg(r::text, '|' ORDER BY r.id), '') FROM institution.institution_role r) || '#' ||
    (SELECT coalesce(string_agg(e::text, '|' ORDER BY e.user_id), '') FROM identity.teacher_eligibility e)
  )
$$;

-- 9. The catalogue: a stable definer of ductus_identity with an empty
-- search_path, two columns, and EXECUTE for ductus_app alone.
SELECT ok(p.prosecdef, 'teachers_without_affiliation is SECURITY DEFINER')
FROM pg_proc p WHERE p.oid = 'institution.teachers_without_affiliation()'::regprocedure;
SELECT is(pg_get_userbyid(p.proowner)::text, 'ductus_identity', 'teachers_without_affiliation belongs to ductus_identity')
FROM pg_proc p WHERE p.oid = 'institution.teachers_without_affiliation()'::regprocedure;
SELECT is(p.proconfig, ARRAY['search_path=""'], 'teachers_without_affiliation runs with an empty search_path')
FROM pg_proc p WHERE p.oid = 'institution.teachers_without_affiliation()'::regprocedure;
SELECT is(p.provolatile::text, 's', 'teachers_without_affiliation is STABLE, so it cannot write')
FROM pg_proc p WHERE p.oid = 'institution.teachers_without_affiliation()'::regprocedure;
SELECT is(pg_get_function_result('institution.teachers_without_affiliation()'::regprocedure),
  'TABLE(user_id uuid, confirmed_at timestamp with time zone)',
  'teachers_without_affiliation returns the account and the confirmation time, nothing else');
SELECT ok(has_function_privilege('ductus_app', 'institution.teachers_without_affiliation()', 'EXECUTE'),
  'ductus_app may execute teachers_without_affiliation');
SELECT is_empty(
  $$ SELECT r.rolname FROM (SELECT rolname::text FROM pg_roles
                            WHERE rolname LIKE 'ductus\_%'
                              -- ductus_app_local inherits ductus_app and nothing else (010).
                              AND rolname NOT IN ('ductus_app', 'ductus_identity', 'ductus_app_local')
                            UNION ALL SELECT 'public') AS r (rolname)
     WHERE has_function_privilege(r.rolname, 'institution.teachers_without_affiliation()', 'EXECUTE') $$,
  'no role but ductus_app, its local login and the owner, nor PUBLIC, may execute teachers_without_affiliation'
);
SELECT matches(pg_temp.ask('iva', 'SELECT count(*)::text FROM identity.teacher_eligibility'), '^42501: ',
  'ductus_app still cannot read teacher_eligibility directly');

-- 1. No session, an expired, a closed and an unknown session: ZD401.
SELECT is(pg_temp.flagged(t), 'ZD401: not authenticated', 'session "' || t || '" is refused with ZD401')
FROM unnest(ARRAY['anon', 'expired', 'closed', 'unknown']) AS t;

-- 2. Students, teachers and an administrator whose role is not confirmed or
-- was revoked: ZD403, so no row.
SELECT is(pg_temp.flagged(t), 'ZD403: forbidden', t || ' is refused with ZD403')
FROM unnest(ARRAY['ana', 'tomo', 'vesna', 'petra', 'nina']) AS t;
INSERT INTO institution.institution_role (institution_id, user_id, role)
VALUES (pg_temp.id('fak_a'), pg_temp.id('boris'), 'admin');
SELECT is(pg_temp.flagged('boris'), 'ZD403: forbidden', 'an unconfirmed administrator role is refused');
UPDATE institution.institution_role SET confirmed_at = now()
 WHERE user_id = pg_temp.id('boris') AND role = 'admin';
SELECT is(pg_temp.flagged('boris'), 'marko,vesna', 'the same role, once confirmed, sees the list (control)');
UPDATE institution.institution_role SET revoked_at = now()
 WHERE user_id = pg_temp.id('boris') AND role = 'admin';
SELECT is(pg_temp.flagged('boris'), 'ZD403: forbidden', 'a revoked administrator role is refused');

-- Before any login nobody has the right: each administrator sees the
-- confirmed teachers of their own institution, with the confirmation time.
SELECT is(pg_temp.flagged('iva'), 'marko,vesna', 'Iva sees Marko and Vesna, who have no right yet');
SELECT is(pg_temp.flagged('lea'), 'petra', 'Lea sees Petra alone');
SELECT is(
  pg_temp.ask('iva', $$ SELECT string_agg(user_id::text || ' ' || confirmed_at::text, ',' ORDER BY user_id)
                        FROM institution.teachers_without_affiliation() $$),
  (SELECT string_agg(user_id::text || ' ' || confirmed_at::text, ',' ORDER BY user_id)
   FROM institution.institution_role
   WHERE institution_id = pg_temp.id('fak_a') AND role = 'teacher' AND confirmed_at IS NOT NULL),
  'each row carries the confirmation time of the role'
);

-- 3. Isolation: Lea never sees a teacher of fak-a, with or without the right,
-- and Iva never sees Petra.
SELECT is(pg_temp.login('vesna', true), 'ok', 'Vesna logs in with the right');
SELECT is(pg_temp.flagged('iva'), 'marko', 'the right lifts the mark from Vesna');
SELECT is(pg_temp.flagged('lea'), 'petra', 'Lea still sees neither Vesna nor Marko');
SELECT is(pg_temp.login('petra', true), 'ok', 'Petra logs in with the right');
SELECT is(pg_temp.flagged('lea'), '-', 'Lea sees nobody once Petra has the right');
SELECT is(pg_temp.flagged('iva'), 'marko', 'Petra''s right changes nothing for Iva');

-- 4. A login with false marks the teacher, one with true lifts the mark,
-- and a login without the claim (NULL) counts as false.
SELECT is(pg_temp.login('vesna', false), 'ok', 'Vesna logs in without the right');
SELECT is(pg_temp.flagged('iva'), 'marko,vesna', 'Vesna is marked again');
SELECT is(pg_temp.login('vesna', true), 'ok', 'Vesna logs in with the right again');
SELECT is(pg_temp.flagged('iva'), 'marko', 'the mark goes with the right');
SELECT is(pg_temp.login('vesna', NULL), 'ok', 'Vesna logs in without the claim');
SELECT is(pg_temp.flagged('iva'), 'marko,vesna', 'a login without the claim marks Vesna');

-- 5. P7: losing the right revokes nothing, and reading the mark writes nothing.
SELECT is(pg_temp.teacher_role('vesna'), 'confirmed', 'Vesna''s teacher role stays confirmed and unrevoked');
SELECT is(
  (SELECT confirmed_by FROM institution.institution_role
   WHERE user_id = pg_temp.id('vesna') AND role = 'teacher' AND revoked_at IS NULL),
  pg_temp.id('iva'), 'the role still names Iva as the one who confirmed it'
);
CREATE TEMP TABLE before_read AS SELECT pg_temp.state() AS s;
DO $$ BEGIN PERFORM pg_temp.flagged('iva'); PERFORM pg_temp.flagged('lea'); PERFORM pg_temp.flagged('vesna'); END $$;
SELECT is(pg_temp.state(), (SELECT s FROM before_read), 'the reads leave every role and every right as they were');

-- 6. A revoked teacher, an administrator without a teacher role and an
-- unconfirmed teacher role are never marked.
SELECT is(pg_temp.ask('iva', $$ SELECT institution.revoke_teacher_role({marko})::text $$), 'true',
  'Iva revokes Marko''s teacher role');
SELECT is(pg_temp.flagged('iva'), 'vesna', 'the revoked teacher is not marked');
SELECT is(pg_temp.login('iva', false), 'ok', 'Iva logs in without the right');
SELECT is(pg_temp.flagged('iva'), 'vesna', 'an administrator without a teacher role is not marked');
SELECT is(pg_temp.login('nina', false), 'ok', 'Nina logs in without the right');
SELECT is(pg_temp.flagged('iva'), 'vesna', 'an unconfirmed teacher role is not marked');

-- 7. The same unique id from another issuer is another account: its right
-- does not lift the mark of the first account.
SELECT is(pg_temp.login('vesna', true, 'https://issuer-2.test'), 'ok', 'Vesna''s unique id logs in from the second issuer with the right');
SELECT is(
  (SELECT string_agg(u.oidc_issuer, ',') FROM identity.teacher_eligibility e
   JOIN identity.user_account u ON u.id = e.user_id
   WHERE u.hr_edu_person_unique_id = 'vesna@fak-a.example'),
  'https://issuer-2.test', 'only the account of the second issuer has the right'
);
SELECT is(pg_temp.flagged('iva'), 'vesna', 'the right of the other account does not lift Vesna''s mark');

-- 8. A right recorded under another institution does not count. The foreign
-- key forbids such a row, so it is dropped inside this rolled-back
-- transaction (as in 033).
ALTER TABLE identity.teacher_eligibility DROP CONSTRAINT teacher_eligibility_user_id_institution_id_fkey;
INSERT INTO identity.teacher_eligibility (user_id, institution_id) VALUES (pg_temp.id('vesna'), pg_temp.id('fak_b'));
SELECT is((SELECT institution_id FROM identity.teacher_eligibility WHERE user_id = pg_temp.id('vesna')),
  pg_temp.id('fak_b'), 'Vesna''s account has a right recorded under fak-b');
SELECT is(pg_temp.flagged('iva'), 'vesna', 'a right under another institution does not lift the mark');
SELECT is(pg_temp.flagged('lea'), '-', 'nor does it show Vesna to Lea');

SELECT * FROM finish();
ROLLBACK;

-- institution.institution_overview() (DAN-313, M2.11-P01; contract on #1091,
-- c.6572435345): an administrator sees one row of counts for their own
-- institution, with its display name, and never a person, a course name or
-- an activity time. Anyone else is refused; there is no parameter to name
-- another institution.
-- Synthetic fixtures only: every person, name and organisation is invented.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';

SELECT plan(44);

-- The login needs a home organisation and an issuer (as in 026).
UPDATE identity.institution SET aai_home_org = 'fak-a.example' WHERE id = pg_temp.id('fak_a');
UPDATE identity.institution SET aai_home_org = 'fak-b.example' WHERE id = pg_temp.id('fak_b');
INSERT INTO identity.institution_issuer (institution_id, oidc_issuer) VALUES
  (pg_temp.id('fak_a'), 'https://issuer.test'),
  (pg_temp.id('fak_b'), 'https://issuer.test');

-- One login of a fixture person as ductus_auth through the eight-argument
-- open_session, which records or clears the teacher right; 'ok' or the refusal.
CREATE FUNCTION pg_temp.login(p_who text, p_eligible boolean) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_org text;
  v_hash bytea := sha256(convert_to(gen_random_uuid()::text, 'UTF8'));
  v_result text := 'ok';
BEGIN
  SELECT faculty || '.example' INTO STRICT v_org FROM person WHERE name = p_who;
  SET LOCAL ROLE ductus_auth;
  BEGIN
    PERFORM identity.open_session('https://issuer.test', 'sub-' || p_who, p_who || '@' || v_org, v_org, v_hash, NULL, NULL, p_eligible);
  EXCEPTION WHEN OTHERS THEN
    v_result := SQLSTATE || ': ' || SQLERRM;
  END;
  RESET ROLE;
  RETURN v_result;
END
$$;

-- The overview as p_who sees it: "name|teachers|candidates|unaffiliated|
-- courses|students" with the row count in front, or the refusal.
CREATE FUNCTION pg_temp.overview(p_who text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_who, $q$
    SELECT count(*) || ':' || coalesce(string_agg(concat_ws('|', institution_name, confirmed_teachers,
           teacher_candidates, teachers_without_affiliation, courses, students), ','), '')
    FROM institution.institution_overview() $q$)
$$;

-- 7. The catalogue: a stable definer of ductus_identity with an empty
-- search_path, counts only, and EXECUTE for ductus_app alone.
SELECT ok(p.prosecdef, 'institution_overview is SECURITY DEFINER')
FROM pg_proc p WHERE p.oid = 'institution.institution_overview()'::regprocedure;
SELECT is(pg_get_userbyid(p.proowner)::text, 'ductus_identity', 'institution_overview belongs to ductus_identity')
FROM pg_proc p WHERE p.oid = 'institution.institution_overview()'::regprocedure;
SELECT is(p.proconfig, ARRAY['search_path=""'], 'institution_overview runs with an empty search_path')
FROM pg_proc p WHERE p.oid = 'institution.institution_overview()'::regprocedure;
SELECT is(p.provolatile::text, 's', 'institution_overview is STABLE, so it cannot write')
FROM pg_proc p WHERE p.oid = 'institution.institution_overview()'::regprocedure;
SELECT is(pg_get_function_result('institution.institution_overview()'::regprocedure),
  'TABLE(institution_name text, confirmed_teachers integer, teacher_candidates integer, '
  || 'teachers_without_affiliation integer, courses integer, students integer)',
  'institution_overview returns the name and five counts, nothing else');
SELECT is(pg_get_function_identity_arguments('institution.institution_overview()'::regprocedure), '',
  'institution_overview takes no parameter: the institution comes from the session alone');

-- 3. EXECUTE for ductus_app, its local login and the owner only.
SELECT ok(has_function_privilege('ductus_app', 'institution.institution_overview()', 'EXECUTE'),
  'ductus_app may execute institution_overview');
SELECT is_empty(
  $$ SELECT r.rolname FROM (SELECT rolname::text FROM pg_roles
                            WHERE rolname LIKE 'ductus\_%'
                              AND rolname NOT IN ('ductus_app', 'ductus_identity', 'ductus_app_local')
                            UNION ALL SELECT 'public') AS r (rolname)
     WHERE has_function_privilege(r.rolname, 'institution.institution_overview()', 'EXECUTE') $$,
  'no role but ductus_app, its local login and the owner, nor PUBLIC, may execute institution_overview'
);

-- 3. No session, an expired, a closed and an unknown session: ZD401.
SELECT is(pg_temp.overview(t), 'ZD401: not authenticated', 'session "' || t || '" is refused with ZD401')
FROM unnest(ARRAY['anon', 'expired', 'closed', 'unknown']) AS t;

-- 2. Students, teachers, an unconfirmed teacher and a person without a role:
-- ZD403, so no row.
SELECT is(pg_temp.overview(t), 'ZD403: forbidden', t || ' is refused with ZD403')
FROM unnest(ARRAY['ana', 'tomo', 'vesna', 'petra', 'nina', 'boris']) AS t;

-- Before any login: each administrator sees their own institution alone.
SELECT is(pg_temp.overview('iva'), '1:Fakultet A (test)|2|0|2|2|2', 'Iva sees fak-a: one row of counts');
SELECT is(pg_temp.overview('lea'), '1:Fakultet B (test)|1|0|1|1|1', 'Lea sees fak-b: one row of counts');

-- 4. Candidates: whom confirm_teacher_role would confirm and has not yet.
SELECT is(pg_temp.login('boris', true), 'ok', 'Boris logs in with the right');
SELECT is(pg_temp.login('nina', true), 'ok', 'Nina, whose role nobody confirmed, logs in with the right');
SELECT is(pg_temp.overview('iva'), '1:Fakultet A (test)|2|2|2|2|2', 'Boris and Nina are candidates of fak-a');
SELECT is(pg_temp.login('vesna', true), 'ok', 'Vesna, a confirmed teacher, logs in with the right');
SELECT is(pg_temp.overview('iva'), '1:Fakultet A (test)|2|2|1|2|2',
  'a confirmed teacher is not a candidate, and the right lifts her mark');
SELECT is(pg_temp.login('iva', true), 'ok', 'Iva herself logs in with the right');
SELECT is(pg_temp.overview('iva'), '1:Fakultet A (test)|2|2|1|2|2', 'the administrator is never her own candidate');
SELECT is(pg_temp.login('tomo', true), 'ok', 'Tomo of fak-b logs in with the right');
SELECT is(pg_temp.overview('iva'), '1:Fakultet A (test)|2|2|1|2|2', 'a right under fak-b counts nothing for Iva');
SELECT is(pg_temp.overview('lea'), '1:Fakultet B (test)|1|1|1|1|1', 'Lea counts Tomo as her candidate');
-- A second administrator counts Iva, not himself: the exclusion is per caller.
INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at)
VALUES (pg_temp.id('fak_a'), pg_temp.id('boris'), 'admin', now());
SELECT is(pg_temp.overview('boris'), '1:Fakultet A (test)|2|2|1|2|2', 'Boris as administrator counts Nina and Iva');
UPDATE institution.institution_role SET revoked_at = now()
 WHERE user_id = pg_temp.id('boris') AND role = 'admin';
SELECT is(pg_temp.overview('boris'), 'ZD403: forbidden', 'a revoked administrator role is refused');
DELETE FROM institution.institution_role WHERE user_id = pg_temp.id('boris') AND role = 'admin';
INSERT INTO institution.institution_role (institution_id, user_id, role)
VALUES (pg_temp.id('fak_a'), pg_temp.id('boris'), 'admin');
SELECT is(pg_temp.overview('boris'), 'ZD403: forbidden', 'an unconfirmed administrator role is refused');
-- A revoked teacher who still has the right is a candidate again.
SELECT is(pg_temp.login('marko', true), 'ok', 'Marko logs in with the right');
UPDATE institution.institution_role SET revoked_at = now()
 WHERE user_id = pg_temp.id('marko') AND role = 'teacher';
SELECT is(pg_temp.overview('iva'), '1:Fakultet A (test)|1|3|0|2|2',
  'a revoked teacher is no longer counted as a teacher and is a candidate again');
-- A login without the right clears it, and the candidate with it.
SELECT is(pg_temp.login('nina', false), 'ok', 'Nina logs in without the right');
SELECT is(pg_temp.overview('iva'), '1:Fakultet A (test)|1|2|0|2|2', 'Nina is no longer a candidate');

-- 6. The unaffiliated count is the row count the administrator gets from the
-- mark itself.
SELECT is(pg_temp.login('vesna', false), 'ok', 'Vesna logs in without the right');
SELECT is(
  pg_temp.ask('iva', 'SELECT teachers_without_affiliation::text FROM institution.institution_overview()'),
  pg_temp.ask('iva', 'SELECT count(*)::text FROM institution.teachers_without_affiliation()'),
  'teachers_without_affiliation equals the rows of the mark'
);
SELECT is(pg_temp.overview('iva'), '1:Fakultet A (test)|1|2|1|2|2', 'the mark is back on Vesna');

-- 5. Students: open student memberships, each person once.
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k2'), pg_temp.id('fak_a'), pg_temp.id('dora'), 'student');
SELECT is(pg_temp.overview('iva'), '1:Fakultet A (test)|1|2|1|2|2', 'a student in two courses is counted once');
UPDATE institution.course_member SET member_to = now()
 WHERE user_id = pg_temp.id('ana') AND course_id = pg_temp.id('k1');
SELECT is(pg_temp.overview('iva'), '1:Fakultet A (test)|1|2|1|2|1', 'a closed membership is not counted');
INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
VALUES (gen_random_uuid(), pg_temp.id('fak_a'), 'K4', '2026/2027', 'prohibited', pg_temp.id('vesna'));
SELECT is(pg_temp.overview('iva'), '1:Fakultet A (test)|1|2|1|3|1', 'a new course is counted');

-- 1. Isolation: nothing that happened in fak-a reached Lea.
SELECT is(pg_temp.overview('lea'), '1:Fakultet B (test)|1|1|1|1|1', 'Lea''s counts are untouched by fak-a');

SELECT * FROM finish();
ROLLBACK;

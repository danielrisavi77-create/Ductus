-- institution.teacher_roles() (DAN-581, M2.11-P02, A-02; contract on #1091,
-- c.6674850230): the administrator of an institution sees the candidates and
-- the confirmed teachers of their own institution, with the name, the time a
-- role was confirmed or last revoked and the D-200 P7 mark, and never a login
-- time. Anyone else is refused; there is no parameter to name another
-- institution.
-- Synthetic fixtures only: every person, name and organisation is invented.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';

SELECT plan(46);

UPDATE identity.institution SET aai_home_org = 'fak-a.example' WHERE id = pg_temp.id('fak_a');
UPDATE identity.institution SET aai_home_org = 'fak-b.example' WHERE id = pg_temp.id('fak_b');
INSERT INTO identity.institution_issuer (institution_id, oidc_issuer) VALUES
  (pg_temp.id('fak_a'), 'https://issuer.test'),
  (pg_temp.id('fak_b'), 'https://issuer.test');

-- One login of a fixture person as ductus_auth, which records or clears the
-- teacher right and writes the name; 'ok' or the refusal.
CREATE FUNCTION pg_temp.login(p_who text, p_eligible boolean, p_given text DEFAULT NULL, p_family text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_org text;
  v_hash bytea := sha256(convert_to(gen_random_uuid()::text, 'UTF8'));
  v_result text := 'ok';
BEGIN
  SELECT faculty || '.example' INTO STRICT v_org FROM person WHERE name = p_who;
  SET LOCAL ROLE ductus_auth;
  BEGIN
    PERFORM identity.open_session('https://issuer.test', 'sub-' || p_who, p_who || '@' || v_org, v_org, v_hash,
                                  p_given, p_family, p_eligible);
  EXCEPTION WHEN OTHERS THEN
    v_result := SQLSTATE || ': ' || SQLERRM;
  END;
  RESET ROLE;
  RETURN v_result;
END
$$;

-- The list as p_who sees it, the row count in front, each row
-- "person|list|name|confirmed|revoked|for review" with "-" for none; or the
-- refusal.
CREATE FUNCTION pg_temp.roles(p_who text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_who, $q$
    SELECT count(*) || ':' || coalesce(string_agg(concat_ws('|', p.name, t.list,
             coalesce(t.given_name || ' ' || t.family_name, '-'),
             CASE WHEN t.confirmed_at IS NULL THEN '-' ELSE 'c' END,
             CASE WHEN t.revoked_at IS NULL THEN '-' ELSE 'r' END,
             coalesce(t.for_review::text, '-')), ',' ORDER BY t.list, p.name), '')
    FROM institution.teacher_roles() t LEFT JOIN person p ON p.id = t.user_id $q$)
$$;

-- The catalogue: a stable definer of ductus_identity with an empty
-- search_path, no login time, and EXECUTE for ductus_app alone.
SELECT ok(p.prosecdef, 'teacher_roles is SECURITY DEFINER')
FROM pg_proc p WHERE p.oid = 'institution.teacher_roles()'::regprocedure;
SELECT is(pg_get_userbyid(p.proowner)::text, 'ductus_identity', 'teacher_roles belongs to ductus_identity')
FROM pg_proc p WHERE p.oid = 'institution.teacher_roles()'::regprocedure;
SELECT is(p.proconfig, ARRAY['search_path=""'], 'teacher_roles runs with an empty search_path')
FROM pg_proc p WHERE p.oid = 'institution.teacher_roles()'::regprocedure;
SELECT is(p.provolatile::text, 's', 'teacher_roles is STABLE, so it cannot write')
FROM pg_proc p WHERE p.oid = 'institution.teacher_roles()'::regprocedure;
SELECT is(pg_get_function_result('institution.teacher_roles()'::regprocedure),
  'TABLE(user_id uuid, list text, given_name text, family_name text, confirmed_at timestamp with time zone, '
  || 'revoked_at timestamp with time zone, for_review boolean)',
  'teacher_roles returns the account, the list, the name, two times and the mark: no login time');
SELECT is(pg_get_function_identity_arguments('institution.teacher_roles()'::regprocedure), '',
  'teacher_roles takes no parameter: the institution comes from the session alone');
SELECT ok(has_function_privilege('ductus_app', 'institution.teacher_roles()', 'EXECUTE'),
  'ductus_app may execute teacher_roles');
SELECT is_empty(
  $$ SELECT r.rolname FROM (SELECT rolname::text FROM pg_roles
                            WHERE rolname LIKE 'ductus\_%'
                              AND rolname NOT IN ('ductus_app', 'ductus_identity', 'ductus_app_local')
                            UNION ALL SELECT 'public') AS r (rolname)
     WHERE has_function_privilege(r.rolname, 'institution.teacher_roles()', 'EXECUTE') $$,
  'no role but ductus_app, its local login and the owner, nor PUBLIC, may execute teacher_roles'
);

-- No session, an expired, a closed and an unknown session: ZD401.
SELECT is(pg_temp.roles(t), 'ZD401: not authenticated', 'session "' || t || '" is refused with ZD401')
FROM unnest(ARRAY['anon', 'expired', 'closed', 'unknown']) AS t;

-- Students, teachers of both institutions, an unconfirmed teacher and a
-- person without a role: ZD403, so no row.
SELECT is(pg_temp.roles(t), 'ZD403: forbidden', t || ' is refused with ZD403')
FROM unnest(ARRAY['ana', 'tomo', 'vesna', 'petra', 'nina', 'boris']) AS t;

-- Before any login: no right is recorded, so no candidate, and each confirmed
-- teacher carries the mark. Each administrator sees their own institution.
SELECT is(pg_temp.roles('iva'), '2:marko|confirmed|-|c|-|true,vesna|confirmed|-|c|-|true',
  'Iva sees the two confirmed teachers of fak-a, both marked');
SELECT is(pg_temp.roles('lea'), '1:petra|confirmed|-|c|-|true', 'Lea sees the one confirmed teacher of fak-b');

-- Candidates: whom confirm_teacher_role would confirm and has not yet.
SELECT is(pg_temp.login('boris', true, 'Bor', 'Primjer'), 'ok', 'Boris logs in with the right and a name');
SELECT is(pg_temp.login('nina', true), 'ok', 'Nina, whose role nobody confirmed, logs in with the right, no name');
SELECT is(pg_temp.login('vesna', true, 'Ves', 'Uzorak'), 'ok', 'Vesna logs in with the right and a name');
SELECT is(pg_temp.roles('iva'),
  '4:boris|candidate|Bor Primjer|-|-|-,nina|candidate|-|-|-|-,marko|confirmed|-|c|-|true,vesna|confirmed|Ves Uzorak|c|-|false',
  'two candidates, never revoked; the right lifts Vesna''s mark; a missing name is both parts null');
SELECT is(pg_temp.ask('iva', $q$ SELECT count(*)::text FROM institution.teacher_roles() t
                                 WHERE t.list = 'candidate' $q$),
          pg_temp.ask('iva', 'SELECT count(*)::text FROM institution.list_teacher_candidates()'),
  'the candidates are as many as list_teacher_candidates returns');
SELECT is(pg_temp.ask('iva', $q$ SELECT string_agg(user_id::text, ',' ORDER BY user_id) FROM institution.teacher_roles()
                                 WHERE list = 'candidate' $q$),
          pg_temp.ask('iva', 'SELECT string_agg(user_id::text, '','' ORDER BY user_id) FROM institution.list_teacher_candidates()'),
  'and they are the same accounts');
SELECT is(pg_temp.login('iva', true, 'Iv', 'Probna'), 'ok', 'Iva herself logs in with the right');
SELECT is(pg_temp.roles('iva'),
  '4:boris|candidate|Bor Primjer|-|-|-,nina|candidate|-|-|-|-,marko|confirmed|-|c|-|true,vesna|confirmed|Ves Uzorak|c|-|false',
  'the administrator is never her own candidate');
SELECT is(pg_temp.login('tomo', true, 'Tom', 'Ogledni'), 'ok', 'Tomo of fak-b logs in with the right');
SELECT is(pg_temp.roles('iva'),
  '4:boris|candidate|Bor Primjer|-|-|-,nina|candidate|-|-|-|-,marko|confirmed|-|c|-|true,vesna|confirmed|Ves Uzorak|c|-|false',
  'a right and a name under fak-b show nothing to Iva');
SELECT is(pg_temp.roles('lea'), '2:tomo|candidate|Tom Ogledni|-|-|-,petra|confirmed|-|c|-|true',
  'Lea sees Tomo as her candidate');

-- Istodobnost: a confirmation moves the person to the confirmed list and a
-- revocation brings them back as a candidate; never on both lists.
SELECT is(pg_temp.ask('iva', 'SELECT institution.confirm_teacher_role({boris})::text'), '', 'Iva confirms Boris');
SELECT is(pg_temp.roles('iva'),
  '4:nina|candidate|-|-|-|-,boris|confirmed|Bor Primjer|c|-|false,marko|confirmed|-|c|-|true,vesna|confirmed|Ves Uzorak|c|-|false',
  'Boris is now confirmed, without the mark, and no longer a candidate');
SELECT is(pg_temp.ask('iva', 'SELECT institution.revoke_teacher_role({boris})::text'), 'true', 'Iva revokes Boris');
SELECT is(pg_temp.roles('iva'),
  '4:boris|candidate|Bor Primjer|-|r|-,nina|candidate|-|-|-|-,marko|confirmed|-|c|-|true,vesna|confirmed|Ves Uzorak|c|-|false',
  'Boris is a candidate again and carries the revocation');
SELECT is(pg_temp.ask('iva', $q$ SELECT revoked_at::text FROM institution.teacher_roles() WHERE user_id = {boris} $q$),
          (SELECT revoked_at::text FROM institution.institution_role
            WHERE user_id = pg_temp.id('boris') AND role = 'teacher'),
  'the revocation time is the one stored on the role');
-- An older revoked role does not hide the latest revocation.
INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_by, confirmed_at, revoked_at)
VALUES (pg_temp.id('fak_a'), pg_temp.id('boris'), 'teacher', pg_temp.id('iva'),
        now() - interval '3 days', now() - interval '2 days');
SELECT is(pg_temp.ask('iva', $q$ SELECT (revoked_at = now())::text FROM institution.teacher_roles()
                                 WHERE user_id = {boris} $q$), 'true',
  'of two revoked roles, the latest revocation is the one returned');
SELECT is(pg_temp.ask('iva', 'SELECT (count(*) = count(DISTINCT user_id))::text FROM institution.teacher_roles()'),
  'true', 'every person is on one list, once');

-- A revoked teacher who still has the right is a candidate with the revocation.
SELECT is(pg_temp.login('marko', true), 'ok', 'Marko logs in with the right');
UPDATE institution.institution_role SET revoked_at = now()
 WHERE user_id = pg_temp.id('marko') AND role = 'teacher' AND revoked_at IS NULL;
SELECT is(pg_temp.roles('iva'),
  '4:boris|candidate|Bor Primjer|-|r|-,marko|candidate|-|-|r|-,nina|candidate|-|-|-|-,vesna|confirmed|Ves Uzorak|c|-|false',
  'Marko moves from the confirmed list to the candidates, with the revocation');
-- A login without the right clears the candidate, and brings the mark back.
SELECT is(pg_temp.login('nina', false), 'ok', 'Nina logs in without the right');
SELECT is(pg_temp.login('vesna', false, 'Ves', 'Uzorak'), 'ok', 'Vesna logs in without the right');
SELECT is(pg_temp.roles('iva'),
  '3:boris|candidate|Bor Primjer|-|r|-,marko|candidate|-|-|r|-,vesna|confirmed|Ves Uzorak|c|-|true',
  'Nina is no longer a candidate, and Vesna is marked again');

-- A revoked or unconfirmed administrator role is refused.
INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at, revoked_at)
VALUES (pg_temp.id('fak_a'), pg_temp.id('dora'), 'admin', now(), now());
SELECT is(pg_temp.roles('dora'), 'ZD403: forbidden', 'a revoked administrator role is refused');
INSERT INTO institution.institution_role (institution_id, user_id, role)
VALUES (pg_temp.id('fak_a'), pg_temp.id('dora'), 'admin');
SELECT is(pg_temp.roles('dora'), 'ZD403: forbidden', 'an unconfirmed administrator role is refused');

-- Isolation: nothing that happened in fak-a reached Lea.
SELECT is(pg_temp.roles('lea'), '2:tomo|candidate|Tom Ogledni|-|-|-,petra|confirmed|-|c|-|true',
  'Lea''s list is untouched by fak-a');

SELECT * FROM finish();
ROLLBACK;

-- institution.list_teacher_candidates() (DAN-486, M2.2-P02b; contract on
-- #1091, c.6568059150, confirmed in c.6569015791): an administrator lists the
-- accounts of their own institution that they can confirm as teachers. The
-- list is computed on read from the teacher right of the last login, writes
-- nothing and returns the account id alone, never a name or a login time.
-- Invariant: the list is exactly the set for which confirm_teacher_role by the
-- same administrator succeeds and changes something.
-- Synthetic fixtures only: every person, name and organisation is invented.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';

SELECT plan(66);

-- The login needs a home organisation and an issuer (as in 024 and 026);
-- fak-a also trusts a second issuer (item 9).
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

-- The candidates as p_admin sees them, by fixture name in name order ('other'
-- for an id outside the fixture, '-' for none), or the refusal as returned.
-- The ids are mapped back to names outside the caller's role.
CREATE FUNCTION pg_temp.candidates(p_admin text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  v := pg_temp.ask(p_admin, $q$ SELECT coalesce(string_agg(user_id::text, ',' ORDER BY user_id), '')
                                FROM institution.list_teacher_candidates() $q$);
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

-- What confirm_teacher_role(p_who) by p_admin would do, without keeping it:
-- 'changed', 'unchanged' or the refusal. The call runs in a subtransaction
-- that is always rolled back.
CREATE FUNCTION pg_temp.confirm_outcome(p_admin text, p_who uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_before text := pg_temp.state();
  v text;
BEGIN
  BEGIN
    v := pg_temp.ask(p_admin, format('SELECT ''ok'' FROM institution.confirm_teacher_role(%L)', p_who));
    IF v = 'ok' THEN
      v := CASE WHEN pg_temp.state() = v_before THEN 'unchanged' ELSE 'changed' END;
    END IF;
    RAISE EXCEPTION '%', v USING ERRCODE = 'ZX999';
  EXCEPTION WHEN SQLSTATE 'ZX999' THEN
    RETURN SQLERRM;
  END;
END
$$;

-- The accounts of every institution for which confirm_teacher_role by
-- p_admin would change something, named as pg_temp.candidates() names them.
CREATE FUNCTION pg_temp.confirmable(p_admin text) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(coalesce(p.name, 'other'), ',' ORDER BY coalesce(p.name, 'other')), '-')
  FROM identity.user_account u
  LEFT JOIN person p ON p.id = u.id
  WHERE pg_temp.confirm_outcome(p_admin, u.id) = 'changed'
$$;

-- 1. The catalogue: a stable definer of ductus_identity with an empty
-- search_path, one column, and EXECUTE for ductus_app alone.
SELECT ok(p.prosecdef, 'list_teacher_candidates is SECURITY DEFINER')
FROM pg_proc p WHERE p.oid = 'institution.list_teacher_candidates()'::regprocedure;
SELECT is(pg_get_userbyid(p.proowner)::text, 'ductus_identity', 'list_teacher_candidates belongs to ductus_identity')
FROM pg_proc p WHERE p.oid = 'institution.list_teacher_candidates()'::regprocedure;
SELECT is(p.proconfig, ARRAY['search_path=""'], 'list_teacher_candidates runs with an empty search_path')
FROM pg_proc p WHERE p.oid = 'institution.list_teacher_candidates()'::regprocedure;
SELECT is(p.provolatile::text, 's', 'list_teacher_candidates is STABLE, so it cannot write')
FROM pg_proc p WHERE p.oid = 'institution.list_teacher_candidates()'::regprocedure;
SELECT is(pg_get_function_result('institution.list_teacher_candidates()'::regprocedure),
  'TABLE(user_id uuid)', 'list_teacher_candidates returns the account alone');
SELECT is(pg_get_function_identity_arguments('institution.list_teacher_candidates()'::regprocedure), '',
  'list_teacher_candidates takes no argument naming an institution or an actor');
SELECT ok(has_function_privilege('ductus_app', 'institution.list_teacher_candidates()', 'EXECUTE'),
  'ductus_app may execute list_teacher_candidates');
SELECT is_empty(
  $$ SELECT r.rolname FROM (SELECT rolname::text FROM pg_roles
                            WHERE rolname LIKE 'ductus\_%'
                              -- ductus_app_local inherits ductus_app and nothing else (010).
                              AND rolname NOT IN ('ductus_app', 'ductus_identity', 'ductus_app_local')
                            UNION ALL SELECT 'public') AS r (rolname)
     WHERE has_function_privilege(r.rolname, 'institution.list_teacher_candidates()', 'EXECUTE') $$,
  'no role but ductus_app, its local login and the owner, nor PUBLIC, may execute list_teacher_candidates'
);
SELECT matches(pg_temp.ask('iva', 'SELECT count(*)::text FROM identity.teacher_eligibility'), '^42501: ',
  'ductus_app still cannot read teacher_eligibility directly');

-- 2. No session, an expired, a closed and an unknown session: ZD401.
SELECT is(pg_temp.candidates(t), 'ZD401: not authenticated', 'session "' || t || '" is refused with ZD401')
FROM unnest(ARRAY['anon', 'expired', 'closed', 'unknown']) AS t;

-- Before any login nobody has the right, so nobody is a candidate.
SELECT is(pg_temp.candidates('iva'), '-', 'Iva sees nobody before any login');
SELECT is(pg_temp.candidates('lea'), '-', 'Lea sees nobody before any login');

-- 5. A login with true puts the person on the list, one with false or
-- without the claim (NULL) takes them off it.
SELECT is(pg_temp.login('ana', true), 'ok', 'Ana logs in with the right');
SELECT is(pg_temp.candidates('iva'), 'ana', 'Ana is Iva''s candidate');
SELECT is(pg_temp.login('ana', false), 'ok', 'Ana logs in without the right');
SELECT is(pg_temp.candidates('iva'), '-', 'a login with false takes Ana off the list');
SELECT is(pg_temp.login('ana', true), 'ok', 'Ana logs in with the right again');
SELECT is(pg_temp.login('ana', NULL), 'ok', 'Ana logs in without the claim');
SELECT is(pg_temp.candidates('iva'), '-', 'a login without the claim takes Ana off the list');

-- 4. Isolation: a candidate with the right in fak-b is never on Iva's list,
-- and Lea never sees a candidate of fak-a.
SELECT is(pg_temp.login('tomo', true), 'ok', 'Tomo of fak-b logs in with the right');
SELECT is(pg_temp.candidates('lea'), 'tomo', 'Tomo is Lea''s candidate');
SELECT is(pg_temp.candidates('iva'), '-', 'Iva does not see Tomo');
SELECT is(pg_temp.login('dora', true), 'ok', 'Dora of fak-a logs in with the right');
SELECT is(pg_temp.candidates('iva'), 'dora', 'Dora is Iva''s candidate');
SELECT is(pg_temp.candidates('lea'), 'tomo', 'Lea does not see Dora');

-- 3. Students, teachers and an administrator whose role is not confirmed or
-- was revoked: ZD403, so no row, now that there are candidates to leak.
SELECT is(pg_temp.candidates(t), 'ZD403: forbidden', t || ' is refused with ZD403')
FROM unnest(ARRAY['ana', 'tomo', 'vesna', 'petra', 'nina']) AS t;
INSERT INTO institution.institution_role (institution_id, user_id, role)
VALUES (pg_temp.id('fak_a'), pg_temp.id('boris'), 'admin');
SELECT is(pg_temp.candidates('boris'), 'ZD403: forbidden', 'an unconfirmed administrator role is refused');
UPDATE institution.institution_role SET confirmed_at = now()
 WHERE user_id = pg_temp.id('boris') AND role = 'admin';
SELECT is(pg_temp.candidates('boris'), 'dora', 'the same role, once confirmed, sees the list (control)');
UPDATE institution.institution_role SET revoked_at = now()
 WHERE user_id = pg_temp.id('boris') AND role = 'admin';
SELECT is(pg_temp.candidates('boris'), 'ZD403: forbidden', 'a revoked administrator role is refused');

-- 6. A confirmed teacher with the right is not a candidate, and is again once
-- the role is revoked; an unconfirmed teacher role with the right is; the
-- administrator with their own right is not on their own list.
SELECT is(pg_temp.login('vesna', true), 'ok', 'Vesna, a confirmed teacher, logs in with the right');
SELECT is(pg_temp.candidates('iva'), 'dora', 'a confirmed teacher is not a candidate');
SELECT is(pg_temp.ask('iva', $$ SELECT institution.revoke_teacher_role({vesna})::text $$), 'true',
  'Iva revokes Vesna''s teacher role');
SELECT is(pg_temp.candidates('iva'), 'dora,vesna', 'the revoked teacher is a candidate again');
SELECT is(pg_temp.login('nina', true), 'ok', 'Nina, whose teacher role nobody confirmed, logs in with the right');
SELECT is(pg_temp.candidates('iva'), 'dora,nina,vesna', 'an unconfirmed teacher role does not exclude');
SELECT is(pg_temp.login('iva', true), 'ok', 'Iva logs in with the right');
SELECT is(pg_temp.candidates('iva'), 'dora,nina,vesna', 'Iva is not on her own list');
SELECT is(pg_temp.login('lea', true), 'ok', 'Lea logs in with the right');
SELECT is(pg_temp.candidates('lea'), 'tomo', 'Lea is not on her own list and sees no one of fak-a');
SELECT is(
  pg_temp.ask('iva', $$ SELECT string_agg(user_id::text, ',') FROM institution.list_teacher_candidates() $$),
  (SELECT string_agg(id::text, ',' ORDER BY id) FROM person WHERE name IN ('dora', 'nina', 'vesna')),
  'the rows come in account order'
);

-- 8. Reading writes nothing.
CREATE TEMP TABLE before_read AS SELECT pg_temp.state() AS s;
DO $$ BEGIN
  PERFORM pg_temp.candidates('iva'); PERFORM pg_temp.candidates('lea');
  PERFORM pg_temp.candidates('vesna'); PERFORM pg_temp.candidates('anon');
END $$;
SELECT is(pg_temp.state(), (SELECT s FROM before_read), 'the reads leave every role and every right as they were');

-- 7. The invariant over every account of both institutions: the list is
-- exactly the set confirm_teacher_role would change, for each administrator.
SELECT is(pg_temp.confirmable('iva'), pg_temp.candidates('iva'), 'Iva''s list is what her confirmation would change');
SELECT is(pg_temp.confirmable('lea'), pg_temp.candidates('lea'), 'Lea''s list is what her confirmation would change');
SELECT is(pg_temp.confirm_outcome('iva', pg_temp.id('marko')), 'ZD403: forbidden',
  'Marko of fak-a, without the right, is not on the list and cannot be confirmed');
SELECT is(pg_temp.confirm_outcome('iva', pg_temp.id('tomo')), 'ZD403: forbidden',
  'Tomo of fak-b cannot be confirmed by Iva');
SELECT is(pg_temp.login('marko', true), 'ok', 'Marko, a confirmed teacher, logs in with the right');
SELECT is(pg_temp.confirm_outcome('iva', pg_temp.id('marko')), 'unchanged',
  'confirming a confirmed teacher off the list changes nothing');

-- 9. The same unique id from another issuer is another account: only the
-- account with the right is on the list.
SELECT is(pg_temp.login('boris', true, 'https://issuer-2.test'), 'ok',
  'Boris''s unique id logs in from the second issuer with the right');
SELECT is(
  pg_temp.ask('iva', $$ SELECT string_agg(user_id::text, ',') FROM institution.list_teacher_candidates()
                        WHERE user_id NOT IN ({dora}, {nina}, {vesna}) $$),
  (SELECT id::text FROM identity.user_account
   WHERE hr_edu_person_unique_id = 'boris@fak-a.example' AND oidc_issuer = 'https://issuer-2.test'),
  'only the account of the second issuer is on the list'
);
SELECT is(pg_temp.candidates('iva'), 'dora,nina,other,vesna', 'Boris''s first account, without the right, is not');
SELECT is(pg_temp.confirmable('iva'), pg_temp.candidates('iva'), 'the invariant holds for the second account too');

-- 4. A person of fak-a whose right is recorded under fak-b is on nobody's
-- list. The foreign key forbids such a row, so it is dropped inside this
-- rolled-back transaction (as in 026).
ALTER TABLE identity.teacher_eligibility DROP CONSTRAINT teacher_eligibility_user_id_institution_id_fkey;
INSERT INTO identity.teacher_eligibility (user_id, institution_id) VALUES (pg_temp.id('boris'), pg_temp.id('fak_b'));
SELECT is(pg_temp.candidates('lea'), 'tomo', 'Lea does not see Boris of fak-a with a right under fak-b');
SELECT is(pg_temp.candidates('iva'), 'dora,nina,other,vesna', 'Iva does not see that right either');
SELECT is(pg_temp.confirmable('lea'), pg_temp.candidates('lea'), 'the invariant holds for the foreign right');

-- 7. Confirming every candidate empties the list, and each becomes a
-- confirmed teacher.
SELECT is(
  (SELECT string_agg(pg_temp.ask('iva', format('SELECT ''ok'' FROM institution.confirm_teacher_role(%L)', c)), ',')
   FROM unnest(string_to_array(
     pg_temp.ask('iva', $$ SELECT string_agg(user_id::text, ',') FROM institution.list_teacher_candidates() $$), ',')) AS c),
  'ok,ok,ok,ok', 'Iva confirms each of her four candidates'
);
SELECT is(pg_temp.candidates('iva'), '-', 'confirmed candidates leave the list');
SELECT is(pg_temp.teacher_role(t), 'confirmed', t || ' is a confirmed teacher')
FROM unnest(ARRAY['dora', 'nina', 'vesna']) AS t;

SELECT * FROM finish();
ROLLBACK;

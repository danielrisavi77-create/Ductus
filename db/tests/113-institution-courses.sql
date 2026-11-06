-- institution.institution_courses(p_academic_year) and
-- institution.institution_academic_years() (DAN-313, M2.11-P03, A-03;
-- contract on #1091, c.6692590206): the administrator of an institution reads
-- the courses of one academic year with their students, holder, team and
-- seminar groups, and the years that have courses; read only. Anyone else is
-- refused, and the institution comes from the session alone.
-- Synthetic fixtures only: every person, name and organisation is invented.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';

SELECT plan(70);

-- A call of a function returning void reads as "ok", or "SQLSTATE: ...".
CREATE FUNCTION pg_temp.run(p_actor text, p_call text) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.ask(p_actor, 'SELECT ''ok'' FROM ' || p_call) $$;

-- The courses p_who reads for p_year, the row count in front, each row
-- "kind|course|group|person|label|name|students" with "-" for none and the
-- fixture names for ids; or the refusal.
CREATE FUNCTION pg_temp.courses(p_who text, p_year text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_who, format($q$
    SELECT count(*) || ':' || coalesce(string_agg(concat_ws('|', t.kind, coalesce(rc.name, '?'),
             coalesce(rg.name, CASE WHEN t.group_id IS NULL THEN '-' ELSE '?' END),
             coalesce(rp.name, CASE WHEN t.user_id IS NULL THEN '-' ELSE '?' END),
             coalesce(t.course_name, t.group_name, '-'),
             coalesce(t.given_name || ' ' || t.family_name, '-'),
             coalesce(t.students::text, '-')), ',' ORDER BY rc.name, t.kind, rg.name, rp.name), '')
    FROM institution.institution_courses(%L) t
    LEFT JOIN ref rc ON rc.val = t.course_id::text
    LEFT JOIN ref rg ON rg.val = t.group_id::text
    LEFT JOIN ref rp ON rp.val = t.user_id::text $q$, p_year))
$$;

-- The years p_who reads, in the order the function returns them.
CREATE FUNCTION pg_temp.years(p_who text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_who, $q$
    SELECT coalesce(string_agg(y.academic_year, ',' ORDER BY y.n), '')
    FROM institution.institution_academic_years() WITH ORDINALITY AS y (academic_year, n) $q$)
$$;

-- K1 gets a holder, two groups (one with a teacher and a student, one empty),
-- K3 at fak-b a group with Tomo. Two more courses in other years.
SELECT is(pg_temp.run('vesna', $$ institution.set_course_holder({k1}, {vesna}) $$), 'ok', 'Vesna becomes holder of K1');
INSERT INTO ref VALUES ('ga', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa A') $$));
INSERT INTO ref VALUES ('gb', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa B') $$));
INSERT INTO ref VALUES ('gk3', pg_temp.ask('petra', $$ SELECT institution.create_seminar_group({k3}, 'Grupa C') $$));
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_teacher({ga}, {marko}) $$), 'ok',
  'Marko, a confirmed teacher of fak-a, teaches group A of K1');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_student({ga}, {ana}) $$), 'ok', 'Ana is in group A');
SELECT is(pg_temp.run('petra', $$ institution.assign_group_student({gk3}, {tomo}) $$), 'ok', 'Tomo is in group C of K3');
INSERT INTO identity.person_name (user_id, institution_id, given_name, family_name)
SELECT id, institution_id, n.given_name, n.family_name
FROM (VALUES ('vesna', 'Ves', 'Uzorak'), ('ana', 'An', 'Probna'), ('tomo', 'Tom', 'Ogledni')) AS n (name, given_name, family_name)
JOIN person p USING (name);
INSERT INTO ref VALUES ('k4', gen_random_uuid()::text), ('k5', gen_random_uuid()::text);
INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
VALUES (pg_temp.id('k4'), pg_temp.id('fak_a'), 'K4', '2025/2026', 'prohibited', pg_temp.id('vesna')),
       (pg_temp.id('k5'), pg_temp.id('fak_b'), 'K5', '2024/2025', 'prohibited', pg_temp.id('petra'));

-- The catalogue: stable definers of ductus_identity with an empty
-- search_path, and EXECUTE for ductus_app alone.
SELECT ok(p.prosecdef, 'institution_courses is SECURITY DEFINER')
FROM pg_proc p WHERE p.oid = 'institution.institution_courses(text)'::regprocedure;
SELECT is(pg_get_userbyid(p.proowner)::text, 'ductus_identity', 'institution_courses belongs to ductus_identity')
FROM pg_proc p WHERE p.oid = 'institution.institution_courses(text)'::regprocedure;
SELECT is(p.proconfig, ARRAY['search_path=""'], 'institution_courses runs with an empty search_path')
FROM pg_proc p WHERE p.oid = 'institution.institution_courses(text)'::regprocedure;
SELECT is(p.provolatile::text, 's', 'institution_courses is STABLE, so it cannot write')
FROM pg_proc p WHERE p.oid = 'institution.institution_courses(text)'::regprocedure;
SELECT ok(has_function_privilege('ductus_app', p.oid, 'EXECUTE'), 'ductus_app may execute institution_courses')
FROM pg_proc p WHERE p.oid = 'institution.institution_courses(text)'::regprocedure;
SELECT ok(p.prosecdef, 'institution_academic_years is SECURITY DEFINER')
FROM pg_proc p WHERE p.oid = 'institution.institution_academic_years()'::regprocedure;
SELECT is(pg_get_userbyid(p.proowner)::text, 'ductus_identity', 'institution_academic_years belongs to ductus_identity')
FROM pg_proc p WHERE p.oid = 'institution.institution_academic_years()'::regprocedure;
SELECT is(p.proconfig, ARRAY['search_path=""'], 'institution_academic_years runs with an empty search_path')
FROM pg_proc p WHERE p.oid = 'institution.institution_academic_years()'::regprocedure;
SELECT is(p.provolatile::text, 's', 'institution_academic_years is STABLE, so it cannot write')
FROM pg_proc p WHERE p.oid = 'institution.institution_academic_years()'::regprocedure;
SELECT ok(has_function_privilege('ductus_app', p.oid, 'EXECUTE'), 'ductus_app may execute institution_academic_years')
FROM pg_proc p WHERE p.oid = 'institution.institution_academic_years()'::regprocedure;
SELECT is(pg_get_function_result('institution.institution_courses(text)'::regprocedure),
  'TABLE(kind text, course_id uuid, course_name text, group_id uuid, group_name text, user_id uuid, '
  || 'given_name text, family_name text, students integer)',
  'institution_courses returns facts with ids, labels, names and counts: no work, no time');
SELECT is(pg_get_function_identity_arguments('institution.institution_courses(text)'::regprocedure), 'p_academic_year text',
  'institution_courses takes the year alone: the institution comes from the session');
SELECT is(pg_get_function_result('institution.institution_academic_years()'::regprocedure),
  'TABLE(academic_year text)', 'institution_academic_years returns the years alone');
SELECT is(pg_get_function_identity_arguments('institution.institution_academic_years()'::regprocedure), '',
  'institution_academic_years takes no parameter');
SELECT is_empty(
  $$ SELECT r.rolname, f.f FROM (SELECT rolname::text FROM pg_roles
                                 WHERE rolname LIKE 'ductus\_%'
                                   AND rolname NOT IN ('ductus_app', 'ductus_identity', 'ductus_app_local')
                                 UNION ALL SELECT 'public') AS r (rolname)
     CROSS JOIN unnest(ARRAY['institution.institution_courses(text)', 'institution.institution_academic_years()']) AS f (f)
     WHERE has_function_privilege(r.rolname, f.f, 'EXECUTE') $$,
  'no role but ductus_app, its local login and the owner, nor PUBLIC, may execute either function'
);

-- No session, an expired, a closed and an unknown session: ZD401, before the
-- year is looked at.
SELECT is(pg_temp.courses(t, '2026/2027'), 'ZD401: not authenticated', 'courses: session "' || t || '" is refused with ZD401')
FROM unnest(ARRAY['anon', 'expired', 'closed', 'unknown']) AS t;
SELECT is(pg_temp.years(t), 'ZD401: not authenticated', 'years: session "' || t || '" is refused with ZD401')
FROM unnest(ARRAY['anon', 'expired', 'closed', 'unknown']) AS t;
SELECT is(pg_temp.courses('anon', NULL), 'ZD401: not authenticated', 'no session and no year: ZD401, not ZD422');

-- Students, teachers of both institutions (holder and group teacher
-- included), an unconfirmed teacher and a person without a role: ZD403.
SELECT is(pg_temp.courses(t, '2026/2027'), 'ZD403: forbidden', 'courses: ' || t || ' is refused with ZD403')
FROM unnest(ARRAY['ana', 'tomo', 'vesna', 'marko', 'petra', 'nina', 'boris']) AS t;
SELECT is(pg_temp.years(t), 'ZD403: forbidden', 'years: ' || t || ' is refused with ZD403')
FROM unnest(ARRAY['ana', 'tomo', 'vesna', 'petra']) AS t;
SELECT is(pg_temp.courses('vesna', 'nije godina'), 'ZD403: forbidden',
  'a malformed year from a non-administrator is ZD403: only an administrator learns it is malformed');

-- Each administrator reads their own institution: K1 with its holder, team
-- and groups, K2 with its teacher; K3 for Lea.
SELECT is(pg_temp.courses('iva', '2026/2027'),
  '9:course|k1|-|-|K1|-|2,group|k1|ga|-|Grupa A|-|1,group|k1|gb|-|Grupa B|-|0,group_teacher|k1|ga|marko|-|-|-,'
  || 'holder|k1|-|vesna|-|Ves Uzorak|-,team|k1|-|marko|-|-|-,team|k1|-|vesna|-|Ves Uzorak|-,'
  || 'course|k2|-|-|K2|-|0,team|k2|-|marko|-|-|-',
  'Iva reads K1 and K2 of fak-a: counts, holder, team, groups and the group teacher');
SELECT is(pg_temp.courses('lea', '2026/2027'),
  '3:course|k3|-|-|K3|-|1,group|k3|gk3|-|Grupa C|-|1,team|k3|-|petra|-|-|-',
  'Lea reads K3 of fak-b alone');
SELECT is(pg_temp.ask('iva', $q$ SELECT count(*)::text FROM institution.institution_courses('2026/2027') t
                                 WHERE t.user_id IN ({ana}, {dora}, {tomo}) OR t.given_name = 'An'
                                    OR t.group_id = {gk3} OR t.course_id = {k3} $q$), '0',
  'no student id or name, and nothing of fak-b, reaches Iva');
SELECT is(pg_temp.courses('iva', '2025/2026'), '1:course|k4|-|-|K4|-|0', 'Iva reads the one course of 2025/2026');
SELECT is(pg_temp.courses('iva', '2024/2025'), '0:', 'a year that has courses only at fak-b is empty for Iva');
SELECT is(pg_temp.courses('iva', '2030/2031'), '0:', 'a well-formed year without courses is empty');
SELECT is(pg_temp.years('iva'), '2026/2027,2025/2026', 'Iva''s years, newest first, each once');
SELECT is(pg_temp.years('lea'), '2026/2027,2024/2025', 'Lea''s years, newest first, each once');

-- The role is per institution, not per person; revoked or unconfirmed is no.
DO $$ BEGIN PERFORM institution.appoint_institution_admin(pg_temp.id('boris'), 'Zahtjev boris/2026'); END $$;
SELECT is(pg_temp.courses('boris', '2026/2027'), pg_temp.courses('iva', '2026/2027'),
  'a second administrator of fak-a reads what Iva reads');
DO $$ BEGIN PERFORM institution.revoke_institution_admin(pg_temp.id('boris'), 'Zahtjev boris/2026'); END $$;
SELECT is(pg_temp.courses('boris', '2026/2027'), 'ZD403: forbidden', 'a revoked administrator role is refused');
SELECT is(pg_temp.years('boris'), 'ZD403: forbidden', 'and gets no years');
INSERT INTO institution.institution_role (institution_id, user_id, role)
VALUES (pg_temp.id('fak_a'), pg_temp.id('nina'), 'admin');
SELECT is(pg_temp.courses('nina', '2026/2027'), 'ZD403: forbidden', 'an unconfirmed administrator role is refused');

-- Every malformed year is ZD422 for the administrator.
SELECT is(pg_temp.courses('iva', y), 'ZD422: invalid input', 'the year ' || coalesce(quote_literal(replace(y, E'\n', '\n')), 'NULL') || ' is ZD422')
FROM unnest(ARRAY[NULL, '', '2026-2027', '2026/27', '26/27', ' 2026/2027', '2026/2027 ', E'2026/2027\n',
                  $y$2026/2027' OR '1'='1$y$, '2026/2026', '2027/2026', '20260/20261']) AS y;

-- Istodobnost: each change between two reads shows in the next read, and no
-- one is counted twice. A revoked teacher role hides the group teacher.
UPDATE institution.institution_role SET revoked_at = now()
 WHERE user_id = pg_temp.id('marko') AND role = 'teacher';
SELECT is(pg_temp.courses('iva', '2026/2027'),
  '6:course|k1|-|-|K1|-|2,group|k1|ga|-|Grupa A|-|1,group|k1|gb|-|Grupa B|-|0,'
  || 'holder|k1|-|vesna|-|Ves Uzorak|-,team|k1|-|vesna|-|Ves Uzorak|-,course|k2|-|-|K2|-|0',
  'with his teacher role revoked Marko is neither a team member nor a group teacher (known limit)');
UPDATE institution.institution_role SET revoked_at = NULL
 WHERE user_id = pg_temp.id('marko') AND role = 'teacher';
SELECT is(pg_temp.run('vesna', $$ institution.end_group_assignment({ga}, {marko}) $$), 'ok',
  'Vesna ends Marko''s group assignment');
SELECT is(pg_temp.courses('iva', '2026/2027'),
  '7:course|k1|-|-|K1|-|2,group|k1|ga|-|Grupa A|-|1,group|k1|gb|-|Grupa B|-|0,'
  || 'holder|k1|-|vesna|-|Ves Uzorak|-,team|k1|-|vesna|-|Ves Uzorak|-,course|k2|-|-|K2|-|0,team|k2|-|marko|-|-|-',
  'group A has no teacher and Marko leaves the team of K1, not of K2');
SELECT is(pg_temp.run('vesna', $$ institution.assign_group_teacher({gb}, {marko}) $$), 'ok',
  'Marko now teaches group B');
SELECT is(pg_temp.ask('iva', $q$ SELECT string_agg(t.kind || '/' || coalesce(r.name, '-'), ',' ORDER BY t.kind, r.name)
                                 FROM institution.institution_courses('2026/2027') t
                                 LEFT JOIN ref r ON r.val = t.group_id::text
                                 WHERE t.user_id = {marko} AND t.course_id = {k1} $q$),
  'group_teacher/gb,team/-', 'Marko is once in the team of K1 and the teacher of group B alone');
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('ana');
SELECT is(pg_temp.ask('iva', $q$ SELECT string_agg(coalesce(r.name, t.course_name) || '=' || t.students, ',' ORDER BY t.kind, r.name)
                                 FROM institution.institution_courses('2026/2027') t
                                 LEFT JOIN ref r ON r.val = t.group_id::text
                                 WHERE t.course_id = {k1} AND t.students IS NOT NULL $q$),
  'K1=1,ga=0,gb=0', 'Ana left K1: K1 counts one student and group A none, though her group row is still open');

SELECT * FROM finish();
ROLLBACK;

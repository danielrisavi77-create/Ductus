-- DAN-51, M2.15-P02 (contract on #1091, c.6728959896): the read policies of
-- 20261108140000_actor_scope_initplan compute the actor's courses and
-- assignments once per statement, and every actor sees exactly the rows the
-- old per-row expressions let them see. Personas of institution.inc and
-- mentorship.inc; every person, course and work is invented.
--
--   Vesna teaches K1 (Z1), whose students are Ana and Dora; Marko teaches K2
--   (Z2) and mentors Ana (zm1); Vesna's mentorship of Dora (zm2) has ended;
--   Nina, unconfirmed, mentors Boris (zm3); Petra teaches K3 (Z3) to Tomo in
--   fak-b. Iva and Lea are administrators.
--
-- The old expressions stay below as text and are checked against the
-- installed ones three ways: the helpers id by id (3), the policies over a
-- synthetic cross product of every value their columns compare (4), and the
-- rows each actor reads through RLS (5). 3 to 5 run again after the scope of
-- three actors changes (6). The old helpers remain in the schema, so the old
-- text still evaluates after the migration.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
\ir fixtures/mentorship.inc
SELECT no_plan();

-- 1. Two helpers, each a set of ids of the calling session.
SELECT is(
  (SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || pg_get_function_result(p.oid)
          || ' ' || p.provolatile::text || CASE WHEN p.prosecdef THEN ' definer' ELSE '' END
          || ' ' || array_to_string(p.proconfig, ',') || ' ' || pg_get_userbyid(p.proowner)
          || CASE WHEN has_function_privilege('ductus_app', p.oid, 'EXECUTE') THEN ' app' ELSE '' END
          || CASE WHEN has_function_privilege('public', p.oid, 'EXECUTE') THEN ' public' ELSE '' END, ' | ' ORDER BY p.proname)
   FROM pg_proc p
   WHERE p.pronamespace = 'institution'::regnamespace AND p.proname IN ('actor_course_ids', 'actor_assignment_ids')),
  'actor_assignment_ids(p_roles text[]) uuid[] s definer search_path="" ductus_identity app'
  ' | actor_course_ids(p_roles text[]) uuid[] s definer search_path="" ductus_identity app',
  'both helpers are stable definers of ductus_identity with an empty search_path, for ductus_app and not PUBLIC'
);

-- 2. The installed policies: no helper with a row's column runs per row.
CREATE TEMP TABLE old_qual (tbl text PRIMARY KEY, qual text NOT NULL);
INSERT INTO old_qual VALUES
  ('assignment', $q$(institution_id = (SELECT app.current_institution_id())) AND (institution.actor_assignment_role(id) IS NOT NULL)$q$),
  ('assignment_version', $q$institution.actor_assignment_role(assignment_id) IS NOT NULL$q$),
  ('course', $q$institution.actor_course_role(id) IS NOT NULL$q$),
  ('course_editor', $q$(user_id = (SELECT app.current_user_id())) OR (institution.actor_course_role(course_id) = 'teacher')$q$),
  ('course_enrollment_code', $q$institution.actor_course_role(course_id) = 'teacher'$q$),
  ('course_holder', $q$(user_id = (SELECT app.current_user_id())) OR (institution.actor_course_role(course_id) = 'teacher')$q$),
  ('course_member', $q$(user_id = (SELECT app.current_user_id())) OR (institution.actor_course_role(course_id) = 'teacher')
     OR ((role = 'teacher') AND (member_to IS NULL) AND (institution.actor_course_role(course_id) IS NOT NULL))$q$),
  ('notice_acknowledgment', $q$(institution_id = (SELECT app.current_institution_id()))
     AND ((institution.actor_assignment_role(assignment_id) = 'teacher')
          OR ((student_id = (SELECT app.current_user_id())) AND (institution.actor_assignment_role(assignment_id) = 'student')))$q$),
  ('seminar_group', $q$institution.actor_course_role(course_id) = 'teacher'$q$),
  ('seminar_group_member', $q$(user_id = (SELECT app.current_user_id())) OR (institution.actor_course_role(course_id) = 'teacher')$q$),
  ('seminar_group_teacher', $q$(user_id = (SELECT app.current_user_id())) OR (institution.actor_course_role(course_id) = 'teacher')$q$),
  ('team_substitution', $q$(absent_id = (SELECT app.current_user_id())) OR (substitute_id = (SELECT app.current_user_id()))
     OR (institution.actor_course_role(course_id) = 'teacher')$q$),
  ('work_grant', $q$(institution_id = (SELECT app.current_institution_id()))
     AND ((grantee_id = (SELECT app.current_user_id())) OR (student_id = (SELECT app.current_user_id()))
          OR (institution.actor_assignment_role(assignment_id) = 'teacher'))$q$),
  ('work_language_override', $q$(institution_id = (SELECT app.current_institution_id()))
     AND ((student_id = (SELECT app.current_user_id())) OR (institution.actor_assignment_role(assignment_id) = 'teacher'))$q$);
GRANT SELECT ON old_qual TO PUBLIC;

SELECT is(
  (SELECT string_agg(p.tablename || '.' || p.cmd || '.' || array_to_string(p.roles, ','), ' ' ORDER BY p.tablename)
   FROM pg_policies p JOIN old_qual o ON o.tbl = p.tablename
   WHERE p.schemaname = 'institution' AND p.policyname = p.tablename || '_read' AND p.permissive = 'PERMISSIVE'),
  (SELECT string_agg(tbl || '.SELECT.ductus_app', ' ' ORDER BY tbl) FROM old_qual),
  'each of the 14 tables keeps one permissive SELECT policy for ductus_app'
);
SELECT is(
  (SELECT string_agg(p.policyname, ', ' ORDER BY p.policyname) FROM pg_policies p
   WHERE p.schemaname = 'institution' AND (p.qual ~ 'actor_(course|assignment)_role\(' OR p.with_check ~ 'actor_(course|assignment)_role\(')),
  NULL,
  'no policy calls actor_course_role or actor_assignment_role any more'
);
SELECT is(
  (SELECT count(*) FROM pg_policies p JOIN old_qual o ON o.tbl = p.tablename
   WHERE p.schemaname = 'institution' AND p.policyname = p.tablename || '_read'
     AND p.qual ~ '= ANY \(\( SELECT institution\.actor_(course|assignment)_ids\('),
  14::bigint,
  'every one of the 14 policies compares with the helper inside its own SELECT, an initplan'
);
-- Each call is the whole scalar subquery of ANY, cast to uuid[], so it is the
-- array form (one array per statement), not ANY (subquery) over the rows.
SELECT is(
  (SELECT string_agg(p.policyname, ', ' ORDER BY p.policyname) FROM pg_policies p
   WHERE p.schemaname = 'institution'
     AND (SELECT count(*) FROM regexp_matches(p.qual, 'actor_(course|assignment)_ids\(', 'g'))
      <> (SELECT count(*) FROM regexp_matches(p.qual,
            '= ANY \(\( SELECT institution\.actor_(course|assignment)_ids\(''\{[a-z,]+\}''::text\[\]\) AS actor_\1_ids\)::uuid\[\]\)', 'g'))),
  NULL,
  'every helper call is the whole scalar subquery of ANY, cast to uuid[]'
);
-- Every call of an app or institution function in any policy of the schema
-- sits right after SELECT (an initplan), except the one reader that is out of
-- scope and named in the migration.
SELECT is(
  (SELECT string_agg(DISTINCT m[1], ', ')
   FROM pg_policies p, regexp_matches(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
                                      '(?<!SELECT )((?:app|institution)\.[a-z_]+)\(', 'g') AS m
   WHERE p.schemaname IN ('institution', 'identity', 'evidence', 'collaboration', 'audit')),
  'institution.work_accommodation',
  'besides work_accommodation_read, no policy calls a function of a row'
);

-- 3. The helpers against the old ones: every actor, every course and
-- assignment of the fixtures, an id of nothing and NULL, every set of roles.
CREATE TEMP TABLE scope_id (kind text NOT NULL, id uuid);
INSERT INTO scope_id
SELECT 'course', pg_temp.id(n) FROM unnest(ARRAY['k1', 'k2', 'k3', 'nobody']) n
UNION ALL SELECT 'course', NULL
UNION ALL SELECT 'assignment', pg_temp.id(n) FROM unnest(ARRAY['z1', 'z2', 'z3', 'zm1', 'zm2', 'zm3', 'nobody']) n
UNION ALL SELECT 'assignment', NULL;
GRANT SELECT ON scope_id TO PUBLIC;

-- "differing/matching": pairs where old and new disagree, and pairs where both hold.
CREATE FUNCTION pg_temp.helper_diff(p_actor text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, $s$
    SELECT count(*) FILTER (WHERE o IS DISTINCT FROM n) || '/' || count(*) FILTER (WHERE o AND n)
    FROM (
      SELECT coalesce(CASE i.kind WHEN 'course' THEN institution.actor_course_role(i.id)
                                  ELSE institution.actor_assignment_role(i.id) END = ANY (r.roles), false) AS o,
             coalesce(i.id = ANY (CASE i.kind WHEN 'course' THEN institution.actor_course_ids(r.roles)
                                              ELSE institution.actor_assignment_ids(r.roles) END), false) AS n
      FROM scope_id i
      CROSS JOIN (VALUES ('{teacher}'::text[]), ('{student}'), ('{teacher,student}')) AS r (roles)
    ) x $s$)
$$;

-- The names of the ids a helper returns for one actor.
CREATE FUNCTION pg_temp.scope(p_actor text, p_helper text, p_roles text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    'SELECT coalesce(string_agg(r.name, '','' ORDER BY r.name), ''-'') FROM ref r WHERE r.val::uuid = ANY (institution.%I(%L))',
    p_helper, p_roles))
$$;

SELECT is(pg_temp.scope(s.actor, s.helper, s.roles), s.expect, format('%s: %s(%s) is %s', s.actor, s.helper, s.roles, s.expect))
FROM (VALUES
  ('vesna', 'actor_course_ids', '{teacher}', 'k1'),
  ('vesna', 'actor_course_ids', '{student}', '-'),
  ('ana', 'actor_course_ids', '{teacher,student}', 'k1'),
  ('ana', 'actor_assignment_ids', '{student}', 'z1,zm1'),
  ('dora', 'actor_assignment_ids', '{teacher,student}', 'z1'),
  ('marko', 'actor_assignment_ids', '{teacher}', 'z2,zm1'),
  ('nina', 'actor_assignment_ids', '{teacher,student}', '-'),
  ('boris', 'actor_assignment_ids', '{student}', 'zm3'),
  ('petra', 'actor_assignment_ids', '{teacher}', 'z3'),
  ('iva', 'actor_course_ids', '{teacher,student}', '-'),
  ('expired', 'actor_course_ids', '{teacher,student}', '-'),
  ('anon', 'actor_assignment_ids', '{teacher,student}', '-')
) AS s (actor, helper, roles, expect);

-- 4. The policies over synthetic rows: per table, every combination of the
-- values its policy compares (ids of the fixtures, an id of nothing, NULL),
-- plus the real rows. Other columns stay NULL; the copies have no constraint.
CREATE TEMP TABLE val (kind text NOT NULL, v text);
INSERT INTO val
SELECT 'course', pg_temp.id(n)::text FROM unnest(ARRAY['k1', 'k2', 'k3', 'nobody']) n
UNION ALL SELECT 'assignment', pg_temp.id(n)::text FROM unnest(ARRAY['z1', 'z2', 'z3', 'zm1', 'zm2', 'zm3', 'nobody']) n
UNION ALL SELECT 'person', id::text FROM person
UNION ALL SELECT 'institution', pg_temp.id(n)::text FROM unnest(ARRAY['fak_a', 'fak_b']) n
UNION ALL SELECT 'role', unnest(ARRAY['teacher', 'student'])
UNION ALL SELECT 'member_to', now()::text
UNION ALL SELECT k, NULL FROM unnest(ARRAY['course', 'assignment', 'person', 'institution', 'member_to']) k;

CREATE TEMP TABLE syn_col (tbl text NOT NULL, col text NOT NULL, kind text NOT NULL);
INSERT INTO syn_col VALUES
  ('assignment', 'id', 'assignment'), ('assignment', 'institution_id', 'institution'),
  ('assignment_version', 'assignment_id', 'assignment'),
  ('course', 'id', 'course'),
  ('course_editor', 'user_id', 'person'), ('course_editor', 'course_id', 'course'),
  ('course_enrollment_code', 'course_id', 'course'),
  ('course_holder', 'user_id', 'person'), ('course_holder', 'course_id', 'course'),
  ('course_member', 'user_id', 'person'), ('course_member', 'course_id', 'course'),
  ('course_member', 'role', 'role'), ('course_member', 'member_to', 'member_to'),
  ('notice_acknowledgment', 'institution_id', 'institution'), ('notice_acknowledgment', 'assignment_id', 'assignment'),
  ('notice_acknowledgment', 'student_id', 'person'),
  ('seminar_group', 'course_id', 'course'),
  ('seminar_group_member', 'user_id', 'person'), ('seminar_group_member', 'course_id', 'course'),
  ('seminar_group_teacher', 'user_id', 'person'), ('seminar_group_teacher', 'course_id', 'course'),
  ('team_substitution', 'absent_id', 'person'), ('team_substitution', 'substitute_id', 'person'),
  ('team_substitution', 'course_id', 'course'),
  ('work_grant', 'institution_id', 'institution'), ('work_grant', 'assignment_id', 'assignment'),
  ('work_grant', 'student_id', 'person'), ('work_grant', 'grantee_id', 'person'),
  ('work_language_override', 'institution_id', 'institution'), ('work_language_override', 'assignment_id', 'assignment'),
  ('work_language_override', 'student_id', 'person');

DO $$
DECLARE
  t text;
  v_cols text;
  v_vals text;
  v_from text;
BEGIN
  FOR t IN SELECT tbl FROM old_qual LOOP
    EXECUTE format('CREATE TEMP TABLE %I AS SELECT * FROM institution.%I WITH NO DATA', 'syn_' || t, t);
    SELECT string_agg(format('%I', c.col), ', ' ORDER BY c.col),
           string_agg(format('v%s.v::%s', c.n, format_type(a.atttypid, a.atttypmod)), ', ' ORDER BY c.col),
           string_agg(format('(SELECT v FROM val WHERE kind = %L) v%s', c.kind, c.n), ' CROSS JOIN ' ORDER BY c.col)
      INTO v_cols, v_vals, v_from
      FROM (SELECT s.*, row_number() OVER () AS n FROM syn_col s WHERE s.tbl = t) c
      JOIN pg_attribute a ON a.attrelid = format('institution.%I', t)::regclass AND a.attname = c.col;
    EXECUTE format('INSERT INTO %I (%s) SELECT %s FROM %s', 'syn_' || t, v_cols, v_vals, v_from);
    EXECUTE format('INSERT INTO %I SELECT * FROM institution.%I', 'syn_' || t, t);
    EXECUTE format('GRANT SELECT ON %I TO PUBLIC', 'syn_' || t);
  END LOOP;
END
$$;

SELECT is(
  (SELECT string_agg(format('%s=%s', o.tbl, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', 'syn_' || o.tbl), false, true, '')))[1]), ' ' ORDER BY o.tbl)
   FROM old_qual o),
  'assignment=30 assignment_version=15 course=8 course_editor=55 course_enrollment_code=9 course_holder=55'
  ' course_member=226 notice_acknowledgment=270 seminar_group=5 seminar_group_member=55 seminar_group_teacher=55'
  ' team_substitution=605 work_grant=2904 work_language_override=264',
  'the synthetic copies hold the cross products and the real rows'
);

-- "differing/visible" for one actor on one table: rows where the old and the
-- installed expression disagree on whether the row is visible, and rows the
-- installed one shows. Only TRUE shows a row, so NULL and false are one.
CREATE FUNCTION pg_temp.policy_diff(p_actor text, p_tbl text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    'SELECT count(*) FILTER (WHERE ((%1$s) IS TRUE) <> ((%2$s) IS TRUE)) || ''/'' || count(*) FILTER (WHERE (%2$s) IS TRUE) FROM %3$I',
    o.qual, p.qual, 'syn_' || p_tbl))
  FROM old_qual o
  JOIN pg_policies p ON p.schemaname = 'institution' AND p.tablename = o.tbl AND p.policyname = o.tbl || '_read'
  WHERE o.tbl = p_tbl
$$;

-- 5. Through RLS: what each actor reads of the real table equals the rows of
-- a snapshot (taken by the test's own role) that the old expression keeps.
CREATE FUNCTION pg_temp.snapshot() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tbl FROM old_qual LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I', 'real_' || t);
    EXECUTE format('CREATE TEMP TABLE %I AS SELECT * FROM institution.%I', 'real_' || t, t);
    EXECUTE format('GRANT SELECT ON %I TO PUBLIC', 'real_' || t);
  END LOOP;
END
$$;

-- Rows are compared on the columns ductus_app may read (course_enrollment_code
-- keeps code_hash from it).
CREATE FUNCTION pg_temp.rls_diff(p_actor text, p_tbl text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    'SELECT (SELECT count(*) FROM ((SELECT ROW(%4$s)::text FROM institution.%1$I s EXCEPT ALL SELECT ROW(%4$s)::text FROM %2$I s WHERE %3$s)'
    ' UNION ALL (SELECT ROW(%4$s)::text FROM %2$I s WHERE %3$s EXCEPT ALL SELECT ROW(%4$s)::text FROM institution.%1$I s)) d)'
    ' || ''/'' || (SELECT count(*) FROM institution.%1$I)',
    p_tbl, 'real_' || p_tbl, o.qual,
    (SELECT string_agg('s.' || quote_ident(a.attname), ', ' ORDER BY a.attnum)
     FROM pg_attribute a
     WHERE a.attrelid = ('institution.' || p_tbl)::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND has_column_privilege('ductus_app', a.attrelid, a.attnum, 'SELECT'))))
  FROM old_qual o WHERE o.tbl = p_tbl
$$;

-- Runs 3 to 5 for every actor and returns what differs, or NULL; and how many
-- rows were visible in 4 and 5 in all, so that "nothing differs" is not empty.
CREATE TEMP TABLE run (phase text NOT NULL, check_name text NOT NULL, actor text NOT NULL, tbl text, result text);
CREATE FUNCTION pg_temp.run_all(p_phase text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.snapshot();
  INSERT INTO run SELECT p_phase, 'helpers', t.name, NULL, pg_temp.helper_diff(t.name) FROM tok t;
  INSERT INTO run SELECT p_phase, 'policies', t.name, o.tbl, pg_temp.policy_diff(t.name, o.tbl) FROM tok t CROSS JOIN old_qual o;
  INSERT INTO run SELECT p_phase, 'rls', t.name, o.tbl, pg_temp.rls_diff(t.name, o.tbl) FROM tok t CROSS JOIN old_qual o;
END
$$;

SELECT pg_temp.run_all('A');
SELECT is(
  (SELECT string_agg(format('%s %s %s: %s', check_name, actor, tbl, result), '; ') FROM run
   WHERE phase = 'A' AND (result IS NULL OR result !~ '^0/\d+$')),
  NULL,
  'phase A: for every actor the helpers, the policies and RLS agree with the old expressions'
);
SELECT is(
  (SELECT string_agg(format('%s=%s', check_name, s), ' ' ORDER BY check_name) FROM (
     SELECT check_name, sum(split_part(result, '/', 2)::bigint) AS s FROM run
     WHERE phase = 'A' AND result ~ '^\d+/\d+$' GROUP BY check_name) x),
  'helpers=30 policies=4352 rls=53',
  'phase A is not empty: the same rows as before are visible in all'
);

-- 6. Phase B: Dora leaves K1, Marko's teacher role is revoked, Vesna is also
-- a student of K2, and Boris's mentorship ends. Then 3 to 5 again.
UPDATE institution.course_member SET member_to = now()
WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('dora');
UPDATE institution.institution_role SET revoked_at = now()
WHERE user_id = pg_temp.id('marko') AND role = 'teacher';
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k2'), pg_temp.id('fak_a'), pg_temp.id('vesna'), 'student');
UPDATE institution.mentorship SET ended_at = now() WHERE id = pg_temp.id('ms3');

SELECT is(pg_temp.scope(s.actor, s.helper, s.roles), s.expect, format('phase B, %s: %s(%s) is %s', s.actor, s.helper, s.roles, s.expect))
FROM (VALUES
  ('vesna', 'actor_course_ids', '{teacher}', 'k1'),
  ('vesna', 'actor_course_ids', '{student}', 'k2'),
  ('vesna', 'actor_assignment_ids', '{teacher,student}', 'z1,z2'),
  ('dora', 'actor_assignment_ids', '{teacher,student}', '-'),
  ('marko', 'actor_assignment_ids', '{teacher,student}', '-'),
  ('boris', 'actor_assignment_ids', '{teacher,student}', '-')
) AS s (actor, helper, roles, expect);

SELECT pg_temp.run_all('B');
SELECT is(
  (SELECT string_agg(format('%s %s %s: %s', check_name, actor, tbl, result), '; ') FROM run
   WHERE phase = 'B' AND (result IS NULL OR result !~ '^0/\d+$')),
  NULL,
  'phase B: after the changes of scope the helpers, the policies and RLS still agree with the old expressions'
);
SELECT isnt(
  (SELECT string_agg(result, ',' ORDER BY actor, check_name, tbl) FROM run WHERE phase = 'B'),
  (SELECT string_agg(result, ',' ORDER BY actor, check_name, tbl) FROM run WHERE phase = 'A'),
  'phase B sees other rows than phase A, so the changes reached the helpers'
);

-- 7. The session is read a fixed number of times per statement, whatever
-- the number of rows: five more students of K2 change no count.
SET LOCAL track_functions = 'all';
CREATE FUNCTION pg_temp.actor_calls(p_actor text, p_sql text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_before bigint := coalesce(pg_stat_get_xact_function_calls('app.current_actor'::regproc), 0);
BEGIN
  PERFORM pg_temp.ask(p_actor, p_sql);
  RETURN coalesce(pg_stat_get_xact_function_calls('app.current_actor'::regproc), 0) - v_before;
END
$$;
CREATE TEMP TABLE calls AS
SELECT o.tbl, pg_temp.actor_calls('vesna', format('SELECT count(*) FROM institution.%I', o.tbl)) AS n FROM old_qual o;

INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
SELECT gen_random_uuid(), pg_temp.id('fak_a'), 'https://issuer.test', 'sub-extra-' || g, 'extra' || g || '@a.example'
FROM generate_series(1, 5) g;
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
SELECT pg_temp.id('k2'), pg_temp.id('fak_a'), u.id, 'student'
FROM identity.user_account u WHERE u.oidc_subject LIKE 'sub-extra-%';

SELECT is(
  pg_temp.actor_calls('vesna', 'SELECT count(*) FROM institution.course_member'),
  (SELECT n FROM calls WHERE tbl = 'course_member'),
  'reading course_member reads the session as often with five more rows in it'
);
SELECT ok(
  (SELECT max(n) <= 5 FROM calls),
  'no read of the 14 tables reads the session more than five times'
);

-- 8. The plans: the scope is an InitPlan, and no helper of a row is left.
CREATE FUNCTION pg_temp.plan(p_actor text, p_tbl text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_plan text := '';
  r record;
BEGIN
  PERFORM set_config('app.session_token', (SELECT token FROM tok WHERE name = p_actor), true);
  SET LOCAL ROLE ductus_app;
  FOR r IN EXECUTE format('EXPLAIN (COSTS OFF) SELECT count(*) FROM institution.%I', p_tbl) LOOP
    v_plan := v_plan || r."QUERY PLAN" || E'\n';
  END LOOP;
  RESET ROLE;
  PERFORM set_config('app.session_token', '', true);
  RETURN v_plan;
END
$$;
SELECT is(
  (SELECT string_agg(o.tbl, ', ' ORDER BY o.tbl) FROM old_qual o
   WHERE pg_temp.plan('vesna', o.tbl) !~ 'InitPlan' OR pg_temp.plan('vesna', o.tbl) ~ 'actor_(course|assignment)_role'),
  NULL,
  'every plan of the 14 tables holds an InitPlan and calls no actor_*_role'
);

-- 9. Istodobnost: one prepared statement with a generic plan, reused by
-- other sessions and after the scope changes, never keeps an earlier scope.
SELECT token AS tok_vesna FROM tok WHERE name = 'vesna' \gset
SELECT token AS tok_petra FROM tok WHERE name = 'petra' \gset
SET LOCAL plan_cache_mode = force_generic_plan;
SET LOCAL ROLE ductus_app;
PREPARE scope_cm AS SELECT count(*) FROM institution.course_member;
SELECT set_config('app.session_token', :'tok_vesna', true);
EXECUTE scope_cm \gset s1_
SELECT set_config('app.session_token', :'tok_petra', true);
EXECUTE scope_cm \gset s2_
SELECT set_config('app.session_token', '', true);
EXECUTE scope_cm \gset s3_
RESET ROLE;
UPDATE institution.course_member SET member_to = now()
WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('vesna');
SET LOCAL ROLE ductus_app;
SELECT set_config('app.session_token', :'tok_vesna', true);
EXECUTE scope_cm \gset s4_
RESET ROLE;
UPDATE identity.session SET closed_at = now(), close_reason = 'logout' WHERE user_id = pg_temp.id('vesna');
SET LOCAL ROLE ductus_app;
EXECUTE scope_cm \gset s5_
SELECT set_config('app.session_token', '', true);
RESET ROLE;

SELECT is(
  format('%s %s %s %s %s', :'s1_count', :'s2_count', :'s3_count', :'s4_count', :'s5_count'),
  '5 2 0 3 0',
  'the same generic plan: Vesna 5 rows, then Petra 2, anonymous 0, Vesna out of K1 3, Vesna logged out 0'
);
SELECT ok(
  (SELECT generic_plans >= 5 AND custom_plans = 0 FROM pg_prepared_statements WHERE name = 'scope_cm'),
  'all five executions used the one generic plan'
);
DEALLOCATE scope_cm;

SELECT * FROM finish();
ROLLBACK;

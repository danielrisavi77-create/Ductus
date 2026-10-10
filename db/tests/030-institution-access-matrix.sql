-- Access matrix of the institution module (B-7 part 1; docs/ARCHITECTURE.md 3
-- and 7; plan of attack on issue #153, items 1 to 8, 10, 13 and 19).
-- Synthetic fixtures only (fixtures/institution.inc).
BEGIN;
\ir fixtures/institution.inc
-- Denials are told apart by their message below, so the language is fixed.
SET LOCAL lc_messages TO 'C';

SELECT plan(431);

-- 1. The catalogue. A table, policy, grant or function that is added later
-- changes one of these lists, so it cannot arrive without a row here.
SELECT bag_eq(
  $$ SELECT c.relname::text FROM pg_class c
     WHERE c.relnamespace = 'institution'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f') $$,
  ARRAY['institution_settings', 'institution_role', 'course', 'course_enrollment_code', 'course_member', 'enrollment_attempt'],
  'the institution schema holds exactly the six tables of this matrix'
);
SELECT is_empty(
  $$ SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'institution'::regnamespace AND c.relkind = 'r'
       AND NOT (c.relrowsecurity AND c.relforcerowsecurity AND c.relowner = 'ductus_identity'::regrole) $$,
  'every institution table has ENABLE and FORCE ROW LEVEL SECURITY and belongs to ductus_identity'
);
-- The privilege lists below name the group roles. has_*_privilege counts what a
-- role inherits, so a login that is a member of ductus_app (db/local/app-login.sql)
-- would appear with ductus_app's rows; they are left out here with NOT rolcanlogin,
-- and 010 checks every login (it may do nothing ductus_app may not, and holds no
-- grant of its own).
SELECT bag_eq(
  $$ SELECT r.rolname || ' ' || p.privilege || ' ' || c.relname
     FROM (SELECT rolname::text FROM pg_roles
           WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin AND rolname <> 'ductus_identity'
           UNION ALL SELECT 'public') AS r
     CROSS JOIN pg_class c
     CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p (privilege)
     WHERE c.relnamespace = 'institution'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
       AND (has_table_privilege(r.rolname, c.oid, p.privilege)
            OR (p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                AND has_any_column_privilege(r.rolname, c.oid, p.privilege))) $$,
  ARRAY[
    'ductus_app SELECT institution_settings',
    'ductus_app SELECT institution_role',
    'ductus_app SELECT course',
    'ductus_app SELECT course_enrollment_code',
    'ductus_app SELECT course_member'
  ],
  'besides the owner only ductus_app holds a privilege on an institution table, and only SELECT'
);
SELECT bag_eq(
  $$ SELECT a.attname::text FROM pg_attribute a
     WHERE a.attrelid = 'institution.course_enrollment_code'::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND NOT has_column_privilege('ductus_app', a.attrelid, a.attnum, 'SELECT') $$,
  ARRAY['code_hash'],
  'ductus_app may read every column of an enrolment code except its hash'
);
SELECT bag_eq(
  $$ SELECT tablename || ': ' || policyname || ' ' || cmd || ' to ' || array_to_string(roles, ',')
     FROM pg_policies WHERE schemaname = 'institution' $$,
  ARRAY[
    'institution_settings: institution_settings_owner ALL to ductus_identity',
    'institution_settings: institution_settings_read SELECT to ductus_app',
    'institution_role: institution_role_owner ALL to ductus_identity',
    'institution_role: institution_role_read SELECT to ductus_app',
    'course: course_owner ALL to ductus_identity',
    'course: course_read SELECT to ductus_app',
    'course_enrollment_code: course_enrollment_code_owner ALL to ductus_identity',
    'course_enrollment_code: course_enrollment_code_read SELECT to ductus_app',
    'course_member: course_member_owner ALL to ductus_identity',
    'course_member: course_member_read SELECT to ductus_app',
    'enrollment_attempt: enrollment_attempt_owner ALL to ductus_identity'
  ],
  'policies: the owner on every table, ductus_app for SELECT alone, nobody on enrollment_attempt'
);
SELECT bag_eq(
  $$ SELECT rolname::text FROM pg_roles
     WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin AND has_schema_privilege(rolname, 'institution', 'USAGE')
     UNION ALL SELECT 'public' WHERE has_schema_privilege('public', 'institution', 'USAGE') $$,
  ARRAY['ductus_app', 'ductus_identity', 'ductus_migrator'],
  'only ductus_app, the owner role and the migrator can use the institution schema'
);
SELECT bag_eq(
  $$ SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
            || CASE WHEN p.prosecdef THEN ' definer' ELSE '' END
            || CASE WHEN has_function_privilege('ductus_app', p.oid, 'EXECUTE') THEN ' app' ELSE '' END
     FROM pg_proc p WHERE p.pronamespace = 'institution'::regnamespace $$,
  ARRAY[
    'is_plain_label(p_text text)',
    'require_actor(OUT user_id uuid, OUT institution_id uuid)',
    'actor_has_role(p_role text) definer app',
    'actor_course_role(p_course_id uuid) definer app',
    'confirm_teacher_role(p_candidate_id uuid) definer app',
    'create_course(p_name text, p_academic_year text, p_ai_policy text) definer app',
    'create_enrollment_code(p_course_id uuid, p_valid_until timestamp with time zone) definer app',
    'revoke_enrollment_code(p_course_id uuid) definer app',
    'enroll_with_code(p_code text, OUT outcome text, OUT enrolled_course_id uuid) definer app'
  ],
  'functions: exact signatures, which are SECURITY DEFINER and which ductus_app may call'
);
SELECT is_empty(
  $$ SELECT r.rolname || ' may execute ' || p.proname
     FROM (SELECT rolname::text FROM pg_roles
           WHERE rolname LIKE 'ductus\_%' AND NOT rolcanlogin AND rolname NOT IN ('ductus_app', 'ductus_identity')
           UNION ALL SELECT 'public') AS r
     CROSS JOIN pg_proc p
     WHERE p.pronamespace = 'institution'::regnamespace AND has_function_privilege(r.rolname, p.oid, 'EXECUTE') $$,
  'no other role, nor PUBLIC, may execute an institution function'
);
SELECT is_empty(
  $$ SELECT p.proname FROM pg_proc p
     WHERE p.pronamespace = 'institution'::regnamespace
       AND (p.proowner <> 'ductus_identity'::regrole OR NOT coalesce('search_path=""' = ANY (p.proconfig), false)) $$,
  'every institution function belongs to the NOLOGIN owner role and pins an empty search_path'
);

-- 2. Role by table by operation, as it is migrated. Each cell runs the
-- statement as that role and reports why it stopped.
CREATE FUNCTION pg_temp.probe(p_role text, p_actor text, p_table text, p_op text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_column text;
  v_result text;
BEGIN
  SELECT attname INTO STRICT v_column FROM pg_attribute
   WHERE attrelid = ('institution.' || p_table)::regclass AND attnum = 1;
  v_result := pg_temp.ask_as(p_role, p_actor, CASE p_op
    WHEN 'SELECT' THEN format('SELECT ''rows='' || count(*) FROM institution.%I', p_table)
    WHEN 'INSERT' THEN format(
      'WITH x AS (INSERT INTO institution.%I DEFAULT VALUES RETURNING 1) SELECT ''rows='' || count(*) FROM x', p_table)
    WHEN 'UPDATE' THEN format(
      'WITH x AS (UPDATE institution.%I SET %I = DEFAULT RETURNING 1) SELECT ''rows='' || count(*) FROM x', p_table, v_column)
    WHEN 'DELETE' THEN format(
      'WITH x AS (DELETE FROM institution.%I RETURNING 1) SELECT ''rows='' || count(*) FROM x', p_table)
  END);
  RETURN CASE
    WHEN v_result LIKE '42501: permission denied for schema %' THEN 'no schema privilege'
    WHEN v_result LIKE '42501: permission denied for table %' THEN 'no table privilege'
    WHEN v_result LIKE '42501: new row violates row-level security policy %' THEN 'refused by RLS'
    ELSE v_result
  END;
END
$$;

CREATE TEMP TABLE cell AS
SELECT r.role, t.tbl, o.op, r.n AS role_n, t.n AS tbl_n, o.n AS op_n
FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence',
                  'ductus_migrator', 'ductus_test_stranger']) WITH ORDINALITY AS r (role, n)
CROSS JOIN unnest(ARRAY['institution_settings', 'institution_role', 'course', 'course_enrollment_code',
                        'course_member', 'enrollment_attempt']) WITH ORDINALITY AS t (tbl, n)
CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) WITH ORDINALITY AS o (op, n);

SELECT is(
  pg_temp.probe(role, 'anon', tbl, op),
  CASE WHEN role = 'ductus_app' AND op = 'SELECT' AND tbl <> 'enrollment_attempt' THEN 'rows=0'
       WHEN role IN ('ductus_app', 'ductus_migrator') THEN 'no table privilege'
       ELSE 'no schema privilege' END,
  format('%s: %s on %s', role, op, tbl)
)
FROM cell ORDER BY role_n, tbl_n, op_n;

-- The owner role holds every privilege and, with RLS forced, reads through
-- its own policy. It cannot log in; only the functions act as it.
SELECT ok(
  has_table_privilege('ductus_identity', ('institution.' || tbl)::regclass, op),
  format('ductus_identity (owner): %s on %s', op, tbl)
)
FROM cell WHERE role = 'ductus_app' ORDER BY tbl_n, op_n;
SELECT is(
  pg_temp.ask_as('ductus_identity', 'anon', 'SELECT count(*) FROM institution.course'), '3',
  'ductus_identity reads through the owner policy'
);

-- 3. Who sees what through ductus_app. One line per actor: every row the
-- session can read in the five readable tables.
CREATE FUNCTION pg_temp.sees(p_actor text) RETURNS text
LANGUAGE sql AS $f$
  SELECT pg_temp.ask(p_actor, $q$
    SELECT concat_ws(' | ',
      'courses: ' || coalesce((SELECT string_agg(c.name, ' ' ORDER BY c.name) FROM institution.course c), '-'),
      'members: ' || coalesce((
        SELECT string_agg(k.name || '.' || p.name || CASE WHEN m.member_to IS NULL THEN '' ELSE '(ended)' END,
                          ' ' ORDER BY k.name, p.name)
        FROM institution.course_member m
        JOIN ref k ON k.val = m.course_id::text
        JOIN person p ON p.id = m.user_id), '-'),
      'codes: ' || (SELECT count(*) FROM institution.course_enrollment_code),
      'roles: ' || coalesce((
        SELECT string_agg(p.name || '.' || r.role, ' ' ORDER BY p.name)
        FROM institution.institution_role r JOIN person p ON p.id = r.user_id), '-'),
      'settings: ' || coalesce((SELECT string_agg(s.display_name, ' ') FROM institution.institution_settings s), '-'))
  $q$)
$f$;

SELECT is(pg_temp.sees(v.actor), v.expected, v.actor || ': ' || v.note)
FROM (VALUES
  (1, 'vesna', 'courses: K1 | members: k1.ana k1.dora k1.vesna | codes: 2 | roles: - | settings: -',
   'teacher of K1 sees K1, all its members and its codes'),
  (2, 'marko', 'courses: K2 | members: k2.marko | codes: 1 | roles: - | settings: -',
   'teacher of another course sees nothing of K1'),
  (3, 'ana', 'courses: K1 | members: k1.ana k1.vesna | codes: 0 | roles: - | settings: -',
   'student sees the course, the teacher and the own membership, not Dora and no code'),
  (4, 'dora', 'courses: K1 | members: k1.dora k1.vesna | codes: 0 | roles: - | settings: -',
   'the other student likewise does not see Ana'),
  (5, 'boris', 'courses: - | members: - | codes: 0 | roles: - | settings: -',
   'student of the same institution outside K1 sees nothing'),
  (6, 'nina', 'courses: - | members: - | codes: 0 | roles: - | settings: -',
   'unconfirmed teacher role opens nothing, not even the own role row'),
  (7, 'iva', 'courses: - | members: - | codes: 0 | roles: iva.admin marko.teacher nina.teacher vesna.teacher | settings: Fakultet A (test)',
   'administrator sees roles and settings of the own institution, no course and no member'),
  (8, 'lea', 'courses: - | members: - | codes: 0 | roles: lea.admin petra.teacher | settings: Fakultet B (test)',
   'administrator of another institution sees nothing of fak-a'),
  (9, 'petra', 'courses: K3 | members: k3.petra k3.tomo | codes: 1 | roles: - | settings: -',
   'teacher at another institution sees only K3'),
  (10, 'tomo', 'courses: K3 | members: k3.petra k3.tomo | codes: 0 | roles: - | settings: -',
   'student at another institution sees only K3'),
  (11, 'anon', 'courses: - | members: - | codes: 0 | roles: - | settings: -', 'no session sees nothing'),
  (12, 'expired', 'courses: - | members: - | codes: 0 | roles: - | settings: -', 'expired session of Ana sees nothing'),
  (13, 'closed', 'courses: - | members: - | codes: 0 | roles: - | settings: -', 'closed session of Ana sees nothing'),
  (14, 'unknown', 'courses: - | members: - | codes: 0 | roles: - | settings: -', 'token of no session sees nothing')
) AS v (n, actor, expected, note)
ORDER BY v.n;

-- The answer for a course one may not see is the answer for no course.
SELECT is(
  pg_temp.ask('boris', $$ SELECT count(*) FROM institution.course WHERE id = {k1} $$),
  pg_temp.ask('boris', $$ SELECT count(*) FROM institution.course WHERE id = {nobody} $$),
  'Boris: K1 by id reads the same as a course that does not exist'
);
SELECT is(
  pg_temp.ask('boris', $$ SELECT coalesce(institution.actor_course_role({k1}), 'null') $$),
  pg_temp.ask('boris', $$ SELECT coalesce(institution.actor_course_role({nobody}), 'null') $$),
  'Boris: actor_course_role is null for K1 and for a course that does not exist alike'
);
SELECT is(
  pg_temp.ask(v.actor, $$ SELECT concat_ws(' ', coalesce(institution.actor_course_role({k1}), 'null'),
                                 institution.actor_has_role('teacher')::text,
                                 institution.actor_has_role('admin')::text) $$),
  v.expected, v.actor || ': part in K1, teacher role, administrator role'
)
FROM (VALUES
  (1, 'vesna', 'teacher true false'), (2, 'ana', 'student false false'), (3, 'marko', 'null true false'),
  (4, 'iva', 'null false true'), (5, 'nina', 'null false false'), (6, 'lea', 'null false true'),
  (7, 'anon', 'null false false'), (8, 'expired', 'null false false'), (9, 'closed', 'null false false')
) AS v (n, actor, expected)
ORDER BY v.n;
SELECT is(
  pg_temp.ask('vesna', 'SELECT encode(code_hash, ''hex'') FROM institution.course_enrollment_code LIMIT 1'),
  '42501: permission denied for table course_enrollment_code',
  'Vesna: the hash of her own course''s code is not readable'
);

-- 4. Nobody raises the own role or writes a table directly (plan 10 and 13).
SELECT is(
  pg_temp.ask('ana', $$ UPDATE institution.course_member SET role = 'teacher' WHERE user_id = {ana} $$),
  '42501: permission denied for table course_member', 'Ana cannot make herself a teacher of K1'
);
SELECT is(
  pg_temp.ask('ana', $$ INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at)
                        VALUES ({fak_a}, {ana}, 'teacher', now()) $$),
  '42501: permission denied for table institution_role', 'Ana cannot give herself the teacher role'
);
SELECT is(
  pg_temp.ask('boris', $$ INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
                          VALUES ({k1}, {fak_a}, {boris}, 'student') $$),
  '42501: permission denied for table course_member', 'Boris cannot add himself to K1 without the code'
);
SELECT is(
  pg_temp.ask('vesna', $$ DELETE FROM institution.course_member WHERE user_id = {ana} $$),
  '42501: permission denied for table course_member', 'Vesna cannot delete a membership row; history stays'
);

-- 5. Removal works at once: no cached decision (plan 19).
UPDATE institution.course_member SET member_to = now() WHERE user_id = pg_temp.id('ana');
SELECT is(
  pg_temp.sees('ana'), 'courses: - | members: k1.ana(ended) | codes: 0 | roles: - | settings: -',
  'unenrolled student: K1 and its teacher are gone at once; only the own ended membership remains'
);
SELECT is(
  pg_temp.sees('vesna'), 'courses: K1 | members: k1.ana(ended) k1.dora k1.vesna | codes: 2 | roles: - | settings: -',
  'the teacher still sees the ended membership'
);
UPDATE institution.course_member SET member_to = now() WHERE user_id = pg_temp.id('vesna');
SELECT is(
  pg_temp.sees('vesna'), 'courses: - | members: k1.vesna(ended) | codes: 0 | roles: - | settings: -',
  'removed teacher: course, members and codes are gone at once'
);
SELECT is(
  pg_temp.sees('dora'), 'courses: K1 | members: k1.dora | codes: 0 | roles: - | settings: -',
  'a student no longer sees the removed teacher'
);
UPDATE institution.institution_role SET revoked_at = now() WHERE user_id = pg_temp.id('marko');
SELECT is(
  pg_temp.sees('marko'), 'courses: - | members: k2.marko | codes: 0 | roles: - | settings: -',
  'teacher whose role the institution revoked: an open membership alone opens nothing'
);
UPDATE institution.institution_role SET revoked_at = now() WHERE user_id = pg_temp.id('iva');
SELECT is(
  pg_temp.sees('iva'), 'courses: - | members: - | codes: 0 | roles: - | settings: -',
  'administrator whose role was revoked sees nothing'
);

-- 6. Grants by mistake (docs/TESTING.md 5). Every role gets the schema and
-- every privilege on every table; what still holds is RLS itself. Vesna is
-- made a teacher of K1 again so that her session has rows to aim at.
UPDATE institution.course_member SET member_to = NULL WHERE user_id = pg_temp.id('vesna');
GRANT USAGE ON SCHEMA institution
  TO ductus_app, ductus_worker, ductus_retention, ductus_auth, ductus_evidence, ductus_migrator, ductus_test_stranger;
GRANT ALL ON ALL TABLES IN SCHEMA institution
  TO ductus_app, ductus_worker, ductus_retention, ductus_auth, ductus_evidence, ductus_migrator, ductus_test_stranger;

SELECT is(
  pg_temp.probe(role, 'anon', tbl, op),
  CASE op WHEN 'INSERT' THEN 'refused by RLS' ELSE 'rows=0' END,
  format('mistaken grant, %s: %s on %s', role, op, tbl)
)
FROM cell ORDER BY role_n, tbl_n, op_n;
SELECT is(
  pg_temp.probe('ductus_app', 'boris', tbl, 'SELECT'), 'rows=0',
  format('mistaken grant, Boris: SELECT on %s still returns no row', tbl)
)
FROM cell WHERE role = 'ductus_app' AND op = 'SELECT' ORDER BY tbl_n;
SELECT is(
  pg_temp.probe('ductus_app', 'vesna', tbl, op),
  CASE op WHEN 'INSERT' THEN 'refused by RLS' ELSE 'rows=0' END,
  format('mistaken grant, Vesna as teacher of K1: %s on %s changes nothing', op, tbl)
)
FROM cell WHERE role = 'ductus_app' AND op <> 'SELECT' ORDER BY tbl_n, op_n;
SELECT is(
  (SELECT concat_ws(' ', (SELECT count(*) FROM institution.institution_settings),
                         (SELECT count(*) FROM institution.institution_role),
                         (SELECT count(*) FROM institution.course),
                         (SELECT count(*) FROM institution.course_enrollment_code),
                         (SELECT count(*) FROM institution.course_member))),
  '2 6 3 4 6',
  'after every probe the fixture rows are all still there'
);

SELECT * FROM finish();
ROLLBACK;

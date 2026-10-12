-- Functions of the institution module (B-7 part 1, and of part 2 the removal
-- of a student and of a teacher): who may call them, what they refuse and
-- what they leave behind (plan of attack on issue #153, items 4 to 6, 8 to 11
-- and 14 to 19, 29; owner decisions of 10 Oct 2026). The assignment functions
-- are in 032-institution-assignments.sql.
-- Synthetic fixtures only (fixtures/institution.inc).
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';

SELECT plan(278);

CREATE FUNCTION pg_temp.attempts(p_name text) RETURNS bigint
LANGUAGE sql AS $$ SELECT count(*) FROM institution.enrollment_attempt WHERE user_id = pg_temp.id(p_name) $$;
CREATE FUNCTION pg_temp.memberships(p_name text, p_course text) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(role || CASE WHEN member_to IS NULL THEN '' ELSE '(ended)' END, ' ' ORDER BY member_to NULLS LAST), '-')
  FROM institution.course_member WHERE user_id = pg_temp.id(p_name) AND course_id = pg_temp.id(p_course)
$$;
-- The whole answer of enroll_with_code as one text: (outcome,course).
CREATE FUNCTION pg_temp.enroll(p_actor text, p_code text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format('SELECT e::text FROM institution.enroll_with_code(%L) e', p_code))
$$;

-- 1. Without an open session every function refuses and changes nothing
-- (plan 8). "expired" and "closed" are sessions of Ana, a member of K1.
SELECT is(pg_temp.ask(a.actor, c.call), 'ZD401: not authenticated', a.actor || ': ' || c.name || ' is refused')
FROM unnest(ARRAY['anon', 'expired', 'closed', 'unknown']) WITH ORDINALITY AS a (actor, n)
CROSS JOIN (VALUES
  (1, 'confirm_teacher_role', 'SELECT institution.confirm_teacher_role({boris})'),
  (2, 'create_course', $$ SELECT institution.create_course('K9', '2026/2027', 'prohibited') $$),
  (3, 'create_enrollment_code', $$ SELECT institution.create_enrollment_code({k1}, now() + interval '1 day') $$),
  (4, 'revoke_enrollment_code', 'SELECT institution.revoke_enrollment_code({k1})'),
  (5, 'enroll_with_code', $$ SELECT outcome FROM institution.enroll_with_code('KOD-K1-TEST') $$),
  (6, 'remove_student', 'SELECT institution.remove_student({k1}, {dora})'),
  (7, 'allow_student_return', 'SELECT institution.allow_student_return({k1}, {dora})'),
  (8, 'revoke_teacher_role', 'SELECT institution.revoke_teacher_role({vesna})')
) AS c (n, name, call)
ORDER BY a.n, c.n;
SELECT is(
  (SELECT concat_ws(' ', (SELECT count(*) FROM institution.course), (SELECT count(*) FROM institution.course_member),
                         (SELECT count(*) FROM institution.institution_role),
                         (SELECT count(*) FROM institution.course_enrollment_code WHERE active),
                         (SELECT count(*) FROM institution.enrollment_attempt))),
  '3 6 6 3 0', 'the refused calls left no row behind'
);
SELECT is(
  (SELECT concat_ws(' ', (SELECT count(*) FROM institution.course_member WHERE member_to IS NOT NULL OR removed_by IS NOT NULL),
                         (SELECT count(*) FROM institution.institution_role WHERE revoked_at IS NOT NULL))),
  '0 0', 'and ended no membership and revoked no role'
);
SELECT is(
  pg_temp.ask('ana', 'SELECT institution.require_actor()'), '42501: permission denied for function require_actor',
  'require_actor is internal: ductus_app cannot call it'
);

-- 2. A course needs a confirmed teacher role (plan 11).
SELECT is(
  pg_temp.ask(v.actor, $$ SELECT institution.create_course('Novi kolegij', '2026/2027', 'prohibited') $$),
  'ZD403: forbidden', v.actor || ': create_course is refused (' || v.why || ')'
)
FROM (VALUES (1, 'ana', 'student'), (2, 'boris', 'no role'), (3, 'nina', 'teacher role not confirmed'),
             (4, 'iva', 'administrator is not a teacher')) AS v (n, actor, why)
ORDER BY v.n;

-- 3. confirm_teacher_role: an administrator, for a colleague of the same
-- institution. Every refusal reads the same, whatever its reason (plan 6).
SELECT is(
  pg_temp.ask(v.actor, format('SELECT institution.confirm_teacher_role(%s)', v.candidate)),
  'ZD403: forbidden', v.actor || ' confirming ' || v.candidate || ' is refused (' || v.why || ')'
)
FROM (VALUES
  (1, 'ana', '{boris}', 'student'),
  (2, 'vesna', '{boris}', 'teacher is not an administrator'),
  (3, 'lea', '{nina}', 'administrator of another institution'),
  (4, 'iva', '{tomo}', 'candidate of another institution'),
  (5, 'iva', '{nobody}', 'candidate does not exist'),
  (6, 'iva', '{iva}', 'the own account'),
  (7, 'iva', 'NULL', 'no candidate')
) AS v (n, actor, candidate, why)
ORDER BY v.n;
SELECT is(
  (SELECT count(*) || ' ' || count(*) FILTER (WHERE confirmed_at IS NULL) FROM institution.institution_role),
  '6 1', 'refused confirmations changed no role'
);

SELECT is(pg_temp.ask('iva', $$ SELECT 'done' FROM institution.confirm_teacher_role({nina}) $$), 'done', 'Iva confirms Nina');
SELECT is(
  (SELECT string_agg(concat_ws(' ', role, confirmed_by = pg_temp.id('iva'), confirmed_at = now(), revoked_at IS NULL), ';')
   FROM institution.institution_role WHERE user_id = pg_temp.id('nina')),
  'teacher t t t', 'Nina has one teacher role, confirmed by Iva at the database time'
);
UPDATE institution.institution_role SET confirmed_at = now() - interval '1 day' WHERE user_id = pg_temp.id('nina');
SELECT is(pg_temp.ask('iva', $$ SELECT 'done' FROM institution.confirm_teacher_role({nina}) $$), 'done', 'confirming Nina again succeeds');
SELECT is(
  (SELECT string_agg((confirmed_at = now() - interval '1 day')::text, ';') FROM institution.institution_role
   WHERE user_id = pg_temp.id('nina')),
  'true', 'the repeated confirmation added no row and kept the first confirmation'
);
SELECT is(pg_temp.ask('iva', $$ SELECT 'done' FROM institution.confirm_teacher_role({boris}) $$), 'done', 'Iva confirms Boris, who had no role row');
SELECT is(pg_temp.ask('boris', $$ SELECT institution.actor_has_role('teacher')::text $$), 'true', 'Boris now holds the teacher role');
SELECT matches(
  pg_temp.ask('nina', $$ SELECT institution.create_course('Kolegij Nine', '2026/2027', 'prohibited') $$),
  '^[0-9a-f-]{36}$', 'once confirmed, Nina creates a course'
);

UPDATE institution.institution_role SET revoked_at = now() WHERE user_id = pg_temp.id('marko');
SELECT is(
  pg_temp.ask('marko', $$ SELECT institution.create_course('Kolegij Marka', '2026/2027', 'prohibited') $$),
  'ZD403: forbidden', 'Marko with a revoked teacher role cannot create a course'
);
SELECT is(pg_temp.ask('iva', $$ SELECT 'done' FROM institution.confirm_teacher_role({marko}) $$), 'done', 'Iva confirms Marko anew');
SELECT is(
  (SELECT count(*) || ' ' || count(*) FILTER (WHERE revoked_at IS NULL) FROM institution.institution_role
   WHERE user_id = pg_temp.id('marko')),
  '2 1', 'the revoked role stays as history beside the new one'
);
UPDATE institution.institution_role SET revoked_at = now() WHERE user_id = pg_temp.id('lea');
SELECT is(
  pg_temp.ask('lea', 'SELECT institution.confirm_teacher_role({tomo})'), 'ZD403: forbidden',
  'Lea with a revoked administrator role confirms nobody'
);

-- 4. create_course.
CREATE TEMP TABLE made AS
SELECT pg_temp.ask('vesna', $$ SELECT institution.create_course('Akademsko pisanje', '2026/2027', 'encouraged') $$) AS course;
SELECT is(
  (SELECT concat_ws(' ', c.institution_id = pg_temp.id('fak_a'), c.created_by = pg_temp.id('vesna'), c.ai_policy,
                    (SELECT string_agg(m.role || ':' || (m.user_id = pg_temp.id('vesna')) || ':' || (m.member_to IS NULL), ',')
                     FROM institution.course_member m WHERE m.course_id = c.id))
   FROM institution.course c, made WHERE c.id::text = made.course),
  't t encouraged teacher:true:true',
  'Vesna creates a course at her institution and is its only member, as teacher'
);
SELECT is(
  pg_temp.ask('vesna', $$ SELECT institution.create_course('Akademsko pisanje', '2026/2027', 'encouraged') $$),
  (SELECT course FROM made), 'the same request again returns the same course'
);
SELECT is(
  (SELECT count(*) || ' ' || (SELECT count(*) FROM institution.course_member m JOIN made ON m.course_id::text = made.course)
   FROM institution.course WHERE name = 'Akademsko pisanje'),
  '1 1', 'and adds neither a course nor a membership'
);
SELECT is(
  pg_temp.ask('vesna', $$ SELECT institution.create_course('Akademsko pisanje', '2026/2027', 'prohibited') $$),
  'ZD409: conflict', 'the same course with another AI rule is a conflict, not a silent change'
);
SELECT matches(
  pg_temp.ask('vesna', $$ SELECT institution.create_course('<script>alert(1)</script>', '2026/2027', 'prohibited') $$),
  '^[0-9a-f-]{36}$', 'markup in a name is not special'
);
SELECT is(
  pg_temp.ask('vesna', $$ SELECT name FROM institution.course WHERE name LIKE '<%' $$),
  '<script>alert(1)</script>', 'it is stored and returned as the same plain text'
);
SELECT matches(
  pg_temp.ask('vesna', format('SELECT institution.create_course(%L, %L, %L)', repeat('a', 200), '2026/2027', 'prohibited')),
  '^[0-9a-f-]{36}$', 'a name of 200 characters is accepted'
);
SELECT is(
  pg_temp.ask('vesna', format('SELECT institution.create_course(%L, %L, %L)', v.name, v.academic_year, v.ai_policy)),
  'ZD422: invalid input', 'create_course refuses ' || v.what
)
FROM (VALUES
  (1, '', '2026/2027', 'prohibited', 'an empty name'),
  (2, '   ', '2026/2027', 'prohibited', 'a name of spaces'),
  (3, repeat('a', 201), '2026/2027', 'prohibited', 'a name of 201 characters'),
  (4, repeat('a', 100000), '2026/2027', 'prohibited', 'a name of 100,000 characters'),
  (5, E'two\nlines', '2026/2027', 'prohibited', 'a line break in the name'),
  (6, E'tab\there', '2026/2027', 'prohibited', 'a control character in the name'),
  (7, U&'zero\200Bwidth', '2026/2027', 'prohibited', 'a zero-width character in the name'),
  (8, U&'bidi\202Eoverride', '2026/2027', 'prohibited', 'a bidirectional override in the name'),
  (9, U&'\FEFFmark', '2026/2027', 'prohibited', 'a byte order mark in the name'),
  (10, NULL, '2026/2027', 'prohibited', 'a missing name'),
  (11, 'Kolegij', '2026', 'prohibited', 'a year that is not a pair'),
  (12, 'Kolegij', '2026/2028', 'prohibited', 'a year pair that is not consecutive'),
  (13, 'Kolegij', '2026-2027', 'prohibited', 'a year with another separator'),
  (14, 'Kolegij', 'abcd/efgh', 'prohibited', 'a year that is not a number'),
  (15, 'Kolegij', NULL, 'prohibited', 'a missing year'),
  (16, 'Kolegij', '2026/2027', 'required', 'an AI rule outside D-52'),
  (17, 'Kolegij', '2026/2027', '', 'an empty AI rule'),
  (18, 'Kolegij', '2026/2027', NULL, 'a missing AI rule'),
  -- QA of part 1: characters the first rule let through.
  (19, U&'arabic\061Cmark', '2026/2027', 'prohibited', 'an Arabic letter mark (U+061C) in the name'),
  (20, U&'soft\00ADhyphen', '2026/2027', 'prohibited', 'a soft hyphen (U+00AD) in the name'),
  (21, U&'vowel\180Eseparator', '2026/2027', 'prohibited', 'a Mongolian vowel separator (U+180E) in the name'),
  (22, U&'\3164', '2026/2027', 'prohibited', 'a name that is one Hangul filler (U+3164)'),
  (23, U&'\2800\2800\2800', '2026/2027', 'prohibited', 'a name of blank Braille cells (U+2800)'),
  (24, U&'\00A0\2003\3000', '2026/2027', 'prohibited', 'a name of no-break, em and ideographic spaces'),
  (25, U&' \3164 \2800 \115F \FFA0 \FE0F ', '2026/2027', 'prohibited', 'a name of spaces, fillers and a variation selector'),
  (26, U&'\+0E0041\+0E0042', '2026/2027', 'prohibited', 'a name of tag characters (U+E0041, U+E0042)'),
  (27, U&'inter\FFF9linear', '2026/2027', 'prohibited', 'an interlinear annotation anchor (U+FFF9) in the name'),
  (28, U&'deprecated\206Aformat', '2026/2027', 'prohibited', 'a deprecated format character (U+206A) in the name')
) AS v (n, name, academic_year, ai_policy, what)
ORDER BY v.n;
-- The rule itself, asked as the owner would: one visible character is enough,
-- in any script, and what was refused before part 2 still is.
SELECT is(institution.is_plain_label(v.name), v.expected, 'is_plain_label: ' || v.what)
FROM (VALUES
  (1, 'Akademsko pisanje', true, 'a plain name passes'),
  (2, U&'\010Cakavski \017Eargon', true, 'Croatian letters pass'),
  (3, U&'\D55C\AE00 \0438 \0645', true, 'Hangul, Cyrillic and Arabic letters pass'),
  (4, U&'\3164a', true, 'a filler beside a visible character passes'),
  (5, U&'Pisanje\00A0II', true, 'a no-break space between words passes'),
  (6, U&'\2801', true, 'a Braille cell with a dot is visible and passes'),
  (7, U&'a\200Db', false, 'a zero-width joiner is refused'),
  (8, U&'a\2066b', false, 'a directional isolate is refused'),
  (9, U&'a\0085b', false, 'a C1 control is refused'),
  (10, '', false, 'an empty name is refused'),
  (11, repeat(U&'\3164', 200) || 'a', false, 'a visible character does not excuse 201 characters')
) AS v (n, name, expected, what)
ORDER BY v.n;
SELECT matches(
  pg_temp.ask('vesna', $$ SELECT institution.create_course(p_name => 'Kolegij', p_academic_year => '2026/2027',
                                                          p_ai_policy => 'prohibited', p_created_by => {boris}) $$),
  '^42883: ', 'create_course has no parameter for the creator'
);
SELECT is(
  (SELECT count(*) FROM institution.course WHERE created_by = pg_temp.id('vesna')), 4::bigint,
  'Vesna has K1 and the three courses created above, nothing from the refused calls'
);
-- A creator who was removed from her course does not get back in by sending
-- the creation again: the answer is the same course, with no new membership.
UPDATE institution.course_member m SET member_to = now() FROM made WHERE m.course_id::text = made.course;
SELECT is(
  pg_temp.ask('vesna', $$ SELECT institution.create_course('Akademsko pisanje', '2026/2027', 'encouraged') $$),
  (SELECT course FROM made), 'removed from her course, Vesna repeats its creation and gets the same course'
);
SELECT is(
  (SELECT string_agg(m.role || ':' || (m.member_to IS NULL), ',') FROM institution.course_member m, made
   WHERE m.course_id::text = made.course)
  || ' ' || pg_temp.ask('vesna', $$ SELECT count(*) FROM institution.course WHERE name = 'Akademsko pisanje' $$),
  'teacher:false 0', 'but she is not a member again and does not read it'
);

-- 5. create_enrollment_code and revoke_enrollment_code: a teacher of that
-- course only. A course one may not manage and no course read the same
-- (plan 4 and 5).
SELECT is(
  pg_temp.ask(v.actor, format($$ SELECT institution.%s $$, c.call)), 'ZD403: forbidden',
  format('%s: %s is refused (%s)', v.actor, c.call, v.why)
)
FROM (VALUES
  (1, 'marko', '{k1}', 'teacher of another course'),
  (2, 'ana', '{k1}', 'student of the course'),
  (3, 'boris', '{k1}', 'not a member'),
  (4, 'iva', '{k1}', 'administrator'),
  (5, 'tomo', '{k1}', 'another institution'),
  (6, 'vesna', '{k2}', 'teacher of another course'),
  (7, 'vesna', '{nobody}', 'no such course'),
  (8, 'vesna', 'NULL', 'no course given')
) AS v (n, actor, course, why)
CROSS JOIN LATERAL (VALUES
  (1, format('create_enrollment_code(%s, now() + interval ''1 day'')', v.course)),
  (2, format('revoke_enrollment_code(%s)', v.course))
) AS c (n, call)
ORDER BY v.n, c.n;
SELECT is(
  pg_temp.ask('vesna', format('SELECT institution.create_enrollment_code({k1}, %s)', v.valid_until)),
  'ZD422: invalid input', 'create_enrollment_code refuses ' || v.what
)
FROM (VALUES
  (1, 'now() - interval ''1 second''', 'a time in the past'),
  (2, 'now()', 'the present moment'),
  (3, 'now() + interval ''1 year 1 day''', 'more than a year ahead'),
  (4, '''infinity''', 'a code that never expires'),
  (5, 'NULL', 'a missing time')
) AS v (n, valid_until, what)
ORDER BY v.n;
SELECT is(
  (SELECT string_agg(encode(code_hash, 'hex'), ',') FROM institution.course_enrollment_code
   WHERE course_id = pg_temp.id('k1') AND active),
  encode(pg_temp.code_hash('KOD-K1-TEST'), 'hex'), 'after the refused calls K1 still has its one code'
);

CREATE TEMP TABLE issued AS
SELECT pg_temp.ask('vesna', $$ SELECT institution.create_enrollment_code({k1}, now() + interval '7 days') $$) AS code;
SELECT matches((SELECT code FROM issued), '^[0-9A-F]{4}(-[0-9A-F]{4}){3}$', 'Vesna gets a code of 16 random hexadecimal characters');
SELECT is(
  (SELECT string_agg(concat_ws(' ', encode(code_hash, 'hex'), valid_until = now() + interval '7 days',
                               created_by = pg_temp.id('vesna')), ',')
   FROM institution.course_enrollment_code WHERE course_id = pg_temp.id('k1') AND active),
  (SELECT encode(pg_temp.code_hash(code), 'hex') || ' t t' FROM issued),
  'K1 has exactly one active code: the hash of the new one; the previous code is cancelled'
);
-- Plan 14: the code exists only as a hash. No column could hold it, and no
-- row of any institution table contains it in either spelling.
SELECT is_empty(
  $$ SELECT a.attname FROM pg_attribute a
     WHERE a.attrelid = 'institution.course_enrollment_code'::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND a.atttypid NOT IN ('uuid'::regtype, 'bytea'::regtype, 'timestamptz'::regtype, 'bool'::regtype) $$,
  'course_enrollment_code has no column that could hold a readable code'
);
CREATE FUNCTION pg_temp.rows_containing(p_needle text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  t text;
  n bigint;
  total bigint := 0;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'institution' LOOP
    EXECUTE format('SELECT count(*) FROM institution.%I AS r WHERE r::text ILIKE %L', t, '%' || p_needle || '%') INTO n;
    total := total + n;
  END LOOP;
  RETURN total;
END
$$;
SELECT is(
  (SELECT pg_temp.rows_containing(code) + pg_temp.rows_containing(replace(code, '-', '')) FROM issued), 0::bigint,
  'the issued code is in no row of any institution table'
);
SELECT ok(pg_temp.rows_containing('K1') > 0, 'the scan itself does find text that is stored');
SELECT isnt(
  pg_temp.ask('vesna', $$ SELECT institution.create_enrollment_code({k1}, now() + interval '7 days') $$),
  (SELECT code FROM issued), 'a second request gives a different code'
);
-- Back to the first code for the rest of the file: the tests need a code
-- whose text they know.
UPDATE institution.course_enrollment_code SET active = false WHERE course_id = pg_temp.id('k1') AND active;
UPDATE institution.course_enrollment_code SET active = true WHERE code_hash = (SELECT pg_temp.code_hash(code) FROM issued);

-- 6. enroll_with_code. The caller is the session and nothing else (plan 9
-- and 10): there is one parameter, the code.
SELECT matches(
  pg_temp.ask('ana', format('SELECT outcome FROM institution.enroll_with_code(%s)', v.arguments)),
  '^42883: ', 'enroll_with_code takes no ' || v.what
)
FROM (VALUES
  (1, 'p_code => ''x'', p_user_id => {boris}', 'user'),
  (2, 'p_code => ''x'', p_institution_id => {fak_b}', 'institution'),
  (3, 'p_code => ''x'', p_role => ''teacher''', 'role'),
  (4, '''x'', {boris}', 'second positional argument')
) AS v (n, arguments, what)
ORDER BY v.n;

-- Plan 15 and 17, owner decision 1: wrong, expired, cancelled and foreign
-- codes get the very same answer, and each counts as an attempt.
SELECT is(pg_temp.enroll('boris', v.code), '(refused,)', 'Boris: ' || v.what || ' is refused')
FROM (VALUES
  (1, 'AAAA-BBBB-CCCC-DDDD', 'a code that was never issued'),
  (2, 'KOD-K2-ISTEKAO', 'the expired code of K2'),
  (3, 'KOD-K1-STARI', 'the cancelled code of K1'),
  (4, 'KOD-K3-TEST', 'the working code of a course at another institution')
) AS v (n, code, what)
ORDER BY v.n;
SELECT is(pg_temp.attempts('boris'), 4::bigint, 'each of the four refusals is counted');
DELETE FROM institution.enrollment_attempt;
SELECT is(pg_temp.enroll('boris', v.code), '(refused,)', 'Boris: ' || v.what || ' is refused')
FROM (VALUES
  (1, NULL, 'no code'),
  (2, '', 'an empty code'),
  (3, repeat('A', 100000), 'a code of 100,000 characters'),
  (4, 'KÖD-K1-TEST', 'a code with a letter outside A to Z'),
  (5, 'KOD-K1-TEST', 'the code that Vesna replaced')
) AS v (n, code, what)
ORDER BY v.n;
SELECT is(pg_temp.memberships('boris', 'k1'), '-', 'after nine refusals Boris is in no course');
DELETE FROM institution.enrollment_attempt;

SELECT is(
  pg_temp.enroll('tomo', (SELECT code FROM issued)), '(refused,)',
  'Tomo of another institution is refused with the working code of K1 (owner decision 1)'
);
SELECT is(pg_temp.memberships('tomo', 'k1') || ' ' || pg_temp.attempts('tomo'), '- 1', 'Tomo is no member and the attempt is counted');
SELECT throws_ok(
  format('INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES (%L, %L, %L, ''student'')',
         pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('tomo')),
  '23503', NULL, 'even the owner cannot put a user of another institution into K1 (foreign key)'
);
SELECT throws_ok(
  format('INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES (%L, %L, %L, ''student'')',
         pg_temp.id('k1'), pg_temp.id('fak_b'), pg_temp.id('tomo')),
  '23503', NULL, 'nor by naming the user''s institution instead of the course''s'
);

SELECT is(
  pg_temp.enroll('boris', (SELECT lower(replace(code, '-', ' ')) FROM issued)), format('(enrolled,%s)', pg_temp.id('k1')),
  'Boris joins K1; spaces and lower case in the code do not matter'
);
SELECT is(pg_temp.memberships('boris', 'k1'), 'student', 'Boris is a student of K1, whatever else he is at the institution');
SELECT is(pg_temp.ask('boris', 'SELECT name FROM institution.course WHERE id = {k1}'), 'K1', 'and reads K1 at once');
SELECT is(
  pg_temp.ask('boris', $$ SELECT institution.actor_has_role('teacher') || ' ' || institution.actor_course_role({k1}) $$)
  || ' ' || pg_temp.ask('boris', $$ SELECT institution.create_enrollment_code({k1}, now() + interval '1 day') $$),
  'true student ZD403: forbidden',
  'Boris holds the teacher role at the institution, yet in K1 he is a student and cannot issue a code'
);
SELECT is(
  pg_temp.enroll('boris', (SELECT code FROM issued)), format('(enrolled,%s)', pg_temp.id('k1')),
  'the same code again gives the same answer (plan 18)'
);
SELECT is(pg_temp.memberships('boris', 'k1') || ' ' || pg_temp.attempts('boris'), 'student 0', 'still one membership, and no attempt counted');
SELECT is(
  pg_temp.enroll('vesna', (SELECT code FROM issued)), format('(enrolled,%s)', pg_temp.id('k1')),
  'Vesna entering the code of her own course is told she is in'
);
SELECT is(pg_temp.memberships('vesna', 'k1'), 'teacher', 'and stays its teacher, with one membership');

-- Plan 16, owner decision 2: five wrong codes, then even the right one is
-- refused until the window has passed. Per user, and from the settings.
SELECT is(pg_temp.enroll('nina', 'WRONG-CODE-' || n), '(refused,)', 'Nina: wrong code number ' || n || ' is refused')
FROM generate_series(1, 5) AS n ORDER BY n;
SELECT is(
  pg_temp.enroll('nina', (SELECT code FROM issued)), '(too_many_attempts,)',
  'Nina: after five wrong codes the right one is refused too'
);
SELECT is(pg_temp.enroll('nina', 'WRONG-CODE-6'), '(too_many_attempts,)', 'and a wrong one gets the same answer');
SELECT is(
  pg_temp.memberships('nina', 'k1') || ' ' || pg_temp.attempts('nina'), '- 5',
  'Nina is no member; calls made while locked out are not counted, so the lock ends with the window'
);
SELECT is(pg_temp.enroll('dora', 'WRONG-CODE-1'), '(refused,)', 'the limit is per user: Dora is not locked out by Nina');
UPDATE institution.enrollment_attempt SET attempted_at = now() - interval '14 minutes 59 seconds' WHERE user_id = pg_temp.id('nina');
SELECT is(pg_temp.enroll('nina', (SELECT code FROM issued)), '(too_many_attempts,)', 'one second before the window ends Nina is still locked out');
UPDATE institution.enrollment_attempt SET attempted_at = now() - interval '15 minutes' WHERE user_id = pg_temp.id('nina');
SELECT is(
  pg_temp.enroll('nina', (SELECT code FROM issued)), format('(enrolled,%s)', pg_temp.id('k1')),
  'when the window has passed the right code works'
);
SELECT is(pg_temp.attempts('nina'), 0::bigint, 'and the old attempts are gone');

-- Seven guesses in a single statement count one by one as well.
DELETE FROM institution.enrollment_attempt;
SELECT is(
  pg_temp.ask('dora', $$ SELECT string_agg(e.outcome, ' ' ORDER BY g)
                         FROM generate_series(1, 7) AS g
                         CROSS JOIN LATERAL institution.enroll_with_code('WRONG-BURST-' || g) AS e $$),
  'refused refused refused refused refused too_many_attempts too_many_attempts',
  'Dora: seven wrong codes in one statement stop at the fifth'
);

UPDATE institution.institution_settings SET enrollment_attempt_limit = 2, enrollment_attempt_window = '1 minute'
 WHERE institution_id = pg_temp.id('fak_b');
DELETE FROM institution.enrollment_attempt;
SELECT is(pg_temp.enroll('tomo', 'WRONG-CODE-' || n), '(refused,)', 'fak-b with a limit of two: wrong code number ' || n)
FROM generate_series(1, 2) AS n ORDER BY n;
SELECT is(pg_temp.enroll('tomo', 'KOD-K3-TEST'), '(too_many_attempts,)', 'the third call is locked out: the limit is the setting, not a constant');
SELECT is(pg_temp.enroll('ana', 'WRONG-CODE-1') || pg_temp.enroll('ana', 'WRONG-CODE-2') || pg_temp.enroll('ana', 'WRONG-CODE-3'),
          '(refused,)(refused,)(refused,)', 'fak-a keeps its own limit of five');
UPDATE institution.enrollment_attempt SET attempted_at = now() - interval '1 minute' WHERE user_id = pg_temp.id('tomo');
SELECT is(
  pg_temp.enroll('tomo', 'KOD-K3-TEST'), format('(enrolled,%s)', pg_temp.id('k3')),
  'the window is the setting too: after one minute Tomo is told he is in K3'
);
SELECT is(pg_temp.memberships('tomo', 'k3'), 'student', 'with the one membership he already had');
-- Plan 30 for this setting: '1 day' would be 23 or 25 hours on the nights the
-- clocks change (25 Oct 2026), '24 hours' is always the same length.
SELECT throws_ok(
  $$ UPDATE institution.institution_settings SET enrollment_attempt_window = '1 day' $$, '23514', NULL,
  'a window written in days is refused'
);
SELECT lives_ok(
  $$ UPDATE institution.institution_settings SET enrollment_attempt_window = '24 hours'
     WHERE institution_id = '00000000-0000-4000-8000-00000000000b' $$,
  'the same window written in hours is accepted'
);
SET LOCAL TimeZone TO 'Europe/Zagreb';
SELECT is(
  timestamptz '2026-10-25 12:00 Europe/Zagreb' - (SELECT enrollment_attempt_window FROM institution.institution_settings
                                                  WHERE institution_id = pg_temp.id('fak_b')),
  timestamptz '2026-10-24 13:00 Europe/Zagreb',
  'and reaches exactly 24 hours back across the change to winter time'
);
SELECT is(
  timestamptz '2026-10-25 12:00 Europe/Zagreb' - interval '1 day', timestamptz '2026-10-24 12:00 Europe/Zagreb',
  'whereas a day would have reached 25 hours back'
);
DELETE FROM institution.institution_settings WHERE institution_id = pg_temp.id('fak_b');
SELECT is(
  pg_temp.enroll('tomo', 'KOD-K3-TEST'), 'ZD503: institution is not configured',
  'an institution without settings enrols nobody'
);

-- Owner decision 3: a student who left may join again; the old row stays.
UPDATE institution.course_member SET member_to = now() WHERE user_id = pg_temp.id('boris') AND course_id = pg_temp.id('k1');
SELECT is(pg_temp.ask('boris', 'SELECT count(*) FROM institution.course WHERE id = {k1}'), '0', 'Boris left K1 and no longer reads it');
SELECT is(
  pg_temp.enroll('boris', (SELECT code FROM issued)), format('(enrolled,%s)', pg_temp.id('k1')),
  'Boris joins K1 again with the same code'
);
SELECT is(pg_temp.memberships('boris', 'k1'), 'student(ended) student', 'as a new membership beside the ended one');

-- 7. Removal (owner decision of 10 Oct 2026: the teacher removes a student,
-- the administrator a teacher). remove_student and allow_student_return are
-- for a teacher of that course; every refusal reads the same.
DELETE FROM institution.enrollment_attempt;
SELECT is(
  pg_temp.ask(v.actor, format('SELECT institution.%s(%s, {ana})', f.name, v.course)), 'ZD403: forbidden',
  format('%s: %s(%s, Ana) is refused (%s)', v.actor, f.name, v.course, v.why)
)
FROM (VALUES
  (1, 'dora', '{k1}', 'another student of the course'),
  (2, 'ana', '{k1}', 'the student herself'),
  (3, 'boris', '{k1}', 'student of the course who holds the teacher role at the institution'),
  (4, 'marko', '{k1}', 'teacher of another course'),
  (5, 'iva', '{k1}', 'administrator: a student is removed by the teacher'),
  (6, 'petra', '{k1}', 'teacher at another institution'),
  (7, 'vesna', '{k2}', 'teacher of another course'),
  (8, 'vesna', '{nobody}', 'no such course'),
  (9, 'vesna', 'NULL', 'no course given')
) AS v (n, actor, course, why)
CROSS JOIN (VALUES (1, 'remove_student'), (2, 'allow_student_return')) AS f (n, name)
ORDER BY v.n, f.n;
SELECT is(
  pg_temp.ask('vesna', format('SELECT institution.remove_student({k1}, %s)::text', v.student)), 'false',
  'Vesna removing ' || v.who || ' finds no student to remove'
)
FROM (VALUES (1, '{iva}', 'a user who is not in K1'), (2, '{nobody}', 'a user who does not exist'), (3, 'NULL', 'nobody'),
             (4, '{vesna}', 'herself, the teacher'), (5, '{tomo}', 'a user of another institution')) AS v (n, student, who)
ORDER BY v.n;
SELECT is(
  concat_ws(' ', pg_temp.memberships('ana', 'k1'), pg_temp.memberships('vesna', 'k1'),
            (SELECT count(*) FROM institution.course_member WHERE removed_by IS NOT NULL OR return_allowed_at IS NOT NULL)),
  'student teacher 0', 'none of these calls removed anybody or allowed anything'
);

-- The table itself holds the shape of a removal, whoever writes the row (QA
-- finding V1 on #175): only an ended membership of a student names who
-- removed it, and a return is allowed only where somebody was removed.
SELECT throws_ok(
  format('UPDATE institution.course_member SET %s WHERE course_id = pg_temp.id(''k1'') AND user_id = pg_temp.id(%L)', v.change, v.person),
  '23514', 'new row for relation "course_member" violates check constraint "course_member_removal_check"',
  'written directly, the table refuses ' || v.what
)
FROM (VALUES
  (1, 'ana', $$removed_by = pg_temp.id('vesna')$$, 'a removal on a membership that is still open'),
  (2, 'vesna', $$member_to = now(), removed_by = pg_temp.id('vesna')$$, 'a removal on the membership of a teacher'),
  (3, 'ana', 'return_allowed_at = now()', 'a permission to return on an open membership nobody removed'),
  (4, 'ana', 'member_to = now(), return_allowed_at = now()', 'a permission to return on an ended membership nobody removed')
) AS v (n, person, change, what)
ORDER BY v.n;
SELECT is(
  concat_ws(' ', pg_temp.memberships('ana', 'k1'), pg_temp.memberships('vesna', 'k1'),
            (SELECT count(*) FROM institution.course_member WHERE removed_by IS NOT NULL OR return_allowed_at IS NOT NULL)),
  'student teacher 0', 'and the refused writes left every membership as it was'
);

SELECT is(pg_temp.ask('vesna', 'SELECT institution.remove_student({k1}, {ana})::text'), 'true', 'Vesna removes Ana from K1');
SELECT is(
  (SELECT string_agg(concat_ws(' ', role, member_to = now(), removed_by = pg_temp.id('vesna'), return_allowed_at IS NULL), ';')
   FROM institution.course_member WHERE user_id = pg_temp.id('ana')),
  'student t t t', 'her one membership row stays, ended at the database time and naming Vesna'
);
SELECT is(
  pg_temp.ask('ana', $$ SELECT concat_ws(' ', (SELECT count(*) FROM institution.course), (SELECT count(*) FROM institution.assignment),
                                         coalesce(institution.actor_course_role({k1}), 'null'),
                                         institution.has_acknowledged_current({z1})::text) $$),
  '0 0 null false', 'from that moment Ana reads nothing of K1 and counts as not having acknowledged its assignment'
);
SELECT is(pg_temp.ask('vesna', 'SELECT institution.remove_student({k1}, {ana})::text'), 'false', 'removing her again finds nothing to remove');

-- The removed student and the code: refused exactly like a wrong code.
SELECT is(pg_temp.enroll('ana', (SELECT code FROM issued)), '(refused,)', 'Ana, removed by the teacher, is refused with the working code of K1');
SELECT is(
  pg_temp.enroll('ana', (SELECT code FROM issued)), pg_temp.enroll('ana', 'AAAA-BBBB-CCCC-DDDD'),
  'and that answer is the answer to a code that was never issued'
);
SELECT is(
  pg_temp.memberships('ana', 'k1') || ' ' || pg_temp.attempts('ana'), 'student(ended) 3',
  'she is not a member, and each refusal is counted like a wrong code'
);
SELECT is(
  pg_temp.enroll('ana', (SELECT code FROM issued)) || pg_temp.enroll('ana', (SELECT code FROM issued))
  || pg_temp.enroll('ana', (SELECT code FROM issued)),
  '(refused,)(refused,)(too_many_attempts,)', 'so the limit stops her at the fifth attempt, as it stops anyone guessing'
);
DELETE FROM institution.enrollment_attempt;
-- The code stays valid for everyone else, and a student who left alone
-- returns as in part 1 (owner decision 3 of part 1 stands).
UPDATE institution.course_member SET member_to = now() WHERE user_id = pg_temp.id('dora') AND course_id = pg_temp.id('k1');
SELECT is(
  pg_temp.enroll('dora', (SELECT code FROM issued)), format('(enrolled,%s)', pg_temp.id('k1')),
  'Dora, who left by herself, returns with the same code while Ana is refused'
);
SELECT is(
  pg_temp.memberships('dora', 'k1') || ' ' || (SELECT count(*) FROM institution.course_member
                                               WHERE user_id = pg_temp.id('dora') AND removed_by IS NOT NULL),
  'student(ended) student 0', 'with a new membership, and nothing marks her as removed'
);
CREATE TEMP TABLE issued_k2 AS
SELECT pg_temp.ask('marko', $$ SELECT institution.create_enrollment_code({k2}, now() + interval '7 days') $$) AS code;
SELECT is(
  pg_temp.enroll('ana', (SELECT code FROM issued_k2)), format('(enrolled,%s)', pg_temp.id('k2')),
  'the removal holds for K1 alone: Ana joins K2 with its code'
);

-- allow_student_return: the teacher lifts the block; the code is still needed.
SELECT is(
  pg_temp.ask('vesna', format('SELECT institution.allow_student_return({k1}, %s)::text', v.student)), 'false',
  'Vesna allowing the return of ' || v.who || ' finds nothing to allow'
)
FROM (VALUES (1, '{boris}', 'Boris, who left alone and returned'), (2, '{dora}', 'Dora, who left alone'),
             (3, '{nobody}', 'a user who does not exist'), (4, 'NULL', 'nobody')) AS v (n, student, who)
ORDER BY v.n;
SELECT is(pg_temp.ask('vesna', 'SELECT institution.allow_student_return({k1}, {ana})::text'), 'true', 'Vesna lets Ana return');
SELECT is(
  (SELECT string_agg(concat_ws(' ', member_to IS NOT NULL, removed_by = pg_temp.id('vesna'), return_allowed_at = now()), ';')
   FROM institution.course_member WHERE user_id = pg_temp.id('ana') AND course_id = pg_temp.id('k1')),
  't t t', 'the ended membership keeps who removed her and gains the time of the permission'
);
SELECT is(pg_temp.ask('vesna', 'SELECT institution.allow_student_return({k1}, {ana})::text'), 'false', 'allowing it again finds nothing to allow');
SELECT is(
  pg_temp.memberships('ana', 'k1') || ' ' || pg_temp.enroll('ana', 'AAAA-BBBB-CCCC-DDDD'), 'student(ended) (refused,)',
  'the permission alone enrols nobody, and a wrong code is still wrong'
);
SELECT is(
  pg_temp.enroll('ana', (SELECT code FROM issued)), format('(enrolled,%s)', pg_temp.id('k1')),
  'with the code Ana is in K1 again'
);
SELECT is(
  pg_temp.memberships('ana', 'k1') || ' ' || pg_temp.ask('ana', 'SELECT institution.has_acknowledged_current({z1})::text'),
  'student(ended) student true', 'as a new membership beside the ended one; what she acknowledged before still stands'
);
SELECT is(
  pg_temp.ask('vesna', 'SELECT institution.remove_student({k1}, {ana})::text') || ' ' || pg_temp.enroll('ana', (SELECT code FROM issued)),
  'true (refused,)', 'removed a second time she is refused again: the earlier permission does not cover a new removal'
);
DELETE FROM institution.enrollment_attempt;

-- revoke_teacher_role: an administrator, for a teacher of the own institution.
-- Lea is an administrator again (section 3 revoked her role).
UPDATE institution.institution_role SET revoked_at = NULL WHERE user_id = pg_temp.id('lea');
INSERT INTO institution.institution_role (institution_id, user_id, role)
VALUES (pg_temp.id('fak_a'), pg_temp.id('dora'), 'teacher');
SELECT is(
  pg_temp.ask(v.actor, 'SELECT institution.revoke_teacher_role({vesna})'), 'ZD403: forbidden',
  v.actor || ' revoking the teacher role of Vesna is refused (' || v.why || ')'
)
FROM (VALUES (1, 'ana', 'student'), (2, 'marko', 'a teacher is removed by the administrator, not by a colleague'),
             (3, 'vesna', 'the teacher herself'), (4, 'dora', 'teacher role not confirmed'),
             (5, 'petra', 'teacher at another institution')) AS v (n, actor, why)
ORDER BY v.n;
SELECT is(
  pg_temp.ask(v.actor, format('SELECT institution.revoke_teacher_role(%s)::text', v.teacher)), 'false',
  v.actor || ' revoking the teacher role of ' || v.who || ' finds no such role at the own institution'
)
FROM (VALUES
  (1, 'lea', '{vesna}', 'Vesna, a teacher at another institution'),
  (2, 'iva', '{petra}', 'Petra, a teacher at another institution'),
  (3, 'iva', '{nobody}', 'a user who does not exist'),
  (4, 'iva', 'NULL', 'nobody'),
  (5, 'iva', '{ana}', 'Ana, who holds no role'),
  (6, 'iva', '{dora}', 'Dora, whose teacher role nobody confirmed'),
  (7, 'iva', '{iva}', 'herself, who holds the administrator role only')
) AS v (n, actor, teacher, who)
ORDER BY v.n;
SELECT is(
  (SELECT string_agg(p.name, ' ' ORDER BY p.name) FROM institution.institution_role r JOIN person p ON p.id = r.user_id
   WHERE r.revoked_at IS NOT NULL),
  'marko', 'none of these calls revoked a role: only the role of Marko that section 3 revoked is revoked'
);

SELECT is(pg_temp.ask('iva', 'SELECT institution.revoke_teacher_role({vesna})::text'), 'true', 'Iva revokes the teacher role of Vesna');
SELECT is(
  (SELECT string_agg(concat_ws(' ', role, confirmed_at IS NOT NULL, revoked_at = now()), ';') FROM institution.institution_role
   WHERE user_id = pg_temp.id('vesna'))
  || ' ' || pg_temp.memberships('vesna', 'k1'),
  'teacher t t teacher', 'the role row stays, revoked at the database time; her membership of K1 stays open'
);
SELECT is(
  pg_temp.ask('vesna', $$ SELECT concat_ws(' ', coalesce(institution.actor_course_role({k1}), 'null'),
                                           coalesce(institution.actor_assignment_role({z1}), 'null'),
                                           institution.actor_has_role('teacher')::text,
                                           (SELECT count(*) FROM institution.course),
                                           (SELECT count(*) FROM institution.course_member WHERE user_id <> {vesna}),
                                           (SELECT count(*) FROM institution.course_enrollment_code),
                                           (SELECT count(*) FROM institution.assignment),
                                           (SELECT count(*) FROM institution.assignment_version),
                                           (SELECT count(*) FROM institution.notice_acknowledgment)) $$),
  'null null false 0 0 0 0 0 0',
  'at once Vesna has no part in K1 and reads no course, member, code, assignment, version or acknowledgment'
);
SELECT is(pg_temp.ask('vesna', 'SELECT institution.' || v.call), 'ZD403: forbidden', 'Vesna without the role: ' || v.call || ' is refused')
FROM (VALUES
  (1, $$create_course('Kolegij bez uloge', '2026/2027', 'prohibited')$$),
  (2, $$create_enrollment_code({k1}, now() + interval '1 day')$$),
  (3, 'revoke_enrollment_code({k1})'),
  (4, 'remove_student({k1}, {dora})'),
  (5, 'allow_student_return({k1}, {ana})'),
  (6, $$create_assignment({k1}, 'Zadatak', 'Upute.', 'essay', now(), now() + interval '7 days', 'prohibited', '{}', 'basic', false)$$),
  (7, $$publish_assignment_version({z1}, 2, 'Zadatak', 'Upute.', 'essay', now(), now() + interval '7 days', 'prohibited', '{}', 'basic', false)$$)
) AS v (n, call)
ORDER BY v.n;
SELECT is(pg_temp.ask('iva', 'SELECT institution.revoke_teacher_role({vesna})::text'), 'false', 'revoking it again finds nothing to revoke');
-- QA of part 1 (b): an open membership that opens nothing is not "enrolled".
SELECT is(
  pg_temp.enroll('vesna', (SELECT code FROM issued)), '(refused,)',
  'Vesna entering the code of K1 is no longer told she is in: her membership opens nothing'
);
SELECT is(
  pg_temp.memberships('vesna', 'k1') || ' ' || pg_temp.attempts('vesna'), 'teacher 1',
  'her membership is as it was, and the attempt is counted'
);
-- QA of part 1 (c) is unchanged and waits for the owner: students still read
-- the membership of a teacher whose role is revoked, and the code of a
-- course without a teacher in force still enrols.
SELECT is(
  pg_temp.ask('dora', $$ SELECT count(*) FROM institution.course_member WHERE course_id = {k1} AND role = 'teacher' $$)
  || ' ' || pg_temp.enroll('marko', (SELECT code FROM issued)),
  format('1 (enrolled,%s)', pg_temp.id('k1')),
  'as in part 1: Dora still reads Vesna as the teacher of K1, and Marko joins K1 with its code'
);
SELECT is(pg_temp.ask('iva', $$ SELECT 'done' FROM institution.confirm_teacher_role({vesna}) $$), 'done', 'Iva confirms Vesna anew');
SELECT is(
  pg_temp.ask('vesna', $$ SELECT concat_ws(' ', institution.actor_course_role({k1}), (SELECT count(*) FROM institution.assignment)) $$)
  || ' ' || (SELECT count(*) || ' ' || count(*) FILTER (WHERE revoked_at IS NULL) FROM institution.institution_role
             WHERE user_id = pg_temp.id('vesna')),
  'teacher 1 2 1', 'the membership that stayed opens K1 again at once; the revoked role stays as history'
);

-- The demo account that is administrator and teacher at once (task K-3)
-- comes from the demo data, written as here; no function makes it.
INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at)
VALUES (pg_temp.id('fak_a'), pg_temp.id('iva'), 'teacher', now());
SELECT is(
  pg_temp.ask('iva', $$ SELECT concat_ws(' ', institution.actor_has_role('admin')::text, institution.actor_has_role('teacher')::text) $$),
  'true true', 'the model holds an account that is administrator and teacher at once'
);
SELECT matches(
  pg_temp.ask('iva', $$ SELECT institution.create_course('Demo kolegij', '2026/2027', 'prohibited') $$),
  '^[0-9a-f-]{36}$', 'such an account creates a course as a teacher'
);
SELECT is(
  pg_temp.ask('iva', $$ SELECT concat_ws(' ', (SELECT string_agg(name, ',') FROM institution.course),
                                         (SELECT count(*) FROM institution.institution_role WHERE user_id = {iva})) $$),
  'Demo kolegij 2', 'and reads the own course as its teacher and the roles as administrator'
);
SELECT is(
  pg_temp.ask('iva', 'SELECT institution.confirm_teacher_role({iva})'), 'ZD403: forbidden',
  'yet no function lets an administrator confirm the own account, this one included'
);

-- A cancelled code stops working at once.
SELECT is(pg_temp.ask('vesna', 'SELECT institution.revoke_enrollment_code({k1})::text'), 'true', 'Vesna cancels the code of K1');
SELECT is(pg_temp.ask('vesna', 'SELECT institution.revoke_enrollment_code({k1})::text'), 'false', 'cancelling again finds nothing to cancel');
SELECT is(pg_temp.enroll('iva', (SELECT code FROM issued)), '(refused,)', 'the cancelled code is refused like any wrong code');

-- Plan 19 for the functions: a removed teacher manages nothing from then on.
UPDATE institution.course_member SET member_to = now() WHERE user_id = pg_temp.id('vesna') AND course_id = pg_temp.id('k1');
SELECT is(
  pg_temp.ask('vesna', $$ SELECT institution.create_enrollment_code({k1}, now() + interval '1 day') $$)
  || ' / ' || pg_temp.ask('vesna', 'SELECT institution.revoke_enrollment_code({k1})'),
  'ZD403: forbidden / ZD403: forbidden', 'Vesna, removed from K1, can neither issue nor cancel its code'
);

SELECT * FROM finish();
ROLLBACK;

-- Shared fixture for the institution tests (B-7; plan of attack, issue #153).
-- Included with \ir inside the test's own transaction, so nothing stays.
-- Every institution, person, course and code below is invented.
--
--   fak-a: Iva administrator; Vesna teacher of K1; Marko teacher of K2;
--          Ana and Dora students in K1; Boris student in no course;
--          Nina with a teacher role nobody has confirmed
--   fak-b: Lea administrator; Petra teacher of K3; Tomo student in K3
CREATE EXTENSION IF NOT EXISTS pgtap;
CREATE ROLE ductus_test_stranger NOLOGIN;

CREATE TEMP TABLE person (
  name text PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  institution_id uuid NOT NULL,
  faculty text NOT NULL
);
INSERT INTO person
SELECT p.name,
       ('00000000-0000-4000-8000-0000000001' || lpad(p.n::text, 2, '0'))::uuid,
       ('00000000-0000-4000-8000-00000000000' || p.faculty)::uuid,
       'fak-' || p.faculty
FROM (VALUES
  ('vesna', 1, 'a'), ('marko', 2, 'a'), ('iva', 3, 'a'), ('ana', 4, 'a'), ('dora', 5, 'a'),
  ('boris', 6, 'a'), ('nina', 7, 'a'), ('lea', 8, 'b'), ('petra', 9, 'b'), ('tomo', 10, 'b')
) AS p (name, n, faculty);

-- Session tokens: 43 base64url characters, one letter per person. "expired"
-- and "closed" are Ana's old sessions; "unknown" matches no session; "anon"
-- is a request without a cookie.
CREATE TEMP TABLE tok (name text PRIMARY KEY, token text NOT NULL);
INSERT INTO tok SELECT name, repeat(chr(64 + row_number() OVER (ORDER BY id)::integer), 43) FROM person;
INSERT INTO tok VALUES
  ('expired', repeat('X', 43)), ('closed', repeat('Y', 43)), ('unknown', repeat('Z', 43)), ('anon', '');

-- Placeholders for pg_temp.ask(): {ana}, {k1}, {fak_a} and so on.
CREATE TEMP TABLE ref (name text PRIMARY KEY, val text NOT NULL);
INSERT INTO ref SELECT name, id::text FROM person;
INSERT INTO ref VALUES
  ('fak_a', '00000000-0000-4000-8000-00000000000a'),
  ('fak_b', '00000000-0000-4000-8000-00000000000b'),
  ('k1', '00000000-0000-4000-8000-0000000000c1'),
  ('k2', '00000000-0000-4000-8000-0000000000c2'),
  ('k3', '00000000-0000-4000-8000-0000000000c3'),
  ('z1', '00000000-0000-4000-8000-0000000000a1'),
  ('z2', '00000000-0000-4000-8000-0000000000a2'),
  ('z3', '00000000-0000-4000-8000-0000000000a3'),
  ('nobody', '00000000-0000-4000-8000-00000000dead');
GRANT SELECT ON person, ref TO PUBLIC;

CREATE FUNCTION pg_temp.id(p_name text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT val::uuid FROM ref WHERE name = p_name $$;
CREATE FUNCTION pg_temp.code_hash(p_code text) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(convert_to(upper(replace(p_code, '-', '')), 'UTF8')) $$;

INSERT INTO identity.institution (id, slug) VALUES (pg_temp.id('fak_a'), 'fak-a'), (pg_temp.id('fak_b'), 'fak-b');
INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
SELECT id, institution_id, 'https://issuer.test', 'sub-' || name, name || '@' || faculty || '.example' FROM person;

INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
SELECT sha256(convert_to(t.token, 'UTF8')), p.id, p.institution_id, now() + interval '1 hour'
FROM person p JOIN tok t USING (name);
INSERT INTO identity.session (token_hash, user_id, institution_id, created_at, expires_at, closed_at, close_reason)
SELECT sha256(convert_to(t.token, 'UTF8')), p.id, p.institution_id, s.created_at, s.expires_at, s.closed_at, s.close_reason
FROM (VALUES
  ('expired', now() - interval '2 hours', now() - interval '1 hour', NULL::timestamptz, NULL),
  ('closed', now() - interval '1 hour', now() + interval '1 hour', now(), 'logout')
) AS s (name, created_at, expires_at, closed_at, close_reason)
JOIN tok t USING (name) CROSS JOIN person p WHERE p.name = 'ana';

-- The limit is written out here: the tests must not lean on the defaults.
INSERT INTO institution.institution_settings (institution_id, display_name, enrollment_attempt_limit, enrollment_attempt_window)
VALUES (pg_temp.id('fak_a'), 'Fakultet A (test)', 5, '15 minutes'),
       (pg_temp.id('fak_b'), 'Fakultet B (test)', 5, '15 minutes');

INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_by, confirmed_at)
SELECT p.institution_id, p.id, r.role, pg_temp.id(r.confirmed_by), CASE WHEN r.confirmed THEN now() END
FROM (VALUES
  ('iva', 'admin', NULL, true), ('lea', 'admin', NULL, true),
  ('vesna', 'teacher', 'iva', true), ('marko', 'teacher', 'iva', true), ('petra', 'teacher', 'lea', true),
  ('nina', 'teacher', NULL, false)
) AS r (name, role, confirmed_by, confirmed)
JOIN person p USING (name);

INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
SELECT pg_temp.id(lower(c.name)), p.institution_id, c.name, '2026/2027', c.ai_policy, p.id
FROM (VALUES ('K1', 'vesna', 'partially_allowed'), ('K2', 'marko', 'prohibited'), ('K3', 'petra', 'encouraged')
) AS c (name, teacher, ai_policy)
JOIN person p ON p.name = c.teacher;

INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
SELECT pg_temp.id(m.course), p.institution_id, p.id, m.role
FROM (VALUES
  ('k1', 'vesna', 'teacher'), ('k2', 'marko', 'teacher'), ('k3', 'petra', 'teacher'),
  ('k1', 'ana', 'student'), ('k1', 'dora', 'student'), ('k3', 'tomo', 'student')
) AS m (course, name, role)
JOIN person p USING (name);

-- K1 has a working code and a cancelled one, K2 only an expired one.
INSERT INTO institution.course_enrollment_code (course_id, code_hash, valid_until, active, created_by)
SELECT pg_temp.id(c.course), pg_temp.code_hash(c.code), now() + c.valid_for, c.active, pg_temp.id(c.teacher)
FROM (VALUES
  ('k1', 'KOD-K1-TEST', interval '30 days', true, 'vesna'),
  ('k1', 'KOD-K1-STARI', interval '30 days', false, 'vesna'),
  ('k2', 'KOD-K2-ISTEKAO', interval '-1 second', true, 'marko'),
  ('k3', 'KOD-K3-TEST', interval '30 days', true, 'petra')
) AS c (course, code, valid_for, active, teacher);

-- One assignment per course (part 2). Z1 of K1 is at its second, narrower
-- version: Ana and Dora acknowledged the first, only Ana the second. Z2 of K2
-- has no acknowledgment, Z3 of K3 has Tomo's.
INSERT INTO institution.assignment (id, course_id, current_version, created_by)
SELECT pg_temp.id(a.name), pg_temp.id(a.course), a.current_version, pg_temp.id(a.teacher)
FROM (VALUES ('z1', 'k1', 2, 'vesna'), ('z2', 'k2', 1, 'marko'), ('z3', 'k3', 1, 'petra')
) AS a (name, course, current_version, teacher);
INSERT INTO institution.assignment_version (
  assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
  evidence_profile, import_allowed, created_by
)
SELECT pg_temp.id(v.name), v.version_no, upper(v.name), 'Upute za izmišljeni zadatak.', 'essay', now(),
       now() + interval '30 days', v.ai_policy, v.ai_purposes::text[], v.evidence_profile, v.import_allowed,
       pg_temp.id(v.teacher)
FROM (VALUES
  ('z1', 1, 'partially_allowed', '{formatting,proofreading}', 'extended', true, 'vesna'),
  ('z1', 2, 'partially_allowed', '{proofreading}', 'extended', true, 'vesna'),
  ('z2', 1, 'prohibited', '{}', 'basic', false, 'marko'),
  ('z3', 1, 'encouraged', '{translation}', 'basic', true, 'petra')
) AS v (name, version_no, ai_policy, ai_purposes, evidence_profile, import_allowed, teacher);
INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id)
SELECT pg_temp.id(n.name), n.version_no, pg_temp.id(n.student)
FROM (VALUES ('z1', 1, 'ana'), ('z1', 1, 'dora'), ('z1', 2, 'ana'), ('z3', 1, 'tomo')) AS n (name, version_no, student);

-- Runs one statement as p_role with p_actor's session token and returns its
-- single value as text, or "SQLSTATE: message" when it fails. The assertions
-- themselves stay with the test's own role, so the roles under test need no
-- access to pgTAP.
CREATE FUNCTION pg_temp.ask_as(p_role text, p_actor text, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_sql text := p_sql;
  v_token text;
  v_result text;
  r record;
BEGIN
  FOR r IN SELECT name, val FROM ref LOOP
    v_sql := replace(v_sql, '{' || r.name || '}', quote_literal(r.val));
  END LOOP;
  SELECT token INTO STRICT v_token FROM tok WHERE name = p_actor;
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  PERFORM set_config('app.session_token', v_token, true);
  BEGIN
    EXECUTE v_sql INTO v_result;
  EXCEPTION WHEN OTHERS THEN
    v_result := SQLSTATE || ': ' || SQLERRM;
  END;
  PERFORM set_config('app.session_token', '', true);
  RESET ROLE;
  RETURN v_result;
END
$$;

-- The web process: ductus_app with the session of p_actor.
CREATE FUNCTION pg_temp.ask(p_actor text, p_sql text) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.ask_as('ductus_app', p_actor, p_sql) $$;

-- migrate:up
-- Institution module for the demo, part 1 (B-7; docs/ARCHITECTURE.md 3 and
-- 7): settings and roles of an institution, course, membership and enrolment
-- by code. Assignment, its versions and notice acknowledgment are part 2.
--
-- ductus_app only reads these tables, through RLS, and changes them only
-- through the SECURITY DEFINER functions below. Every function takes the
-- caller from app.current_actor(); none has a parameter that names the
-- caller. search_path is empty, so an unqualified name is pg_catalog's.
--
-- Errors carry no input: ZD401 no open session, ZD403 not allowed (also when
-- the object does not exist), ZD409 same request with other content, ZD422
-- invalid input, ZD500 wrong transaction mode, ZD503 institution not set up.
CREATE SCHEMA institution;
GRANT USAGE ON SCHEMA institution TO ductus_app, ductus_identity;
-- The tables reference identity.user_account, which only its owner may
-- reference, so the owner role creates everything. It holds CREATE on the
-- schema for this migration only.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- A name shown in lists: one line, no control, bidirectional or zero-width
-- characters. Markup is not special; it is stored and returned as text.
CREATE FUNCTION institution.is_plain_label(p_text text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT length(p_text) BETWEEN 1 AND 200 AND p_text ~ '\S'
     AND p_text !~ '[\u0001-\u001F\u007F-\u009F​-‏ -‮⁠-⁤⁦-⁩﻿]'
$$;

-- The enrolment limit is a setting, not a constant in a function. The
-- defaults are the owner's decision of 10 Oct 2026 (five wrong codes in
-- fifteen minutes per user). An institution without a row cannot enrol anyone.
-- The window is hours, minutes and seconds only: a day would be 23 or 25
-- hours long on the nights the clocks change.
CREATE TABLE institution.institution_settings (
  institution_id uuid PRIMARY KEY REFERENCES identity.institution (id),
  display_name text NOT NULL CHECK (institution.is_plain_label(display_name)),
  enrollment_attempt_limit integer NOT NULL DEFAULT 5 CHECK (enrollment_attempt_limit BETWEEN 1 AND 100),
  enrollment_attempt_window interval NOT NULL DEFAULT '15 minutes'
    CHECK (enrollment_attempt_window BETWEEN '1 minute' AND '24 hours'
           AND extract(day FROM enrollment_attempt_window) = 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A role is in force once confirmed and until revoked. The operator sets
-- the first administrator (confirmed_by is null); an administrator of the
-- same institution confirms a teacher (docs/PRODUCT.md 3 and 6).
CREATE TABLE institution.institution_role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('teacher', 'admin')),
  confirmed_by uuid,
  confirmed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (confirmed_by, institution_id) REFERENCES identity.user_account (id, institution_id),
  CHECK (confirmed_by IS NULL OR confirmed_at IS NOT NULL)
);
CREATE UNIQUE INDEX institution_role_open_idx
  ON institution.institution_role (institution_id, user_id, role) WHERE revoked_at IS NULL;

-- ai_policy is the rule from the course plan (D-52), from narrowest to widest.
-- The last unique key makes a repeated create_course return the same course.
CREATE TABLE institution.course (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES identity.institution (id),
  name text NOT NULL CHECK (institution.is_plain_label(name)),
  academic_year text NOT NULL CHECK (academic_year ~ '^[0-9]{4}/[0-9]{4}$'),
  ai_policy text NOT NULL CHECK (ai_policy IN ('prohibited', 'partially_allowed', 'encouraged')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (created_by, institution_id) REFERENCES identity.user_account (id, institution_id),
  UNIQUE (id, institution_id),
  UNIQUE (institution_id, created_by, academic_year, name)
);

-- Only the SHA-256 of a code is stored. The code itself leaves the database
-- once, as the result of create_enrollment_code. One active code per course.
CREATE TABLE institution.course_enrollment_code (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES institution.course (id),
  code_hash bytea NOT NULL UNIQUE CHECK (octet_length(code_hash) = 32),
  valid_until timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES identity.user_account (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX course_enrollment_code_active_idx
  ON institution.course_enrollment_code (course_id) WHERE active;

-- A membership is in force while member_to is null. Leaving keeps the row
-- and joining again adds a new one, so the history stays. Both foreign keys
-- carry the institution: a member always belongs to the course's institution.
CREATE TABLE institution.course_member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('teacher', 'student')),
  member_from timestamptz NOT NULL DEFAULT now(),
  member_to timestamptz,
  FOREIGN KEY (course_id, institution_id) REFERENCES institution.course (id, institution_id),
  FOREIGN KEY (user_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  CHECK (member_to >= member_from)
);
CREATE UNIQUE INDEX course_member_open_idx
  ON institution.course_member (course_id, user_id) WHERE member_to IS NULL;
CREATE INDEX course_member_user_idx ON institution.course_member (user_id);

-- Wrong codes of one user inside the window. The user's next attempt removes
-- the older rows. Only enroll_with_code touches this table.
CREATE TABLE institution.enrollment_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES identity.user_account (id),
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enrollment_attempt_user_idx ON institution.enrollment_attempt (user_id, attempted_at);

-- RLS is forced, so the owner needs a policy too; it acts only through the
-- functions below. Any other role sees a row only where a policy says so.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'institution' LOOP
    EXECUTE format('ALTER TABLE institution.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE institution.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON institution.%I TO ductus_identity USING (true) WITH CHECK (true)', t || '_owner', t
    );
  END LOOP;
END
$$;

-- The caller, or ZD401. Not granted to ductus_app; the functions below use it.
CREATE FUNCTION institution.require_actor(OUT user_id uuid, OUT institution_id uuid)
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  SELECT a.user_id, a.institution_id INTO user_id, institution_id FROM app.current_actor() a;
  IF user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
END
$$;

-- Does the caller hold this role at the own institution, confirmed and not
-- revoked? A role alone opens no course (C-23).
CREATE FUNCTION institution.actor_has_role(p_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.current_actor() a
    JOIN institution.institution_role r ON r.user_id = a.user_id AND r.institution_id = a.institution_id
    WHERE r.role = p_role AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
  )
$$;

-- The caller's part in a course: 'teacher', 'student' or null. The policies
-- and the functions all decide through this one function. A teacher needs an
-- open membership and the teacher role at the institution; without the role
-- the answer is null, the same as for a course that does not exist.
CREATE FUNCTION institution.actor_course_role(p_course_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.role
  FROM app.current_actor() a
  JOIN institution.course_member m ON m.user_id = a.user_id AND m.institution_id = a.institution_id
  WHERE m.course_id = p_course_id AND m.member_to IS NULL
    AND (m.role = 'student' OR institution.actor_has_role('teacher'))
$$;

CREATE POLICY institution_settings_read ON institution.institution_settings FOR SELECT TO ductus_app
  USING (institution_id = (SELECT app.current_institution_id()) AND (SELECT institution.actor_has_role('admin')));
CREATE POLICY institution_role_read ON institution.institution_role FOR SELECT TO ductus_app
  USING (institution_id = (SELECT app.current_institution_id()) AND (SELECT institution.actor_has_role('admin')));
CREATE POLICY course_read ON institution.course FOR SELECT TO ductus_app
  USING (institution.actor_course_role(id) IS NOT NULL);
CREATE POLICY course_enrollment_code_read ON institution.course_enrollment_code FOR SELECT TO ductus_app
  USING (institution.actor_course_role(course_id) = 'teacher');
-- Owner decision of 10 Oct 2026: a student sees the teachers of the course
-- and the own membership, never the other students; a teacher sees everyone.
CREATE POLICY course_member_read ON institution.course_member FOR SELECT TO ductus_app
  USING (
    user_id = (SELECT app.current_user_id())
    OR institution.actor_course_role(course_id) = 'teacher'
    OR (role = 'teacher' AND member_to IS NULL AND institution.actor_course_role(course_id) IS NOT NULL)
  );

-- An administrator confirms a colleague of the same institution as teacher;
-- never the own account, so a second person is always involved. Repeating it
-- changes nothing.
CREATE FUNCTION institution.confirm_teacher_role(p_candidate_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF NOT institution.actor_has_role('admin')
     OR p_candidate_id IS NOT DISTINCT FROM actor.user_id
     OR NOT EXISTS (
       SELECT 1 FROM identity.user_account u
       WHERE u.id = p_candidate_id AND u.institution_id = actor.institution_id
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  INSERT INTO institution.institution_role AS r (institution_id, user_id, role, confirmed_by, confirmed_at)
  VALUES (actor.institution_id, p_candidate_id, 'teacher', actor.user_id, now())
  ON CONFLICT (institution_id, user_id, role) WHERE revoked_at IS NULL
  DO UPDATE SET confirmed_by = EXCLUDED.confirmed_by, confirmed_at = EXCLUDED.confirmed_at
  WHERE r.confirmed_at IS NULL;
END
$$;

-- A teacher creates a course and becomes its first teacher, in one
-- transaction. The same request again returns the same course.
CREATE FUNCTION institution.create_course(p_name text, p_academic_year text, p_ai_policy text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_course uuid;
  v_ai_policy text;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF NOT institution.actor_has_role('teacher') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- Checked here, before the table constraints, whose errors quote the row.
  IF NOT coalesce(
       institution.is_plain_label(p_name)
       AND p_ai_policy IN ('prohibited', 'partially_allowed', 'encouraged')
       AND CASE WHEN p_academic_year ~ '^[0-9]{4}/[0-9]{4}$'
                THEN right(p_academic_year, 4)::integer = left(p_academic_year, 4)::integer + 1
                ELSE false END,
       false) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;

  INSERT INTO institution.course (institution_id, name, academic_year, ai_policy, created_by)
  VALUES (actor.institution_id, p_name, p_academic_year, p_ai_policy, actor.user_id)
  ON CONFLICT (institution_id, created_by, academic_year, name) DO NOTHING
  RETURNING id INTO v_course;
  IF v_course IS NULL THEN
    SELECT c.id, c.ai_policy INTO v_course, v_ai_policy
      FROM institution.course c
     WHERE c.institution_id = actor.institution_id AND c.created_by = actor.user_id
       AND c.academic_year = p_academic_year AND c.name = p_name;
    IF v_ai_policy <> p_ai_policy THEN
      RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
    END IF;
    RETURN v_course;
  END IF;
  INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
  VALUES (v_course, actor.institution_id, actor.user_id, 'teacher');
  RETURN v_course;
END
$$;

-- A teacher of the course gets a new code and the previous one stops
-- working. The code has 64 random bits and is returned only here.
CREATE FUNCTION institution.create_enrollment_code(p_course_id uuid, p_valid_until timestamptz) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_code text;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF NOT coalesce(p_valid_until > now() AND p_valid_until <= now() + interval '1 year', false) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  -- Two teachers at once: the second waits here, then replaces the first code.
  PERFORM 1 FROM institution.course c WHERE c.id = p_course_id FOR UPDATE;
  UPDATE institution.course_enrollment_code e SET active = false WHERE e.course_id = p_course_id AND e.active;
  v_code := upper(encode(
    substring(sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())) FROM 1 FOR 8), 'hex'
  ));
  INSERT INTO institution.course_enrollment_code (course_id, code_hash, valid_until, created_by)
  VALUES (p_course_id, sha256(convert_to(v_code, 'UTF8')), p_valid_until, actor.user_id);
  RETURN concat_ws('-', substr(v_code, 1, 4), substr(v_code, 5, 4), substr(v_code, 9, 4), substr(v_code, 13, 4));
END
$$;

-- A teacher of the course cancels its code. False when none was active.
CREATE FUNCTION institution.revoke_enrollment_code(p_course_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  UPDATE institution.course_enrollment_code e SET active = false WHERE e.course_id = p_course_id AND e.active;
  RETURN FOUND;
END
$$;

-- The caller joins a course of the own institution as a student. The answer
-- is a row, never an error, so a wrong attempt is committed and counted:
--   enrolled           also when the caller already is a member
--   refused            wrong, expired or cancelled code, or a course of
--                      another institution; nothing tells these apart
--   too_many_attempts  the limit is reached; the code is not looked at
CREATE FUNCTION institution.enroll_with_code(p_code text, OUT outcome text, OUT enrolled_course_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  settings record;
  v_code text;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  -- The count below must see what a parallel request has just committed.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE = 'ZD500';
  END IF;
  SELECT s.enrollment_attempt_limit AS attempt_limit, s.enrollment_attempt_window AS attempt_window
    INTO settings
    FROM institution.institution_settings s WHERE s.institution_id = actor.institution_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'institution is not configured' USING ERRCODE = 'ZD503';
  END IF;

  -- One attempt of a user at a time, so parallel requests cannot pass the limit.
  PERFORM pg_advisory_xact_lock(hashtextextended('institution.enroll_with_code:' || actor.user_id, 0));
  DELETE FROM institution.enrollment_attempt t
   WHERE t.user_id = actor.user_id AND t.attempted_at <= now() - settings.attempt_window;
  IF (SELECT count(*) FROM institution.enrollment_attempt t WHERE t.user_id = actor.user_id)
     >= settings.attempt_limit THEN
    outcome := 'too_many_attempts';
    RETURN;
  END IF;

  -- Spaces, hyphens and letter case do not matter; only the hash is compared.
  IF length(p_code) <= 64 THEN
    v_code := regexp_replace(p_code, '[\s-]', '', 'g');
  END IF;
  IF v_code ~ '^[0-9A-Za-z]{8,32}$' THEN
    SELECT c.id INTO enrolled_course_id
      FROM institution.course_enrollment_code e
      JOIN institution.course c ON c.id = e.course_id
     WHERE e.code_hash = sha256(convert_to(upper(v_code), 'UTF8'))
       AND e.active AND e.valid_until > now()
       AND c.institution_id = actor.institution_id;
  END IF;
  IF enrolled_course_id IS NULL THEN
    INSERT INTO institution.enrollment_attempt (user_id) VALUES (actor.user_id);
    outcome := 'refused';
    RETURN;
  END IF;

  INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
  VALUES (enrolled_course_id, actor.institution_id, actor.user_id, 'student')
  ON CONFLICT (course_id, user_id) WHERE member_to IS NULL DO NOTHING;
  outcome := 'enrolled';
END
$$;

-- The hash of a code is not granted: a teacher reads when a code expires and
-- whether it is active, nothing that could be tested against a guess.
GRANT SELECT ON
  institution.institution_settings, institution.institution_role, institution.course, institution.course_member
TO ductus_app;
GRANT SELECT (id, course_id, valid_until, active, created_by, created_at)
  ON institution.course_enrollment_code TO ductus_app;
GRANT EXECUTE ON FUNCTION
  institution.actor_has_role(text),
  institution.actor_course_role(uuid),
  institution.confirm_teacher_role(uuid),
  institution.create_course(text, text, text),
  institution.create_enrollment_code(uuid, timestamptz),
  institution.revoke_enrollment_code(uuid),
  institution.enroll_with_code(text)
TO ductus_app;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
DROP SCHEMA institution CASCADE;

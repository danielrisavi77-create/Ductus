-- migrate:up
-- Institution module for the demo, part 2 (B-7): who removes whom, and the
-- findings of the QA of part 1. Rules as in part 1: ductus_app only reads,
-- every change goes through a SECURITY DEFINER function that takes the caller
-- from app.current_actor(), and errors carry no input.
--
-- Owner decisions of 10 Oct 2026: the teacher removes a student and the
-- administrator removes a teacher. A student the teacher removed cannot come
-- back with the code until a teacher of the course allows it; the code keeps
-- working for everyone else, and a student who left alone may still return.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- A name shown in lists: one line with at least one visible character and
-- without control, bidirectional, zero-width or soft-hyphen characters. The
-- last class lists what renders as nothing: spaces of every width, fillers,
-- the blank Braille cell, variation selectors and tag characters.
CREATE OR REPLACE FUNCTION institution.is_plain_label(p_text text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT length(p_text) BETWEEN 1 AND 200
     AND p_text !~ '[\x0001-\x001F\x007F-\x009F\x00AD\x061C\x180E\x200B-\x200F\x2028-\x202E\x2060-\x206F\xFEFF\xFFF9-\xFFFB]'
     AND p_text ~ '[^\s\x00A0\x034F\x115F\x1160\x1680\x17B4\x17B5\x180B-\x180D\x2000-\x200A\x202F\x205F\x2800\x3000\x3164\xFE00-\xFE0F\xFFA0\U000E0000-\U000E0FFF]'
$$;
-- The stricter rule also guards two CHECK constraints. A stored name that no
-- longer passes would break a later restore, so the migration stops instead.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM institution.course c WHERE NOT institution.is_plain_label(c.name))
     OR EXISTS (SELECT 1 FROM institution.institution_settings s WHERE NOT institution.is_plain_label(s.display_name)) THEN
    RAISE EXCEPTION 'a stored name does not pass the stricter is_plain_label';
  END IF;
END
$$;

-- removed_by names the teacher who ended a student's membership; an ended
-- membership without it means the member left. return_allowed_at is set when
-- a teacher lets the removed student enrol again.
ALTER TABLE institution.course_member
  ADD COLUMN removed_by uuid,
  ADD COLUMN return_allowed_at timestamptz,
  ADD CONSTRAINT course_member_removed_by_fkey
    FOREIGN KEY (removed_by, institution_id) REFERENCES identity.user_account (id, institution_id),
  ADD CONSTRAINT course_member_removal_check CHECK (
    (removed_by IS NULL OR (role = 'student' AND member_to IS NOT NULL))
    AND (return_allowed_at IS NULL OR removed_by IS NOT NULL)
  );

-- A teacher of the course ends a student's membership. False when the student
-- has no open membership there. The lock is the one enroll_with_code takes
-- for that user, so a removal and an enrolment of the same student never
-- interleave.
CREATE FUNCTION institution.remove_student(p_course_id uuid, p_student_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('institution.enroll_with_code:' || p_student_id, 0));
  UPDATE institution.course_member m
     SET member_to = greatest(now(), m.member_from), removed_by = actor.user_id
   WHERE m.course_id = p_course_id AND m.user_id = p_student_id AND m.role = 'student' AND m.member_to IS NULL;
  RETURN FOUND;
END
$$;

-- A teacher of the course lets a removed student enrol again; the student
-- still needs the code. False when nothing was blocking that student.
CREATE FUNCTION institution.allow_student_return(p_course_id uuid, p_student_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  UPDATE institution.course_member m SET return_allowed_at = now()
   WHERE m.course_id = p_course_id AND m.user_id = p_student_id
     AND m.removed_by IS NOT NULL AND m.return_allowed_at IS NULL;
  RETURN FOUND;
END
$$;

-- An administrator revokes a confirmed teacher role at the own institution.
-- The teacher's memberships stay, and open nothing without the role (C-23).
-- False when that user holds no such role here.
CREATE FUNCTION institution.revoke_teacher_role(p_teacher_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF NOT institution.actor_has_role('admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  UPDATE institution.institution_role r SET revoked_at = now()
   WHERE r.institution_id = actor.institution_id AND r.user_id = p_teacher_id
     AND r.role = 'teacher' AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL;
  RETURN FOUND;
END
$$;

-- As in part 1, with two more cases that answer 'refused' exactly like a
-- wrong code, attempt counted and no course named: the student a teacher
-- removed and has not let back, and the caller whose membership opens nothing
-- (a teacher of that course whose role was revoked). 'enrolled' now always
-- means that the caller has a part in the course.
CREATE OR REPLACE FUNCTION institution.enroll_with_code(p_code text, OUT outcome text, OUT enrolled_course_id uuid)
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
       AND c.institution_id = actor.institution_id
       AND NOT EXISTS (
         SELECT 1 FROM institution.course_member m
          WHERE m.course_id = c.id AND m.user_id = actor.user_id
            AND m.removed_by IS NOT NULL AND m.return_allowed_at IS NULL
       );
  END IF;
  IF enrolled_course_id IS NOT NULL THEN
    INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
    VALUES (enrolled_course_id, actor.institution_id, actor.user_id, 'student')
    ON CONFLICT (course_id, user_id) WHERE member_to IS NULL DO NOTHING;
    IF institution.actor_course_role(enrolled_course_id) IS NOT NULL THEN
      outcome := 'enrolled';
      RETURN;
    END IF;
  END IF;
  enrolled_course_id := NULL;
  INSERT INTO institution.enrollment_attempt (user_id) VALUES (actor.user_id);
  outcome := 'refused';
END
$$;

GRANT EXECUTE ON FUNCTION
  institution.remove_student(uuid, uuid),
  institution.allow_student_return(uuid, uuid),
  institution.revoke_teacher_role(uuid)
TO ductus_app;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
-- Puts back part 1 as it was: its two functions and its course_member.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION institution.remove_student(uuid, uuid);
DROP FUNCTION institution.allow_student_return(uuid, uuid);
DROP FUNCTION institution.revoke_teacher_role(uuid);

CREATE OR REPLACE FUNCTION institution.enroll_with_code(p_code text, OUT outcome text, OUT enrolled_course_id uuid)
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

ALTER TABLE institution.course_member
  DROP CONSTRAINT course_member_removal_check,
  DROP CONSTRAINT course_member_removed_by_fkey,
  DROP COLUMN removed_by,
  DROP COLUMN return_allowed_at;

-- The rule of part 1; its class is the same, spelled here in hexadecimal.
CREATE OR REPLACE FUNCTION institution.is_plain_label(p_text text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT length(p_text) BETWEEN 1 AND 200 AND p_text ~ '\S'
     AND p_text !~ '[\x0001-\x001F\x007F-\x009F\x200B-\x200F\x2028-\x202E\x2060-\x2064\x2066-\x2069\xFEFF]'
$$;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

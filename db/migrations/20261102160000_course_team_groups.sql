-- migrate:up
-- DAN-351, M2.7-P01 (contract on #1091, c.6569002820): the manual model of a
-- course's holder and of its seminar groups, with their teachers and
-- students. A model only: nothing here decides access to a work. What a
-- holder or a group teacher may do is M2.7-P02 (one decision, can()), so
-- institution.actor_course_role and every policy stay as they were. A group
-- teacher is not a course member and gets no course role from a group.
--
-- Rows are never deleted: an assignment ends by setting valid_to, so the
-- history stays. Only a teacher of the course changes these rows, through
-- the functions below; ductus_app reads them through RLS.
--
-- Errors carry no input, as in the rest of the schema: ZD403 not allowed
-- (also for what does not exist), ZD409 the student is already in another
-- group of the course, ZD422 invalid input.
SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- The holder of a course: at most one open row per course.
CREATE TABLE institution.course_holder (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  user_id uuid NOT NULL,
  assigned_by uuid NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  FOREIGN KEY (course_id, institution_id) REFERENCES institution.course (id, institution_id),
  FOREIGN KEY (user_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (assigned_by, institution_id) REFERENCES identity.user_account (id, institution_id),
  CHECK (valid_to >= valid_from)
);
-- squawk-ignore require-concurrent-index-creation
CREATE UNIQUE INDEX course_holder_open_idx ON institution.course_holder (course_id) WHERE valid_to IS NULL;

-- A seminar group of a course. It is not group work (D-78): every work
-- stays one student's.
CREATE TABLE institution.seminar_group (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  name text NOT NULL CHECK (institution.is_plain_label(name)),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, institution_id),
  UNIQUE (id, course_id, institution_id),
  UNIQUE (course_id, name),
  FOREIGN KEY (course_id, institution_id) REFERENCES institution.course (id, institution_id),
  FOREIGN KEY (created_by, institution_id) REFERENCES identity.user_account (id, institution_id)
);

-- A teacher of a group and a student of a group. Both carry the course, so
-- a read can be decided without a join and a student can hold at most one
-- open group per course.
CREATE TABLE institution.seminar_group_teacher (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  course_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  user_id uuid NOT NULL,
  assigned_by uuid NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  FOREIGN KEY (group_id, course_id, institution_id) REFERENCES institution.seminar_group (id, course_id, institution_id),
  FOREIGN KEY (user_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (assigned_by, institution_id) REFERENCES identity.user_account (id, institution_id),
  CHECK (valid_to >= valid_from)
);
-- squawk-ignore require-concurrent-index-creation
CREATE UNIQUE INDEX seminar_group_teacher_open_idx ON institution.seminar_group_teacher (group_id, user_id)
  WHERE valid_to IS NULL;
CREATE TABLE institution.seminar_group_member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  course_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  user_id uuid NOT NULL,
  assigned_by uuid NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  FOREIGN KEY (group_id, course_id, institution_id) REFERENCES institution.seminar_group (id, course_id, institution_id),
  FOREIGN KEY (user_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (assigned_by, institution_id) REFERENCES identity.user_account (id, institution_id),
  CHECK (valid_to >= valid_from)
);
-- squawk-ignore require-concurrent-index-creation
CREATE UNIQUE INDEX seminar_group_member_open_idx ON institution.seminar_group_member (course_id, user_id)
  WHERE valid_to IS NULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['course_holder', 'seminar_group', 'seminar_group_teacher', 'seminar_group_member'] LOOP
    EXECUTE format('ALTER TABLE institution.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE institution.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON institution.%I TO ductus_identity USING (true) WITH CHECK (true)', t || '_owner', t
    );
  END LOOP;
END
$$;

-- A teacher of the course reads all of it; anyone else only the own rows.
-- A group teacher does not read the group itself: what a group opens is P02.
CREATE POLICY course_holder_read ON institution.course_holder FOR SELECT TO ductus_app
  USING (user_id = (SELECT app.current_user_id()) OR institution.actor_course_role(course_id) = 'teacher');
CREATE POLICY seminar_group_read ON institution.seminar_group FOR SELECT TO ductus_app
  USING (institution.actor_course_role(course_id) = 'teacher');
CREATE POLICY seminar_group_teacher_read ON institution.seminar_group_teacher FOR SELECT TO ductus_app
  USING (user_id = (SELECT app.current_user_id()) OR institution.actor_course_role(course_id) = 'teacher');
CREATE POLICY seminar_group_member_read ON institution.seminar_group_member FOR SELECT TO ductus_app
  USING (user_id = (SELECT app.current_user_id()) OR institution.actor_course_role(course_id) = 'teacher');

-- The caller, who must be a teacher of the course: ZD403 otherwise, the same
-- as for a course that does not exist (or a null one, for an unknown group).
CREATE FUNCTION institution.require_course_teacher(p_course_id uuid, OUT user_id uuid, OUT institution_id uuid)
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  SELECT a.user_id, a.institution_id INTO user_id, institution_id FROM institution.require_actor() a;
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
END
$$;

-- Is the user a confirmed, unrevoked teacher of the course's institution?
-- The institution comes from the course, never from a caller (033).
CREATE FUNCTION institution.is_confirmed_teacher(p_user_id uuid, p_course_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM institution.institution_role r JOIN institution.course c ON c.institution_id = r.institution_id
    WHERE c.id = p_course_id AND r.user_id = p_user_id AND r.role = 'teacher'
      AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
  )
$$;

-- Names the holder, who must be an open teacher of the course with the
-- teacher role, and ends the previous holder. Repeating it changes nothing.
CREATE FUNCTION institution.set_course_holder(p_course_id uuid, p_holder_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_course_teacher(p_course_id);
  IF NOT institution.is_confirmed_teacher(p_holder_id, p_course_id) OR NOT EXISTS (
       SELECT 1 FROM institution.course_member m
       WHERE m.course_id = p_course_id AND m.user_id = p_holder_id AND m.role = 'teacher' AND m.member_to IS NULL
     ) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  -- Two replacements of the same course wait for each other here.
  PERFORM 1 FROM institution.course c WHERE c.id = p_course_id FOR NO KEY UPDATE;
  IF EXISTS (SELECT 1 FROM institution.course_holder h
             WHERE h.course_id = p_course_id AND h.user_id = p_holder_id AND h.valid_to IS NULL) THEN
    RETURN;
  END IF;
  UPDATE institution.course_holder h SET valid_to = now() WHERE h.course_id = p_course_id AND h.valid_to IS NULL;
  INSERT INTO institution.course_holder (course_id, institution_id, user_id, assigned_by)
  VALUES (p_course_id, actor.institution_id, p_holder_id, actor.user_id);
END
$$;

-- Creates a group of the course. The same name again returns the same group.
CREATE FUNCTION institution.create_seminar_group(p_course_id uuid, p_name text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_group uuid;
BEGIN
  SELECT * INTO actor FROM institution.require_course_teacher(p_course_id);
  IF NOT coalesce(institution.is_plain_label(p_name), false) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  INSERT INTO institution.seminar_group (course_id, institution_id, name, created_by)
  VALUES (p_course_id, actor.institution_id, p_name, actor.user_id)
  ON CONFLICT (course_id, name) DO NOTHING
  RETURNING id INTO v_group;
  IF v_group IS NULL THEN
    SELECT g.id INTO STRICT v_group FROM institution.seminar_group g WHERE g.course_id = p_course_id AND g.name = p_name;
  END IF;
  RETURN v_group;
END
$$;

-- Adds a confirmed teacher of the institution to a group. Repeating it
-- changes nothing.
CREATE FUNCTION institution.assign_group_teacher(p_group_id uuid, p_teacher_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_course uuid;
BEGIN
  SELECT g.course_id INTO v_course FROM institution.seminar_group g WHERE g.id = p_group_id;
  SELECT * INTO actor FROM institution.require_course_teacher(v_course);
  IF NOT institution.is_confirmed_teacher(p_teacher_id, v_course) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  INSERT INTO institution.seminar_group_teacher (group_id, course_id, institution_id, user_id, assigned_by)
  VALUES (p_group_id, v_course, actor.institution_id, p_teacher_id, actor.user_id)
  ON CONFLICT (group_id, user_id) WHERE valid_to IS NULL DO NOTHING;
END
$$;

-- Adds an open student of the course to a group. A student already in
-- another group of the course is refused, never moved silently.
CREATE FUNCTION institution.assign_group_student(p_group_id uuid, p_student_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_course uuid;
BEGIN
  SELECT g.course_id INTO v_course FROM institution.seminar_group g WHERE g.id = p_group_id;
  SELECT * INTO actor FROM institution.require_course_teacher(v_course);
  IF NOT EXISTS (
       SELECT 1 FROM institution.course_member m
       WHERE m.course_id = v_course AND m.user_id = p_student_id AND m.role = 'student' AND m.member_to IS NULL
     ) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  INSERT INTO institution.seminar_group_member (group_id, course_id, institution_id, user_id, assigned_by)
  VALUES (p_group_id, v_course, actor.institution_id, p_student_id, actor.user_id)
  ON CONFLICT (course_id, user_id) WHERE valid_to IS NULL DO NOTHING;
  IF NOT FOUND AND NOT EXISTS (
       SELECT 1 FROM institution.seminar_group_member s
       WHERE s.group_id = p_group_id AND s.user_id = p_student_id AND s.valid_to IS NULL
     ) THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
END
$$;

-- Ends the open place of a teacher or a student in a group. Repeating it
-- changes nothing.
CREATE FUNCTION institution.end_group_assignment(p_group_id uuid, p_user_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_course uuid;
BEGIN
  SELECT g.course_id INTO v_course FROM institution.seminar_group g WHERE g.id = p_group_id;
  PERFORM institution.require_course_teacher(v_course);
  UPDATE institution.seminar_group_teacher t SET valid_to = now()
   WHERE t.group_id = p_group_id AND t.user_id = p_user_id AND t.valid_to IS NULL;
  UPDATE institution.seminar_group_member s SET valid_to = now()
   WHERE s.group_id = p_group_id AND s.user_id = p_user_id AND s.valid_to IS NULL;
END
$$;

REVOKE ALL ON FUNCTION
  institution.require_course_teacher(uuid),
  institution.is_confirmed_teacher(uuid, uuid),
  institution.set_course_holder(uuid, uuid),
  institution.create_seminar_group(uuid, text),
  institution.assign_group_teacher(uuid, uuid),
  institution.assign_group_student(uuid, uuid),
  institution.end_group_assignment(uuid, uuid)
FROM PUBLIC;
GRANT SELECT ON
  institution.course_holder, institution.seminar_group, institution.seminar_group_teacher,
  institution.seminar_group_member
TO ductus_app;
GRANT EXECUTE ON FUNCTION
  institution.set_course_holder(uuid, uuid),
  institution.create_seminar_group(uuid, text),
  institution.assign_group_teacher(uuid, uuid),
  institution.assign_group_student(uuid, uuid),
  institution.end_group_assignment(uuid, uuid)
TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION institution.end_group_assignment(uuid, uuid), institution.assign_group_student(uuid, uuid),
  institution.assign_group_teacher(uuid, uuid), institution.create_seminar_group(uuid, text),
  institution.set_course_holder(uuid, uuid), institution.is_confirmed_teacher(uuid, uuid),
  institution.require_course_teacher(uuid);
DROP TABLE institution.seminar_group_member, institution.seminar_group_teacher, institution.seminar_group,
  institution.course_holder;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

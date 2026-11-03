-- migrate:up
-- DAN-351, M2.7-P03 (contract on #1091, c.6584738431): the editor of a
-- course, the substitution of a team member, and who of the team is told
-- about a student's work. A model and a reader only: nothing here opens a
-- work, a course or a notification. institution.actor_course_role, can() and
-- every policy stay as they were (T053); an editor or a substitute gets no
-- access from these rows.
--
-- A team member of a course is a confirmed, unrevoked teacher of its
-- institution who is an open teacher of the course or of one of its groups,
-- and is not an open student of it. That is decided at every read; nothing
-- here remembers it.
--
-- Rows are never deleted: an editor ends by valid_to, a substitution by
-- ended_at, so the history stays. Only a teacher of the course changes them,
-- through the functions below; ductus_app reads them through RLS. Errors
-- carry no input: ZD403 not allowed (also for what does not exist), ZD422
-- invalid input.
SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- The editor of a course: at most one open row per course.
CREATE TABLE institution.course_editor (
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
CREATE UNIQUE INDEX course_editor_open_idx ON institution.course_editor (course_id) WHERE valid_to IS NULL;

-- A substitute for an absent team member, from valid_from up to (not
-- including) valid_to, which is always set. ended_at ends it early. At most
-- one substitution of an absent per course is not ended.
CREATE TABLE institution.team_substitution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  absent_id uuid NOT NULL,
  substitute_id uuid NOT NULL,
  assigned_by uuid NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz NOT NULL,
  ended_at timestamptz,
  FOREIGN KEY (course_id, institution_id) REFERENCES institution.course (id, institution_id),
  FOREIGN KEY (absent_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (substitute_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (assigned_by, institution_id) REFERENCES identity.user_account (id, institution_id),
  CHECK (absent_id <> substitute_id),
  CHECK (valid_to > valid_from),
  CHECK (ended_at >= valid_from)
);
-- squawk-ignore require-concurrent-index-creation
CREATE UNIQUE INDEX team_substitution_open_idx ON institution.team_substitution (course_id, absent_id)
  WHERE ended_at IS NULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['course_editor', 'team_substitution'] LOOP
    EXECUTE format('ALTER TABLE institution.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE institution.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON institution.%I TO ductus_identity USING (true) WITH CHECK (true)', t || '_owner', t
    );
  END LOOP;
END
$$;

-- A teacher of the course reads all of it; anyone else only the own rows.
CREATE POLICY course_editor_read ON institution.course_editor FOR SELECT TO ductus_app
  USING (user_id = (SELECT app.current_user_id()) OR institution.actor_course_role(course_id) = 'teacher');
CREATE POLICY team_substitution_read ON institution.team_substitution FOR SELECT TO ductus_app
  USING (absent_id = (SELECT app.current_user_id()) OR substitute_id = (SELECT app.current_user_id())
         OR institution.actor_course_role(course_id) = 'teacher');

-- Is the user a team member of the course now? See the header.
CREATE FUNCTION institution.is_course_team_member(p_user_id uuid, p_course_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT institution.is_confirmed_teacher(p_user_id, p_course_id)
     AND (EXISTS (SELECT 1 FROM institution.course_member m
                  WHERE m.course_id = p_course_id AND m.user_id = p_user_id AND m.role = 'teacher'
                    AND m.member_to IS NULL)
          OR EXISTS (SELECT 1 FROM institution.seminar_group_teacher t
                     WHERE t.course_id = p_course_id AND t.user_id = p_user_id AND t.valid_to IS NULL))
     AND NOT EXISTS (SELECT 1 FROM institution.course_member m
                     WHERE m.course_id = p_course_id AND m.user_id = p_user_id AND m.role = 'student'
                       AND m.member_to IS NULL)
$$;

-- Is the user an open teacher of the course itself, and a team member?
CREATE FUNCTION institution.is_course_team_teacher(p_user_id uuid, p_course_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT institution.is_course_team_member(p_user_id, p_course_id)
     AND EXISTS (SELECT 1 FROM institution.course_member m
                 WHERE m.course_id = p_course_id AND m.user_id = p_user_id AND m.role = 'teacher'
                   AND m.member_to IS NULL)
$$;

-- Names the editor, who must be a team member and an open teacher of the
-- course, and ends the previous editor. Repeating it changes nothing. Ends
-- and starts as set_course_holder (never an end before its start).
CREATE FUNCTION institution.set_course_editor(p_course_id uuid, p_editor_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_ended timestamptz;
BEGIN
  SELECT * INTO actor FROM institution.require_course_teacher(p_course_id);
  IF NOT institution.is_course_team_teacher(p_editor_id, p_course_id) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  -- Two changes of the same course wait for each other here.
  PERFORM 1 FROM institution.course c WHERE c.id = p_course_id FOR NO KEY UPDATE;
  IF EXISTS (SELECT 1 FROM institution.course_editor e
             WHERE e.course_id = p_course_id AND e.user_id = p_editor_id AND e.valid_to IS NULL) THEN
    RETURN;
  END IF;
  UPDATE institution.course_editor e SET valid_to = greatest(now(), e.valid_from)
   WHERE e.course_id = p_course_id AND e.valid_to IS NULL
  RETURNING e.valid_to INTO v_ended;
  INSERT INTO institution.course_editor (course_id, institution_id, user_id, assigned_by, valid_from)
  VALUES (p_course_id, actor.institution_id, p_editor_id, actor.user_id, greatest(now(), v_ended));
END
$$;

-- Ends the open editor of the course. Repeating it changes nothing.
CREATE FUNCTION institution.end_course_editor(p_course_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM institution.require_course_teacher(p_course_id);
  PERFORM 1 FROM institution.course c WHERE c.id = p_course_id FOR NO KEY UPDATE;
  UPDATE institution.course_editor e SET valid_to = greatest(now(), e.valid_from)
   WHERE e.course_id = p_course_id AND e.valid_to IS NULL;
END
$$;

-- Names a substitute for an absent team member until p_valid_to, at most a
-- year ahead, and ends the absent's previous substitution. Both must be team
-- members now and differ. The same call again returns the same substitution.
CREATE FUNCTION institution.set_team_substitution(
  p_course_id uuid, p_absent_id uuid, p_substitute_id uuid, p_valid_to timestamptz
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_id uuid;
BEGIN
  SELECT * INTO actor FROM institution.require_course_teacher(p_course_id);
  IF p_absent_id IS NOT DISTINCT FROM p_substitute_id
     OR NOT institution.is_course_team_member(p_absent_id, p_course_id)
     OR NOT institution.is_course_team_member(p_substitute_id, p_course_id)
     OR p_valid_to IS NULL OR p_valid_to <= now() OR p_valid_to > now() + interval '1 year' THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  PERFORM 1 FROM institution.course c WHERE c.id = p_course_id FOR NO KEY UPDATE;
  SELECT s.id INTO v_id FROM institution.team_substitution s
   WHERE s.course_id = p_course_id AND s.absent_id = p_absent_id AND s.ended_at IS NULL
     AND s.substitute_id = p_substitute_id AND s.valid_to = p_valid_to;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  UPDATE institution.team_substitution s SET ended_at = greatest(now(), s.valid_from)
   WHERE s.course_id = p_course_id AND s.absent_id = p_absent_id AND s.ended_at IS NULL;
  INSERT INTO institution.team_substitution (course_id, institution_id, absent_id, substitute_id, assigned_by, valid_to)
  VALUES (p_course_id, actor.institution_id, p_absent_id, p_substitute_id, actor.user_id, p_valid_to)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- Ends a substitution early, never before it began. Repeating it changes
-- nothing; an unknown substitution reads as not allowed.
CREATE FUNCTION institution.end_team_substitution(p_substitution_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_course uuid;
BEGIN
  SELECT s.course_id INTO v_course FROM institution.team_substitution s WHERE s.id = p_substitution_id;
  PERFORM institution.require_course_teacher(v_course);
  UPDATE institution.team_substitution s SET ended_at = greatest(now(), s.valid_from)
   WHERE s.id = p_substitution_id AND s.ended_at IS NULL;
END
$$;

-- Who of the team is told about a work of p_student in p_course, read from
-- the state now. Nobody unless the student is an open student of the
-- course. Otherwise the first level that has a team member: the teachers of
-- the student's open group, the editor, the holder, every teacher of the
-- course (the editor and the holder count only as open teachers of the
-- course). Each is then replaced by the substitute of a substitution in
-- force (valid_from <= now() < valid_to, not ended) if the substitute is a
-- team member, one step only. A team member is never a student of the
-- course, so the student is never among them. No application role calls
-- this; the writers of notifications (owner ductus_identity) will.
CREATE FUNCTION institution.team_notification_recipients(p_course_id uuid, p_student_id uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SET search_path = ''
AS $$
  WITH candidate (level, user_id) AS (
    SELECT 1, t.user_id
    FROM institution.seminar_group_member g
    JOIN institution.seminar_group_teacher t ON t.group_id = g.group_id AND t.valid_to IS NULL
    WHERE g.course_id = p_course_id AND g.user_id = p_student_id AND g.valid_to IS NULL
      AND institution.is_course_team_member(t.user_id, p_course_id)
    UNION ALL
    SELECT 2, e.user_id FROM institution.course_editor e
    WHERE e.course_id = p_course_id AND e.valid_to IS NULL AND institution.is_course_team_teacher(e.user_id, p_course_id)
    UNION ALL
    SELECT 3, h.user_id FROM institution.course_holder h
    WHERE h.course_id = p_course_id AND h.valid_to IS NULL AND institution.is_course_team_teacher(h.user_id, p_course_id)
    UNION ALL
    SELECT 4, m.user_id FROM institution.course_member m
    WHERE m.course_id = p_course_id AND m.role = 'teacher' AND m.member_to IS NULL
      AND institution.is_course_team_member(m.user_id, p_course_id)
  ),
  chosen AS (
    SELECT c.user_id FROM candidate c
    WHERE c.level = (SELECT min(level) FROM candidate)
      AND EXISTS (SELECT 1 FROM institution.course_member m
                  WHERE m.course_id = p_course_id AND m.user_id = p_student_id AND m.role = 'student'
                    AND m.member_to IS NULL)
  )
  SELECT DISTINCT coalesce(
    (SELECT s.substitute_id FROM institution.team_substitution s
     WHERE s.course_id = p_course_id AND s.absent_id = c.user_id AND s.ended_at IS NULL
       AND s.valid_from <= now() AND now() < s.valid_to
       AND institution.is_course_team_member(s.substitute_id, p_course_id)),
    c.user_id)
  FROM chosen c
$$;

REVOKE ALL ON FUNCTION
  institution.is_course_team_member(uuid, uuid),
  institution.is_course_team_teacher(uuid, uuid),
  institution.set_course_editor(uuid, uuid),
  institution.end_course_editor(uuid),
  institution.set_team_substitution(uuid, uuid, uuid, timestamptz),
  institution.end_team_substitution(uuid),
  institution.team_notification_recipients(uuid, uuid)
FROM PUBLIC;
GRANT SELECT ON institution.course_editor, institution.team_substitution TO ductus_app;
GRANT EXECUTE ON FUNCTION
  institution.set_course_editor(uuid, uuid),
  institution.end_course_editor(uuid),
  institution.set_team_substitution(uuid, uuid, uuid, timestamptz),
  institution.end_team_substitution(uuid)
TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION institution.team_notification_recipients(uuid, uuid), institution.end_team_substitution(uuid),
  institution.set_team_substitution(uuid, uuid, uuid, timestamptz), institution.end_course_editor(uuid),
  institution.set_course_editor(uuid, uuid), institution.is_course_team_teacher(uuid, uuid),
  institution.is_course_team_member(uuid, uuid);
DROP TABLE institution.team_substitution, institution.course_editor;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

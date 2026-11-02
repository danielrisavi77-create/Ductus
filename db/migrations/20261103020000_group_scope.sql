-- migrate:up
-- DAN-351, M2.5-P01 (contract on #1091, c.6582474569): the students and works
-- of a seminar group for its teacher (variant A). A teacher of the course,
-- the holder among them, keeps the whole course as before; a teacher of a
-- seminar group who is not a member of the course gets the students of the
-- group, and their works, and nothing else of the course.
--
-- One condition, institution.actor_group_student, joins the four places
-- every reader of a student or a work goes through: collaboration.actor_role
-- (text, comments, summary, replay, fast path opening), institution.can, and
-- the two lists app.teacher_assignment_students and app.teacher_course_students.
-- The three that open a work use institution.actor_group_work, which also
-- keeps a work started before the current group place closed (#1372, repair
-- round 2); the course list shows names only and keeps actor_group_student.
-- actor_course_role and actor_assignment_role, and with them every policy,
-- are not changed (T053): the course, its assignments and its groups stay
-- unreadable to a group teacher. Same signatures, owners and grants; no
-- table, grant to ductus_app or policy is added.
SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA institution, app, collaboration TO ductus_identity;
GRANT USAGE, CREATE ON SCHEMA collaboration TO ductus_evidence;

-- When the student's work on the assignment was started (its project row,
-- written once by the server at now()), or NULL while there is none. Owned by
-- the evidence role and executable only by the identity role, as
-- collaboration.document_scope (20261017120000) (#1372, repair round 2).
SET LOCAL ROLE ductus_evidence;
CREATE FUNCTION collaboration.work_started_at(p_institution_id uuid, p_assignment_id uuid, p_student_id uuid)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.created_at FROM evidence.project p
   WHERE p.assignment_id = p_assignment_id AND p.institution_id = p_institution_id AND p.principal_id = p_student_id
$$;
REVOKE ALL ON FUNCTION collaboration.work_started_at(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collaboration.work_started_at(uuid, uuid, uuid) TO ductus_identity;

-- The latest start of a work of the given students on the given assignments,
-- or NULL while there is none; read by the two assign functions below after
-- their locks (#1372, repair round 3). Owned and granted as work_started_at.
CREATE FUNCTION collaboration.works_started_last(p_institution_id uuid, p_assignment_ids uuid[], p_student_ids uuid[])
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT max(p.created_at) FROM evidence.project p
   WHERE p.institution_id = p_institution_id AND p.assignment_id = ANY (p_assignment_ids)
     AND p.principal_id = ANY (p_student_ids)
$$;
REVOKE ALL ON FUNCTION collaboration.works_started_last(uuid, uuid[], uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collaboration.works_started_last(uuid, uuid[], uuid[]) TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- True while the actor of the session holds a confirmed and unrevoked
-- teacher role, is an open teacher of a seminar group of the course, and the
-- student is an open member of that group and still an open student of the
-- course (a removal from the course does not end the group membership,
-- 20261102160000). Nothing else falls back to the whole course: no group, an
-- ended assignment or an unconfirmed role is false. A student is in at most
-- one open group of a course, so moving her to another group moves who sees
-- her one work. It holds whether or not the actor is herself a student of
-- the course (enrolled with a code), but never for her own work, not even
-- in her own group (#1372, repair round 1). Called only from definer
-- functions of ductus_identity.
CREATE FUNCTION institution.actor_group_student(p_course_id uuid, p_student_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM app.current_actor() a
      JOIN institution.institution_role r ON r.user_id = a.user_id AND r.institution_id = a.institution_id
       AND r.role = 'teacher' AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
      JOIN institution.seminar_group_teacher t ON t.user_id = a.user_id AND t.institution_id = a.institution_id
       AND t.course_id = p_course_id AND t.valid_to IS NULL
      JOIN institution.seminar_group_member g ON g.group_id = t.group_id AND g.institution_id = t.institution_id
       AND g.user_id = p_student_id AND g.valid_to IS NULL
      JOIN institution.course_member m ON m.course_id = p_course_id AND m.institution_id = a.institution_id
       AND m.user_id = p_student_id AND m.role = 'student' AND m.member_to IS NULL
     WHERE p_student_id IS DISTINCT FROM a.user_id
  )
$$;
REVOKE ALL ON FUNCTION institution.actor_group_student(uuid, uuid) FROM PUBLIC;

-- The work of a student of the actor's group on an assignment of the course
-- (#1372, repair round 2; DAN-351, dopuna 27. 10., points 4 and 5): as
-- actor_group_student, and the work was started no earlier than both the
-- student's place in the group and the actor's place as its teacher. A work
-- started before that, in another group, before a handover or before the
-- actor's earlier place ended, stays closed to her until an explicit transfer
-- (not in this migration). A work's start is the now() of the transaction
-- that wrote it; a place starts at its own now(), or just after a work
-- committed before it whose transaction began later, which
-- assign_group_student and assign_group_teacher below serialise with
-- app.open_student_work (#1372, repair round 3). So the comparison follows
-- the order of commits, not only the clocks. A student with no work yet has nothing earlier.
CREATE FUNCTION institution.actor_group_work(p_assignment_id uuid, p_student_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM app.current_actor() a
      JOIN institution.assignment s ON s.id = p_assignment_id AND s.institution_id = a.institution_id
      JOIN institution.seminar_group_teacher t ON t.user_id = a.user_id AND t.institution_id = a.institution_id
       AND t.course_id = s.course_id AND t.valid_to IS NULL
      JOIN institution.seminar_group_member g ON g.group_id = t.group_id AND g.institution_id = t.institution_id
       AND g.user_id = p_student_id AND g.valid_to IS NULL
     WHERE institution.actor_group_student(s.course_id, p_student_id)
       AND NOT coalesce(collaboration.work_started_at(s.institution_id, s.id, p_student_id)
                          < greatest(g.valid_from, t.valid_from), false)
  )
$$;
REVOKE ALL ON FUNCTION institution.actor_group_work(uuid, uuid) FROM PUBLIC;

-- As 20261017120000, with the group teacher: an actor who is not a teacher
-- of the assignment is its teacher for the work of a student of her group
-- started within their current places (actor_group_work), also when she is
-- a student of the course; her own work stays hers.
CREATE OR REPLACE FUNCTION collaboration.actor_role(p_institution_id uuid, p_assignment_id uuid, p_owner_id uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_institution_id IS DISTINCT FROM a.institution_id THEN NULL
    WHEN institution.actor_assignment_role(p_assignment_id) = 'teacher' THEN 'teacher'
    WHEN institution.actor_assignment_role(p_assignment_id) = 'student' AND p_owner_id = a.user_id THEN 'student'
    WHEN institution.actor_group_work(p_assignment_id, p_owner_id) THEN 'teacher'
  END
  FROM app.current_actor() a
$$;

-- As 20261102200000, with the same group branch, so that db/tests/098 still
-- finds no cell where can() and actor_role differ.
CREATE OR REPLACE FUNCTION institution.can(p_action text, p_document_id text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_institution uuid;
  v_scope record;
  v_confirmed boolean;
  v_relation text;
  v_teacher boolean;
  v_owner boolean;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('read', 'comment', 'open_fast_path', 'write', 'propose') THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;

  SELECT a.user_id, a.institution_id INTO v_user, v_institution FROM app.current_actor() a;
  IF v_user IS NULL OR p_document_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT s.institution_id, s.assignment_id, s.principal_id INTO v_scope
  FROM collaboration.document_scope(p_document_id) s;
  IF v_scope.institution_id IS DISTINCT FROM v_institution THEN
    RETURN false;
  END IF;

  v_confirmed := EXISTS (
    SELECT 1 FROM institution.institution_role r
    WHERE r.user_id = v_user AND r.institution_id = v_institution AND r.role = 'teacher'
      AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
  );

  -- The actor's relation to the assignment of the work: through the course,
  -- or through the mentorship. An assignment has exactly one of the two.
  -- Unless a teacher of the course, through a seminar group of it whose
  -- teacher the actor is and whose member the owner is, also when the actor
  -- is a student of the course; never for the actor's own work (as
  -- actor_role).
  SELECT CASE
           WHEN a.course_id IS NOT NULL THEN (
             SELECT CASE
                      WHEN m.role = 'teacher' THEN 'teacher'
                      WHEN institution.actor_group_work(a.id, v_scope.principal_id) THEN 'teacher'
                      ELSE m.role
                    END
             FROM (SELECT) one
             LEFT JOIN institution.course_member m
               ON m.course_id = a.course_id AND m.institution_id = v_institution
              AND m.user_id = v_user AND m.member_to IS NULL)
           ELSE (
             SELECT CASE WHEN ms.mentor_id = v_user THEN 'teacher'
                         WHEN ms.student_id = v_user THEN 'student' END
             FROM institution.mentorship ms
             WHERE ms.id = a.mentorship_id AND ms.institution_id = v_institution AND ms.ended_at IS NULL)
         END
  INTO v_relation
  FROM institution.assignment a
  WHERE a.id = v_scope.assignment_id AND a.institution_id = v_institution;

  v_teacher := v_relation IS NOT DISTINCT FROM 'teacher' AND v_confirmed;
  v_owner := v_relation IS NOT DISTINCT FROM 'student' AND v_scope.principal_id = v_user;

  RETURN CASE p_action
           WHEN 'read' THEN v_teacher OR v_owner
           WHEN 'write' THEN v_owner
           ELSE v_teacher
         END;
END
$$;

-- As 20261101150000, with the students of the actor's group for a course's
-- assignment the actor is not a teacher of (no part in it, or a student of
-- the course), unless the student's work was started before the current
-- places (actor_group_work). One open group per student and course, and the
-- actor never among them, so no student comes twice.
CREATE OR REPLACE FUNCTION app.teacher_assignment_students(p_assignment_id uuid) RETURNS TABLE (student_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.user_id
    FROM app.current_actor() a
    JOIN institution.assignment s ON s.id = p_assignment_id AND s.institution_id = a.institution_id
    JOIN institution.course_member m ON m.course_id = s.course_id AND m.institution_id = s.institution_id
   WHERE m.role = 'student' AND m.member_to IS NULL
     AND institution.actor_assignment_role(p_assignment_id) = 'teacher'
  UNION ALL
  SELECT t.student_id
    FROM app.current_actor() a
    JOIN institution.assignment s ON s.id = p_assignment_id AND s.institution_id = a.institution_id
    JOIN institution.mentorship t ON t.id = s.mentorship_id AND t.institution_id = s.institution_id
   WHERE t.ended_at IS NULL
     AND institution.actor_assignment_role(p_assignment_id) = 'teacher'
  UNION ALL
  SELECT g.user_id
    FROM app.current_actor() a
    JOIN institution.assignment s ON s.id = p_assignment_id AND s.institution_id = a.institution_id
    JOIN institution.seminar_group_member g ON g.course_id = s.course_id AND g.institution_id = s.institution_id
   WHERE g.valid_to IS NULL
     AND institution.actor_assignment_role(p_assignment_id) IS DISTINCT FROM 'teacher'
     AND institution.actor_group_work(p_assignment_id, g.user_id)
$$;

-- As 20261028140000, with the students of the actor's group for an actor who
-- is not a teacher of the course (no member of it, or a student of it).
CREATE OR REPLACE FUNCTION app.teacher_course_students(p_course_id uuid)
RETURNS TABLE (student_id uuid, given_name text, family_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor record;
  v_role text;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  -- Decided once per call, in the session's institution (actor_course_role).
  v_role := institution.actor_course_role(p_course_id);
  -- One open membership per student and course, so one row per student.
  RETURN QUERY
  SELECT m.user_id, n.given_name, n.family_name
    FROM institution.course_member m
    LEFT JOIN identity.person_name n ON n.user_id = m.user_id AND n.institution_id = m.institution_id
   WHERE m.course_id = p_course_id AND m.institution_id = v_actor.institution_id
     AND m.role = 'student' AND m.member_to IS NULL
     AND (v_role = 'teacher' OR institution.actor_group_student(p_course_id, m.user_id))
   ORDER BY m.user_id;
END
$$;

-- As 20261102160000, with the start of the place after every work of the
-- student committed before it (#1372, repair round 3). The group row is held
-- first, so a teacher assigned to the same group waits, and then the
-- student's open course membership FOR UPDATE: app.open_student_work holds
-- that row FOR SHARE until it commits (app.lock_student_assignment), so a
-- work in progress commits first and a later one waits for this one. A work
-- whose transaction began after this one, and so after now(), and committed
-- before the lock was granted, moves the start one microsecond past it; any
-- other committed work began at or before now() and is compared with now() as
-- before, equal not earlier (also a work of this very transaction).
CREATE OR REPLACE FUNCTION institution.assign_group_student(p_group_id uuid, p_student_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_course uuid;
  v_last timestamptz;
  v_from timestamptz;
BEGIN
  SELECT g.course_id INTO v_course FROM institution.seminar_group g WHERE g.id = p_group_id;
  SELECT * INTO actor FROM institution.require_course_teacher(v_course);
  PERFORM 1 FROM institution.seminar_group g WHERE g.id = p_group_id FOR NO KEY UPDATE;
  PERFORM 1 FROM institution.course_member m
   WHERE m.course_id = v_course AND m.user_id = p_student_id AND m.role = 'student' AND m.member_to IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  v_last := collaboration.works_started_last(
              actor.institution_id,
              ARRAY(SELECT s.id FROM institution.assignment s
                     WHERE s.course_id = v_course AND s.institution_id = actor.institution_id),
              ARRAY[p_student_id]);
  v_from := CASE WHEN v_last > now() THEN v_last + interval '1 microsecond' ELSE now() END;
  INSERT INTO institution.seminar_group_member (group_id, course_id, institution_id, user_id, assigned_by, valid_from)
  VALUES (p_group_id, v_course, actor.institution_id, p_student_id, actor.user_id, v_from)
  ON CONFLICT (course_id, user_id) WHERE valid_to IS NULL DO NOTHING;
  IF NOT FOUND AND NOT EXISTS (
       SELECT 1 FROM institution.seminar_group_member s
       WHERE s.group_id = p_group_id AND s.user_id = p_student_id AND s.valid_to IS NULL
     ) THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
END
$$;

-- As 20261102160000, with the start of the place after every work of the
-- group's open members committed before it: the group row first, then their
-- open course memberships FOR UPDATE in the order of their ids, as above.
CREATE OR REPLACE FUNCTION institution.assign_group_teacher(p_group_id uuid, p_teacher_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_course uuid;
  v_students uuid[];
  v_last timestamptz;
  v_from timestamptz;
BEGIN
  SELECT g.course_id INTO v_course FROM institution.seminar_group g WHERE g.id = p_group_id;
  SELECT * INTO actor FROM institution.require_course_teacher(v_course);
  IF NOT institution.is_confirmed_teacher(p_teacher_id, v_course) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  PERFORM 1 FROM institution.seminar_group g WHERE g.id = p_group_id FOR NO KEY UPDATE;
  SELECT array_agg(l.user_id) INTO v_students
    FROM (SELECT m.user_id
            FROM institution.course_member m
            JOIN institution.seminar_group_member s ON s.course_id = m.course_id AND s.user_id = m.user_id
           WHERE s.group_id = p_group_id AND s.valid_to IS NULL
             AND m.course_id = v_course AND m.role = 'student' AND m.member_to IS NULL
           ORDER BY m.id
             FOR UPDATE OF m) l;
  v_last := collaboration.works_started_last(
              actor.institution_id,
              ARRAY(SELECT a.id FROM institution.assignment a
                     WHERE a.course_id = v_course AND a.institution_id = actor.institution_id),
              v_students);
  v_from := CASE WHEN v_last > now() THEN v_last + interval '1 microsecond' ELSE now() END;
  INSERT INTO institution.seminar_group_teacher (group_id, course_id, institution_id, user_id, assigned_by, valid_from)
  VALUES (p_group_id, v_course, actor.institution_id, p_teacher_id, actor.user_id, v_from)
  ON CONFLICT (group_id, user_id) WHERE valid_to IS NULL DO NOTHING;
END
$$;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution, app, collaboration FROM ductus_identity;
REVOKE USAGE, CREATE ON SCHEMA collaboration FROM ductus_evidence;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
-- The definitions of 20261017120000, 20261102200000, 20261101150000,
-- 20261028140000 and 20261102160000.
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution, app, collaboration TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE OR REPLACE FUNCTION collaboration.actor_role(p_institution_id uuid, p_assignment_id uuid, p_owner_id uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_institution_id IS DISTINCT FROM a.institution_id THEN NULL
    WHEN institution.actor_assignment_role(p_assignment_id) = 'teacher' THEN 'teacher'
    WHEN institution.actor_assignment_role(p_assignment_id) = 'student' AND p_owner_id = a.user_id THEN 'student'
  END
  FROM app.current_actor() a
$$;

CREATE OR REPLACE FUNCTION institution.can(p_action text, p_document_id text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_institution uuid;
  v_scope record;
  v_confirmed boolean;
  v_relation text;
  v_teacher boolean;
  v_owner boolean;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('read', 'comment', 'open_fast_path', 'write', 'propose') THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  SELECT a.user_id, a.institution_id INTO v_user, v_institution FROM app.current_actor() a;
  IF v_user IS NULL OR p_document_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT s.institution_id, s.assignment_id, s.principal_id INTO v_scope
  FROM collaboration.document_scope(p_document_id) s;
  IF v_scope.institution_id IS DISTINCT FROM v_institution THEN
    RETURN false;
  END IF;
  v_confirmed := EXISTS (
    SELECT 1 FROM institution.institution_role r
    WHERE r.user_id = v_user AND r.institution_id = v_institution AND r.role = 'teacher'
      AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
  );
  SELECT CASE
           WHEN a.course_id IS NOT NULL THEN (
             SELECT m.role FROM institution.course_member m
             WHERE m.course_id = a.course_id AND m.institution_id = v_institution
               AND m.user_id = v_user AND m.member_to IS NULL)
           ELSE (
             SELECT CASE WHEN ms.mentor_id = v_user THEN 'teacher'
                         WHEN ms.student_id = v_user THEN 'student' END
             FROM institution.mentorship ms
             WHERE ms.id = a.mentorship_id AND ms.institution_id = v_institution AND ms.ended_at IS NULL)
         END
  INTO v_relation
  FROM institution.assignment a
  WHERE a.id = v_scope.assignment_id AND a.institution_id = v_institution;
  v_teacher := v_relation IS NOT DISTINCT FROM 'teacher' AND v_confirmed;
  v_owner := v_relation IS NOT DISTINCT FROM 'student' AND v_scope.principal_id = v_user;
  RETURN CASE p_action
           WHEN 'read' THEN v_teacher OR v_owner
           WHEN 'write' THEN v_owner
           ELSE v_teacher
         END;
END
$$;

CREATE OR REPLACE FUNCTION app.teacher_assignment_students(p_assignment_id uuid) RETURNS TABLE (student_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.user_id
    FROM app.current_actor() a
    JOIN institution.assignment s ON s.id = p_assignment_id AND s.institution_id = a.institution_id
    JOIN institution.course_member m ON m.course_id = s.course_id AND m.institution_id = s.institution_id
   WHERE m.role = 'student' AND m.member_to IS NULL
     AND institution.actor_assignment_role(p_assignment_id) = 'teacher'
  UNION ALL
  SELECT t.student_id
    FROM app.current_actor() a
    JOIN institution.assignment s ON s.id = p_assignment_id AND s.institution_id = a.institution_id
    JOIN institution.mentorship t ON t.id = s.mentorship_id AND t.institution_id = s.institution_id
   WHERE t.ended_at IS NULL
     AND institution.actor_assignment_role(p_assignment_id) = 'teacher'
$$;

CREATE OR REPLACE FUNCTION app.teacher_course_students(p_course_id uuid)
RETURNS TABLE (student_id uuid, given_name text, family_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor record;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT m.user_id, n.given_name, n.family_name
    FROM institution.course_member m
    LEFT JOIN identity.person_name n ON n.user_id = m.user_id AND n.institution_id = m.institution_id
   WHERE m.course_id = p_course_id AND m.institution_id = v_actor.institution_id
     AND m.role = 'student' AND m.member_to IS NULL
   ORDER BY m.user_id;
END
$$;

CREATE OR REPLACE FUNCTION institution.assign_group_teacher(p_group_id uuid, p_teacher_id uuid) RETURNS void
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

CREATE OR REPLACE FUNCTION institution.assign_group_student(p_group_id uuid, p_student_id uuid) RETURNS void
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

DROP FUNCTION institution.actor_group_work(uuid, uuid);
DROP FUNCTION institution.actor_group_student(uuid, uuid);

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution, app, collaboration FROM ductus_identity;
DROP FUNCTION collaboration.work_started_at(uuid, uuid, uuid);
DROP FUNCTION collaboration.works_started_last(uuid, uuid[], uuid[]);

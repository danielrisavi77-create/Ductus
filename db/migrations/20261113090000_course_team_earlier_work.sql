-- migrate:up
-- DAN-351, M2.7-P04b (contract on #1836, c.6858454835): the historical
-- boundary of a place in the teaching team of a course, as for seminar groups
-- (20261104100000; D-265 Q19, DAN-351 points 4 and 5). A teacher of the course
-- reaches a student's work on its assignment only if the work was not started
-- before the actor's open teacher membership of the course began
-- (course_member.member_from). The same instant is not earlier, and a work not
-- yet started has nothing earlier. A work closed this way stays reachable
-- through a seminar group of the actor when actor_group_work allows it; else
-- it stays closed until an explicit transfer (not in this migration; who gives
-- it is an open owner question).
--
-- Today the only teacher row of a course is its creator's, written before any
-- work on it, so nothing changes in production; the handover to a teacher from
-- outside the team (P04c) writes the first later row. The five places that
-- open a work through the course role get the boundary: collaboration.actor_role,
-- audit.reader_role, institution.can, app.teacher_assignment_students and
-- institution.work_accommodation. app.teacher_course_students (names only)
-- keeps every student of the course, as for groups. institution.work_language
-- and institution.set_work_language follow in P04c. Same signatures, owners
-- and grants; no table, policy or grant to ductus_app is added.
SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA institution, app, collaboration, audit TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- False only when the actor is an open teacher member of the course of the
-- assignment and the student's work on it was started before that membership
-- began (the group comparison of actor_group_work, against member_from). True
-- for an assignment of a mentorship, for an actor who is no open teacher of
-- the course, and for a student with no work yet: it only narrows a course
-- teacher, it grants nothing. Called only from definer functions of
-- ductus_identity, as actor_group_work.
CREATE FUNCTION institution.actor_course_work(p_assignment_id uuid, p_student_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM app.current_actor() a
      JOIN institution.assignment s ON s.id = p_assignment_id AND s.institution_id = a.institution_id
      JOIN institution.course_member m ON m.course_id = s.course_id AND m.institution_id = s.institution_id
       AND m.user_id = a.user_id AND m.role = 'teacher' AND m.member_to IS NULL
     WHERE coalesce(collaboration.work_started_at(s.institution_id, s.id, p_student_id) < m.member_from, false)
  )
$$;
REVOKE ALL ON FUNCTION institution.actor_course_work(uuid, uuid) FROM PUBLIC;

-- As 20261104100000, with the boundary on the course teacher: a work started
-- before her membership falls through to the group branch.
CREATE OR REPLACE FUNCTION collaboration.actor_role(p_institution_id uuid, p_assignment_id uuid, p_owner_id uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_institution_id IS DISTINCT FROM a.institution_id THEN NULL
    WHEN institution.actor_assignment_role(p_assignment_id) = 'teacher'
         AND institution.actor_course_work(p_assignment_id, p_owner_id) THEN 'teacher'
    WHEN institution.actor_assignment_role(p_assignment_id) = 'student' AND p_owner_id = a.user_id THEN 'student'
    WHEN institution.actor_group_work(p_assignment_id, p_owner_id) THEN 'teacher'
  END
  FROM app.current_actor() a
$$;

-- As 20261111180000, with the same boundary, so that the access log records
-- the role through which the work was in fact opened.
CREATE OR REPLACE FUNCTION audit.reader_role(p_institution_id uuid, p_assignment_id uuid, p_owner_id uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_institution_id IS DISTINCT FROM a.institution_id THEN NULL
    WHEN p_owner_id = a.user_id THEN NULL
    WHEN institution.actor_assignment_role(p_assignment_id) = 'teacher'
         AND institution.actor_course_work(p_assignment_id, p_owner_id) THEN
      CASE WHEN s.mentorship_id IS NOT NULL THEN 'mentor' ELSE 'teacher' END
    WHEN institution.actor_group_work(p_assignment_id, p_owner_id) THEN 'seminar_teacher'
  END
  FROM app.current_actor() a
  LEFT JOIN institution.assignment s ON s.id = p_assignment_id AND s.institution_id = a.institution_id
$$;

-- As 20261104100000, with the same boundary, so that db/tests/098 still finds
-- no cell where can() and actor_role differ: a teacher of the course whose
-- work is closed by it has the relation of the group branch, or none (never
-- her course role back).
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
  -- A teacher of the course only for a work not started before her
  -- membership (actor_course_work). Otherwise through a seminar group of it
  -- whose teacher the actor is and whose member the owner is, also when the
  -- actor is a student of the course; never for the actor's own work (as
  -- actor_role).
  SELECT CASE
           WHEN a.course_id IS NOT NULL THEN (
             SELECT CASE
                      WHEN m.role = 'teacher'
                           AND institution.actor_course_work(a.id, v_scope.principal_id) THEN 'teacher'
                      WHEN institution.actor_group_work(a.id, v_scope.principal_id) THEN 'teacher'
                      WHEN m.role = 'teacher' THEN NULL
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

-- As 20261104100000, with the boundary on the course branch. The group branch
-- also serves a teacher of the course for a student whose work the boundary
-- closes (exactly the students the course branch leaves out), so no student
-- comes twice.
CREATE OR REPLACE FUNCTION app.teacher_assignment_students(p_assignment_id uuid) RETURNS TABLE (student_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.user_id
    FROM app.current_actor() a
    JOIN institution.assignment s ON s.id = p_assignment_id AND s.institution_id = a.institution_id
    JOIN institution.course_member m ON m.course_id = s.course_id AND m.institution_id = s.institution_id
   WHERE m.role = 'student' AND m.member_to IS NULL
     AND institution.actor_assignment_role(p_assignment_id) = 'teacher'
     AND institution.actor_course_work(p_assignment_id, m.user_id)
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
     AND (institution.actor_assignment_role(p_assignment_id) IS DISTINCT FROM 'teacher'
          OR NOT institution.actor_course_work(p_assignment_id, g.user_id))
     AND institution.actor_group_work(p_assignment_id, g.user_id)
$$;

-- As 20261108130000, with the boundary on the teacher branch.
CREATE OR REPLACE FUNCTION institution.work_accommodation(p_assignment_id uuid, p_student_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_institution uuid;
  v_role text;
BEGIN
  SELECT a.user_id, a.institution_id INTO v_user, v_institution FROM app.current_actor() a;
  v_role := institution.actor_assignment_role(p_assignment_id);
  IF v_user IS NULL OR p_student_id IS NULL
     OR NOT coalesce((v_role = 'student' AND p_student_id = v_user)
                     OR (v_role = 'teacher'
                         AND institution.work_relation(p_student_id, p_assignment_id) = 'student'
                         AND institution.actor_course_work(p_assignment_id, p_student_id))
                     OR institution.actor_group_work(p_assignment_id, p_student_id), false) THEN
    RETURN NULL;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM institution.work_accommodation w
     WHERE w.assignment_id = p_assignment_id AND w.student_id = p_student_id
       AND w.institution_id = v_institution);
END
$$;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution, app, collaboration, audit FROM ductus_identity;

-- migrate:down
-- Local only: the five functions as before, then the helper.
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution, app, collaboration, audit TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE OR REPLACE FUNCTION collaboration.actor_role(p_institution_id uuid, p_assignment_id uuid, p_owner_id uuid) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT CASE
    WHEN p_institution_id IS DISTINCT FROM a.institution_id THEN NULL
    WHEN institution.actor_assignment_role(p_assignment_id) = 'teacher' THEN 'teacher'
    WHEN institution.actor_assignment_role(p_assignment_id) = 'student' AND p_owner_id = a.user_id THEN 'student'
    WHEN institution.actor_group_work(p_assignment_id, p_owner_id) THEN 'teacher'
  END
  FROM app.current_actor() a
$$;

CREATE OR REPLACE FUNCTION audit.reader_role(p_institution_id uuid, p_assignment_id uuid, p_owner_id uuid) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT CASE
    WHEN p_institution_id IS DISTINCT FROM a.institution_id THEN NULL
    WHEN p_owner_id = a.user_id THEN NULL
    WHEN institution.actor_assignment_role(p_assignment_id) = 'teacher' THEN
      CASE WHEN s.mentorship_id IS NOT NULL THEN 'mentor' ELSE 'teacher' END
    WHEN institution.actor_group_work(p_assignment_id, p_owner_id) THEN 'seminar_teacher'
  END
  FROM app.current_actor() a
  LEFT JOIN institution.assignment s ON s.id = p_assignment_id AND s.institution_id = a.institution_id
$$;

CREATE OR REPLACE FUNCTION institution.can(p_action text, p_document_id text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
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

CREATE OR REPLACE FUNCTION app.teacher_assignment_students(p_assignment_id uuid) RETURNS TABLE(student_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
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

CREATE OR REPLACE FUNCTION institution.work_accommodation(p_assignment_id uuid, p_student_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user uuid;
  v_institution uuid;
  v_role text;
BEGIN
  SELECT a.user_id, a.institution_id INTO v_user, v_institution FROM app.current_actor() a;
  v_role := institution.actor_assignment_role(p_assignment_id);
  IF v_user IS NULL OR p_student_id IS NULL
     OR NOT coalesce((v_role = 'student' AND p_student_id = v_user)
                     OR (v_role = 'teacher'
                         AND institution.work_relation(p_student_id, p_assignment_id) = 'student')
                     OR institution.actor_group_work(p_assignment_id, p_student_id), false) THEN
    RETURN NULL;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM institution.work_accommodation w
     WHERE w.assignment_id = p_assignment_id AND w.student_id = p_student_id
       AND w.institution_id = v_institution);
END
$$;

DROP FUNCTION institution.actor_course_work(uuid, uuid);

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution, app, collaboration, audit FROM ductus_identity;

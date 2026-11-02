-- migrate:up
-- DAN-351, M2.7-P02 (contract on #1091, c.6578617862): one decision on what
-- the actor may do with a work, can(action, document). The actor is always
-- the one of the open session (app.current_actor()); no parameter names it.
--
-- The decision is about the relation only: who is the teacher of the work
-- and who owns it. Conditions of state (the acknowledged notice, a submitted
-- work, the record of an opening) stay with each caller.
--
-- It is derived here from the tables, not through collaboration.actor_role,
-- so that db/tests/098 can compare the two over every actor and work. No
-- caller is changed yet, and neither are the actor_* helpers: a holder of a
-- course and a group teacher (M2.7-P01) get no right from can() (T053).
--
-- Actions:
--   read            the owner student, or a teacher of the work
--   comment         a teacher of the work
--   open_fast_path  a teacher of the work
--   write           the owner student
--   propose         a teacher of the work (D-34: a proposal, or a direct
--                   change that the student's client applies)
-- A teacher of the work is a member of the course with the teacher role, or
-- the mentor of an open mentorship, and in both cases holds a confirmed and
-- unrevoked teacher role of the institution (D-204).
--
-- Unknown or null action: ZD422, so that a mistyped action in a caller fails
-- loudly instead of reading as "no". Everything else that is not allowed,
-- including no session and a work that does not exist or belongs to another
-- institution, is false.
SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE FUNCTION institution.can(p_action text, p_document_id text) RETURNS boolean
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

REVOKE ALL ON FUNCTION institution.can(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.can(text, text) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION institution.can(text, text);

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

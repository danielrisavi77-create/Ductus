-- migrate:up
-- DAN-313 (M2.11-P03, A-03; contract on #1091, c.6692590206): the courses of
-- an institution in one academic year, for its administrator, read only. The
-- caller and the institution come only from the session; only a confirmed,
-- unrevoked administrator gets an answer, for their own institution alone.
--
-- One row per fact, in one statement, so one snapshot gives every course:
--   course         the course, with its number of open students
--   holder         the open holder of the course
--   team           a member of the teaching team (is_course_team_member)
--   group          a seminar group, with its open students who are still open
--                  students of the course (the rule of actor_group_student)
--   group_teacher  an open teacher of the group who is a team member
-- A person's name is the pair person_name holds for this institution, or
-- none. Never a student's name or id, a work, or an activity time. No
-- assignment is changed here: who may change groups is open with the owner
-- (c.6692522699).
--
-- The year has the form and the rule create_course requires; anything else
-- is ZD422, after the session and the role are checked, so only an
-- administrator learns that a value is malformed.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE FUNCTION institution.institution_courses(p_academic_year text)
RETURNS TABLE (
  kind text, course_id uuid, course_name text, group_id uuid, group_name text,
  user_id uuid, given_name text, family_name text, students integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF NOT institution.actor_has_role('admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF NOT coalesce(CASE WHEN p_academic_year ~ '^[0-9]{4}/[0-9]{4}$'
                       THEN right(p_academic_year, 4)::integer = left(p_academic_year, 4)::integer + 1
                  END, false) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  RETURN QUERY
  WITH c AS (
    SELECT c.id, c.name FROM institution.course c
    WHERE c.institution_id = actor.institution_id AND c.academic_year = p_academic_year
  ),
  fact AS (
    SELECT 'course'::text AS kind, c.id AS course_id, c.name AS course_name,
           NULL::uuid AS group_id, NULL::text AS group_name, NULL::uuid AS user_id,
           (SELECT count(DISTINCT m.user_id)::integer FROM institution.course_member m
             WHERE m.course_id = c.id AND m.role = 'student' AND m.member_to IS NULL) AS students
    FROM c
    UNION ALL
    SELECT 'holder', h.course_id, NULL, NULL, NULL, h.user_id, NULL
    FROM institution.course_holder h JOIN c ON c.id = h.course_id
    WHERE h.valid_to IS NULL
    UNION ALL
    SELECT 'team', t.course_id, NULL, NULL, NULL, t.user_id, NULL
    FROM (SELECT m.course_id, m.user_id FROM institution.course_member m JOIN c ON c.id = m.course_id
           WHERE m.role = 'teacher' AND m.member_to IS NULL
          UNION
          SELECT g.course_id, g.user_id FROM institution.seminar_group_teacher g JOIN c ON c.id = g.course_id
           WHERE g.valid_to IS NULL) t
    WHERE institution.is_course_team_member(t.user_id, t.course_id)
    UNION ALL
    SELECT 'group', g.course_id, NULL, g.id, g.name, NULL,
           (SELECT count(*)::integer FROM institution.seminar_group_member s
             WHERE s.group_id = g.id AND s.valid_to IS NULL
               AND EXISTS (SELECT 1 FROM institution.course_member m
                           WHERE m.course_id = g.course_id AND m.user_id = s.user_id
                             AND m.role = 'student' AND m.member_to IS NULL))
    FROM institution.seminar_group g JOIN c ON c.id = g.course_id
    UNION ALL
    SELECT 'group_teacher', t.course_id, NULL, t.group_id, NULL, t.user_id, NULL
    FROM institution.seminar_group_teacher t JOIN c ON c.id = t.course_id
    WHERE t.valid_to IS NULL AND institution.is_course_team_member(t.user_id, t.course_id)
  )
  SELECT f.kind, f.course_id, f.course_name, f.group_id, f.group_name, f.user_id,
         n.given_name, n.family_name, f.students
  FROM fact f
  LEFT JOIN identity.person_name n ON n.user_id = f.user_id AND n.institution_id = actor.institution_id
  ORDER BY f.course_id, f.kind, f.group_id, f.user_id;
END
$$;

-- The academic years of the institution's courses, newest first, for the
-- year picker of the same screen.
CREATE FUNCTION institution.institution_academic_years()
RETURNS TABLE (academic_year text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF NOT institution.actor_has_role('admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  RETURN QUERY
  SELECT DISTINCT c.academic_year FROM institution.course c
  WHERE c.institution_id = actor.institution_id
  ORDER BY c.academic_year DESC;
END
$$;

REVOKE ALL ON FUNCTION institution.institution_courses(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.institution_courses(text) TO ductus_app;
REVOKE ALL ON FUNCTION institution.institution_academic_years() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.institution_academic_years() TO ductus_app;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION institution.institution_academic_years();
DROP FUNCTION institution.institution_courses(text);

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

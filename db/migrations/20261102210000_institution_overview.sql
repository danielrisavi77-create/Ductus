-- migrate:up
-- DAN-313 (M2.11-P01, contract on #1091, comment 6572435345): the overview of
-- an institution for its administrator (screen A-01). It takes no parameter:
-- the caller and the institution come only from the session, and only a
-- confirmed, unrevoked administrator gets an answer, for their own
-- institution alone. One row of counts and the institution's display name;
-- never a person's name or id, a course name or an activity time.
-- SECURITY DEFINER of ductus_identity, as teachers_without_affiliation, since
-- the candidates are read from identity.teacher_eligibility.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE FUNCTION institution.institution_overview()
RETURNS TABLE (
  institution_name text,
  confirmed_teachers integer,
  teacher_candidates integer,
  teachers_without_affiliation integer,
  courses integer,
  students integer
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
  RETURN QUERY
  SELECT
    (SELECT s.display_name FROM institution.institution_settings s WHERE s.institution_id = actor.institution_id),
    (SELECT count(*)::integer FROM institution.institution_role r
     WHERE r.institution_id = actor.institution_id AND r.role = 'teacher'
       AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL),
    -- A candidate is whom confirm_teacher_role would confirm and has not yet:
    -- an account of this institution, not the caller, with the teacher right
    -- of its last login recorded under this institution.
    (SELECT count(*)::integer FROM identity.user_account u
     WHERE u.institution_id = actor.institution_id AND u.id <> actor.user_id
       AND EXISTS (SELECT 1 FROM identity.teacher_eligibility e
                   WHERE e.user_id = u.id AND e.institution_id = actor.institution_id)
       AND NOT EXISTS (SELECT 1 FROM institution.institution_role r
                       WHERE r.institution_id = actor.institution_id AND r.user_id = u.id AND r.role = 'teacher'
                         AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL)),
    -- The same rows the administrator gets from the mark itself (DAN-478).
    (SELECT count(*)::integer FROM institution.teachers_without_affiliation()),
    (SELECT count(*)::integer FROM institution.course c WHERE c.institution_id = actor.institution_id),
    -- A person is counted once however many courses they are enrolled in.
    (SELECT count(DISTINCT m.user_id)::integer FROM institution.course_member m
     WHERE m.institution_id = actor.institution_id AND m.role = 'student' AND m.member_to IS NULL);
END
$$;

REVOKE ALL ON FUNCTION institution.institution_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.institution_overview() TO ductus_app;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION institution.institution_overview();

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

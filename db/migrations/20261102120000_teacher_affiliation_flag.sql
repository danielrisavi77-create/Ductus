-- migrate:up
-- DAN-478 (M1.3b; D-200 P7): a confirmed teacher whose last AAI@EduHr login
-- did not give the teacher right keeps the role; the administrator of the
-- institution sees a mark for review. The mark is computed when it is read
-- from identity.teacher_eligibility (DAN-304), so nothing is stored and no
-- role changes.
--
-- Only the fact comes back: the account and when its role was confirmed.
-- Never an attribute value, and no name (the administration view is M2.11).
-- Who may ask: a session with a confirmed, unrevoked administrator role, and
-- the answer covers that administrator's institution alone.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE FUNCTION institution.teachers_without_affiliation()
RETURNS TABLE (user_id uuid, confirmed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF NOT institution.actor_has_role('admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- A right recorded under another institution does not count; the account
  -- is the one of this issuer and unique id, so another account of the same
  -- person never lifts the mark.
  RETURN QUERY
  SELECT r.user_id, r.confirmed_at
  FROM institution.institution_role r
  WHERE r.institution_id = actor.institution_id
    AND r.role = 'teacher' AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM identity.teacher_eligibility e
      WHERE e.user_id = r.user_id AND e.institution_id = actor.institution_id
    )
  ORDER BY r.confirmed_at, r.user_id;
END
$$;

REVOKE ALL ON FUNCTION institution.teachers_without_affiliation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.teachers_without_affiliation() TO ductus_app;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION institution.teachers_without_affiliation();

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

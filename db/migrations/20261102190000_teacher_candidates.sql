-- migrate:up
-- DAN-486 (M2.2-P02b; contract on #1091, c.6568059150, confirmed in
-- c.6569015791): an administrator lists the accounts of their institution that
-- they can confirm as teachers. The list is read from identity.teacher_eligibility
-- (DAN-304), which only its owner reads, so nothing is stored and no role
-- changes.
--
-- The list is exactly the set for which institution.confirm_teacher_role(id)
-- by the same administrator succeeds and changes something: an account of this
-- institution with the right recorded under it, not the actor, and without a
-- confirmed, unrevoked teacher role. An unconfirmed or revoked role does not
-- exclude, since confirm_teacher_role would confirm that candidate.
-- Only the account comes back: no name (M2.11) and no login time.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE FUNCTION institution.list_teacher_candidates()
RETURNS TABLE (user_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF NOT institution.actor_has_role('admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- The same three conditions as confirm_teacher_role: the account belongs to
  -- this institution, its right is recorded under it, and it is not the actor.
  RETURN QUERY
  SELECT e.user_id
  FROM identity.teacher_eligibility e
  JOIN identity.user_account u ON u.id = e.user_id AND u.institution_id = actor.institution_id
  WHERE e.institution_id = actor.institution_id
    AND e.user_id <> actor.user_id
    AND NOT EXISTS (
      SELECT 1 FROM institution.institution_role r
      WHERE r.institution_id = actor.institution_id AND r.user_id = e.user_id
        AND r.role = 'teacher' AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
    )
  ORDER BY e.user_id;
END
$$;

REVOKE ALL ON FUNCTION institution.list_teacher_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.list_teacher_candidates() TO ductus_app;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION institution.list_teacher_candidates();

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

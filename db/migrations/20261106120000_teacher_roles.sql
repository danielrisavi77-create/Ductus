-- migrate:up
-- DAN-581 (M2.11-P02, A-02; contract on #1091, c.6674850230): the list the
-- administrator of an institution sees on the teacher roles screen, in one
-- statement, so one snapshot gives both lists and nobody is on both.
--
-- Candidates are exactly the accounts list_teacher_candidates returns, with
-- the time their last teacher role here was revoked, if one was. Confirmed
-- teachers are the confirmed, unrevoked teacher roles here, each with the
-- D-200 P7 mark: no teacher right recorded under this institution.
--
-- The name is the pair person_name holds for this institution, or none.
-- Never a login time (c.6674436818, 2), an attribute value, an address or an
-- AAI identifier. Who may ask: a session with a confirmed, unrevoked
-- administrator role, and the answer covers that institution alone.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE FUNCTION institution.teacher_roles()
RETURNS TABLE (
  user_id uuid, list text, given_name text, family_name text,
  confirmed_at timestamptz, revoked_at timestamptz, for_review boolean
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
  WITH member AS (
    -- The same conditions as list_teacher_candidates and confirm_teacher_role.
    SELECT 'candidate'::text AS list, e.user_id, NULL::timestamptz AS confirmed_at,
           (SELECT max(o.revoked_at) FROM institution.institution_role o
             WHERE o.institution_id = actor.institution_id AND o.user_id = e.user_id
               AND o.role = 'teacher' AND o.revoked_at IS NOT NULL) AS revoked_at,
           NULL::boolean AS for_review
    FROM identity.teacher_eligibility e
    JOIN identity.user_account u ON u.id = e.user_id AND u.institution_id = actor.institution_id
    WHERE e.institution_id = actor.institution_id
      AND e.user_id <> actor.user_id
      AND NOT EXISTS (
        SELECT 1 FROM institution.institution_role r
        WHERE r.institution_id = actor.institution_id AND r.user_id = e.user_id
          AND r.role = 'teacher' AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
      )
    UNION ALL
    -- The same conditions as teachers_without_affiliation, without the filter.
    SELECT 'confirmed', r.user_id, r.confirmed_at, NULL::timestamptz,
           NOT EXISTS (
             SELECT 1 FROM identity.teacher_eligibility e
             WHERE e.user_id = r.user_id AND e.institution_id = actor.institution_id
           )
    FROM institution.institution_role r
    WHERE r.institution_id = actor.institution_id
      AND r.role = 'teacher' AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
  )
  SELECT m.user_id, m.list, n.given_name, n.family_name, m.confirmed_at, m.revoked_at, m.for_review
  FROM member m
  LEFT JOIN identity.person_name n ON n.user_id = m.user_id AND n.institution_id = actor.institution_id
  ORDER BY m.list, m.user_id;
END
$$;

REVOKE ALL ON FUNCTION institution.teacher_roles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.teacher_roles() TO ductus_app;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION institution.teacher_roles();

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

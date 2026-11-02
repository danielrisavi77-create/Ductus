-- migrate:up
-- DAN-304 (M1.3, plan of attack #1181): a teacher role is confirmed only for
-- a person whose last successful AAI@EduHr login released an affiliation that
-- allows one (D-171). The fact is stored, never the attribute's value: one
-- row means "may be confirmed", no row means "may not".
--
-- The fact is written at every login by the eight-argument open_session
-- below: inserted when the login allows it, removed when it does not, so a
-- right never outlives the login that gave it. A confirmed role stays when
-- the right goes (D-200 P7); flagging such a teacher for the administrator
-- is a later step.
--
-- The foreign key does not cascade (033), as for identity.person_name: an
-- account cannot be deleted while its right exists, so whatever deletes the
-- account deletes the right first, in the same transaction.
GRANT CREATE ON SCHEMA identity TO ductus_identity;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE TABLE identity.teacher_eligibility (
  user_id uuid PRIMARY KEY,
  institution_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, institution_id) REFERENCES identity.user_account (id, institution_id)
);

ALTER TABLE identity.teacher_eligibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.teacher_eligibility FORCE ROW LEVEL SECURITY;
CREATE POLICY teacher_eligibility_owner ON identity.teacher_eligibility TO ductus_identity USING (true) WITH CHECK (true);

-- The seven-argument open_session decides who logs in and what name is kept;
-- this one runs it first, so every refusal is the same refusal and nothing
-- changes for a login that fails. The account it found or created is then
-- read back by the same identifiers it matched on.
CREATE FUNCTION identity.open_session(
  p_issuer text,
  p_subject text,
  p_unique_id text,
  p_home_org text,
  p_token_hash bytea,
  p_given_name text,
  p_family_name text,
  p_teacher_eligible boolean
) RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_expires timestamptz;
  v_user uuid;
  v_institution uuid;
BEGIN
  v_expires := identity.open_session(p_issuer, p_subject, p_unique_id, p_home_org, p_token_hash, p_given_name, p_family_name);

  SELECT u.id, u.institution_id INTO STRICT v_user, v_institution
  FROM identity.user_account u
  WHERE u.oidc_issuer = p_issuer AND u.hr_edu_person_unique_id = p_unique_id;

  -- Only true gives the right; false and NULL take it away.
  IF p_teacher_eligible IS TRUE THEN
    INSERT INTO identity.teacher_eligibility (user_id, institution_id)
    VALUES (v_user, v_institution)
    ON CONFLICT (user_id) DO UPDATE SET updated_at = pg_catalog.now();
  ELSE
    DELETE FROM identity.teacher_eligibility WHERE user_id = v_user;
  END IF;
  RETURN v_expires;
END
$$;

REVOKE ALL ON FUNCTION identity.open_session(text, text, text, text, bytea, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.open_session(text, text, text, text, bytea, text, text, boolean) TO ductus_auth;

-- Plan item 13: the login role keeps no way to open a session that leaves
-- the right as it was. The older forms stay for the eight-argument one,
-- which runs them as their owner.
REVOKE EXECUTE ON FUNCTION identity.open_session(text, text, text, text, bytea) FROM ductus_auth;
REVOKE EXECUTE ON FUNCTION identity.open_session(text, text, text, text, bytea, text, text) FROM ductus_auth;

-- The same refusal as before, with one condition more: a candidate without
-- the right is refused with the same code and no row, so the code never
-- tells which condition failed, nor whether a person of another institution
-- has the right.
CREATE OR REPLACE FUNCTION institution.confirm_teacher_role(p_candidate_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF NOT institution.actor_has_role('admin')
     OR p_candidate_id IS NOT DISTINCT FROM actor.user_id
     OR NOT EXISTS (
       SELECT 1 FROM identity.user_account u
       WHERE u.id = p_candidate_id AND u.institution_id = actor.institution_id
     )
     OR NOT EXISTS (
       SELECT 1 FROM identity.teacher_eligibility e
       WHERE e.user_id = p_candidate_id AND e.institution_id = actor.institution_id
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  INSERT INTO institution.institution_role AS r (institution_id, user_id, role, confirmed_by, confirmed_at)
  VALUES (actor.institution_id, p_candidate_id, 'teacher', actor.user_id, now())
  ON CONFLICT (institution_id, user_id, role) WHERE revoked_at IS NULL
  DO UPDATE SET confirmed_by = EXCLUDED.confirmed_by, confirmed_at = EXCLUDED.confirmed_at
  WHERE r.confirmed_at IS NULL;
END
$$;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

-- migrate:down
GRANT CREATE ON SCHEMA identity TO ductus_identity;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE OR REPLACE FUNCTION institution.confirm_teacher_role(p_candidate_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF NOT institution.actor_has_role('admin')
     OR p_candidate_id IS NOT DISTINCT FROM actor.user_id
     OR NOT EXISTS (
       SELECT 1 FROM identity.user_account u
       WHERE u.id = p_candidate_id AND u.institution_id = actor.institution_id
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  INSERT INTO institution.institution_role AS r (institution_id, user_id, role, confirmed_by, confirmed_at)
  VALUES (actor.institution_id, p_candidate_id, 'teacher', actor.user_id, now())
  ON CONFLICT (institution_id, user_id, role) WHERE revoked_at IS NULL
  DO UPDATE SET confirmed_by = EXCLUDED.confirmed_by, confirmed_at = EXCLUDED.confirmed_at
  WHERE r.confirmed_at IS NULL;
END
$$;

GRANT EXECUTE ON FUNCTION identity.open_session(text, text, text, text, bytea) TO ductus_auth;
GRANT EXECUTE ON FUNCTION identity.open_session(text, text, text, text, bytea, text, text) TO ductus_auth;
DROP FUNCTION identity.open_session(text, text, text, text, bytea, text, text, boolean);
DROP TABLE identity.teacher_eligibility;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

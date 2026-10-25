-- migrate:up
-- B-11a (#757, owner decision O1): the given name and family name of an
-- account, from two separate AAI@EduHr attributes, never split from one
-- display name. They exist for the teacher's fast path (B-11b), which reads
-- them through its own function; no role but the owner touches the table.
--
-- The names are written at every login by the seven-argument open_session
-- below: replaced when the provider releases both, removed when it releases
-- either one empty, invalid or not at all, so a stale name never outlives
-- the attribute. The foreign key does not cascade (033), so an account
-- cannot be deleted while its name exists: whatever deletes the account
-- deletes the name first, in the same transaction.
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE TABLE identity.person_name (
  user_id uuid PRIMARY KEY,
  institution_id uuid NOT NULL,
  given_name text NOT NULL CHECK (length(given_name) BETWEEN 1 AND 255),
  family_name text NOT NULL CHECK (length(family_name) BETWEEN 1 AND 255),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, institution_id) REFERENCES identity.user_account (id, institution_id)
);

ALTER TABLE identity.person_name ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.person_name FORCE ROW LEVEL SECURITY;
CREATE POLICY person_name_owner ON identity.person_name TO ductus_identity USING (true) WITH CHECK (true);

-- The five-argument open_session decides who logs in and is unchanged; this
-- one runs it first, so every refusal is the same refusal and no name is
-- written for a login that fails. The account it found or created is then
-- read back by the same identifiers it matched on.
CREATE FUNCTION identity.open_session(
  p_issuer text,
  p_subject text,
  p_unique_id text,
  p_home_org text,
  p_token_hash bytea,
  p_given_name text,
  p_family_name text
) RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_expires timestamptz;
  v_user uuid;
  v_institution uuid;
  v_given text := pg_catalog.btrim(p_given_name, E' \t\r\n');
  v_family text := pg_catalog.btrim(p_family_name, E' \t\r\n');
BEGIN
  v_expires := identity.open_session(p_issuer, p_subject, p_unique_id, p_home_org, p_token_hash);

  SELECT u.id, u.institution_id INTO STRICT v_user, v_institution
  FROM identity.user_account u
  WHERE u.oidc_issuer = p_issuer AND u.hr_edu_person_unique_id = p_unique_id;

  -- A name with a control character is not a name; it is dropped, never
  -- refused, so a bad attribute costs the name and not the login.
  IF pg_catalog.length(v_given) BETWEEN 1 AND 255 AND v_given !~ '[[:cntrl:]]'
     AND pg_catalog.length(v_family) BETWEEN 1 AND 255 AND v_family !~ '[[:cntrl:]]' THEN
    INSERT INTO identity.person_name (user_id, institution_id, given_name, family_name)
    VALUES (v_user, v_institution, v_given, v_family)
    ON CONFLICT (user_id) DO UPDATE
      SET given_name = EXCLUDED.given_name, family_name = EXCLUDED.family_name, updated_at = pg_catalog.now();
  ELSE
    DELETE FROM identity.person_name WHERE user_id = v_user;
  END IF;
  RETURN v_expires;
END
$$;

REVOKE ALL ON FUNCTION identity.open_session(text, text, text, text, bytea, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.open_session(text, text, text, text, bytea, text, text) TO ductus_auth;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

-- migrate:down
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION identity.open_session(text, text, text, text, bytea, text, text);
DROP TABLE identity.person_name;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

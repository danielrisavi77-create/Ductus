-- migrate:up
-- Opening a session at login (B-6; docs/BACKEND.md 4.3, D-90). Only the
-- login callback calls this, as a login in ductus_auth, after it has checked
-- the OIDC response. The callback generates the cookie token and passes its
-- SHA-256 alone; the token never reaches the database.
--
-- Identity is the issuer plus hrEduPersonUniqueID (D-73), never e-mail. The
-- institution is the one whose AAI home organisation matches the
-- hrEduPersonHomeOrg the provider released; the map is data, never code.
-- Errors carry no input: ZD403 the identity does not match the account on
-- record, ZD409 token hash already used, ZD422 invalid input, ZD503 no
-- institution takes logins from this home organisation. The login route
-- shows ZD403, ZD422 and ZD503 as one neutral message, so nobody learns
-- whether an institution exists.
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- An institution without a home organisation takes no logins; clearing the
-- value is how an institution stops taking them. Only the owner writes it
-- (local and CI seeds; provisioning in production).
ALTER TABLE identity.institution
  ADD COLUMN aai_home_org text UNIQUE CHECK (aai_home_org ~ '^[a-z0-9.-]{1,255}$');

-- Sessions last 12 hours from login. Expiry is not logout (BACKEND 4.3): the
-- browser keeps unsynced work until the same user signs in again.
CREATE FUNCTION identity.open_session(
  p_issuer text,
  p_subject text,
  p_unique_id text,
  p_home_org text,
  p_token_hash bytea
) RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_institution uuid;
  v_user uuid;
  v_user_institution uuid;
  v_subject text;
  v_expires timestamptz := pg_catalog.now() + interval '12 hours';
  -- Lower case under "C" folds ASCII alone, so a look-alike character such
  -- as the Kelvin sign stays what it is and matches nothing.
  v_home_org text := pg_catalog.lower(pg_catalog.btrim(p_home_org, E' \t\r\n') COLLATE "C");
BEGIN
  IF p_issuer IS NULL OR pg_catalog.length(p_issuer) NOT BETWEEN 1 AND 255
     OR p_subject IS NULL OR pg_catalog.length(p_subject) NOT BETWEEN 1 AND 255
     OR p_unique_id IS NULL OR pg_catalog.length(p_unique_id) NOT BETWEEN 1 AND 255
     OR p_token_hash IS NULL OR pg_catalog.octet_length(p_token_hash) <> 32 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;

  IF v_home_org ~ '^[a-z0-9.-]{1,255}$' THEN
    SELECT i.id INTO v_institution FROM identity.institution i WHERE i.aai_home_org = v_home_org;
  END IF;
  IF v_institution IS NULL THEN
    RAISE EXCEPTION 'institution not set up' USING ERRCODE = 'ZD503';
  END IF;

  -- First login creates the account. A conflict on either identifier leaves
  -- the existing row, and the check below decides. ON CONFLICT waits for a
  -- concurrent first login, whose row the next statement then sees.
  INSERT INTO identity.user_account (institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
  VALUES (v_institution, p_issuer, p_subject, p_unique_id)
  ON CONFLICT DO NOTHING;

  SELECT u.id, u.institution_id, u.oidc_subject
    INTO v_user, v_user_institution, v_subject
  FROM identity.user_account u
  WHERE u.oidc_issuer = p_issuer AND u.hr_edu_person_unique_id = p_unique_id;

  -- Not found means the subject belongs to another unique id. A changed
  -- subject or home institution is refused rather than merged: which of the
  -- two identifiers Srce never reassigns is not confirmed yet.
  IF v_user IS NULL OR v_subject <> p_subject OR v_user_institution <> v_institution THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;

  BEGIN
    INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
    VALUES (p_token_hash, v_user, v_institution, v_expires);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END;
  RETURN v_expires;
END
$$;

REVOKE ALL ON FUNCTION identity.open_session(text, text, text, text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.open_session(text, text, text, text, bytea) TO ductus_auth;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;
GRANT USAGE ON SCHEMA identity TO ductus_auth;

-- migrate:down
REVOKE USAGE ON SCHEMA identity FROM ductus_auth;
DROP FUNCTION identity.open_session(text, text, text, text, bytea);
SET LOCAL ROLE ductus_identity;
ALTER TABLE identity.institution DROP COLUMN aai_home_org;
SET LOCAL ROLE ductus_migrator;

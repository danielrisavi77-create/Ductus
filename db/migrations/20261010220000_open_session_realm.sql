-- migrate:up
-- open_session also requires that the realm of hrEduPersonUniqueID, the part
-- after its last "@", equals hrEduPersonHomeOrg after the same normalisation.
-- A refusal is the same ZD503 as an unknown home organisation and leaves no
-- row. The check runs on every login, so it also holds for accounts created
-- before it. Comparison is equality alone; no pattern is built from input.
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE OR REPLACE FUNCTION identity.open_session(
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
  -- Characters from the end of the unique id to its last "@"; 0 when none.
  v_at integer := pg_catalog.strpos(pg_catalog.reverse(p_unique_id), '@');
  v_local text;
  v_realm text;
BEGIN
  IF p_issuer IS NULL OR pg_catalog.length(p_issuer) NOT BETWEEN 1 AND 255
     OR p_subject IS NULL OR pg_catalog.length(p_subject) NOT BETWEEN 1 AND 255
     OR p_unique_id IS NULL OR pg_catalog.length(p_unique_id) NOT BETWEEN 1 AND 255
     OR p_token_hash IS NULL OR pg_catalog.octet_length(p_token_hash) <> 32 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;

  -- A unique id is local@realm: both parts present, and the local part does
  -- not end in "@", so "x@@realm" is no shortcut to a realm.
  IF v_at > 0 THEN
    v_local := pg_catalog."left"(p_unique_id, -v_at);
    v_realm := pg_catalog.lower(pg_catalog.btrim(pg_catalog."right"(p_unique_id, v_at - 1), E' \t\r\n') COLLATE "C");
  END IF;

  IF v_home_org ~ '^[a-z0-9.-]{1,255}$'
     AND v_local <> '' AND pg_catalog."right"(v_local, 1) <> '@'
     AND v_realm = v_home_org COLLATE "C" THEN
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

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

-- migrate:down
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE OR REPLACE FUNCTION identity.open_session(
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

  INSERT INTO identity.user_account (institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
  VALUES (v_institution, p_issuer, p_subject, p_unique_id)
  ON CONFLICT DO NOTHING;

  SELECT u.id, u.institution_id, u.oidc_subject
    INTO v_user, v_user_institution, v_subject
  FROM identity.user_account u
  WHERE u.oidc_issuer = p_issuer AND u.hr_edu_person_unique_id = p_unique_id;

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

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

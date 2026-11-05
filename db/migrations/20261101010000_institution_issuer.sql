-- migrate:up
-- An institution takes logins only from an OIDC issuer recorded for it
-- (DAN-159, F-021; D-104). The issuer is data, never code: one issuer may
-- serve many institutions, and an institution may later hold a second issuer
-- without a change to the account model. D-09 is unchanged; a row only
-- narrows what is accepted, it adds no way to sign in.
--
-- open_session refuses an issuer not recorded for the institution chosen by
-- hrEduPersonHomeOrg with the same ZD503 as an unknown home organisation or
-- a wrong realm, after the same two lookups, and leaves no row. The check
-- runs on every login, so it also holds for accounts created before it.
-- Comparison is equality alone: the login route stores the issuer in one
-- spelling (accountIssuer in src/server/auth/oidc.ts), and the database
-- normalises nothing. No row is backfilled; seeds and provisioning write
-- them next to aai_home_org.
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- Printable ASCII after an http(s) scheme: no space, control or look-alike
-- character can make two spellings of one issuer.
CREATE TABLE identity.institution_issuer (
  institution_id uuid NOT NULL REFERENCES identity.institution (id),
  oidc_issuer text NOT NULL CHECK (
    char_length(oidc_issuer) <= 255
    AND oidc_issuer ~ ('^https?://[!-~]+$' COLLATE "C")
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id, oidc_issuer)
);

-- As for every identity table: RLS is forced and only the owner, which acts
-- solely through the definer functions, has a policy. No role holds a grant.
ALTER TABLE identity.institution_issuer ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.institution_issuer FORCE ROW LEVEL SECURITY;
CREATE POLICY institution_issuer_owner ON identity.institution_issuer TO ductus_identity USING (true) WITH CHECK (true);

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
  v_shape_ok boolean;
  v_issuer_ok boolean;
BEGIN
  IF p_issuer IS NULL OR pg_catalog.length(p_issuer) NOT BETWEEN 1 AND 255
     OR p_subject IS NULL OR pg_catalog.length(p_subject) NOT BETWEEN 1 AND 255
     OR p_unique_id IS NULL OR pg_catalog.length(p_unique_id) NOT BETWEEN 1 AND 255
     OR p_token_hash IS NULL OR pg_catalog.octet_length(p_token_hash) <> 32 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;

  -- A unique id is local@realm with exactly one "@". The local part is not
  -- empty and holds no "@", no space or separator (Zs, Zl, Zp), no control
  -- (Cc) and no invisible format character (Cf); text cannot hold a surrogate
  -- (Cs). This is stricter than claims.ts, which lets Zs spaces through. Any
  -- other character passes.
  IF v_at > 0 THEN
    v_local := pg_catalog."left"(p_unique_id, -v_at);
    v_realm := pg_catalog.lower(pg_catalog.btrim(pg_catalog."right"(p_unique_id, v_at - 1), E' \t\r\n') COLLATE "C");
  END IF;
  v_shape_ok := v_home_org ~ '^[a-z0-9.-]{1,255}$'
    AND v_local ~ ('^[^@\u0001-\u0020\u007F-\u00A0\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890\u0891\u08E2'
                   '\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u2066-\u206F\u3000\uFEFF\uFFF9-\uFFFB'
                   '\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A'
                   '\U000E0001\U000E0020-\U000E007F]+$' COLLATE "C")
    AND v_realm = v_home_org COLLATE "C";

  -- Both lookups run on every path, so a refused shape or realm, an unknown
  -- institution and an issuer not recorded for it run the same queries
  -- before the same ZD503. That is the boundary: equal outcome and equal
  -- queries, not equal duration. With no institution the issuer lookup
  -- still reads the table, under the nil id that gen_random_uuid never
  -- gives; a match there could not open a session anyway.
  SELECT i.id INTO v_institution FROM identity.institution i WHERE i.aai_home_org = v_home_org;
  v_issuer_ok := EXISTS (
    SELECT 1 FROM identity.institution_issuer ii
    WHERE ii.institution_id = coalesce(v_institution, '00000000-0000-0000-0000-000000000000'::uuid)
      AND ii.oidc_issuer = p_issuer COLLATE "C"
  );
  IF v_institution IS NULL OR v_shape_ok IS NOT TRUE OR v_issuer_ok IS NOT TRUE THEN
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
  -- Lower case under "C" folds ASCII alone, so a look-alike character such
  -- as the Kelvin sign stays what it is and matches nothing.
  v_home_org text := pg_catalog.lower(pg_catalog.btrim(p_home_org, E' \t\r\n') COLLATE "C");
  -- Characters from the end of the unique id to its last "@"; 0 when none.
  v_at integer := pg_catalog.strpos(pg_catalog.reverse(p_unique_id), '@');
  v_local text;
  v_realm text;
  v_shape_ok boolean;
BEGIN
  IF p_issuer IS NULL OR pg_catalog.length(p_issuer) NOT BETWEEN 1 AND 255
     OR p_subject IS NULL OR pg_catalog.length(p_subject) NOT BETWEEN 1 AND 255
     OR p_unique_id IS NULL OR pg_catalog.length(p_unique_id) NOT BETWEEN 1 AND 255
     OR p_token_hash IS NULL OR pg_catalog.octet_length(p_token_hash) <> 32 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;

  -- A unique id is local@realm with exactly one "@". The local part is not
  -- empty and holds no "@", no space or separator (Zs, Zl, Zp), no control
  -- (Cc) and no invisible format character (Cf); text cannot hold a surrogate
  -- (Cs). This is stricter than claims.ts, which lets Zs spaces through. Any
  -- other character passes.
  IF v_at > 0 THEN
    v_local := pg_catalog."left"(p_unique_id, -v_at);
    v_realm := pg_catalog.lower(pg_catalog.btrim(pg_catalog."right"(p_unique_id, v_at - 1), E' \t\r\n') COLLATE "C");
  END IF;
  v_shape_ok := v_home_org ~ '^[a-z0-9.-]{1,255}$'
    AND v_local ~ ('^[^@\u0001-\u0020\u007F-\u00A0\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890\u0891\u08E2'
                   '\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u2064\u2066-\u206F\u3000\uFEFF\uFFF9-\uFFFB'
                   '\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A'
                   '\U000E0001\U000E0020-\U000E007F]+$' COLLATE "C")
    AND v_realm = v_home_org COLLATE "C";

  -- The lookup runs on every path, so a refused shape or realm and an
  -- unknown institution run the same query before the same ZD503. That is
  -- the boundary: equal outcome and equal queries, not equal duration.
  SELECT i.id INTO v_institution FROM identity.institution i WHERE i.aai_home_org = v_home_org;
  IF v_institution IS NULL OR v_shape_ok IS NOT TRUE THEN
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

DROP TABLE identity.institution_issuer;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

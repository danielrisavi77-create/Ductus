-- migrate:up
-- Open sessions follow the institution they were opened under (F-036,
-- DAN-169). current_actor() looks only at the session row, so a change to
-- what an institution accepts must close the sessions it no longer would:
--
-- - a new or removed aai_home_org closes every live session of that
--   institution; a first value (from NULL) closes nothing, since no login
--   can have opened a session without one;
-- - a removed or rewritten institution_issuer row closes the live sessions
--   of users of that issuer in that institution, and nothing else;
-- - identity.close_user_sessions(user) lets an operator close every live
--   session of one user. No application role and not PUBLIC may run it.
--
-- Each close happens in the statement's own transaction, so the change and
-- the closing commit or fail together. A session already closed keeps its
-- reason and time, and an expired one is left as it is. current_actor() and
-- open_session decide as before; open_session only reads the institution
-- and issuer rows FOR SHARE, so a change and a login in flight cannot pass
-- each other. The triggers run as the role that changes the row: only the owner
-- ductus_identity (or a superuser) can, and a role that could change the row
-- but not close the sessions would fail the whole statement.
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- logout_all comes from 20261101200000_session_idle.sql (DAN-296), which
-- landed first; this CHECK keeps it.
ALTER TABLE identity.session DROP CONSTRAINT session_close_reason_check;
ALTER TABLE identity.session ADD CONSTRAINT session_close_reason_check CHECK (
  close_reason IN ('logout', 'backchannel_logout', 'logout_all', 'institution_changed', 'issuer_removed', 'operator')
);

CREATE FUNCTION identity.close_sessions_on_home_org_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  UPDATE identity.session
     SET closed_at = pg_catalog.now(), close_reason = 'institution_changed'
   WHERE institution_id = OLD.id
     AND closed_at IS NULL
     AND expires_at > pg_catalog.now();
  RETURN NULL;
END
$$;

CREATE TRIGGER close_sessions_on_home_org_change
  AFTER UPDATE OF aai_home_org ON identity.institution
  FOR EACH ROW WHEN (OLD.aai_home_org IS NOT NULL AND OLD.aai_home_org IS DISTINCT FROM NEW.aai_home_org)
  EXECUTE FUNCTION identity.close_sessions_on_home_org_change();

-- A row rewritten to the same institution and issuer (created_at alone)
-- accepts the same logins, so it closes nothing.
CREATE FUNCTION identity.close_sessions_on_issuer_removal() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.institution_id = OLD.institution_id
     AND NEW.oidc_issuer = OLD.oidc_issuer COLLATE "C" THEN
    RETURN NULL;
  END IF;
  UPDATE identity.session s
     SET closed_at = pg_catalog.now(), close_reason = 'issuer_removed'
    FROM identity.user_account u
   WHERE u.id = s.user_id
     AND s.institution_id = OLD.institution_id
     AND u.oidc_issuer = OLD.oidc_issuer COLLATE "C"
     AND s.closed_at IS NULL
     AND s.expires_at > pg_catalog.now();
  RETURN NULL;
END
$$;

CREATE TRIGGER close_sessions_on_issuer_removal
  AFTER UPDATE OR DELETE ON identity.institution_issuer
  FOR EACH ROW EXECUTE FUNCTION identity.close_sessions_on_issuer_removal();

-- TRUNCATE fires no row trigger; with every issuer gone no session stays.
CREATE FUNCTION identity.close_sessions_on_issuer_truncate() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  UPDATE identity.session
     SET closed_at = pg_catalog.now(), close_reason = 'issuer_removed'
   WHERE closed_at IS NULL
     AND expires_at > pg_catalog.now();
  RETURN NULL;
END
$$;

CREATE TRIGGER close_sessions_on_issuer_truncate
  AFTER TRUNCATE ON identity.institution_issuer
  FOR EACH STATEMENT EXECUTE FUNCTION identity.close_sessions_on_issuer_truncate();

-- Operator only: returns how many sessions it closed, so a repeat gives 0.
CREATE FUNCTION identity.close_user_sessions(p_user_id uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  closed integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  UPDATE identity.session
     SET closed_at = pg_catalog.now(), close_reason = 'operator'
   WHERE user_id = p_user_id
     AND closed_at IS NULL
     AND expires_at > pg_catalog.now();
  GET DIAGNOSTICS closed = ROW_COUNT;
  RETURN closed;
END
$$;

-- open_session is the body of 20261101010000_institution_issuer.sql with
-- its two lookups made FOR SHARE; nothing else changes.
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
  --
  -- Both rows are read FOR SHARE and stay locked until the login commits
  -- (F-036, DAN-169). A change to aai_home_org or to the issuer row then
  -- waits for this login, and its trigger closes the session it opened; a
  -- change committed first is seen here, under READ COMMITTED the row is
  -- read again, and the login gets the same ZD503. Shared locks do not
  -- block each other, so logins do not wait for one another.
  SELECT i.id INTO v_institution FROM identity.institution i WHERE i.aai_home_org = v_home_org FOR SHARE;
  SELECT true INTO v_issuer_ok FROM identity.institution_issuer ii
  WHERE ii.institution_id = coalesce(v_institution, '00000000-0000-0000-0000-000000000000'::uuid)
    AND ii.oidc_issuer = p_issuer COLLATE "C"
  FOR SHARE;
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

REVOKE ALL ON FUNCTION
  identity.close_sessions_on_home_org_change(),
  identity.close_sessions_on_issuer_removal(),
  identity.close_sessions_on_issuer_truncate(),
  identity.close_user_sessions(uuid)
FROM PUBLIC;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

-- migrate:down
-- Restoring the old CHECK fails while a session holds one of the new
-- reasons, so a rollback never rewrites why a session was closed.
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

DROP TRIGGER close_sessions_on_issuer_truncate ON identity.institution_issuer;
DROP TRIGGER close_sessions_on_issuer_removal ON identity.institution_issuer;
DROP TRIGGER close_sessions_on_home_org_change ON identity.institution;
DROP FUNCTION identity.close_user_sessions(uuid);
DROP FUNCTION identity.close_sessions_on_issuer_truncate();
DROP FUNCTION identity.close_sessions_on_issuer_removal();
DROP FUNCTION identity.close_sessions_on_home_org_change();
ALTER TABLE identity.session DROP CONSTRAINT session_close_reason_check;
ALTER TABLE identity.session ADD CONSTRAINT session_close_reason_check CHECK (
  close_reason IN ('logout', 'backchannel_logout', 'logout_all')
);
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

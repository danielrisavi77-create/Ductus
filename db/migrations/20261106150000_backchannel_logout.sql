-- migrate:up
-- DAN-474 (M1.4b, D-200 P4; plan of attack #1620, contract on #1091,
-- c.6683556284): OpenID Connect back-channel logout. The provider names a
-- login session by `sid`, an account by `sub`, or both, and Ductus closes the
-- open sessions that match. It never opens one (D-09).
--
-- The smallest datum that matches a session is kept: the SHA-256 of the
-- provider's `sid`, never the value or a token. A closed session carries
-- none: a trigger clears it on every close, whatever closes the session, and
-- a CHECK refuses a closed row that still has it. A session that ends by
-- expiry or idleness without a close keeps it until purge_ended_sessions
-- removes the row (known limit; no logout can match it, it is not open).
--
-- A logout token counts once per issuer (`jti`, Back-Channel Logout 1.0
-- 2.6 point 6). Its hash is kept for one hour, longer than the route accepts
-- a token by its `iat`, and every call removes the rows past that.
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

ALTER TABLE identity.session
  ADD COLUMN oidc_sid_hash bytea,
  ADD CONSTRAINT session_oidc_sid_hash_check CHECK (octet_length(oidc_sid_hash) = 32),
  ADD CONSTRAINT session_oidc_sid_hash_closed_check CHECK (closed_at IS NULL OR oidc_sid_hash IS NULL);

CREATE INDEX session_oidc_sid_hash_idx ON identity.session (oidc_sid_hash) WHERE oidc_sid_hash IS NOT NULL;

-- Every close path sets closed_at; none has to know about the hash.
CREATE FUNCTION identity.clear_session_sid() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.oidc_sid_hash := NULL;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION identity.clear_session_sid() FROM PUBLIC;

CREATE TRIGGER clear_session_sid BEFORE UPDATE ON identity.session
FOR EACH ROW WHEN (NEW.closed_at IS NOT NULL AND NEW.oidc_sid_hash IS NOT NULL)
EXECUTE FUNCTION identity.clear_session_sid();

CREATE TABLE identity.logout_token_jti (
  oidc_issuer text NOT NULL CHECK (pg_catalog.length(oidc_issuer) BETWEEN 1 AND 255),
  jti_hash bytea NOT NULL CHECK (octet_length(jti_hash) = 32),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (oidc_issuer, jti_hash)
);

ALTER TABLE identity.logout_token_jti ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.logout_token_jti FORCE ROW LEVEL SECURITY;
CREATE POLICY logout_token_jti_owner ON identity.logout_token_jti TO ductus_identity USING (true) WITH CHECK (true);

-- The eight-argument open_session decides who logs in, with every refusal it
-- had; this one runs it first and then keeps the hash of the `sid` on the
-- session it opened. A `sid` that is missing or not a plain value of 1 to
-- 255 characters is left out and the login stands (#1620 E5): it then has
-- no back-channel logout by `sid`, only by `sub`.
CREATE FUNCTION identity.open_session(
  p_issuer text,
  p_subject text,
  p_unique_id text,
  p_home_org text,
  p_token_hash bytea,
  p_given_name text,
  p_family_name text,
  p_teacher_eligible boolean,
  p_sid text
) RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_expires timestamptz;
BEGIN
  v_expires := identity.open_session(
    p_issuer, p_subject, p_unique_id, p_home_org, p_token_hash, p_given_name, p_family_name, p_teacher_eligible
  );
  IF pg_catalog.length(p_sid) BETWEEN 1 AND 255 AND p_sid !~ '[[:cntrl:]]' THEN
    UPDATE identity.session
       SET oidc_sid_hash = pg_catalog.sha256(pg_catalog.convert_to(p_sid, 'UTF8'))
     WHERE token_hash = p_token_hash AND closed_at IS NULL;
  END IF;
  RETURN v_expires;
END
$$;

REVOKE ALL ON FUNCTION identity.open_session(text, text, text, text, bytea, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.open_session(text, text, text, text, bytea, text, text, boolean, text) TO ductus_auth;
-- The eight-argument form stays granted: it is this one with no `sid`,
-- which the login may always send, so it gives the login nothing more.

-- Closes the open sessions a verified logout token names and returns how
-- many. The route has checked the signature and every claim; this checks
-- the shape of what it is given again, refuses a token seen before, and
-- touches nothing but closed_at, close_reason and the jti record.
--
-- ZD422: invalid input. ZD409: the token was used before; nothing is
-- closed. Under READ COMMITTED a second call with the same token waits on
-- the first call's row and then finds it, so a token closes once; a session
-- whose login has not committed yet is not seen and stays open (#1620 D1).
CREATE FUNCTION identity.backchannel_logout(p_issuer text, p_subject text, p_sid text, p_jti text)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_sid_hash bytea;
  v_count integer;
BEGIN
  IF p_issuer IS NULL OR pg_catalog.length(p_issuer) NOT BETWEEN 1 AND 255
     OR p_jti IS NULL OR pg_catalog.length(p_jti) NOT BETWEEN 1 AND 255
     OR (p_subject IS NULL AND p_sid IS NULL)
     OR pg_catalog.length(p_subject) NOT BETWEEN 1 AND 255 OR p_subject ~ '[[:cntrl:]]'
     OR pg_catalog.length(p_sid) NOT BETWEEN 1 AND 255 OR p_sid ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted') THEN
    RAISE EXCEPTION 'read committed required' USING ERRCODE = '25000';
  END IF;

  DELETE FROM identity.logout_token_jti WHERE expires_at <= pg_catalog.now();
  INSERT INTO identity.logout_token_jti (oidc_issuer, jti_hash, expires_at)
  VALUES (p_issuer, pg_catalog.sha256(pg_catalog.convert_to(p_jti, 'UTF8')), pg_catalog.now() + interval '1 hour')
  ON CONFLICT (oidc_issuer, jti_hash) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'logout token replayed' USING ERRCODE = 'ZD409';
  END IF;

  IF p_sid IS NOT NULL THEN
    v_sid_hash := pg_catalog.sha256(pg_catalog.convert_to(p_sid, 'UTF8'));
  END IF;
  UPDATE identity.session s
     SET closed_at = pg_catalog.now(), close_reason = 'backchannel_logout'
    FROM identity.user_account u
   WHERE u.id = s.user_id
     AND u.oidc_issuer = p_issuer
     AND (p_subject IS NULL OR u.oidc_subject = p_subject)
     AND (p_sid IS NULL OR s.oidc_sid_hash = v_sid_hash)
     AND s.closed_at IS NULL
     AND s.expires_at > pg_catalog.now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION identity.backchannel_logout(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.backchannel_logout(text, text, text, text) TO ductus_auth;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

-- migrate:down
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION identity.backchannel_logout(text, text, text, text);
DROP FUNCTION identity.open_session(text, text, text, text, bytea, text, text, boolean, text);
DROP TABLE identity.logout_token_jti;
DROP TRIGGER clear_session_sid ON identity.session;
DROP FUNCTION identity.clear_session_sid();
DROP INDEX identity.session_oidc_sid_hash_idx;
ALTER TABLE identity.session
  DROP CONSTRAINT session_oidc_sid_hash_closed_check,
  DROP CONSTRAINT session_oidc_sid_hash_check,
  DROP COLUMN oidc_sid_hash;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

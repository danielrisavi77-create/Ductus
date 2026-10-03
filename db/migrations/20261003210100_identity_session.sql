-- migrate:up
-- Identity, server-side sessions and current_actor() (docs/BACKEND.md 4.3).
-- ductus_app never reads these tables: it sets app.session_token inside a
-- transaction (withActor) and current_actor() derives the user from it.
-- A raw user id is never a GUC, so SQL injection cannot pose as another user.
CREATE SCHEMA identity;
CREATE SCHEMA app;

CREATE TABLE identity.institution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,32}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Identity is the issuer plus hrEduPersonUniqueID, never e-mail (D-73), and
-- no OIB. The OIDC subject is kept too until Srce confirms which identifier
-- is never reassigned.
CREATE TABLE identity.user_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES identity.institution (id),
  oidc_issuer text NOT NULL CHECK (length(oidc_issuer) BETWEEN 1 AND 255),
  oidc_subject text NOT NULL CHECK (length(oidc_subject) BETWEEN 1 AND 255),
  hr_edu_person_unique_id text NOT NULL CHECK (length(hr_edu_person_unique_id) BETWEEN 1 AND 255),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (oidc_issuer, hr_edu_person_unique_id),
  UNIQUE (oidc_issuer, oidc_subject),
  UNIQUE (id, institution_id)
);

-- Only the SHA-256 of the cookie token is stored. The composite key keeps a
-- session's institution equal to its user's.
CREATE TABLE identity.session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  user_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  closed_at timestamptz,
  close_reason text CHECK (close_reason IN ('logout', 'backchannel_logout')),
  FOREIGN KEY (user_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  CHECK (expires_at > created_at),
  CHECK ((closed_at IS NULL) = (close_reason IS NULL))
);
CREATE INDEX session_user_id_idx ON identity.session (user_id);

ALTER TABLE identity.institution OWNER TO ductus_identity;
ALTER TABLE identity.user_account OWNER TO ductus_identity;
ALTER TABLE identity.session OWNER TO ductus_identity;

-- RLS is forced, so even the owner needs a policy. Only ductus_identity has
-- one; it is NOLOGIN and acts solely through the functions below. Every
-- other role sees no rows even if a grant is added by mistake.
ALTER TABLE identity.institution ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.institution FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.user_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.user_account FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.session ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.session FORCE ROW LEVEL SECURITY;
CREATE POLICY institution_owner ON identity.institution TO ductus_identity USING (true) WITH CHECK (true);
CREATE POLICY user_account_owner ON identity.user_account TO ductus_identity USING (true) WITH CHECK (true);
CREATE POLICY session_owner ON identity.session TO ductus_identity USING (true) WITH CHECK (true);

-- Token format matches the cookie: 32 random bytes in base64url (43 chars).
-- Anything else is anonymous, never an error that could echo the token.
CREATE FUNCTION app.current_actor(OUT user_id uuid, OUT institution_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH t AS (
    SELECT pg_catalog.current_setting('app.session_token', true) AS token
  )
  SELECT s.user_id, s.institution_id
  FROM t
  JOIN identity.session s
    ON s.token_hash = pg_catalog.sha256(pg_catalog.convert_to(t.token, 'UTF8'))
  WHERE t.token ~ '^[A-Za-z0-9_-]{43}$'
    AND s.closed_at IS NULL
    AND s.expires_at > pg_catalog.now()
$$;

-- For policies: call as (SELECT app.current_user_id()) so it runs once per
-- statement, not once per row.
CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT (app.current_actor()).user_id $$;

CREATE FUNCTION app.current_institution_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT (app.current_actor()).institution_id $$;

-- Logout closes only the caller's own session. Returns false when there is
-- no open session for the token, so repeating it is harmless.
CREATE FUNCTION identity.close_current_session() RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  token text := pg_catalog.current_setting('app.session_token', true);
  closed integer;
BEGIN
  IF token IS NULL OR token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN false;
  END IF;
  UPDATE identity.session
     SET closed_at = pg_catalog.now(), close_reason = 'logout'
   WHERE token_hash = pg_catalog.sha256(pg_catalog.convert_to(token, 'UTF8'))
     AND closed_at IS NULL;
  GET DIAGNOSTICS closed = ROW_COUNT;
  RETURN closed > 0;
END
$$;

ALTER FUNCTION app.current_actor() OWNER TO ductus_identity;
ALTER FUNCTION identity.close_current_session() OWNER TO ductus_identity;

GRANT USAGE ON SCHEMA identity TO ductus_identity, ductus_app;
GRANT USAGE ON SCHEMA app TO ductus_identity, ductus_app;
GRANT EXECUTE ON FUNCTION
  app.current_actor(),
  app.current_user_id(),
  app.current_institution_id(),
  identity.close_current_session()
TO ductus_app;

-- migrate:down
DROP SCHEMA app CASCADE;
DROP SCHEMA identity CASCADE;

-- migrate:up
-- Open sessions follow the institution they were opened under (F-036,
-- DAN-169). current_actor() looks only at the session row, so a change to
-- what an institution accepts must close the sessions it no longer would:
--
-- - a new or removed aai_home_org closes every live session of that
--   institution;
-- - a removed or rewritten institution_issuer row closes the live sessions
--   of users of that issuer in that institution, and nothing else;
-- - identity.close_user_sessions(user) lets an operator close every live
--   session of one user. No application role and not PUBLIC may run it.
--
-- Each close happens in the statement's own transaction, so the change and
-- the closing commit or fail together. A session already closed keeps its
-- reason and time, and an expired one is left as it is. current_actor() and
-- open_session are unchanged; a later login is judged by open_session as
-- before. The triggers run as the role that changes the row: only the owner
-- ductus_identity (or a superuser) can, and a role that could change the row
-- but not close the sessions would fail the whole statement.
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

ALTER TABLE identity.session DROP CONSTRAINT session_close_reason_check;
ALTER TABLE identity.session ADD CONSTRAINT session_close_reason_check CHECK (
  close_reason IN ('logout', 'backchannel_logout', 'institution_changed', 'issuer_removed', 'operator')
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
  FOR EACH ROW WHEN (OLD.aai_home_org IS DISTINCT FROM NEW.aai_home_org)
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
DROP TRIGGER close_sessions_on_issuer_truncate ON identity.institution_issuer;
DROP TRIGGER close_sessions_on_issuer_removal ON identity.institution_issuer;
DROP TRIGGER close_sessions_on_home_org_change ON identity.institution;
DROP FUNCTION identity.close_user_sessions(uuid);
DROP FUNCTION identity.close_sessions_on_issuer_truncate();
DROP FUNCTION identity.close_sessions_on_issuer_removal();
DROP FUNCTION identity.close_sessions_on_home_org_change();
ALTER TABLE identity.session DROP CONSTRAINT session_close_reason_check;
ALTER TABLE identity.session ADD CONSTRAINT session_close_reason_check CHECK (
  close_reason IN ('logout', 'backchannel_logout')
);
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

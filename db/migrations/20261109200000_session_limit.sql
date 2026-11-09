-- migrate:up
-- At most five live sessions per account (DAN-296, D-200 P2). A login that
-- would make a sixth closes the least active of the others, with reason
-- superseded; the new session itself is never closed by this. Live means what
-- app.current_actor() means: open, before expires_at and seen within two
-- hours. Ended rows are not counted and are not touched.
--
-- The limit is a trigger on the session row, so every path that opens a
-- session keeps it, whichever open_session layer runs. Two logins of one
-- account at the same time are put in a row by a lock on its user_account
-- row, taken after the session INSERT: the second waits for the first to
-- commit and then counts its session too. open_session already holds no
-- stronger lock on user_account (its INSERT ... ON CONFLICT DO NOTHING and
-- the foreign key take KEY SHARE, which this lock does not conflict with), and
-- the trigger fires before any other row is locked by the login. No session
-- path locks user_account; institution.require_admin_request takes FOR SHARE
-- on the admin's own row and touches no session row, so one only waits for
-- the other and there is no lock order to invert. Under REPEATABLE READ the second login would count from its old
-- snapshot and miss the first one's session, so the trigger refuses it.
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

ALTER TABLE identity.session DROP CONSTRAINT session_close_reason_check;
ALTER TABLE identity.session ADD CONSTRAINT session_close_reason_check CHECK (
  close_reason IN ('logout', 'backchannel_logout', 'logout_all', 'institution_changed', 'issuer_removed', 'operator', 'superseded')
);

CREATE FUNCTION identity.enforce_session_limit() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.expires_at <= pg_catalog.now()
     OR NEW.last_seen_at <= pg_catalog.now() - interval '2 hours' THEN
    RETURN NULL;
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted') THEN
    RAISE EXCEPTION 'read committed required' USING ERRCODE = '25000';
  END IF;
  PERFORM 1 FROM identity.user_account WHERE id = NEW.user_id FOR NO KEY UPDATE;
  -- Keeps the four most recently active others; the order is total, so the
  -- same rows always go.
  UPDATE identity.session
  SET closed_at = pg_catalog.now(), close_reason = 'superseded'
  WHERE id IN (
      SELECT s.id
      FROM identity.session s
      WHERE s.user_id = NEW.user_id
        AND s.id <> NEW.id
        AND s.closed_at IS NULL
        AND s.expires_at > pg_catalog.now()
        AND s.last_seen_at > pg_catalog.now() - interval '2 hours'
      ORDER BY s.last_seen_at DESC, s.created_at DESC, s.id DESC
      OFFSET 4
    )
    AND closed_at IS NULL;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION identity.enforce_session_limit() FROM PUBLIC;

CREATE TRIGGER enforce_session_limit AFTER INSERT ON identity.session
FOR EACH ROW WHEN (NEW.closed_at IS NULL)
EXECUTE FUNCTION identity.enforce_session_limit();

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

-- migrate:down
-- No limit again. Rows closed as superseded become logout, the nearest reason
-- the earlier CHECK knows; they stay closed.
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP TRIGGER enforce_session_limit ON identity.session;
DROP FUNCTION identity.enforce_session_limit();
UPDATE identity.session SET close_reason = 'logout' WHERE close_reason = 'superseded';
ALTER TABLE identity.session DROP CONSTRAINT session_close_reason_check;
ALTER TABLE identity.session ADD CONSTRAINT session_close_reason_check CHECK (
  close_reason IN ('logout', 'backchannel_logout', 'logout_all', 'institution_changed', 'issuer_removed', 'operator')
);

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

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
-- the other and there is no lock order to invert. Under REPEATABLE READ the
-- second login would count from its old snapshot and miss the first one's
-- session, so the trigger refuses it. A touch of the session being chosen
-- (identity.touch_current_session) is the one write that can change the
-- choice while the login waits; the guarded passes below handle it.
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- The CHECK is replaced by a wider one: every value the old one allowed is
-- still allowed, so each row passes; validating it at once scans
-- identity.session under the lock this transaction holds.
-- squawk-ignore ban-drop-constraint
ALTER TABLE identity.session DROP CONSTRAINT session_close_reason_check;
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE identity.session ADD CONSTRAINT session_close_reason_check CHECK (
  close_reason IN ('logout', 'backchannel_logout', 'logout_all', 'institution_changed', 'issuer_removed', 'operator', 'superseded')
);

CREATE FUNCTION identity.enforce_session_limit() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_pass integer;
  v_live bigint;
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
  -- same rows always go. A row is closed only while it still has the
  -- last_seen_at it was chosen by: a touch that commits while this waits for
  -- its row changes that value, the row is skipped, and the next pass chooses
  -- again from a fresh snapshot. A touch writes a session at most once a
  -- minute, so the passes are few; the bound turns a runaway into a retryable
  -- failure rather than a loop.
  FOR v_pass IN 1..10 LOOP
    UPDATE identity.session s
    SET closed_at = pg_catalog.now(), close_reason = 'superseded'
    FROM (
        SELECT o.id, o.last_seen_at
        FROM identity.session o
        WHERE o.user_id = NEW.user_id
          AND o.id <> NEW.id
          AND o.closed_at IS NULL
          AND o.expires_at > pg_catalog.now()
          AND o.last_seen_at > pg_catalog.now() - interval '2 hours'
        ORDER BY o.last_seen_at DESC, o.created_at DESC, o.id DESC
        OFFSET 4
      ) c
    WHERE s.id = c.id
      AND s.closed_at IS NULL
      AND s.last_seen_at = c.last_seen_at;
    SELECT pg_catalog.count(*) INTO v_live
    FROM identity.session o
    WHERE o.user_id = NEW.user_id
      AND o.id <> NEW.id
      AND o.closed_at IS NULL
      AND o.expires_at > pg_catalog.now()
      AND o.last_seen_at > pg_catalog.now() - interval '2 hours';
    IF v_live <= 4 THEN
      RETURN NULL;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'session limit not settled' USING ERRCODE = '40001';
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

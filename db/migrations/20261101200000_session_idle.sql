-- migrate:up
-- A session also ends after two hours without activity, next to the twelve
-- hours from login that open_session already sets (DAN-296 B4, D-200 P2).
-- Activity is recorded by identity.touch_current_session(); which requests
-- count is decided by the server (D-200 P2), the time only by this clock.
-- Expiry is not logout: nothing here touches a browser's local journal (D-118).
--
-- Rows that exist before this migration start their idle time now, but never
-- after expires_at, so no session lives past its twelve hours and a closed
-- one stays closed. now() is the start of this transaction: a login committed
-- after it and before the ALTER below has a later created_at, so the backfill
-- never goes below created_at (expires_at is always later still). New rows
-- take now() from the column default, because open_session names no
-- last_seen_at in its INSERT.
GRANT CREATE ON SCHEMA identity, app TO ductus_identity;
SET LOCAL ROLE ductus_identity;

ALTER TABLE identity.session ADD COLUMN last_seen_at timestamptz;
UPDATE identity.session SET last_seen_at = GREATEST(created_at, LEAST(now(), expires_at));
ALTER TABLE identity.session
  ALTER COLUMN last_seen_at SET DEFAULT now(),
  ALTER COLUMN last_seen_at SET NOT NULL,
  ADD CONSTRAINT session_last_seen_check CHECK (last_seen_at >= created_at);

-- logout_all: closed by "sign me out everywhere". Whichever of this and a
-- later migration with its own reasons lands second carries both sets.
ALTER TABLE identity.session
  DROP CONSTRAINT session_close_reason_check,
  ADD CONSTRAINT session_close_reason_check
    CHECK (close_reason IN ('logout', 'backchannel_logout', 'logout_all'));

-- Exactly two hours without activity is already anonymous. Every RLS policy
-- and RPC reaches identity through this function, so the rule holds there too.
CREATE OR REPLACE FUNCTION app.current_actor(OUT user_id uuid, OUT institution_id uuid)
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
    AND s.last_seen_at > pg_catalog.now() - interval '2 hours'
$$;

-- Records activity on the caller's own session, only while it is open and
-- live: an expired or closed session is never revived, and expires_at never
-- moves. At most one write per 60 seconds, so the idle limit is off by at
-- most a minute. A concurrent call on a locked row waits for it rather than
-- skip it: if the other transaction commits, the row is checked again and
-- this call writes nothing, and if it rolls back, this call writes, so a
-- committed call's activity is never lost. Takes no argument: the time is the
-- database's. True when this call wrote the row.
CREATE FUNCTION identity.touch_current_session() RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_token text := pg_catalog.current_setting('app.session_token', true);
BEGIN
  IF v_token IS NULL OR v_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN false;
  END IF;
  UPDATE identity.session s
  SET last_seen_at = pg_catalog.now()
  WHERE s.token_hash = pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8'))
    AND s.closed_at IS NULL
    AND s.expires_at > pg_catalog.now()
    AND s.last_seen_at > pg_catalog.now() - interval '2 hours'
    AND s.last_seen_at <= pg_catalog.now() - interval '60 seconds';
  RETURN FOUND;
END
$$;

-- "Sign me out everywhere": closes every live session of the caller's
-- account, the calling one included, with reason logout_all. Without a live
-- session it closes nothing, and the outcome is the same either way, so it
-- tells nobody whether other sessions exist. Rows that already ended keep
-- their reason and time, so a repeat changes nothing.
CREATE FUNCTION identity.close_all_sessions_for_identity() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid;
BEGIN
  SELECT a.user_id INTO v_user FROM app.current_actor() a;
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  UPDATE identity.session
  SET closed_at = pg_catalog.now(), close_reason = 'logout_all'
  WHERE user_id = v_user
    AND closed_at IS NULL
    AND expires_at > pg_catalog.now()
    AND last_seen_at > pg_catalog.now() - interval '2 hours';
END
$$;

-- Retention (D-200 P2): a row goes more than 30 days after its session ended,
-- by closing, by the twelve hours or by two hours without activity, whichever
-- came first. Only identity.session is touched; accounts, evidence,
-- submissions and the audit trail are not. Returns the count alone. Nothing
-- schedules it yet; it runs as ductus_retention.
CREATE FUNCTION identity.purge_ended_sessions() RETURNS bigint
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  WITH gone AS (
    DELETE FROM identity.session
    WHERE LEAST(closed_at, expires_at, last_seen_at + interval '2 hours')
          < pg_catalog.now() - interval '30 days'
    RETURNING 1
  )
  SELECT pg_catalog.count(*) FROM gone
$$;

REVOKE ALL ON FUNCTION identity.touch_current_session() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.close_all_sessions_for_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.purge_ended_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.touch_current_session() TO ductus_app;
GRANT EXECUTE ON FUNCTION identity.close_all_sessions_for_identity() TO ductus_app;
GRANT EXECUTE ON FUNCTION identity.purge_ended_sessions() TO ductus_retention;

SET LOCAL ROLE ductus_migrator;
-- USAGE lets ductus_retention name the function; it still holds no privilege
-- on any identity table (db/tests/020-identity-session.sql, section 6).
GRANT USAGE ON SCHEMA identity TO ductus_retention;
REVOKE CREATE ON SCHEMA identity, app FROM ductus_identity;

-- migrate:down
-- Back to the twelve hours alone. Rows closed with logout_all become logout,
-- the nearest reason the earlier CHECK knows; they stay closed.
REVOKE USAGE ON SCHEMA identity FROM ductus_retention;
GRANT CREATE ON SCHEMA app TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION identity.purge_ended_sessions();
DROP FUNCTION identity.close_all_sessions_for_identity();
DROP FUNCTION identity.touch_current_session();

CREATE OR REPLACE FUNCTION app.current_actor(OUT user_id uuid, OUT institution_id uuid)
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

UPDATE identity.session SET close_reason = 'logout' WHERE close_reason = 'logout_all';
ALTER TABLE identity.session
  DROP CONSTRAINT session_close_reason_check,
  ADD CONSTRAINT session_close_reason_check
    CHECK (close_reason IN ('logout', 'backchannel_logout'));
ALTER TABLE identity.session
  DROP CONSTRAINT session_last_seen_check,
  DROP COLUMN last_seen_at;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity;

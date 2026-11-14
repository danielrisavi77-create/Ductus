-- migrate:up
-- DAN-184, M11.9-P01 (contract on #1836, c.6821517800; round 3 c.6867544247):
-- operational and security alarms delivered to an in-app channel, with no
-- outside provider (NQ10, D-277). This table is the channel; showing it to a
-- person is a later step with its own role.
--
-- An alarm is a member of a closed set of kinds and a few timestamps. No
-- column can hold a person, an institution, a work, an error message or any
-- free text (PRODUCT 5): the kind is all that is known about the fault.
--
-- Deduplication: at most one open alarm per kind (partial unique index). A
-- raise from a reporter that holds no fresh fault row of the kind, this
-- replica or another, adds to raise_count on the open row instead of adding a
-- row. A raise from a reporter whose row is still fresh is only a refresh: it
-- moves that row's reported_at and leaves raise_count and last_raised_at, so
-- raise_count counts raises, not how long a fault lasts. Raise and resolve at
-- once leave either one open row or a closed one and a new episode, never two
-- open rows (tests/integration/ops-alarm-race.integration.test.ts).
--
-- Several replicas share the table. Each one reports with its own reporter, a
-- random UUID made when the process starts (not a person and not a machine).
-- ops_alarm_fault holds, per kind, which reporters saw the fault within the
-- last 120 seconds (database time). An alarm stays open while any such fresh
-- row exists: a healthy replica cannot close an alarm another replica still
-- sees, and its resolve answers false so it tries again later. A replica that
-- stops reporting stops holding the alarm once its row is 120 s old. Both RPCs
-- first take a SHARE ROW EXCLUSIVE lock on ops_alarm_fault, so a raise and a
-- resolve of different replicas run one after the other.
--
-- The schema is identity, not audit: ductus_app has no USAGE on audit. Nobody
-- but the owner reads or writes the tables; ductus_app only calls the two RPCs.
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE TABLE identity.ops_alarm (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('ready_database', 'ready_storage', 'ready_queue', 'ready_signing')),
  category text NOT NULL CHECK (category IN ('operational', 'security')),
  first_raised_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  last_raised_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  raise_count integer NOT NULL DEFAULT 1 CHECK (raise_count >= 1),
  resolved_at timestamptz,
  CHECK ((category = 'security') = (kind = 'ready_signing')),
  CHECK (last_raised_at >= first_raised_at),
  CHECK (resolved_at IS NULL OR resolved_at >= first_raised_at)
);
CREATE UNIQUE INDEX ops_alarm_open_kind ON identity.ops_alarm (kind) WHERE resolved_at IS NULL;

ALTER TABLE identity.ops_alarm ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.ops_alarm FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_alarm_owner ON identity.ops_alarm TO ductus_identity
  USING (true) WITH CHECK (true);

-- One row per kind and reporter that last saw the fault at reported_at.
CREATE TABLE identity.ops_alarm_fault (
  kind text NOT NULL CHECK (kind IN ('ready_database', 'ready_storage', 'ready_queue', 'ready_signing')),
  reporter uuid NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (kind, reporter)
);

ALTER TABLE identity.ops_alarm_fault ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.ops_alarm_fault FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_alarm_fault_owner ON identity.ops_alarm_fault TO ductus_identity
  USING (true) WITH CHECK (true);

-- Records that this reporter sees the fault now and drops stale rows of the
-- kind. When the reporter had no fresh row, opens the alarm of this kind or
-- counts one more raise on the open one. When it had one, the call is a
-- refresh: only reported_at moves, and an alarm is opened only if none is
-- open (a fresh row normally means one is).
-- ZD422 for a kind outside the set or a NULL reporter.
CREATE FUNCTION identity.raise_ops_alarm(p_kind text, p_reporter uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET lock_timeout = '2000ms'
AS $$
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('ready_database', 'ready_storage', 'ready_queue', 'ready_signing')
     OR p_reporter IS NULL THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  LOCK TABLE identity.ops_alarm_fault IN SHARE ROW EXCLUSIVE MODE;
  DELETE FROM identity.ops_alarm_fault f
   WHERE f.kind = p_kind
     AND f.reported_at < pg_catalog.statement_timestamp() - interval '120 seconds';
  UPDATE identity.ops_alarm_fault f
     SET reported_at = GREATEST(f.reported_at, pg_catalog.statement_timestamp())
   WHERE f.kind = p_kind AND f.reporter = p_reporter;
  IF FOUND THEN
    INSERT INTO identity.ops_alarm (kind, category)
    VALUES (p_kind, CASE WHEN p_kind = 'ready_signing' THEN 'security' ELSE 'operational' END)
    ON CONFLICT (kind) WHERE resolved_at IS NULL DO NOTHING;
    RETURN;
  END IF;
  INSERT INTO identity.ops_alarm_fault (kind, reporter) VALUES (p_kind, p_reporter);
  INSERT INTO identity.ops_alarm AS a (kind, category)
  VALUES (p_kind, CASE WHEN p_kind = 'ready_signing' THEN 'security' ELSE 'operational' END)
  ON CONFLICT (kind) WHERE resolved_at IS NULL DO UPDATE
    SET raise_count = LEAST(a.raise_count, 2147483646) + 1,
        last_raised_at = GREATEST(a.last_raised_at, pg_catalog.statement_timestamp());
END
$$;

-- Records that this reporter no longer sees the fault and drops stale rows of
-- the kind. Closes the open alarm of this kind and answers true when no fresh
-- row of another reporter is left; otherwise leaves it open and answers false.
-- True with nothing written to ops_alarm when no alarm is open.
-- ZD422 for a kind outside the set or a NULL reporter.
CREATE FUNCTION identity.resolve_ops_alarm(p_kind text, p_reporter uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET lock_timeout = '2000ms'
AS $$
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('ready_database', 'ready_storage', 'ready_queue', 'ready_signing')
     OR p_reporter IS NULL THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  LOCK TABLE identity.ops_alarm_fault IN SHARE ROW EXCLUSIVE MODE;
  DELETE FROM identity.ops_alarm_fault f
   WHERE f.kind = p_kind
     AND (f.reporter = p_reporter
          OR f.reported_at < pg_catalog.statement_timestamp() - interval '120 seconds');
  IF EXISTS (SELECT 1 FROM identity.ops_alarm_fault f WHERE f.kind = p_kind) THEN
    RETURN false;
  END IF;
  UPDATE identity.ops_alarm a
     SET resolved_at = GREATEST(a.last_raised_at, pg_catalog.statement_timestamp())
   WHERE a.kind = p_kind AND a.resolved_at IS NULL;
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION identity.raise_ops_alarm(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.resolve_ops_alarm(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.raise_ops_alarm(text, uuid) TO ductus_app;
GRANT EXECUTE ON FUNCTION identity.resolve_ops_alarm(text, uuid) TO ductus_app;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION identity.resolve_ops_alarm(text, uuid);
DROP FUNCTION identity.raise_ops_alarm(text, uuid);
DROP TABLE identity.ops_alarm_fault;
DROP TABLE identity.ops_alarm;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

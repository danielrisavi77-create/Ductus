-- migrate:up
-- DAN-184, M11.9-P01 (contract on #1836, c.6821517800): operational and
-- security alarms delivered to an in-app channel, with no outside provider
-- (NQ10, D-277). This table is the channel; showing it to a person is a later
-- step with its own role.
--
-- An alarm is a member of a closed set of kinds and a few timestamps. No
-- column can hold a person, an institution, a work, an error message or any
-- free text (PRODUCT 5): the kind is all that is known about the fault.
--
-- Deduplication: at most one open alarm per kind (partial unique index). A
-- repeated raise, from this replica or another, adds to raise_count on the
-- open row instead of adding a row; raise and resolve at once leave either one
-- open row or a closed one and a new episode, never two open rows
-- (tests/integration/ops-alarm-race.integration.test.ts).
--
-- The schema is identity, not audit: ductus_app has no USAGE on audit. Nobody
-- but the owner reads or writes the table; ductus_app only calls the two RPCs.
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

-- Opens the alarm of this kind, or counts one more raise on the open one.
-- ZD422 for a kind outside the set.
CREATE FUNCTION identity.raise_ops_alarm(p_kind text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET lock_timeout = '2000ms'
AS $$
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('ready_database', 'ready_storage', 'ready_queue', 'ready_signing') THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  INSERT INTO identity.ops_alarm AS a (kind, category)
  VALUES (p_kind, CASE WHEN p_kind = 'ready_signing' THEN 'security' ELSE 'operational' END)
  ON CONFLICT (kind) WHERE resolved_at IS NULL DO UPDATE
    SET raise_count = LEAST(a.raise_count, 2147483646) + 1,
        last_raised_at = GREATEST(a.last_raised_at, pg_catalog.statement_timestamp());
END
$$;

-- Closes the open alarm of this kind; nothing when none is open.
-- ZD422 for a kind outside the set.
CREATE FUNCTION identity.resolve_ops_alarm(p_kind text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET lock_timeout = '2000ms'
AS $$
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('ready_database', 'ready_storage', 'ready_queue', 'ready_signing') THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  UPDATE identity.ops_alarm a
     SET resolved_at = GREATEST(a.last_raised_at, pg_catalog.statement_timestamp())
   WHERE a.kind = p_kind AND a.resolved_at IS NULL;
END
$$;

REVOKE ALL ON FUNCTION identity.raise_ops_alarm(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.resolve_ops_alarm(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.raise_ops_alarm(text) TO ductus_app;
GRANT EXECUTE ON FUNCTION identity.resolve_ops_alarm(text) TO ductus_app;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION identity.resolve_ops_alarm(text);
DROP FUNCTION identity.raise_ops_alarm(text);
DROP TABLE identity.ops_alarm;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

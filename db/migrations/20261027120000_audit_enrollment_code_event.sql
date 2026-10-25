-- DAN-292: the audit trail of enrollment codes (owner decisions of 25 Oct
-- 2026 on #87, comment 6404460984, and "Zapisati i izmjenu"; contract on #747,
-- comments 6404499871 and 6404516621). A code that stops being active leaves
-- exactly one row, written in the same transaction as the change: 'revoked'
-- when a teacher cancels it (revoke_enrollment_code), 'replaced' when issuing
-- a new code switches it off (create_enrollment_code). The caller comes from
-- the session, never from a parameter. The row names the code by its id; the
-- code itself is stored nowhere, as before. Input, access rule and return of
-- both functions are unchanged; revoke_enrollment_code now also locks the
-- course first, as create_enrollment_code always did.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA audit TO ductus_identity;
GRANT CREATE ON SCHEMA institution TO ductus_identity;

SET LOCAL ROLE ductus_identity;

-- One row per code that stopped being active, so UNIQUE (code_id). A new kind
-- of event widens the CHECK in the migration that adds it.
CREATE TABLE audit.enrollment_code_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  course_id uuid NOT NULL,
  code_id uuid NOT NULL UNIQUE REFERENCES institution.course_enrollment_code (id),
  kind text NOT NULL CHECK (kind IN ('revoked', 'replaced')),
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (course_id, institution_id) REFERENCES institution.course (id, institution_id),
  FOREIGN KEY (actor_id, institution_id) REFERENCES identity.user_account (id, institution_id)
);
CREATE INDEX enrollment_code_event_course_idx ON audit.enrollment_code_event (course_id, occurred_at);

CREATE TRIGGER enrollment_code_event_append_only BEFORE UPDATE OR DELETE ON audit.enrollment_code_event
  FOR EACH ROW EXECUTE FUNCTION audit.reject_change();
CREATE TRIGGER enrollment_code_event_no_truncate BEFORE TRUNCATE ON audit.enrollment_code_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_change();

-- As access_log: forced RLS with only the owner's policy and no privilege for
-- any other role. Rows are written only from inside the two functions below,
-- which the owner role owns (CLAUDE.md: the client never writes the audit trail).
ALTER TABLE audit.enrollment_code_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.enrollment_code_event FORCE ROW LEVEL SECURITY;
CREATE POLICY enrollment_code_event_owner ON audit.enrollment_code_event TO ductus_identity USING (true) WITH CHECK (true);

-- As 20261010180000, and the code it switches off is written as 'replaced'.
CREATE OR REPLACE FUNCTION institution.create_enrollment_code(p_course_id uuid, p_valid_until timestamptz) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_code text;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF NOT coalesce(p_valid_until > now() AND p_valid_until <= now() + interval '1 year', false) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  -- Two teachers at once: the second waits here, then replaces the first code.
  PERFORM 1 FROM institution.course c WHERE c.id = p_course_id FOR UPDATE;
  WITH ended AS (
    UPDATE institution.course_enrollment_code e SET active = false
     WHERE e.course_id = p_course_id AND e.active
    RETURNING e.id
  )
  INSERT INTO audit.enrollment_code_event (institution_id, course_id, code_id, kind, actor_id, occurred_at)
  SELECT actor.institution_id, p_course_id, ended.id, 'replaced', actor.user_id, now() FROM ended;
  v_code := upper(encode(
    substring(sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())) FROM 1 FOR 8), 'hex'
  ));
  INSERT INTO institution.course_enrollment_code (course_id, code_hash, valid_until, created_by)
  VALUES (p_course_id, sha256(convert_to(v_code, 'UTF8')), p_valid_until, actor.user_id);
  RETURN concat_ws('-', substr(v_code, 1, 4), substr(v_code, 5, 4), substr(v_code, 9, 4), substr(v_code, 13, 4));
END
$$;

-- As 20261010180000, and the cancelled code is written as 'revoked'. False,
-- and nothing written, when none was active. It now locks the course first.
CREATE OR REPLACE FUNCTION institution.revoke_enrollment_code(p_course_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_written integer;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- The same lock, taken first, as create_enrollment_code: the audit row's
  -- foreign key needs a share lock on the course, so without it a revocation
  -- holding the code and an issue holding the course would wait on each other.
  PERFORM 1 FROM institution.course c WHERE c.id = p_course_id FOR UPDATE;
  WITH ended AS (
    UPDATE institution.course_enrollment_code e SET active = false
     WHERE e.course_id = p_course_id AND e.active
    RETURNING e.id
  )
  INSERT INTO audit.enrollment_code_event (institution_id, course_id, code_id, kind, actor_id, occurred_at)
  SELECT actor.institution_id, p_course_id, ended.id, 'revoked', actor.user_id, now() FROM ended;
  GET DIAGNOSTICS v_written = ROW_COUNT;
  RETURN v_written > 0;
END
$$;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA audit FROM ductus_identity;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;
CREATE OR REPLACE FUNCTION institution.create_enrollment_code(p_course_id uuid, p_valid_until timestamptz) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_code text;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF NOT coalesce(p_valid_until > now() AND p_valid_until <= now() + interval '1 year', false) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  -- Two teachers at once: the second waits here, then replaces the first code.
  PERFORM 1 FROM institution.course c WHERE c.id = p_course_id FOR UPDATE;
  UPDATE institution.course_enrollment_code e SET active = false WHERE e.course_id = p_course_id AND e.active;
  v_code := upper(encode(
    substring(sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())) FROM 1 FOR 8), 'hex'
  ));
  INSERT INTO institution.course_enrollment_code (course_id, code_hash, valid_until, created_by)
  VALUES (p_course_id, sha256(convert_to(v_code, 'UTF8')), p_valid_until, actor.user_id);
  RETURN concat_ws('-', substr(v_code, 1, 4), substr(v_code, 5, 4), substr(v_code, 9, 4), substr(v_code, 13, 4));
END
$$;
CREATE OR REPLACE FUNCTION institution.revoke_enrollment_code(p_course_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  UPDATE institution.course_enrollment_code e SET active = false WHERE e.course_id = p_course_id AND e.active;
  RETURN FOUND;
END
$$;
DROP TABLE audit.enrollment_code_event;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- DAN-525 (M2.A, D-262 Q04; contract on #1091, comment 6644919534): only the
-- operator appoints the administrator of an institution, on the faculty's
-- written request, and only the operator revokes the last one.
--
-- - institution.appoint_institution_admin(user, request_ref) and
--   institution.revoke_institution_admin(user, request_ref) are the operator
--   procedure. No application role and not PUBLIC may run them, as
--   identity.close_user_sessions. The institution is the user's own, read
--   from the user's row, so no function takes an institution as input (U1). Each writes the role row and its audit
--   row in one statement; the audit row carries the reference to the written
--   request (a register number, never a name) and no actor, since the
--   operator is not a user of the institution. A call that changes nothing
--   writes nothing and returns false.
-- - A deferred check refuses to commit an active confirmed administrator row
--   that the procedure did not appoint: confirm_teacher_role, a direct write
--   or an un-revoke cannot make one.
-- - A deferred check refuses to commit a revocation that leaves the
--   institution without an active administrator, unless the procedure wrote
--   it. The check takes a lock per institution and runs only under READ
--   COMMITTED (25000 otherwise), so two revocations in flight cannot each see
--   the other's administrator as still there.
--
-- Administrators present before this migration keep their rows and have no
-- audit row; deleting a role row is not covered (a row the procedure
-- appointed cannot be deleted while its audit row exists).
--
-- Errors carry no input: ZD409 the change is refused, ZD422 invalid input,
-- 25000 a level other than READ COMMITTED.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA audit TO ductus_identity;
GRANT CREATE ON SCHEMA institution TO ductus_identity;

SET LOCAL ROLE ductus_identity;

-- The trail of teacher roles also records administrator roles. A teacher row
-- names the administrator who acted; an administrator row names the written
-- request instead. Every row already there is a teacher row with an actor.
-- The table is the append-only trail written by two functions; the checks are
-- validated under this migration's lock and the table is short. The role
-- check is replaced in the same transaction, and origin_check below keeps
-- actor_id required for every teacher row: no guarantee is lost.
-- squawk-ignore ban-drop-constraint
ALTER TABLE audit.teacher_role_event DROP CONSTRAINT teacher_role_event_role_check;
-- squawk-ignore ban-drop-not-null
ALTER TABLE audit.teacher_role_event ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE audit.teacher_role_event ADD COLUMN request_ref text;
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE audit.teacher_role_event ADD CONSTRAINT teacher_role_event_role_check
  CHECK (role IN ('teacher', 'admin'));
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE audit.teacher_role_event ADD CONSTRAINT teacher_role_event_origin_check
  CHECK ((role = 'admin') = (request_ref IS NOT NULL) AND (role = 'admin') = (actor_id IS NULL));
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE audit.teacher_role_event ADD CONSTRAINT teacher_role_event_request_ref_check
  CHECK (request_ref IS NULL OR (request_ref = btrim(request_ref) AND institution.is_plain_label(request_ref)));

-- Shared by both procedures: returns the institution of an existing user,
-- whose row stays as read until commit, once the reference is a plain label
-- without surrounding spaces.
CREATE FUNCTION institution.require_admin_request(p_user_id uuid, p_request_ref text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  v_institution_id uuid;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted') THEN
    RAISE EXCEPTION 'read committed required' USING ERRCODE = '25000';
  END IF;
  IF p_request_ref IS NULL OR p_request_ref <> pg_catalog.btrim(p_request_ref)
     OR NOT coalesce(institution.is_plain_label(p_request_ref), false) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  SELECT u.institution_id INTO v_institution_id FROM identity.user_account u WHERE u.id = p_user_id FOR SHARE;
  IF v_institution_id IS NULL THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'institution.institution_admin:' || v_institution_id::text, 0));
  RETURN v_institution_id;
END
$$;

-- Operator only. RETURNING gives only a row inserted now or a pending row
-- confirmed now; an administrator already active is left as it was.
CREATE FUNCTION institution.appoint_institution_admin(p_user_id uuid, p_request_ref text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_institution_id uuid := institution.require_admin_request(p_user_id, p_request_ref);
  v_written integer;
BEGIN
  WITH appointed AS (
    INSERT INTO institution.institution_role AS r (institution_id, user_id, role, confirmed_by, confirmed_at)
    VALUES (v_institution_id, p_user_id, 'admin', NULL, now())
    ON CONFLICT (institution_id, user_id, role) WHERE revoked_at IS NULL
    DO UPDATE SET confirmed_by = NULL, confirmed_at = EXCLUDED.confirmed_at
    WHERE r.confirmed_at IS NULL
    RETURNING r.id, r.institution_id, r.user_id, r.role
  )
  INSERT INTO audit.teacher_role_event
    (institution_id, role_id, teacher_id, role, kind, actor_id, request_ref, occurred_at)
  SELECT appointed.institution_id, appointed.id, appointed.user_id, appointed.role, 'confirmed', NULL,
         p_request_ref, now()
  FROM appointed;
  GET DIAGNOSTICS v_written = ROW_COUNT;
  RETURN v_written > 0;
END
$$;

-- Operator only; it may revoke the last administrator.
CREATE FUNCTION institution.revoke_institution_admin(p_user_id uuid, p_request_ref text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_institution_id uuid := institution.require_admin_request(p_user_id, p_request_ref);
  v_written integer;
BEGIN
  WITH revoked AS (
    UPDATE institution.institution_role r SET revoked_at = now()
     WHERE r.institution_id = v_institution_id AND r.user_id = p_user_id
       AND r.role = 'admin' AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
    RETURNING r.id, r.institution_id, r.user_id, r.role
  )
  INSERT INTO audit.teacher_role_event
    (institution_id, role_id, teacher_id, role, kind, actor_id, request_ref, occurred_at)
  SELECT revoked.institution_id, revoked.id, revoked.user_id, revoked.role, 'revoked', NULL, p_request_ref, now()
  FROM revoked;
  GET DIAGNOSTICS v_written = ROW_COUNT;
  RETURN v_written > 0;
END
$$;

-- At commit the row is read again: an active confirmed administrator needs
-- the procedure's 'confirmed' row written together with the row as it now
-- stands, no 'revoked' row, and must not be a revoked row made active again.
-- The procedure writes the row and its 'confirmed' row in one statement, so
-- both carry the same transaction id (xmin), in a subtransaction too. Any
-- later write that brings the row back into office (clearing and setting
-- confirmed_at again, or a restore after a revocation outside the procedure,
-- which writes no 'revoked' row) gives the row another xmin, so an earlier
-- 'confirmed' row no longer admits it. A later change to the same row in
-- another savepoint of the procedure's transaction is refused too (fail
-- closed). The caller may be ductus_app, which cannot read the trail: hence
-- the definer.
CREATE FUNCTION institution.check_admin_appointment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_restored boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_restored := OLD.revoked_at IS NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM institution.institution_role r
             WHERE r.id = NEW.id AND r.role = 'admin' AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
               AND (v_restored
                    OR NOT EXISTS (SELECT 1 FROM audit.teacher_role_event e
                                   WHERE e.role_id = r.id AND e.role = 'admin' AND e.kind = 'confirmed'
                                     AND e.xmin = r.xmin)
                    OR EXISTS (SELECT 1 FROM audit.teacher_role_event e
                               WHERE e.role_id = r.id AND e.kind = 'revoked'))) THEN
    RAISE EXCEPTION 'administrator not appointed by the operator' USING ERRCODE = 'ZD409';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER institution_role_admin_appointed AFTER INSERT ON institution.institution_role
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.role = 'admin' AND NEW.confirmed_at IS NOT NULL AND NEW.revoked_at IS NULL)
  EXECUTE FUNCTION institution.check_admin_appointment();
CREATE CONSTRAINT TRIGGER institution_role_admin_reappointed AFTER UPDATE ON institution.institution_role
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.role = 'admin' AND NEW.confirmed_at IS NOT NULL AND NEW.revoked_at IS NULL
        AND (OLD.role <> 'admin' OR OLD.confirmed_at IS NULL OR OLD.revoked_at IS NOT NULL
             OR (OLD.id, OLD.institution_id, OLD.user_id) IS DISTINCT FROM (NEW.id, NEW.institution_id, NEW.user_id)))
  EXECUTE FUNCTION institution.check_admin_appointment();

-- At commit, under the lock of the institution: a revocation outside the
-- procedure must leave an active administrator behind. The procedure's
-- 'revoked' row lets the operator revoke the last one.
CREATE FUNCTION institution.check_last_admin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted') THEN
    RAISE EXCEPTION 'read committed required' USING ERRCODE = '25000';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'institution.institution_admin:' || OLD.institution_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM institution.institution_role r
                 WHERE r.institution_id = OLD.institution_id AND r.role = 'admin'
                   AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM audit.teacher_role_event e
                     WHERE e.role_id = OLD.id AND e.role = 'admin' AND e.kind = 'revoked') THEN
    RAISE EXCEPTION 'last administrator' USING ERRCODE = 'ZD409';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER institution_role_keeps_admin AFTER UPDATE ON institution.institution_role
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.role = 'admin' AND OLD.confirmed_at IS NOT NULL AND OLD.revoked_at IS NULL
        AND NOT (NEW.role = 'admin' AND NEW.confirmed_at IS NOT NULL AND NEW.revoked_at IS NULL
                 AND (OLD.id, OLD.institution_id, OLD.user_id) IS NOT DISTINCT FROM (NEW.id, NEW.institution_id, NEW.user_id)))
  EXECUTE FUNCTION institution.check_last_admin();

REVOKE ALL ON FUNCTION
  institution.require_admin_request(uuid, text),
  institution.appoint_institution_admin(uuid, text),
  institution.revoke_institution_admin(uuid, text),
  institution.check_admin_appointment(),
  institution.check_last_admin()
FROM PUBLIC;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA audit FROM ductus_identity;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only; staging and production only go forward (docs/BACKEND.md §6).
-- Administrator rows of the trail cannot go back under the old checks.
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
GRANT CREATE ON SCHEMA audit TO ductus_identity;
SET LOCAL ROLE ductus_identity;
DROP TRIGGER institution_role_keeps_admin ON institution.institution_role;
DROP TRIGGER institution_role_admin_reappointed ON institution.institution_role;
DROP TRIGGER institution_role_admin_appointed ON institution.institution_role;
DROP FUNCTION institution.check_last_admin();
DROP FUNCTION institution.check_admin_appointment();
DROP FUNCTION institution.revoke_institution_admin(uuid, text);
DROP FUNCTION institution.appoint_institution_admin(uuid, text);
DROP FUNCTION institution.require_admin_request(uuid, text);
ALTER TABLE audit.teacher_role_event DROP CONSTRAINT teacher_role_event_request_ref_check;
ALTER TABLE audit.teacher_role_event DROP CONSTRAINT teacher_role_event_origin_check;
ALTER TABLE audit.teacher_role_event DROP CONSTRAINT teacher_role_event_role_check;
ALTER TABLE audit.teacher_role_event DROP COLUMN request_ref;
ALTER TABLE audit.teacher_role_event ALTER COLUMN actor_id SET NOT NULL;
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE audit.teacher_role_event ADD CONSTRAINT teacher_role_event_role_check CHECK (role = 'teacher');
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA audit FROM ductus_identity;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

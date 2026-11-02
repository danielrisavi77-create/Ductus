-- DAN-497 (M2.2-P03, #1263, Poznate granice t. 1; contract on #1091,
-- comment 6581690986): confirming a teacher role and revoking it each leave
-- one append-only audit row with the administrator from the session, the role
-- row it changed, the teacher and the database time, written in the same
-- statement as the change. Input, access rule and return of both functions
-- are unchanged; a call that changes nothing writes nothing.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA audit TO ductus_identity;
GRANT CREATE ON SCHEMA institution TO ductus_identity;

SET LOCAL ROLE ductus_identity;

-- The target of the composite key below. id alone is already unique; this
-- adds no new rule to institution.institution_role. The index is built under
-- the lock this migration's one transaction holds; the table has one row per
-- role binding, so the scan is short.
-- squawk-ignore constraint-missing-not-valid, disallowed-unique-constraint
ALTER TABLE institution.institution_role ADD CONSTRAINT institution_role_binding_key UNIQUE (id, institution_id, user_id, role);

-- One row per role row and kind: a role row is confirmed at most once and
-- revoked at most once. A role confirmed again after a revocation is a new
-- row of institution.institution_role, so it gets its own rows. The row is
-- bound to the role row it records, so the trail cannot name a teacher,
-- institution or role that row never had.
CREATE TABLE audit.teacher_role_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  role_id uuid NOT NULL,
  teacher_id uuid NOT NULL,
  role text NOT NULL CHECK (role = 'teacher'),
  kind text NOT NULL CHECK (kind IN ('confirmed', 'revoked')),
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (role_id, kind),
  CONSTRAINT teacher_role_event_role_fkey FOREIGN KEY (role_id, institution_id, teacher_id, role)
    REFERENCES institution.institution_role (id, institution_id, user_id, role),
  FOREIGN KEY (teacher_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (actor_id, institution_id) REFERENCES identity.user_account (id, institution_id)
);
CREATE INDEX teacher_role_event_institution_idx ON audit.teacher_role_event (institution_id, occurred_at);

CREATE TRIGGER teacher_role_event_append_only BEFORE UPDATE OR DELETE ON audit.teacher_role_event
  FOR EACH ROW EXECUTE FUNCTION audit.reject_change();
CREATE TRIGGER teacher_role_event_no_truncate BEFORE TRUNCATE ON audit.teacher_role_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_change();

-- As course_member_event: forced RLS with only the owner's policy and no
-- privilege for any other role. Rows are written only from inside the two
-- functions below, which the owner role owns.
ALTER TABLE audit.teacher_role_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.teacher_role_event FORCE ROW LEVEL SECURITY;
CREATE POLICY teacher_role_event_owner ON audit.teacher_role_event TO ductus_identity USING (true) WITH CHECK (true);

-- As 20261101190000, and the role row it confirms is written as 'confirmed'.
-- RETURNING gives only a row that was inserted or whose confirmation was
-- set now; a role already confirmed is left as it was and writes no row.
CREATE OR REPLACE FUNCTION institution.confirm_teacher_role(p_candidate_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF NOT institution.actor_has_role('admin')
     OR p_candidate_id IS NOT DISTINCT FROM actor.user_id
     OR NOT EXISTS (
       SELECT 1 FROM identity.user_account u
       WHERE u.id = p_candidate_id AND u.institution_id = actor.institution_id
     )
     OR NOT EXISTS (
       SELECT 1 FROM identity.teacher_eligibility e
       WHERE e.user_id = p_candidate_id AND e.institution_id = actor.institution_id
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  WITH confirmed AS (
    INSERT INTO institution.institution_role AS r (institution_id, user_id, role, confirmed_by, confirmed_at)
    VALUES (actor.institution_id, p_candidate_id, 'teacher', actor.user_id, now())
    ON CONFLICT (institution_id, user_id, role) WHERE revoked_at IS NULL
    DO UPDATE SET confirmed_by = EXCLUDED.confirmed_by, confirmed_at = EXCLUDED.confirmed_at
    WHERE r.confirmed_at IS NULL
    RETURNING r.id, r.institution_id, r.user_id, r.role
  )
  INSERT INTO audit.teacher_role_event (institution_id, role_id, teacher_id, role, kind, actor_id, occurred_at)
  SELECT confirmed.institution_id, confirmed.id, confirmed.user_id, confirmed.role, 'confirmed', actor.user_id, now()
  FROM confirmed;
END
$$;

-- As 20261010190000, and the role row it revokes is written as 'revoked'.
CREATE OR REPLACE FUNCTION institution.revoke_teacher_role(p_teacher_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_written integer;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF NOT institution.actor_has_role('admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  WITH revoked AS (
    UPDATE institution.institution_role r SET revoked_at = now()
     WHERE r.institution_id = actor.institution_id AND r.user_id = p_teacher_id
       AND r.role = 'teacher' AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
    RETURNING r.id, r.institution_id, r.user_id, r.role
  )
  INSERT INTO audit.teacher_role_event (institution_id, role_id, teacher_id, role, kind, actor_id, occurred_at)
  SELECT revoked.institution_id, revoked.id, revoked.user_id, revoked.role, 'revoked', actor.user_id, now()
  FROM revoked;
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
CREATE OR REPLACE FUNCTION institution.confirm_teacher_role(p_candidate_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF NOT institution.actor_has_role('admin')
     OR p_candidate_id IS NOT DISTINCT FROM actor.user_id
     OR NOT EXISTS (
       SELECT 1 FROM identity.user_account u
       WHERE u.id = p_candidate_id AND u.institution_id = actor.institution_id
     )
     OR NOT EXISTS (
       SELECT 1 FROM identity.teacher_eligibility e
       WHERE e.user_id = p_candidate_id AND e.institution_id = actor.institution_id
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  INSERT INTO institution.institution_role AS r (institution_id, user_id, role, confirmed_by, confirmed_at)
  VALUES (actor.institution_id, p_candidate_id, 'teacher', actor.user_id, now())
  ON CONFLICT (institution_id, user_id, role) WHERE revoked_at IS NULL
  DO UPDATE SET confirmed_by = EXCLUDED.confirmed_by, confirmed_at = EXCLUDED.confirmed_at
  WHERE r.confirmed_at IS NULL;
END
$$;
CREATE OR REPLACE FUNCTION institution.revoke_teacher_role(p_teacher_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF NOT institution.actor_has_role('admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  UPDATE institution.institution_role r SET revoked_at = now()
   WHERE r.institution_id = actor.institution_id AND r.user_id = p_teacher_id
     AND r.role = 'teacher' AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL;
  RETURN FOUND;
END
$$;
DROP TABLE audit.teacher_role_event;
ALTER TABLE institution.institution_role DROP CONSTRAINT institution_role_binding_key;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:up
-- DAN-379, M2.8-P02 (contract on #1836, c.6790935730): a grant stays bound
-- to the rows that made it live when it was given. P01 checked the grantee's
-- teacher role and the granter's relation to the work by user, so a role that
-- was revoked and then confirmed again, or a teacher removed from a course and
-- added back, brought an old grant back to life. A confirmation after a
-- revocation is a new row of institution.institution_role, and adding a
-- teacher back is a new row of institution.course_member; nothing reopens a
-- closed row. So the grant names those rows, and grant_can() asks that the
-- named rows are still in force:
--   grantee_role_id    the grantee's confirmed, unrevoked teacher role
--   granter_role_id    the granter's confirmed, unrevoked teacher role
--   granter_member_id  the granter's open teacher membership of the course of
--                      the assignment; null for a thesis, whose mentorship
--                      the assignment already names and which never reopens
-- A revocation, a removal or an ended mentorship ends the grant for good; a
-- new confirmation or membership needs a new grant. A missing binding reads
-- as no access. The bindings are set by a trigger on insert, whatever the
-- insert names, and never change.
SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- A bound row is of the grant's own institution (A5): the keys pair
-- institution_id with institution_id, as every key of the application does.
-- The tables are small and this one transaction holds their locks.
ALTER TABLE institution.institution_role
  -- squawk-ignore constraint-missing-not-valid, disallowed-unique-constraint
  ADD CONSTRAINT institution_role_id_institution_id_key UNIQUE (id, institution_id);
ALTER TABLE institution.course_member
  -- squawk-ignore constraint-missing-not-valid, disallowed-unique-constraint
  ADD CONSTRAINT course_member_id_institution_id_key UNIQUE (id, institution_id);

-- The table holds one row per grant (no UI before U-1), so the constraints
-- are checked under the lock of this one transaction.
ALTER TABLE institution.work_grant
  ADD COLUMN grantee_role_id uuid,
  ADD COLUMN granter_role_id uuid,
  ADD COLUMN granter_member_id uuid,
  -- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
  ADD CONSTRAINT work_grant_grantee_role_id_institution_id_fkey FOREIGN KEY (grantee_role_id, institution_id)
    REFERENCES institution.institution_role (id, institution_id),
  -- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
  ADD CONSTRAINT work_grant_granter_role_id_institution_id_fkey FOREIGN KEY (granter_role_id, institution_id)
    REFERENCES institution.institution_role (id, institution_id),
  -- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
  ADD CONSTRAINT work_grant_granter_member_id_institution_id_fkey FOREIGN KEY (granter_member_id, institution_id)
    REFERENCES institution.course_member (id, institution_id);

-- Existing grants, as the contract says: the row that keeps the grant live
-- today, else the latest confirmed row, which stays closed; none gives null.
-- A grant reads as it did before; only a later revocation or removal ends it
-- for good. An unconfirmed row is never bound: it could be confirmed in place.
UPDATE institution.work_grant g SET
  grantee_role_id = (
    SELECT r.id FROM institution.institution_role r
    WHERE r.user_id = g.grantee_id AND r.institution_id = g.institution_id AND r.role = 'teacher'
      AND r.confirmed_at IS NOT NULL
    ORDER BY (r.revoked_at IS NULL) DESC, r.confirmed_at DESC LIMIT 1),
  granter_role_id = (
    SELECT r.id FROM institution.institution_role r
    WHERE r.user_id = g.granted_by AND r.institution_id = g.institution_id AND r.role = 'teacher'
      AND r.confirmed_at IS NOT NULL
    ORDER BY (r.revoked_at IS NULL) DESC, r.confirmed_at DESC LIMIT 1),
  granter_member_id = (
    SELECT m.id FROM institution.assignment a
    JOIN institution.course_member m ON m.course_id = a.course_id AND m.institution_id = a.institution_id
    WHERE a.id = g.assignment_id AND a.institution_id = g.institution_id
      AND m.user_id = g.granted_by AND m.role = 'teacher'
    ORDER BY (m.member_to IS NULL) DESC, m.member_from DESC LIMIT 1);

-- Runs with the rights of the writer: grant_work_access() (the owner role) or
-- the owner role itself; ductus_app never writes the table.
CREATE FUNCTION institution.work_grant_binding_fill() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'ZD403';
  END IF;
  NEW.grantee_role_id := (
    SELECT r.id FROM institution.institution_role r
    WHERE r.user_id = NEW.grantee_id AND r.institution_id = NEW.institution_id AND r.role = 'teacher'
      AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL);
  NEW.granter_role_id := (
    SELECT r.id FROM institution.institution_role r
    WHERE r.user_id = NEW.granted_by AND r.institution_id = NEW.institution_id AND r.role = 'teacher'
      AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL);
  NEW.granter_member_id := (
    SELECT m.id FROM institution.assignment a
    JOIN institution.course_member m ON m.course_id = a.course_id AND m.institution_id = a.institution_id
    WHERE a.id = NEW.assignment_id AND a.institution_id = NEW.institution_id
      AND m.user_id = NEW.granted_by AND m.role = 'teacher' AND m.member_to IS NULL);
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION institution.work_grant_binding_fill() FROM PUBLIC;
CREATE TRIGGER work_grant_binding_fill
  BEFORE INSERT OR UPDATE OF grantee_role_id, granter_role_id, granter_member_id ON institution.work_grant
  FOR EACH ROW EXECUTE FUNCTION institution.work_grant_binding_fill();

-- As 20261103010000, with the bound rows in place of the checks by user.
CREATE OR REPLACE FUNCTION institution.grant_can(p_action text, p_document_id text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_institution uuid;
  v_scope record;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('read_text', 'comment') THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;

  SELECT a.user_id, a.institution_id INTO v_user, v_institution FROM app.current_actor() a;
  IF v_user IS NULL OR p_document_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT s.institution_id, s.assignment_id, s.principal_id INTO v_scope
  FROM collaboration.document_scope(p_document_id) s;
  IF v_scope.institution_id IS DISTINCT FROM v_institution THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM institution.work_grant g
    JOIN institution.assignment a ON a.id = g.assignment_id AND a.institution_id = g.institution_id
    JOIN institution.institution_role ge ON ge.id = g.grantee_role_id
     AND ge.user_id = g.grantee_id AND ge.institution_id = g.institution_id AND ge.role = 'teacher'
     AND ge.confirmed_at IS NOT NULL AND ge.revoked_at IS NULL
    JOIN institution.institution_role gr ON gr.id = g.granter_role_id
     AND gr.user_id = g.granted_by AND gr.institution_id = g.institution_id AND gr.role = 'teacher'
     AND gr.confirmed_at IS NOT NULL AND gr.revoked_at IS NULL
    WHERE g.institution_id = v_institution
      AND g.grantee_id = v_user
      AND g.assignment_id = v_scope.assignment_id
      AND g.student_id = v_scope.principal_id
      AND g.revoked_at IS NULL
      AND statement_timestamp() >= g.valid_from
      AND statement_timestamp() < g.valid_to
      AND p_action = ANY (g.actions)
      AND CASE
            WHEN a.course_id IS NOT NULL THEN EXISTS (
              SELECT 1 FROM institution.course_member m
              WHERE m.id = g.granter_member_id AND m.course_id = a.course_id
                AND m.institution_id = a.institution_id AND m.user_id = g.granted_by
                AND m.role = 'teacher' AND m.member_to IS NULL)
            ELSE EXISTS (
              SELECT 1 FROM institution.mentorship ms
              WHERE ms.id = a.mentorship_id AND ms.institution_id = a.institution_id
                AND ms.mentor_id = g.granted_by AND ms.ended_at IS NULL)
          END
  );
END
$$;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE OR REPLACE FUNCTION institution.grant_can(p_action text, p_document_id text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_institution uuid;
  v_scope record;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('read_text', 'comment') THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;

  SELECT a.user_id, a.institution_id INTO v_user, v_institution FROM app.current_actor() a;
  IF v_user IS NULL OR p_document_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT s.institution_id, s.assignment_id, s.principal_id INTO v_scope
  FROM collaboration.document_scope(p_document_id) s;
  IF v_scope.institution_id IS DISTINCT FROM v_institution THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM institution.institution_role r
    WHERE r.user_id = v_user AND r.institution_id = v_institution AND r.role = 'teacher'
      AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
  ) AND EXISTS (
    SELECT 1 FROM institution.work_grant g
    WHERE g.institution_id = v_institution
      AND g.grantee_id = v_user
      AND g.assignment_id = v_scope.assignment_id
      AND g.student_id = v_scope.principal_id
      AND g.revoked_at IS NULL
      AND statement_timestamp() >= g.valid_from
      AND statement_timestamp() < g.valid_to
      AND p_action = ANY (g.actions)
      AND institution.work_relation(g.granted_by, g.assignment_id) = 'teacher'
  );
END
$$;
DROP TRIGGER work_grant_binding_fill ON institution.work_grant;
-- squawk-ignore ban-drop-function
DROP FUNCTION institution.work_grant_binding_fill();
-- squawk-ignore ban-drop-column
ALTER TABLE institution.work_grant
  DROP COLUMN granter_member_id,
  DROP COLUMN granter_role_id,
  DROP COLUMN grantee_role_id;
ALTER TABLE institution.course_member DROP CONSTRAINT course_member_id_institution_id_key;
ALTER TABLE institution.institution_role DROP CONSTRAINT institution_role_id_institution_id_key;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

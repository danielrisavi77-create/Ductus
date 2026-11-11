-- DAN-294 (M10.4-P02, contract on #1836, c.6788079686): the access log names
-- the reader's real role and, for a submitted work, its own surface.
-- Expand only. A reader of a work is the teacher of its course (teacher), the
-- mentor of its thesis (mentor) or the teacher of the seminar group its owner
-- belongs to (seminar_teacher); the role is derived by the writer itself, in
-- the transaction of the read and from the same rules as the access check,
-- and a reader with none of these roles is refused without a row. Rows written
-- before keep teacher and live_view. The owner's own reads and lists without
-- content still write nothing; read_my_access_log (#1702) is unchanged.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA audit TO ductus_identity;
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;

SET LOCAL ROLE ductus_identity;

-- The closed lists grow; every existing row still holds. Each CHECK is
-- replaced by a wider one (the drop is deliberate) and validated in the same
-- transaction, as dbmate runs the migration in one.
-- squawk-ignore ban-drop-constraint
ALTER TABLE audit.access_log DROP CONSTRAINT access_log_reader_role_check;
ALTER TABLE audit.access_log ADD CONSTRAINT access_log_reader_role_check
  CHECK (reader_role IN ('teacher', 'mentor', 'seminar_teacher')) NOT VALID;
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE audit.access_log VALIDATE CONSTRAINT access_log_reader_role_check;
-- squawk-ignore ban-drop-constraint
ALTER TABLE audit.access_log DROP CONSTRAINT access_log_surface_check;
ALTER TABLE audit.access_log ADD CONSTRAINT access_log_surface_check
  CHECK (surface IN ('live_view', 'process_summary', 'fast_path', 'replay', 'submitted_text')) NOT VALID;
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE audit.access_log VALIDATE CONSTRAINT access_log_surface_check;

-- The role in which the caller reads a work of another person, or NULL. The
-- branches are those of collaboration.actor_role that give a reader other
-- than the owner: a teacher of the assignment is the mentor when the
-- assignment belongs to a mentorship and the teacher of the course otherwise;
-- without that, a teacher of the owner's seminar group. A teacher of the
-- course who also teaches the group stays teacher.
CREATE FUNCTION audit.reader_role(p_institution_id uuid, p_assignment_id uuid, p_owner_id uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_institution_id IS DISTINCT FROM a.institution_id THEN NULL
    WHEN p_owner_id = a.user_id THEN NULL
    WHEN institution.actor_assignment_role(p_assignment_id) = 'teacher' THEN
      CASE WHEN s.mentorship_id IS NOT NULL THEN 'mentor' ELSE 'teacher' END
    WHEN institution.actor_group_work(p_assignment_id, p_owner_id) THEN 'seminar_teacher'
  END
  FROM app.current_actor() a
  LEFT JOIN institution.assignment s ON s.id = p_assignment_id AND s.institution_id = a.institution_id
$$;
REVOKE ALL ON FUNCTION audit.reader_role(uuid, uuid, uuid) FROM PUBLIC;

-- As 20261021130000, with the role derived here instead of fixed: a session
-- with no reader role on the work is refused and nothing is written, so a
-- caller can never log a read it was not allowed, nor under another role.
CREATE OR REPLACE FUNCTION audit.record_work_opening(
  p_institution_id uuid, p_document_id text, p_assignment_id uuid, p_owner_id uuid, p_surface text
) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := audit.reader_role(p_institution_id, p_assignment_id, p_owner_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  INSERT INTO audit.access_log (institution_id, document_id, assignment_id, owner_id, reader_id, reader_role, surface, opened_at)
  SELECT p_institution_id, p_document_id, p_assignment_id, p_owner_id, a.user_id, v_role, p_surface,
         date_bin('5 minutes', now(), timestamptz '2000-01-01 00:00:00+00')
  FROM app.current_actor() a
  ON CONFLICT (document_id, institution_id, reader_id, surface, opened_at) DO NOTHING;
END
$$;

-- As 20261026163000, and the submitted revision is looked up before the read
-- is logged, so a read of the submitted text is logged as submitted_text and
-- a read of the live text as live_view. Outcomes and output are unchanged.
CREATE OR REPLACE FUNCTION collaboration.read_live_state(p_document_id text, p_known_hash text)
RETURNS TABLE (outcome text, content_hash text, body text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  scope record;
  v_role text;
  v_current record;
  v_submitted record;
  v_is_submitted boolean;
BEGIN
  PERFORM institution.require_actor();
  SELECT * INTO scope FROM collaboration.document_scope(p_document_id);
  v_role := collaboration.actor_role(scope.institution_id, scope.assignment_id, scope.principal_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF p_known_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  SELECT t.content_hash, t.body INTO v_submitted FROM app.submitted_document_text(p_document_id) t;
  v_is_submitted := FOUND;
  IF v_role = 'teacher' THEN
    PERFORM audit.record_work_opening(scope.institution_id, p_document_id, scope.assignment_id, scope.principal_id,
                                      CASE WHEN v_is_submitted THEN 'submitted_text' ELSE 'live_view' END);
  END IF;
  IF v_is_submitted THEN
    IF v_submitted.body IS NULL THEN
      RETURN QUERY SELECT 'unavailable'::text, NULL::text, NULL::text;
    ELSIF v_submitted.content_hash = p_known_hash THEN
      RETURN QUERY SELECT 'submitted'::text, v_submitted.content_hash, NULL::text;
    ELSE
      RETURN QUERY SELECT 'submitted'::text, v_submitted.content_hash, v_submitted.body;
    END IF;
    RETURN;
  END IF;
  SELECT l.content_hash, l.body INTO v_current FROM collaboration.live_state l
  WHERE l.document_id = p_document_id AND l.institution_id = scope.institution_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'empty'::text, NULL::text, NULL::text;
  ELSIF v_current.content_hash = p_known_hash THEN
    RETURN QUERY SELECT 'unchanged'::text, v_current.content_hash, NULL::text;
  ELSE
    RETURN QUERY SELECT 'state'::text, v_current.content_hash, v_current.body;
  END IF;
END
$$;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA audit FROM ductus_identity;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
-- Rows written with a new role or surface are kept as they are: the old
-- closed lists come back validated when no such row exists, and otherwise
-- NOT VALID, so they bind every new row without rewriting the log.
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA audit TO ductus_identity;
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
SET LOCAL ROLE ductus_identity;
-- The read of 20261026163000, verbatim.
CREATE OR REPLACE FUNCTION collaboration.read_live_state(p_document_id text, p_known_hash text)
RETURNS TABLE (outcome text, content_hash text, body text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  scope record;
  v_role text;
  v_current record;
  v_submitted record;
BEGIN
  PERFORM institution.require_actor();
  SELECT * INTO scope FROM collaboration.document_scope(p_document_id);
  v_role := collaboration.actor_role(scope.institution_id, scope.assignment_id, scope.principal_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF p_known_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF v_role = 'teacher' THEN
    PERFORM audit.record_work_opening(scope.institution_id, p_document_id, scope.assignment_id, scope.principal_id, 'live_view');
  END IF;
  SELECT t.content_hash, t.body INTO v_submitted FROM app.submitted_document_text(p_document_id) t;
  IF FOUND THEN
    IF v_submitted.body IS NULL THEN
      RETURN QUERY SELECT 'unavailable'::text, NULL::text, NULL::text;
    ELSIF v_submitted.content_hash = p_known_hash THEN
      RETURN QUERY SELECT 'submitted'::text, v_submitted.content_hash, NULL::text;
    ELSE
      RETURN QUERY SELECT 'submitted'::text, v_submitted.content_hash, v_submitted.body;
    END IF;
    RETURN;
  END IF;
  SELECT l.content_hash, l.body INTO v_current FROM collaboration.live_state l
  WHERE l.document_id = p_document_id AND l.institution_id = scope.institution_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'empty'::text, NULL::text, NULL::text;
  ELSIF v_current.content_hash = p_known_hash THEN
    RETURN QUERY SELECT 'unchanged'::text, v_current.content_hash, NULL::text;
  ELSE
    RETURN QUERY SELECT 'state'::text, v_current.content_hash, v_current.body;
  END IF;
END
$$;

-- The writer of 20261021130000, verbatim.
CREATE OR REPLACE FUNCTION audit.record_work_opening(
  p_institution_id uuid, p_document_id text, p_assignment_id uuid, p_owner_id uuid, p_surface text
) RETURNS void
LANGUAGE sql VOLATILE SET search_path = ''
AS $$
  INSERT INTO audit.access_log (institution_id, document_id, assignment_id, owner_id, reader_id, reader_role, surface, opened_at)
  SELECT p_institution_id, p_document_id, p_assignment_id, p_owner_id, a.user_id, 'teacher', p_surface,
         date_bin('5 minutes', now(), timestamptz '2000-01-01 00:00:00+00')
  FROM app.current_actor() a
  ON CONFLICT (document_id, institution_id, reader_id, surface, opened_at) DO NOTHING
$$;
DROP FUNCTION audit.reader_role(uuid, uuid, uuid);

ALTER TABLE audit.access_log DROP CONSTRAINT access_log_reader_role_check;
ALTER TABLE audit.access_log ADD CONSTRAINT access_log_reader_role_check CHECK (reader_role = 'teacher') NOT VALID;
ALTER TABLE audit.access_log DROP CONSTRAINT access_log_surface_check;
ALTER TABLE audit.access_log ADD CONSTRAINT access_log_surface_check
  CHECK (surface IN ('live_view', 'process_summary', 'fast_path', 'replay')) NOT VALID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM audit.access_log WHERE reader_role <> 'teacher') THEN
    ALTER TABLE audit.access_log VALIDATE CONSTRAINT access_log_reader_role_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit.access_log WHERE surface = 'submitted_text') THEN
    ALTER TABLE audit.access_log VALIDATE CONSTRAINT access_log_surface_check;
  END IF;
END
$$;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA audit FROM ductus_identity;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;

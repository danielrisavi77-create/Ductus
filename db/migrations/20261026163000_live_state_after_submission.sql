-- DAN-289 A3 (contract on #756, option (a); owner decisions on #87
-- c.6397418697 and c.6397773534): after a submission the live channel shows
-- the submitted revision, not the last live state. Publishing writes nothing
-- and answers ZD403, as any refused publish. Reading answers, to the student
-- and the teacher alike (PRODUCT 5 rule 5), the outcome submitted with the
-- hash and the exact bytes of the submitted revision from
-- evidence.document_checkpoint, held to submission.artifact_hash; without that
-- checkpoint, or when its bytes do not hash to it, the outcome is unavailable.
-- The channel never returns a revision, a time or an id of the submission.
--
-- The exception to BACKEND 4.12 t. 1 is narrow: two functions of the evidence
-- role in schema app, executable only by the owner of the live functions, so
-- that role still has no access to schema evidence (as app.process_summary_record).
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_evidence;
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;

SET LOCAL ROLE ductus_evidence;
-- Yes or no: is a submission of this document recorded. Nothing else.
CREATE FUNCTION app.document_submitted(p_document_id text, p_institution_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM evidence.submission s
      JOIN evidence.submission_request r ON r.id = s.submission_request_id AND r.institution_id = s.institution_id
     WHERE r.document_id = p_document_id AND r.institution_id = p_institution_id
  )
$$;
REVOKE ALL ON FUNCTION app.document_submitted(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.document_submitted(text, uuid) TO ductus_identity;

-- No row: not submitted. One row: the submitted artifact hash and the text of
-- the submitted revision, or NULL text when no checkpoint of that revision
-- holds exactly those bytes.
CREATE FUNCTION app.submitted_document_text(p_document_id text, p_institution_id uuid)
RETURNS TABLE (content_hash text, body text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.artifact_hash, c.body
    FROM evidence.submission s
    JOIN evidence.submission_request r ON r.id = s.submission_request_id AND r.institution_id = s.institution_id
    LEFT JOIN evidence.document_checkpoint c
      ON c.document_id = r.document_id AND c.institution_id = r.institution_id AND c.revision = s.revision
     AND c.content_hash = s.artifact_hash
     AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(c.body, 'UTF8')), 'hex') = s.artifact_hash
   WHERE r.document_id = p_document_id AND r.institution_id = p_institution_id
$$;
REVOKE ALL ON FUNCTION app.submitted_document_text(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.submitted_document_text(text, uuid) TO ductus_identity;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_identity;

-- As 20261019120000, and a submitted document is refused like any other
-- refused publish: ZD403 before the input is checked, nothing written.
CREATE OR REPLACE FUNCTION collaboration.publish_live_state(p_document_id text, p_expected_token uuid, p_body text)
RETURNS TABLE (outcome text, write_token uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  scope record;
  v_hash text;
  v_new uuid := gen_random_uuid();
  v_current record;
BEGIN
  PERFORM institution.require_actor();
  SELECT * INTO scope FROM collaboration.document_scope(p_document_id);
  IF collaboration.actor_role(scope.institution_id, scope.assignment_id, scope.principal_id) IS DISTINCT FROM 'student'
     OR NOT institution.has_acknowledged_current(scope.assignment_id)
     OR app.document_submitted(p_document_id, scope.institution_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- Checked before the table constraints, whose errors would quote the row.
  IF p_body IS NULL OR octet_length(p_body) NOT BETWEEN 1 AND 2097152 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  v_hash := encode(sha256(convert_to(p_body, 'UTF8')), 'hex');

  SELECT l.content_hash, l.write_token INTO v_current FROM collaboration.live_state l
  WHERE l.document_id = p_document_id AND l.institution_id = scope.institution_id
  FOR UPDATE;
  IF NOT FOUND THEN
    IF p_expected_token IS NOT NULL THEN
      RETURN QUERY SELECT 'conflict'::text, NULL::uuid;
      RETURN;
    END IF;
    INSERT INTO collaboration.live_state (document_id, institution_id, assignment_id, owner_id, body, content_hash, write_token)
    VALUES (p_document_id, scope.institution_id, scope.assignment_id, scope.principal_id, p_body, v_hash, v_new)
    ON CONFLICT ON CONSTRAINT live_state_pkey DO NOTHING;
    IF FOUND THEN
      RETURN QUERY SELECT 'accepted'::text, v_new;
      RETURN;
    END IF;
    -- A first write of another request won the race; decide against it.
    SELECT l.content_hash, l.write_token INTO v_current FROM collaboration.live_state l
    WHERE l.document_id = p_document_id AND l.institution_id = scope.institution_id
    FOR UPDATE;
  END IF;

  IF v_current.content_hash = v_hash THEN
    RETURN QUERY SELECT 'unchanged'::text, v_current.write_token;
  ELSIF p_expected_token = v_current.write_token THEN
    UPDATE collaboration.live_state l SET body = p_body, content_hash = v_hash, write_token = v_new
    WHERE l.document_id = p_document_id AND l.institution_id = scope.institution_id;
    RETURN QUERY SELECT 'accepted'::text, v_new;
  ELSE
    RETURN QUERY SELECT 'conflict'::text, v_current.write_token;
  END IF;
END
$$;

-- As 20261021130000, and a submitted document answers its submitted revision:
-- submitted with hash and bytes, the bytes left out when the reader already
-- holds that hash (as unchanged); unavailable when the text cannot be shown.
-- The live state is not read for a submitted document.
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
  SELECT t.content_hash, t.body INTO v_submitted FROM app.submitted_document_text(p_document_id, scope.institution_id) t;
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

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
SET LOCAL ROLE ductus_identity;
-- The publish of 20261019120000, verbatim.
CREATE OR REPLACE FUNCTION collaboration.publish_live_state(p_document_id text, p_expected_token uuid, p_body text)
RETURNS TABLE (outcome text, write_token uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  scope record;
  v_hash text;
  v_new uuid := gen_random_uuid();
  v_current record;
BEGIN
  PERFORM institution.require_actor();
  SELECT * INTO scope FROM collaboration.document_scope(p_document_id);
  IF collaboration.actor_role(scope.institution_id, scope.assignment_id, scope.principal_id) IS DISTINCT FROM 'student'
     OR NOT institution.has_acknowledged_current(scope.assignment_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- Checked before the table constraints, whose errors would quote the row.
  IF p_body IS NULL OR octet_length(p_body) NOT BETWEEN 1 AND 2097152 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  v_hash := encode(sha256(convert_to(p_body, 'UTF8')), 'hex');

  SELECT l.content_hash, l.write_token INTO v_current FROM collaboration.live_state l
  WHERE l.document_id = p_document_id AND l.institution_id = scope.institution_id
  FOR UPDATE;
  IF NOT FOUND THEN
    IF p_expected_token IS NOT NULL THEN
      RETURN QUERY SELECT 'conflict'::text, NULL::uuid;
      RETURN;
    END IF;
    INSERT INTO collaboration.live_state (document_id, institution_id, assignment_id, owner_id, body, content_hash, write_token)
    VALUES (p_document_id, scope.institution_id, scope.assignment_id, scope.principal_id, p_body, v_hash, v_new)
    ON CONFLICT ON CONSTRAINT live_state_pkey DO NOTHING;
    IF FOUND THEN
      RETURN QUERY SELECT 'accepted'::text, v_new;
      RETURN;
    END IF;
    -- A first write of another request won the race; decide against it.
    SELECT l.content_hash, l.write_token INTO v_current FROM collaboration.live_state l
    WHERE l.document_id = p_document_id AND l.institution_id = scope.institution_id
    FOR UPDATE;
  END IF;

  IF v_current.content_hash = v_hash THEN
    RETURN QUERY SELECT 'unchanged'::text, v_current.write_token;
  ELSIF p_expected_token = v_current.write_token THEN
    UPDATE collaboration.live_state l SET body = p_body, content_hash = v_hash, write_token = v_new
    WHERE l.document_id = p_document_id AND l.institution_id = scope.institution_id;
    RETURN QUERY SELECT 'accepted'::text, v_new;
  ELSE
    RETURN QUERY SELECT 'conflict'::text, v_current.write_token;
  END IF;
END
$$;
-- The read of 20261021130000, verbatim.
CREATE OR REPLACE FUNCTION collaboration.read_live_state(p_document_id text, p_known_hash text)
RETURNS TABLE (outcome text, content_hash text, body text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  scope record;
  v_role text;
  v_current record;
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
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.submitted_document_text(text, uuid);
DROP FUNCTION app.document_submitted(text, uuid);
RESET ROLE;

-- DAN-314 step 2e (docs/backend/suradnja.md 4.14, attack plan #1506, #1091
-- c.6696580072): a revision request names only revisions the document has.
-- The requested, the answered and the accepted revision are each at most the
-- document's current revision; one above it is invalid input (ZD422) and
-- nothing is written. Equal to it is allowed.
-- The check is inside create, respond, accept and reopen, right before the
-- write and after the revision order check, so every earlier error keeps its
-- place (D6: no trigger on the request tables). Each call holds the document
-- FOR SHARE since its lock step, and a commit raises current_revision with an
-- UPDATE of that row, so the revision read here cannot move before the call
-- commits. withdraw names no revision. The bodies are those of 20261106160000
-- and 20261106190000 with the one check added; down restores them verbatim.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
GRANT USAGE, CREATE ON SCHEMA collaboration TO ductus_evidence;

-- True when the revision is above the current revision of the document in the
-- institution, or there is no such document (fails closed). Owned by the
-- evidence role and executable only by the identity role, like
-- lock_document_for_write.
SET LOCAL ROLE ductus_evidence;
CREATE FUNCTION collaboration.revision_above_document(p_document_id text, p_institution_id uuid, p_revision bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(p_revision > (SELECT d.current_revision FROM evidence.document d
                                 WHERE d.id = p_document_id AND d.institution_id = p_institution_id), true)
$$;
REVOKE ALL ON FUNCTION collaboration.revision_above_document(text, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collaboration.revision_above_document(text, uuid, bigint) TO ductus_identity;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_identity;

CREATE OR REPLACE FUNCTION collaboration.create_revision_request(
  p_document_id text, p_anchor jsonb, p_instruction text, p_requested_revision bigint
)
RETURNS TABLE (request_id uuid, row_seq bigint, version integer, state text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  actor record;
  scope record;
  v_id uuid;
  v_seq bigint;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT * INTO scope FROM collaboration.document_scope(p_document_id);
  IF collaboration.actor_role(scope.institution_id, scope.assignment_id, scope.principal_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  PERFORM collaboration.lock_document_for_write(p_document_id);
  IF app.document_submitted(p_document_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- Checked before the table constraints, whose errors would quote the row.
  IF NOT coalesce(collaboration.is_text_anchor(p_anchor), false)
     OR NOT coalesce(collaboration.is_revision_text(p_instruction), false)
     OR p_requested_revision IS NULL
     OR p_requested_revision NOT BETWEEN 0 AND 9007199254740991 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF collaboration.revision_above_document(p_document_id, scope.institution_id, p_requested_revision) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  v_seq := nextval('collaboration.revision_request_seq');
  INSERT INTO collaboration.revision_request
    (institution_id, assignment_id, owner_id, document_id, anchor, state, version, row_seq, created_by)
  VALUES
    (scope.institution_id, scope.assignment_id, scope.principal_id, p_document_id, p_anchor, 'open', 1, v_seq, actor.user_id)
  RETURNING id INTO v_id;
  INSERT INTO collaboration.revision_request_version
    (request_id, institution_id, version, instruction, requested_revision, opened_by)
  VALUES (v_id, scope.institution_id, 1, p_instruction, p_requested_revision, actor.user_id);
  RETURN QUERY SELECT v_id, v_seq, 1, 'open'::text;
END
$$;

CREATE OR REPLACE FUNCTION collaboration.respond_revision_request(
  p_request_id uuid, p_expected_seq bigint, p_kind text, p_explanation text, p_response_revision bigint
)
RETURNS TABLE (outcome text, row_seq bigint, version integer, state text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  r record;
  v_seq bigint;
BEGIN
  SELECT * INTO r FROM collaboration.revision_request_for_write(p_request_id, 'student');
  -- Checked before the table constraints, whose errors would quote the row.
  IF NOT collaboration.is_revision_seq(p_expected_seq)
     OR p_kind IS NULL OR p_kind NOT IN ('done', 'declined')
     OR NOT coalesce(collaboration.is_revision_text(p_explanation), false)
     OR NOT collaboration.is_revision_number(p_response_revision) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF p_expected_seq <> r.row_seq THEN
    RETURN QUERY SELECT 'conflict'::text, r.row_seq, r.version, r.state;
    RETURN;
  END IF;
  IF r.state NOT IN ('open', 'reopened') THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = 'ZD409';
  END IF;
  IF p_response_revision < (SELECT v.requested_revision FROM collaboration.revision_request_version v
                             WHERE v.request_id = r.request_id AND v.version = r.version) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF collaboration.revision_above_document(
       (SELECT q.document_id FROM collaboration.revision_request q WHERE q.id = r.request_id),
       r.institution_id, p_response_revision) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  v_seq := nextval('collaboration.revision_request_seq');
  INSERT INTO collaboration.revision_response
    (request_id, institution_id, version, kind, explanation, response_revision, author_id)
  VALUES (r.request_id, r.institution_id, r.version, p_kind, p_explanation, p_response_revision, r.actor_id);
  UPDATE collaboration.revision_request q SET state = 'responded', row_seq = v_seq WHERE q.id = r.request_id;
  RETURN QUERY SELECT 'applied'::text, v_seq, r.version, 'responded'::text;
END
$$;

CREATE OR REPLACE FUNCTION collaboration.accept_revision_request(
  p_request_id uuid, p_expected_seq bigint, p_accepted_revision bigint, p_range_hash text
)
RETURNS TABLE (outcome text, row_seq bigint, version integer, state text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  r record;
  v_seq bigint;
BEGIN
  SELECT * INTO r FROM collaboration.revision_request_for_write(p_request_id, 'teacher');
  IF NOT collaboration.is_revision_seq(p_expected_seq)
     OR NOT collaboration.is_revision_number(p_accepted_revision)
     OR (p_range_hash IS NOT NULL AND p_range_hash !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF p_expected_seq <> r.row_seq THEN
    RETURN QUERY SELECT 'conflict'::text, r.row_seq, r.version, r.state;
    RETURN;
  END IF;
  IF r.state <> 'responded' THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = 'ZD409';
  END IF;
  IF p_accepted_revision < (SELECT s.response_revision FROM collaboration.revision_response s
                             WHERE s.request_id = r.request_id AND s.version = r.version) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF collaboration.revision_above_document(
       (SELECT q.document_id FROM collaboration.revision_request q WHERE q.id = r.request_id),
       r.institution_id, p_accepted_revision) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  v_seq := nextval('collaboration.revision_request_seq');
  UPDATE collaboration.revision_request_version v
     SET closed_as = 'accepted', closed_by = r.actor_id, closed_at = now(),
         accepted_revision = p_accepted_revision, accepted_range_hash = p_range_hash
   WHERE v.request_id = r.request_id AND v.version = r.version;
  UPDATE collaboration.revision_request q SET state = 'accepted', row_seq = v_seq WHERE q.id = r.request_id;
  RETURN QUERY SELECT 'applied'::text, v_seq, r.version, 'accepted'::text;
END
$$;

CREATE OR REPLACE FUNCTION collaboration.reopen_revision_request(
  p_request_id uuid, p_expected_seq bigint, p_instruction text, p_requested_revision bigint
)
RETURNS TABLE (outcome text, row_seq bigint, version integer, state text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  r record;
  v_seq bigint;
BEGIN
  SELECT * INTO r FROM collaboration.revision_request_for_write(p_request_id, 'teacher');
  IF NOT collaboration.is_revision_seq(p_expected_seq)
     OR NOT coalesce(collaboration.is_revision_text(p_instruction), false)
     OR NOT collaboration.is_revision_number(p_requested_revision) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF p_expected_seq <> r.row_seq THEN
    RETURN QUERY SELECT 'conflict'::text, r.row_seq, r.version, r.state;
    RETURN;
  END IF;
  IF r.state NOT IN ('open', 'reopened', 'responded', 'accepted') OR r.version >= 1000 THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = 'ZD409';
  END IF;
  IF p_requested_revision < (
    SELECT greatest(max(v.requested_revision), max(v.accepted_revision),
             (SELECT max(s.response_revision) FROM collaboration.revision_response s WHERE s.request_id = r.request_id))
      FROM collaboration.revision_request_version v WHERE v.request_id = r.request_id) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF collaboration.revision_above_document(
       (SELECT q.document_id FROM collaboration.revision_request q WHERE q.id = r.request_id),
       r.institution_id, p_requested_revision) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  v_seq := nextval('collaboration.revision_request_seq');
  UPDATE collaboration.revision_request_version v
     SET closed_as = 'reopened', closed_by = r.actor_id, closed_at = now()
   WHERE v.request_id = r.request_id AND v.version = r.version AND v.closed_as IS NULL;
  INSERT INTO collaboration.revision_request_version
    (request_id, institution_id, version, instruction, requested_revision, opened_by)
  VALUES (r.request_id, r.institution_id, r.version + 1, p_instruction, p_requested_revision, r.actor_id);
  UPDATE collaboration.revision_request q SET state = 'reopened', version = r.version + 1, row_seq = v_seq
   WHERE q.id = r.request_id;
  RETURN QUERY SELECT 'applied'::text, v_seq, r.version + 1, 'reopened'::text;
END
$$;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;
REVOKE USAGE, CREATE ON SCHEMA collaboration FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
GRANT USAGE ON SCHEMA collaboration TO ductus_evidence;
SET LOCAL ROLE ductus_identity;

CREATE OR REPLACE FUNCTION collaboration.create_revision_request(
  p_document_id text, p_anchor jsonb, p_instruction text, p_requested_revision bigint
)
RETURNS TABLE (request_id uuid, row_seq bigint, version integer, state text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  actor record;
  scope record;
  v_id uuid;
  v_seq bigint;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT * INTO scope FROM collaboration.document_scope(p_document_id);
  IF collaboration.actor_role(scope.institution_id, scope.assignment_id, scope.principal_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  PERFORM collaboration.lock_document_for_write(p_document_id);
  IF app.document_submitted(p_document_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- Checked before the table constraints, whose errors would quote the row.
  IF NOT coalesce(collaboration.is_text_anchor(p_anchor), false)
     OR NOT coalesce(collaboration.is_revision_text(p_instruction), false)
     OR p_requested_revision IS NULL
     OR p_requested_revision NOT BETWEEN 0 AND 9007199254740991 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  v_seq := nextval('collaboration.revision_request_seq');
  INSERT INTO collaboration.revision_request
    (institution_id, assignment_id, owner_id, document_id, anchor, state, version, row_seq, created_by)
  VALUES
    (scope.institution_id, scope.assignment_id, scope.principal_id, p_document_id, p_anchor, 'open', 1, v_seq, actor.user_id)
  RETURNING id INTO v_id;
  INSERT INTO collaboration.revision_request_version
    (request_id, institution_id, version, instruction, requested_revision, opened_by)
  VALUES (v_id, scope.institution_id, 1, p_instruction, p_requested_revision, actor.user_id);
  RETURN QUERY SELECT v_id, v_seq, 1, 'open'::text;
END
$$;

CREATE OR REPLACE FUNCTION collaboration.respond_revision_request(
  p_request_id uuid, p_expected_seq bigint, p_kind text, p_explanation text, p_response_revision bigint
)
RETURNS TABLE (outcome text, row_seq bigint, version integer, state text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  r record;
  v_seq bigint;
BEGIN
  SELECT * INTO r FROM collaboration.revision_request_for_write(p_request_id, 'student');
  -- Checked before the table constraints, whose errors would quote the row.
  IF NOT collaboration.is_revision_seq(p_expected_seq)
     OR p_kind IS NULL OR p_kind NOT IN ('done', 'declined')
     OR NOT coalesce(collaboration.is_revision_text(p_explanation), false)
     OR NOT collaboration.is_revision_number(p_response_revision) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF p_expected_seq <> r.row_seq THEN
    RETURN QUERY SELECT 'conflict'::text, r.row_seq, r.version, r.state;
    RETURN;
  END IF;
  IF r.state NOT IN ('open', 'reopened') THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = 'ZD409';
  END IF;
  IF p_response_revision < (SELECT v.requested_revision FROM collaboration.revision_request_version v
                             WHERE v.request_id = r.request_id AND v.version = r.version) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  v_seq := nextval('collaboration.revision_request_seq');
  INSERT INTO collaboration.revision_response
    (request_id, institution_id, version, kind, explanation, response_revision, author_id)
  VALUES (r.request_id, r.institution_id, r.version, p_kind, p_explanation, p_response_revision, r.actor_id);
  UPDATE collaboration.revision_request q SET state = 'responded', row_seq = v_seq WHERE q.id = r.request_id;
  RETURN QUERY SELECT 'applied'::text, v_seq, r.version, 'responded'::text;
END
$$;

CREATE OR REPLACE FUNCTION collaboration.accept_revision_request(
  p_request_id uuid, p_expected_seq bigint, p_accepted_revision bigint, p_range_hash text
)
RETURNS TABLE (outcome text, row_seq bigint, version integer, state text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  r record;
  v_seq bigint;
BEGIN
  SELECT * INTO r FROM collaboration.revision_request_for_write(p_request_id, 'teacher');
  IF NOT collaboration.is_revision_seq(p_expected_seq)
     OR NOT collaboration.is_revision_number(p_accepted_revision)
     OR (p_range_hash IS NOT NULL AND p_range_hash !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF p_expected_seq <> r.row_seq THEN
    RETURN QUERY SELECT 'conflict'::text, r.row_seq, r.version, r.state;
    RETURN;
  END IF;
  IF r.state <> 'responded' THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = 'ZD409';
  END IF;
  IF p_accepted_revision < (SELECT s.response_revision FROM collaboration.revision_response s
                             WHERE s.request_id = r.request_id AND s.version = r.version) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  v_seq := nextval('collaboration.revision_request_seq');
  UPDATE collaboration.revision_request_version v
     SET closed_as = 'accepted', closed_by = r.actor_id, closed_at = now(),
         accepted_revision = p_accepted_revision, accepted_range_hash = p_range_hash
   WHERE v.request_id = r.request_id AND v.version = r.version;
  UPDATE collaboration.revision_request q SET state = 'accepted', row_seq = v_seq WHERE q.id = r.request_id;
  RETURN QUERY SELECT 'applied'::text, v_seq, r.version, 'accepted'::text;
END
$$;

CREATE OR REPLACE FUNCTION collaboration.reopen_revision_request(
  p_request_id uuid, p_expected_seq bigint, p_instruction text, p_requested_revision bigint
)
RETURNS TABLE (outcome text, row_seq bigint, version integer, state text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  r record;
  v_seq bigint;
BEGIN
  SELECT * INTO r FROM collaboration.revision_request_for_write(p_request_id, 'teacher');
  IF NOT collaboration.is_revision_seq(p_expected_seq)
     OR NOT coalesce(collaboration.is_revision_text(p_instruction), false)
     OR NOT collaboration.is_revision_number(p_requested_revision) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF p_expected_seq <> r.row_seq THEN
    RETURN QUERY SELECT 'conflict'::text, r.row_seq, r.version, r.state;
    RETURN;
  END IF;
  IF r.state NOT IN ('open', 'reopened', 'responded', 'accepted') OR r.version >= 1000 THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = 'ZD409';
  END IF;
  IF p_requested_revision < (
    SELECT greatest(max(v.requested_revision), max(v.accepted_revision),
             (SELECT max(s.response_revision) FROM collaboration.revision_response s WHERE s.request_id = r.request_id))
      FROM collaboration.revision_request_version v WHERE v.request_id = r.request_id) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  v_seq := nextval('collaboration.revision_request_seq');
  UPDATE collaboration.revision_request_version v
     SET closed_as = 'reopened', closed_by = r.actor_id, closed_at = now()
   WHERE v.request_id = r.request_id AND v.version = r.version AND v.closed_as IS NULL;
  INSERT INTO collaboration.revision_request_version
    (request_id, institution_id, version, instruction, requested_revision, opened_by)
  VALUES (r.request_id, r.institution_id, r.version + 1, p_instruction, p_requested_revision, r.actor_id);
  UPDATE collaboration.revision_request q SET state = 'reopened', version = r.version + 1, row_seq = v_seq
   WHERE q.id = r.request_id;
  RETURN QUERY SELECT 'applied'::text, v_seq, r.version + 1, 'reopened'::text;
END
$$;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION collaboration.revision_above_document(text, uuid, bigint);
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;
REVOKE USAGE ON SCHEMA collaboration FROM ductus_evidence;

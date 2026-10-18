-- B-LIVE / DAN-216: the live view (docs/BACKEND.md 4.12, step 2). The
-- student publishes the latest state of a document; the student and the
-- teacher of the assignment read it through one function. It is not evidence:
-- no chain, no signature, no time, no counter and no history, only the latest
-- state. No function here reads or writes a revision, segment, package or
-- receipt; the scope of a document comes only through document_scope.
-- Errors: ZD401 no session, ZD403 not allowed or not there (same answer),
-- ZD422 invalid input.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
-- The retention role reaches delete_live_state and nothing else here.
GRANT USAGE ON SCHEMA collaboration TO ductus_retention;

SET LOCAL ROLE ductus_identity;

-- One row per document: a new accepted write replaces the old one. No column
-- holds a time or a count; write_token is a fresh random value on every
-- accepted write, so it tells neither how many writes there were nor their
-- order. No foreign key to evidence.document (as 4.11): deleting a document
-- under its retention rule calls delete_live_state in the same transaction.
CREATE TABLE collaboration.live_state (
  document_id text NOT NULL CHECK (length(document_id) BETWEEN 1 AND 256),
  institution_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  body text NOT NULL CHECK (octet_length(body) BETWEEN 1 AND 2097152),
  content_hash text NOT NULL,
  write_token uuid NOT NULL,
  PRIMARY KEY (document_id, institution_id),
  CHECK (content_hash = encode(sha256(convert_to(body, 'UTF8')), 'hex')),
  FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment (id, institution_id),
  FOREIGN KEY (owner_id, institution_id) REFERENCES identity.user_account (id, institution_id)
);

ALTER TABLE collaboration.live_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration.live_state FORCE ROW LEVEL SECURITY;
CREATE POLICY live_state_owner ON collaboration.live_state TO ductus_identity USING (true) WITH CHECK (true);

-- The student who owns the document, in an open membership, with the current
-- version of the assignment notice acknowledged. The row is locked, so
-- comparing the token and writing are one step. An equal body is unchanged
-- whatever the token; otherwise the expected token decides. A token for a row
-- that does not exist is a conflict with no current token (narrowest reading
-- of 4.12, point 3: nothing is written).
CREATE FUNCTION collaboration.publish_live_state(p_document_id text, p_expected_token uuid, p_body text)
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

-- One reading for the student and the teacher alike (PRODUCT 5, rule 5): the
-- outcome and the bytes do not depend on who asks. Never the token, a person,
-- the institution or a time.
CREATE FUNCTION collaboration.read_live_state(p_document_id text, p_known_hash text)
RETURNS TABLE (outcome text, content_hash text, body text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  scope record;
  v_current record;
BEGIN
  PERFORM institution.require_actor();
  SELECT * INTO scope FROM collaboration.document_scope(p_document_id);
  IF collaboration.actor_role(scope.institution_id, scope.assignment_id, scope.principal_id) IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF p_known_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
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

-- For the retention role only: called in the same transaction as deleting a
-- document under its retention rule or on a student's withdrawal (D-12).
-- Neither takes nor returns a body.
CREATE FUNCTION collaboration.delete_live_state(p_document_id text, p_institution_id uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  DELETE FROM collaboration.live_state l WHERE l.document_id = p_document_id AND l.institution_id = p_institution_id
$$;

GRANT EXECUTE ON FUNCTION
  collaboration.publish_live_state(text, uuid, text),
  collaboration.read_live_state(text, text)
TO ductus_app;
GRANT EXECUTE ON FUNCTION collaboration.delete_live_state(text, uuid) TO ductus_retention;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_identity;
DROP FUNCTION collaboration.delete_live_state(text, uuid);
DROP FUNCTION collaboration.read_live_state(text, text);
DROP FUNCTION collaboration.publish_live_state(text, uuid, text);
DROP TABLE collaboration.live_state;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE USAGE ON SCHEMA collaboration FROM ductus_retention;

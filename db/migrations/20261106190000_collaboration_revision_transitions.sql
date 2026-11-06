-- DAN-314 step 2b (docs/backend/suradnja.md 4.14, attack plan #1506,
-- contract on #1091): the four transitions of a revision request, each with
-- the expected write counter. Nothing here writes the document, a revision, a
-- segment, a receipt or a hash.
-- Order in every transition: session (ZD401); the request row and the role
-- from its stored scope (ZD403); the document lock and the submitted check
-- (ZD403); input shape (ZD422); the counter (outcome 'conflict', no write);
-- the transition table and the version ceiling (ZD409); revision order
-- (ZD422); the write with a new row_seq (outcome 'applied').
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- Steps 1 to 3 of every transition. The role is checked on a plain read and
-- only then is the row locked, so a caller who may not touch the request
-- never holds its lock. Scope, assignment and owner never change, so the
-- check stays true; state, version and row_seq are read again under the lock.
-- A request of another institution, a missing one and the wrong role give
-- the same ZD403. Then the document lock and, as its own statement, the
-- submitted check, which under READ COMMITTED sees a submission committed
-- while the lock waited.
CREATE FUNCTION collaboration.revision_request_for_write(
  p_request_id uuid, p_role text,
  OUT request_id uuid, OUT institution_id uuid, OUT state text, OUT version integer, OUT row_seq bigint, OUT actor_id uuid
)
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  actor record;
  r record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT q.id, q.institution_id, q.assignment_id, q.owner_id, q.document_id INTO r
    FROM collaboration.revision_request q WHERE q.id = p_request_id AND q.institution_id = actor.institution_id;
  IF r.id IS NULL OR collaboration.actor_role(r.institution_id, r.assignment_id, r.owner_id) IS DISTINCT FROM p_role THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  SELECT q.state, q.version, q.row_seq INTO state, version, row_seq
    FROM collaboration.revision_request q WHERE q.id = r.id FOR UPDATE;
  PERFORM collaboration.lock_document_for_write(r.document_id);
  IF app.document_submitted(r.document_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  request_id := r.id;
  institution_id := r.institution_id;
  actor_id := actor.user_id;
END
$$;

-- An expected counter has the shape of a row_seq.
CREATE FUNCTION collaboration.is_revision_seq(p_seq bigint) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT p_seq IS NOT NULL AND p_seq BETWEEN 1 AND 9007199254740991 $$;

-- A revision number as in create_revision_request.
CREATE FUNCTION collaboration.is_revision_number(p_revision bigint) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT p_revision IS NOT NULL AND p_revision BETWEEN 0 AND 9007199254740991 $$;

-- The student answers the open version: done or declined, with an
-- explanation and the revision the answer refers to. open, reopened ->
-- responded. A second answer to the same version is a conflict, because the
-- first one moved the counter; the unique key holds it even so.
CREATE FUNCTION collaboration.respond_revision_request(
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

-- A teacher accepts the answer to the open version, a declined one too.
-- responded -> accepted. The accepted revision is not below the revision of
-- the answer; the range hash is optional.
CREATE FUNCTION collaboration.accept_revision_request(
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

-- A teacher opens a new version with a new instruction. open, reopened,
-- responded, accepted -> reopened. The old version is closed as reopened,
-- unless it is already closed (an accepted one stays accepted). Version 1000
-- is the last. The new requested revision is not below any revision the
-- request has already recorded.
CREATE FUNCTION collaboration.reopen_revision_request(
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

-- A teacher withdraws a request that is not accepted. open, reopened,
-- responded -> withdrawn, which is final.
CREATE FUNCTION collaboration.withdraw_revision_request(p_request_id uuid, p_expected_seq bigint)
RETURNS TABLE (outcome text, row_seq bigint, version integer, state text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  r record;
  v_seq bigint;
BEGIN
  SELECT * INTO r FROM collaboration.revision_request_for_write(p_request_id, 'teacher');
  IF NOT collaboration.is_revision_seq(p_expected_seq) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF p_expected_seq <> r.row_seq THEN
    RETURN QUERY SELECT 'conflict'::text, r.row_seq, r.version, r.state;
    RETURN;
  END IF;
  IF r.state NOT IN ('open', 'reopened', 'responded') THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = 'ZD409';
  END IF;
  v_seq := nextval('collaboration.revision_request_seq');
  UPDATE collaboration.revision_request_version v
     SET closed_as = 'withdrawn', closed_by = r.actor_id, closed_at = now()
   WHERE v.request_id = r.request_id AND v.version = r.version;
  UPDATE collaboration.revision_request q SET state = 'withdrawn', row_seq = v_seq WHERE q.id = r.request_id;
  RETURN QUERY SELECT 'applied'::text, v_seq, r.version, 'withdrawn'::text;
END
$$;

GRANT EXECUTE ON FUNCTION
  collaboration.respond_revision_request(uuid, bigint, text, text, bigint),
  collaboration.accept_revision_request(uuid, bigint, bigint, text),
  collaboration.reopen_revision_request(uuid, bigint, text, bigint),
  collaboration.withdraw_revision_request(uuid, bigint)
TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_identity;
DROP FUNCTION collaboration.withdraw_revision_request(uuid, bigint);
DROP FUNCTION collaboration.reopen_revision_request(uuid, bigint, text, bigint);
DROP FUNCTION collaboration.accept_revision_request(uuid, bigint, bigint, text);
DROP FUNCTION collaboration.respond_revision_request(uuid, bigint, text, text, bigint);
DROP FUNCTION collaboration.is_revision_number(bigint);
DROP FUNCTION collaboration.is_revision_seq(bigint);
DROP FUNCTION collaboration.revision_request_for_write(uuid, text);
RESET ROLE;
SET LOCAL ROLE ductus_migrator;

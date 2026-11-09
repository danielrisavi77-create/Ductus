-- DAN-314, changed after acceptance (docs/backend/suradnja.md 4.14, contract
-- #1091 c.6752687836; O7 #87 c.6581656612; #87 c.6691142048): an accepted
-- request whose anchored range changed in a later revision of the document
-- goes back to review as a new version. One RPC, no trigger and no worker:
-- the server never resolves an anchor and never receives the text. The caller
-- (the student owner or a teacher of the course) sends the hash of the range
-- as it resolves now and the revision it was read at; the server compares the
-- hash with the one the acceptance stored. A different hash, or none because
-- the range no longer resolves, opens version v + 1 with the teacher's
-- instruction of version v. The accepted version stays accepted. Nothing is
-- graded, decided or concluded about the author: the new version only says
-- that it was opened by a rereview and which hash was observed.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- How the version was opened: by a teacher's instruction (create, reopen) or
-- by a rereview; and for a rereview the hash the caller observed, NULL when
-- the range no longer resolved.
ALTER TABLE collaboration.revision_request_version
  ADD COLUMN opened_as text NOT NULL DEFAULT 'instruction'
    CONSTRAINT revision_request_version_opened_as_check CHECK (opened_as IN ('instruction', 'rereview')),
  ADD COLUMN observed_range_hash text
    CONSTRAINT revision_request_version_observed_hash_check CHECK (observed_range_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT revision_request_version_observed_rereview_check
    CHECK (observed_range_hash IS NULL OR opened_as = 'rereview');

-- accepted -> reopened at version + 1. The checks keep the order of the other
-- transitions: session, request and role, lock and submission, input shape,
-- counter, state and version ceiling, the change rule, revision order and
-- ceiling. An acceptance without a hash cannot be compared, so it is never
-- rereviewed here; the teacher's reopen remains.
CREATE FUNCTION collaboration.rereview_revision_request(
  p_request_id uuid, p_expected_seq bigint, p_current_revision bigint, p_range_hash text
)
RETURNS TABLE (outcome text, row_seq bigint, version integer, state text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  actor record;
  v_role text;
  r record;
  a record;
  v_seq bigint;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT collaboration.actor_role(q.institution_id, q.assignment_id, q.owner_id) INTO v_role
    FROM collaboration.revision_request q
   WHERE q.id = p_request_id AND q.institution_id = actor.institution_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  SELECT * INTO r FROM collaboration.revision_request_for_write(p_request_id, v_role);
  IF NOT collaboration.is_revision_seq(p_expected_seq)
     OR NOT collaboration.is_revision_number(p_current_revision)
     OR (p_range_hash IS NOT NULL AND p_range_hash !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF p_expected_seq <> r.row_seq THEN
    RETURN QUERY SELECT 'conflict'::text, r.row_seq, r.version, r.state;
    RETURN;
  END IF;
  IF r.state <> 'accepted' OR r.version >= 1000 THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = 'ZD409';
  END IF;
  SELECT v.instruction, v.accepted_revision, v.accepted_range_hash INTO a
    FROM collaboration.revision_request_version v
   WHERE v.request_id = r.request_id AND v.version = r.version;
  IF a.accepted_range_hash IS NULL OR p_range_hash IS NOT DISTINCT FROM a.accepted_range_hash THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = 'ZD409';
  END IF;
  IF p_current_revision <= a.accepted_revision THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF collaboration.revision_above_document(
       (SELECT q.document_id FROM collaboration.revision_request q WHERE q.id = r.request_id),
       r.institution_id, p_current_revision) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  v_seq := nextval('collaboration.revision_request_seq');
  INSERT INTO collaboration.revision_request_version
    (request_id, institution_id, version, instruction, requested_revision, opened_by, opened_as, observed_range_hash)
  VALUES (r.request_id, r.institution_id, r.version + 1, a.instruction, p_current_revision, r.actor_id, 'rereview', p_range_hash);
  UPDATE collaboration.revision_request q SET state = 'reopened', version = r.version + 1, row_seq = v_seq
   WHERE q.id = r.request_id;
  RETURN QUERY SELECT 'applied'::text, v_seq, r.version + 1, 'reopened'::text;
END
$$;

REVOKE ALL ON FUNCTION collaboration.rereview_revision_request(uuid, bigint, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collaboration.rereview_revision_request(uuid, bigint, bigint, text) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;

-- migrate:down

SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
SET LOCAL ROLE ductus_identity;
DROP FUNCTION collaboration.rereview_revision_request(uuid, bigint, bigint, text);
ALTER TABLE collaboration.revision_request_version
  DROP COLUMN observed_range_hash,
  DROP COLUMN opened_as;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;

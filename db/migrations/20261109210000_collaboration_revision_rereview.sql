-- DAN-314, changed after acceptance (docs/backend/suradnja.md 4.14, contract
-- #1091 c.6752687836 as narrowed by #1091 c.6754441692; O7 #87 c.6581656612;
-- #87 c.6691142048): an accepted request whose anchored range changed in a
-- later revision of the document goes back to review as a new version. One
-- RPC, no trigger and no worker. The database decides whether the range
-- changed: it resolves the request's stored anchor in the checkpoint of the
-- document's current revision and compares the hash of the resolved range
-- with the one the acceptance stored. The caller (the student owner or a
-- teacher of the course) sends only the request and its counter, never a
-- hash, a revision or text. A different hash, or none because the range no
-- longer resolves, opens version v + 1 with the teacher's instruction of
-- version v. The accepted version stays accepted. Nothing is graded, decided
-- or concluded about the author: the new version only says that it was opened
-- by a rereview and which hash the database computed.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
GRANT USAGE, CREATE ON SCHEMA collaboration TO ductus_evidence;

-- The current revision of a document and the hash of the range an anchor
-- resolves to in that revision's checkpoint; the hash is NULL when the range
-- does not resolve. Owned by the evidence role, which alone reads the text,
-- and the text never leaves this function. Resolution follows
-- resolveTextAnchor (src/domain/collaboration/anchor.ts): the first block
-- with the anchor's id, its inline texts joined, every occurrence of the
-- quote (overlapping ones too), one point for the prefix right before it and
-- one for the suffix right after it; the range resolves when exactly one
-- occurrence has the highest score, and more than 1000 occurrences never
-- resolve. It compares UTF-8 bytes, which finds the same occurrences as code
-- units do in well-formed text. A resolved range is the quote itself, so its
-- hash is the hash of the quote's bytes (snapshotHash). A missing checkpoint
-- or one that is not a document fails closed: unreadable is never "changed".
SET LOCAL ROLE ductus_evidence;
CREATE FUNCTION collaboration.current_range_hash(p_document_id text, p_institution_id uuid, p_anchor jsonb)
RETURNS TABLE (revision bigint, range_hash text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_revision bigint;
  v_body text;
  v_node jsonb;
  v_text bytea;
  v_quote bytea := pg_catalog.convert_to(coalesce(p_anchor ->> 'quote', ''), 'UTF8');
  v_prefix bytea := pg_catalog.convert_to(coalesce(p_anchor ->> 'prefix', ''), 'UTF8');
  v_suffix bytea := pg_catalog.convert_to(coalesce(p_anchor ->> 'suffix', ''), 'UTF8');
  v_from integer := 1;
  v_at integer;
  v_matches integer := 0;
  v_score integer;
  v_best integer := -1;
  v_winners integer := 0;
BEGIN
  SELECT d.current_revision, c.body INTO v_revision, v_body
    FROM evidence.document d
    LEFT JOIN evidence.document_checkpoint c
      ON c.document_id = d.id AND c.institution_id = d.institution_id
     AND c.revision = d.current_revision AND c.content_hash = d.current_content_hash
   WHERE d.id = p_document_id AND d.institution_id = p_institution_id;
  IF v_body IS NULL OR NOT pg_catalog.pg_input_is_valid(v_body, 'jsonb')
     OR pg_catalog.jsonb_typeof(v_body::jsonb -> 'nodes') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'work unavailable' USING ERRCODE = 'ZD503';
  END IF;
  SELECT n.value INTO v_node
    FROM pg_catalog.jsonb_array_elements(v_body::jsonb -> 'nodes') WITH ORDINALITY AS n(value, ord)
   WHERE n.value ->> 'id' = p_anchor ->> 'nodeId'
   ORDER BY n.ord LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT v_revision, NULL::text;
    RETURN;
  END IF;
  IF pg_catalog.jsonb_typeof(v_node -> 'children') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'work unavailable' USING ERRCODE = 'ZD503';
  END IF;
  SELECT pg_catalog.convert_to(coalesce(pg_catalog.string_agg(coalesce(c.value ->> 'text', ''), '' ORDER BY c.ord), ''), 'UTF8')
    INTO v_text
    FROM pg_catalog.jsonb_array_elements(v_node -> 'children') WITH ORDINALITY AS c(value, ord);
  WHILE pg_catalog.length(v_quote) > 0 LOOP
    v_at := position(v_quote IN pg_catalog.substr(v_text, v_from));
    EXIT WHEN v_at = 0;
    v_at := v_from + v_at - 1;
    v_matches := v_matches + 1;
    IF v_matches > 1000 THEN
      v_winners := 0;
      EXIT;
    END IF;
    v_score :=
      (pg_catalog.length(v_prefix) > 0 AND v_at > pg_catalog.length(v_prefix)
        AND pg_catalog.substr(v_text, v_at - pg_catalog.length(v_prefix), pg_catalog.length(v_prefix)) = v_prefix)::integer
      + (pg_catalog.length(v_suffix) > 0
        AND pg_catalog.substr(v_text, v_at + pg_catalog.length(v_quote), pg_catalog.length(v_suffix)) = v_suffix)::integer;
    IF v_score > v_best THEN
      v_best := v_score;
      v_winners := 1;
    ELSIF v_score = v_best THEN
      v_winners := v_winners + 1;
    END IF;
    v_from := v_at + 1;
  END LOOP;
  RETURN QUERY SELECT v_revision,
    CASE WHEN v_winners = 1 THEN pg_catalog.encode(pg_catalog.sha256(v_quote), 'hex') END;
END
$$;

REVOKE ALL ON FUNCTION collaboration.current_range_hash(text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collaboration.current_range_hash(text, uuid, jsonb) TO ductus_identity;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_identity;

-- How the version was opened: by a teacher's instruction (create, reopen) or
-- by a rereview; and for a rereview the hash the database computed for the
-- range, NULL when the range no longer resolved.
ALTER TABLE collaboration.revision_request_version
  ADD COLUMN opened_as text NOT NULL DEFAULT 'instruction'
    CONSTRAINT revision_request_version_opened_as_check CHECK (opened_as IN ('instruction', 'rereview')),
  ADD COLUMN observed_range_hash text
    CONSTRAINT revision_request_version_observed_hash_check CHECK (observed_range_hash ~ '^[0-9a-f]{64}$'),
  -- The scan under the lock is accepted: the table holds one row per version
  -- of a request, and every existing row passes (the new column is null).
  -- squawk-ignore constraint-missing-not-valid
  ADD CONSTRAINT revision_request_version_observed_rereview_check
    CHECK (observed_range_hash IS NULL OR opened_as = 'rereview');

-- accepted -> reopened at version + 1. The checks keep the order of the other
-- transitions: session, request and role, lock and submission, input shape,
-- counter, state and version ceiling, then the change rule. The rule reads
-- the document under the lock that holds back a commit: the transition is
-- allowed only when the document has a revision after the accepted one and
-- the range's hash there differs from the accepted one. An acceptance without
-- a hash cannot be compared, so it is never rereviewed here; the teacher's
-- reopen remains.
CREATE FUNCTION collaboration.rereview_revision_request(p_request_id uuid, p_expected_seq bigint)
RETURNS TABLE (outcome text, row_seq bigint, version integer, state text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  actor record;
  v_role text;
  r record;
  a record;
  now_at record;
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
  IF NOT collaboration.is_revision_seq(p_expected_seq) THEN
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
  IF a.accepted_range_hash IS NULL THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = 'ZD409';
  END IF;
  SELECT h.revision, h.range_hash INTO now_at
    FROM collaboration.revision_request q
   CROSS JOIN LATERAL collaboration.current_range_hash(q.document_id, q.institution_id, q.anchor) h
   WHERE q.id = r.request_id;
  IF now_at.revision <= a.accepted_revision OR now_at.range_hash IS NOT DISTINCT FROM a.accepted_range_hash THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = 'ZD409';
  END IF;
  v_seq := nextval('collaboration.revision_request_seq');
  INSERT INTO collaboration.revision_request_version
    (request_id, institution_id, version, instruction, requested_revision, opened_by, opened_as, observed_range_hash)
  VALUES (r.request_id, r.institution_id, r.version + 1, a.instruction, now_at.revision, r.actor_id, 'rereview',
          now_at.range_hash);
  UPDATE collaboration.revision_request q SET state = 'reopened', version = r.version + 1, row_seq = v_seq
   WHERE q.id = r.request_id;
  RETURN QUERY SELECT 'applied'::text, v_seq, r.version + 1, 'reopened'::text;
END
$$;

REVOKE ALL ON FUNCTION collaboration.rereview_revision_request(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collaboration.rereview_revision_request(uuid, bigint) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;
REVOKE USAGE, CREATE ON SCHEMA collaboration FROM ductus_evidence;

-- migrate:down

SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
GRANT USAGE ON SCHEMA collaboration TO ductus_evidence;
SET LOCAL ROLE ductus_identity;
DROP FUNCTION collaboration.rereview_revision_request(uuid, bigint);
ALTER TABLE collaboration.revision_request_version
  DROP COLUMN observed_range_hash,
  DROP COLUMN opened_as;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION collaboration.current_range_hash(text, uuid, jsonb);
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;
REVOKE USAGE ON SCHEMA collaboration FROM ductus_evidence;

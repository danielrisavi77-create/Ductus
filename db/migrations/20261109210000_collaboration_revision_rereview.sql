-- DAN-314, changed after acceptance (docs/backend/suradnja.md 4.14, contract
-- #1091 c.6752687836 as narrowed by #1091 c.6754441692; O7 #87 c.6581656612;
-- #87 c.6691142048): an accepted request whose anchored range changed in a
-- later revision of the document goes back to review as a new version. One
-- RPC, no trigger and no worker. The database decides whether the range
-- changed: it resolves the anchor stored with the acceptance (the range the
-- teacher actually accepted, #1831 B, #87 c.6763239855) in the checkpoint of
-- the accepted revision and in the checkpoint of the document's current
-- revision, and compares the two hashes. The caller (the student owner or a
-- teacher of the course) sends only the request and its counter, never a
-- hash, a revision or text. The stored acceptance is trusted only when its
-- hash is the one the database computes under its anchor at the accepted
-- revision; an acceptance without a hash, with another hash, or of a range
-- that did not resolve when it was accepted cannot be compared and is never
-- "changed". A
-- comparable acceptance whose range no longer resolves opens version v + 1
-- with the teacher's instruction of version v. The accepted version stays
-- accepted. Nothing is graded, decided or concluded about the author: the
-- new version only says that it was opened by a rereview and which hash the
-- database computed.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
GRANT USAGE, CREATE ON SCHEMA collaboration TO ductus_evidence;

-- A revision of a document (the current one when p_revision is NULL) and
-- the hash of the range an anchor resolves to in that revision's checkpoint;
-- the hash is NULL when the range does not resolve. Every revision has a
-- checkpoint, bound to the revision's content hash by a foreign key; the
-- current one is also checked against the document's own content hash.
-- Owned by the evidence role, which alone reads the text,
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
CREATE FUNCTION collaboration.range_hash_at(p_document_id text, p_institution_id uuid, p_anchor jsonb, p_revision bigint)
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
  SELECT coalesce(p_revision, d.current_revision), c.body INTO v_revision, v_body
    FROM evidence.document d
    LEFT JOIN evidence.document_checkpoint c
      ON c.document_id = d.id AND c.institution_id = d.institution_id
     AND c.revision = coalesce(p_revision, d.current_revision)
     AND (p_revision IS NOT NULL OR c.content_hash = d.current_content_hash)
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

REVOKE ALL ON FUNCTION collaboration.range_hash_at(text, uuid, jsonb, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collaboration.range_hash_at(text, uuid, jsonb, bigint) TO ductus_identity;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_identity;

-- How the version was opened: by a teacher's instruction (create, reopen) or
-- by a rereview; and for a rereview the hash the database computed for the
-- range, NULL when the range no longer resolved. Only an acceptance whose
-- range resolved is rereviewed, and a range that still resolves has the same
-- hash, so today a rereview always stores NULL here.
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

-- #1831 B (#87 c.6763239855): the anchor of the range the teacher actually
-- accepted, set together with its hash. A revision may replace the quote of
-- the request (Q -> Q'), so the range accepted is not always the request's
-- anchor; the rereview follows this one. NULL exactly when the hash is NULL:
-- no range was accepted. An acceptance stored before this column accepted
-- the request's own range, so its anchor is the request's.
ALTER TABLE collaboration.revision_request_version
  ADD COLUMN accepted_anchor jsonb
    CONSTRAINT revision_request_version_accepted_anchor_check CHECK (
      accepted_anchor IS NULL OR collaboration.is_text_anchor(accepted_anchor));
UPDATE collaboration.revision_request_version v SET accepted_anchor = q.anchor
  FROM collaboration.revision_request q
 WHERE q.id = v.request_id AND v.accepted_range_hash IS NOT NULL;
-- The scan under the lock is accepted, as above; every row passes after the
-- update.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE collaboration.revision_request_version
  ADD CONSTRAINT revision_request_version_accepted_anchor_hash_check
    CHECK ((accepted_anchor IS NULL) = (accepted_range_hash IS NULL));

-- The body of 20261106220000 with the accepted anchor added. The client sends
-- the hash and the anchor of the range it accepted in the accepted revision,
-- or neither when no range resolved. A hash without an anchor accepts the
-- request's own range (the four-argument calls); an anchor without a hash, or
-- one that is not a text anchor, is invalid input. The pair is the teacher's
-- claim; the rereview trusts it only when the database computes the same hash
-- under that anchor in the accepted revision.
DROP FUNCTION collaboration.accept_revision_request(uuid, bigint, bigint, text);
CREATE FUNCTION collaboration.accept_revision_request(
  p_request_id uuid, p_expected_seq bigint, p_accepted_revision bigint, p_range_hash text,
  p_accepted_anchor jsonb DEFAULT NULL
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
     OR (p_range_hash IS NOT NULL AND p_range_hash !~ '^[0-9a-f]{64}$')
     OR (p_accepted_anchor IS NOT NULL
         AND (p_range_hash IS NULL OR NOT coalesce(collaboration.is_text_anchor(p_accepted_anchor), false))) THEN
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
         accepted_revision = p_accepted_revision, accepted_range_hash = p_range_hash,
         accepted_anchor = CASE WHEN p_range_hash IS NOT NULL THEN coalesce(p_accepted_anchor,
           (SELECT q.anchor FROM collaboration.revision_request q WHERE q.id = r.request_id)) END
   WHERE v.request_id = r.request_id AND v.version = r.version;
  UPDATE collaboration.revision_request q SET state = 'accepted', row_seq = v_seq WHERE q.id = r.request_id;
  RETURN QUERY SELECT 'applied'::text, v_seq, r.version, 'accepted'::text;
END
$$;

REVOKE ALL ON FUNCTION collaboration.accept_revision_request(uuid, bigint, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collaboration.accept_revision_request(uuid, bigint, bigint, text, jsonb) TO ductus_app;

-- accepted -> reopened at version + 1. The checks keep the order of the other
-- transitions: session, request and role, lock and submission, input shape,
-- counter, state and version ceiling, then the change rule. The rule reads
-- the document under the lock that holds back a commit: the transition is
-- allowed only when the range's hash in the current revision differs from
-- the accepted one. The accepted hash is a value the teacher's client sent,
-- so it is compared only when the database computes the same hash in the
-- checkpoint of the accepted revision: an acceptance without a hash (refused
-- before any text is read), with another hash, or of a range that did not
-- resolve then is never rereviewed here, whatever the document holds now;
-- the teacher's reopen remains. The revisions need no comparison of their
-- own: the accepted revision itself has one checkpoint and so one hash.
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
  t record;
  v_then text;
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
  SELECT v.instruction, v.accepted_revision, v.accepted_range_hash, v.accepted_anchor INTO a
    FROM collaboration.revision_request_version v
   WHERE v.request_id = r.request_id AND v.version = r.version;
  -- No range was accepted (the client found none to hash): nothing to
  -- compare, refused before any text is read; the teacher's reopen remains.
  IF a.accepted_range_hash IS NULL OR a.accepted_anchor IS NULL THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = 'ZD409';
  END IF;
  SELECT q.document_id INTO t FROM collaboration.revision_request q WHERE q.id = r.request_id;
  -- The accepted anchor must resolve to the accepted hash in the accepted
  -- revision; one that does not resolve there, or to another hash, is not
  -- comparable.
  SELECT h.range_hash INTO v_then
    FROM collaboration.range_hash_at(t.document_id, r.institution_id, a.accepted_anchor, a.accepted_revision) h;
  IF v_then IS DISTINCT FROM a.accepted_range_hash THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = 'ZD409';
  END IF;
  SELECT h.revision, h.range_hash INTO now_at
    FROM collaboration.range_hash_at(t.document_id, r.institution_id, a.accepted_anchor, NULL) h;
  IF now_at.range_hash IS NOT DISTINCT FROM a.accepted_range_hash THEN
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
DROP FUNCTION collaboration.accept_revision_request(uuid, bigint, bigint, text, jsonb);
-- The body of 20261106220000, verbatim.
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

REVOKE ALL ON FUNCTION collaboration.accept_revision_request(uuid, bigint, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collaboration.accept_revision_request(uuid, bigint, bigint, text) TO ductus_app;
ALTER TABLE collaboration.revision_request_version
  DROP COLUMN accepted_anchor,
  DROP COLUMN observed_range_hash,
  DROP COLUMN opened_as;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION collaboration.range_hash_at(text, uuid, jsonb, bigint);
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;
REVOKE USAGE ON SCHEMA collaboration FROM ductus_evidence;

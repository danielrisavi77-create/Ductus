-- DAN-344 PR A (contract on #923, comment 6429438582): the record the replay
-- of a work is read from. The replay is built from the same record as the
-- process summary, with the same readers and the same submission cut
-- (app.process_summary_record, 20261026130000): the owning student and the
-- teacher of the assignment get the same answer (PRODUCT 5 rule 5, D-154),
-- every other caller gets the answer for a missing document.
--
-- app.read_replay_source is app.read_process_summary_source of
-- 20261021130000 with the surface replay. app.read_replay_checkpoints returns
-- the text of the revisions whose hashes the route asks for: the document the
-- replay starts from and the one it resumes from after a break in the chain
-- (P2 of the contract). A teacher's read of either is logged before it is
-- answered, one row per reader, work and surface per 5-minute interval; the
-- owning student's is not. Every call is logged, not only the first page, so
-- a page read without the first one is logged too.
--
-- The checkpoints are read by a function of the evidence role in schema app,
-- executable only by the identity role, so the identity role still has no
-- access to schema evidence (as app.submitted_document_text, 20261026163000).
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_identity, ductus_evidence;

SET LOCAL ROLE ductus_evidence;
-- The text of the caller's institution's checkpoints of this document whose
-- hash is asked for, one row per hash found, and only bytes that hash to it.
-- The institution comes from the session, never from a parameter; the caller
-- has already checked that the actor may read the document.
CREATE FUNCTION app.replay_document_checkpoints(p_document_id text, p_content_hashes text[])
RETURNS TABLE (content_hash text, body text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT DISTINCT ON (c.content_hash) c.content_hash, c.body
    FROM app.current_actor() a
    JOIN evidence.document_checkpoint c ON c.institution_id = a.institution_id
   WHERE c.document_id = p_document_id
     AND c.content_hash = ANY (p_content_hashes)
     AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(c.body, 'UTF8')), 'hex') = c.content_hash
   ORDER BY c.content_hash, c.revision
$$;
REVOKE ALL ON FUNCTION app.replay_document_checkpoints(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.replay_document_checkpoints(text, text[]) TO ductus_identity;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_identity;

-- A new surface widens the closed list (20261021120000).
ALTER TABLE audit.access_log DROP CONSTRAINT access_log_surface_check;
ALTER TABLE audit.access_log ADD CONSTRAINT access_log_surface_check
  CHECK (surface IN ('live_view', 'process_summary', 'fast_path', 'replay'));

-- Outcomes as app.read_process_summary_source: ZD401 (no open session),
-- found (institution, package and its segments up to the submission cut),
-- not_found (one answer for every refusal and for a missing document),
-- unavailable (no package or more than one, or a listing that does not end at
-- the head).
CREATE FUNCTION app.read_replay_source(p_document_id text)
RETURNS TABLE (outcome text, institution_id uuid, evidence_package_id text, segment_hashes text[])
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_scope record;
  v_role text;
  v_record record;
  v_head text;
  v_packages integer := 0;
BEGIN
  -- The session first, before the input: no session is ZD401 whatever is asked.
  PERFORM institution.require_actor();
  IF p_document_id IS NULL OR length(p_document_id) NOT BETWEEN 1 AND 256
     OR p_document_id ~ '[[:cntrl:]]' OR p_document_id <> pg_catalog.btrim(p_document_id) THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::text[];
    RETURN;
  END IF;
  SELECT * INTO v_scope FROM collaboration.document_scope(p_document_id);
  v_role := collaboration.actor_role(v_scope.institution_id, v_scope.assignment_id, v_scope.principal_id);
  IF v_scope.institution_id IS NULL OR v_role IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::text[];
    RETURN;
  END IF;
  IF v_role = 'teacher' THEN
    PERFORM audit.record_work_opening(v_scope.institution_id, p_document_id, v_scope.assignment_id,
                                      v_scope.principal_id, 'replay');
  END IF;

  FOR v_record IN
    SELECT r.evidence_package_id, r.head_segment_hash, r.segment_hashes
      FROM app.process_summary_record(p_document_id) r
  LOOP
    v_packages := v_packages + 1;
    IF v_packages > 1 THEN
      EXIT;
    END IF;
    evidence_package_id := v_record.evidence_package_id;
    v_head := v_record.head_segment_hash;
    segment_hashes := v_record.segment_hashes;
  END LOOP;
  IF v_packages <> 1
     OR v_head IS DISTINCT FROM segment_hashes[pg_catalog.cardinality(segment_hashes)] THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::text, NULL::text[];
    RETURN;
  END IF;
  RETURN QUERY SELECT 'found'::text, v_scope.institution_id::uuid, evidence_package_id, segment_hashes;
END
$$;
REVOKE ALL ON FUNCTION app.read_replay_source(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_replay_source(text) TO ductus_app;

-- ZD401 without an open session; ZD422 for a hash list that is empty, longer
-- than 512, or holds anything but lowercase SHA-256 hex. A caller who may not
-- read the document, and a document that does not exist, get no rows, the
-- same as a hash no checkpoint has.
CREATE FUNCTION app.read_replay_checkpoints(p_document_id text, p_content_hashes text[])
RETURNS TABLE (content_hash text, body text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_scope record;
  v_role text;
BEGIN
  PERFORM institution.require_actor();
  IF p_content_hashes IS NULL OR pg_catalog.cardinality(p_content_hashes) NOT BETWEEN 1 AND 512
     OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_content_hashes) AS h (hash)
                 WHERE h.hash IS NULL OR h.hash !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF p_document_id IS NULL OR length(p_document_id) NOT BETWEEN 1 AND 256
     OR p_document_id ~ '[[:cntrl:]]' OR p_document_id <> pg_catalog.btrim(p_document_id) THEN
    RETURN;
  END IF;
  SELECT * INTO v_scope FROM collaboration.document_scope(p_document_id);
  v_role := collaboration.actor_role(v_scope.institution_id, v_scope.assignment_id, v_scope.principal_id);
  IF v_scope.institution_id IS NULL OR v_role IS NULL THEN
    RETURN;
  END IF;
  IF v_role = 'teacher' THEN
    PERFORM audit.record_work_opening(v_scope.institution_id, p_document_id, v_scope.assignment_id,
                                      v_scope.principal_id, 'replay');
  END IF;
  RETURN QUERY SELECT c.content_hash, c.body FROM app.replay_document_checkpoints(p_document_id, p_content_hashes) c;
END
$$;
REVOKE ALL ON FUNCTION app.read_replay_checkpoints(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_replay_checkpoints(text, text[]) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity, ductus_evidence;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_identity;
DROP FUNCTION app.read_replay_checkpoints(text, text[]);
DROP FUNCTION app.read_replay_source(text);
-- Fails while a replay row exists, which the append-only log keeps.
ALTER TABLE audit.access_log DROP CONSTRAINT access_log_surface_check;
ALTER TABLE audit.access_log ADD CONSTRAINT access_log_surface_check
  CHECK (surface IN ('live_view', 'process_summary', 'fast_path'));
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.replay_document_checkpoints(text, text[]);
RESET ROLE;

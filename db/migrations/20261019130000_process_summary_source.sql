-- B-13 step 3 / DAN-85: which stored record the process summary of a
-- document is built from (docs/BACKEND.md 4.10 t. 7; src/application/ports/
-- process-summary-source.ts). One answer for every reader (PRODUCT 5 t. 5,
-- D-80 t. 6): who asks decides only whether there is an answer, never what
-- it holds. Identity and institution come from current_actor(); the only
-- parameter is the document. Payload bytes are not here: the caller reads
-- them by hash and verifies the chain against the head of this cut.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; all revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_identity, ductus_evidence;
GRANT ductus_evidence TO ductus_identity WITH INHERIT FALSE, SET TRUE;

SET LOCAL ROLE ductus_identity;
SET LOCAL ROLE ductus_evidence;
-- The cut of a document's record: per package, the hashes of the segments
-- accepted before p_before, in chain order. Owned by the evidence role and
-- executable only by the identity role, so the web role reads no segment row.
CREATE FUNCTION app.process_summary_cut(p_document_id text, p_before timestamptz)
RETURNS TABLE (evidence_package_id text, segment_hashes text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id, coalesce((
    SELECT array_agg(s.segment_hash ORDER BY s.sequence_from)
      FROM evidence.segment s
     WHERE s.evidence_package_id = p.id AND s.institution_id = p.institution_id
       AND s.accepted_at < p_before), ARRAY[]::text[])
  FROM evidence.package p
  WHERE p.document_id = p_document_id
$$;
REVOKE ALL ON FUNCTION app.process_summary_cut(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.process_summary_cut(text, timestamptz) TO ductus_identity;

SET LOCAL ROLE ductus_identity;
-- Outcomes: found (package and cut), not_found (no session, not the teacher
-- of the assignment's course nor its owning student, another institution, no
-- such document or an id that cannot be one: one answer), unavailable (the
-- document has no package or more than one). D-144 replaced D-37, so a short
-- assignment is read like any other.
--
-- The cut follows BACKEND 4.10 t. 7: only segments accepted before the start
-- of the current P-03 window (database clock, 5 minutes aligned in UTC, the
-- default of docs/DECISIONS.md, as in collaboration.list_comments, until it
-- is an institution setting).
CREATE FUNCTION app.read_process_summary_source(p_document_id text)
RETURNS TABLE (outcome text, evidence_package_id text, segment_hashes text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_scope record;
  v_cut record;
  v_packages integer := 0;
BEGIN
  IF p_document_id IS NULL OR length(p_document_id) NOT BETWEEN 1 AND 256
     OR p_document_id ~ '[[:cntrl:]]' OR p_document_id <> pg_catalog.btrim(p_document_id) THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::text[];
    RETURN;
  END IF;
  SELECT * INTO v_scope FROM collaboration.document_scope(p_document_id);
  IF v_scope.institution_id IS NULL
     OR collaboration.actor_role(v_scope.institution_id, v_scope.assignment_id, v_scope.principal_id) IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::text[];
    RETURN;
  END IF;

  FOR v_cut IN
    SELECT c.evidence_package_id, c.segment_hashes
      FROM app.process_summary_cut(
        p_document_id,
        pg_catalog.date_bin('5 minutes', pg_catalog.now(), timestamptz '2000-01-01 00:00:00+00')) c
  LOOP
    v_packages := v_packages + 1;
    IF v_packages > 1 THEN
      EXIT;
    END IF;
    evidence_package_id := v_cut.evidence_package_id;
    segment_hashes := v_cut.segment_hashes;
  END LOOP;
  IF v_packages <> 1 THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::text, NULL::text[];
    RETURN;
  END IF;
  RETURN QUERY SELECT 'found'::text, evidence_package_id, segment_hashes;
END
$$;
REVOKE ALL ON FUNCTION app.read_process_summary_source(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_process_summary_source(text) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity, ductus_evidence;
REVOKE ductus_evidence FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT ductus_evidence TO ductus_identity WITH INHERIT FALSE, SET TRUE;
SET LOCAL ROLE ductus_identity;
DROP FUNCTION app.read_process_summary_source(text);
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.process_summary_cut(text, timestamptz);
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE ductus_evidence FROM ductus_identity;

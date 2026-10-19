-- B-13 step 4 / DAN-85: the read RPC of the process summary also names the
-- institution of the record, so the server reads the segment payloads from
-- that institution's storage domain (BACKEND 4.1, B2) with the institution
-- taken from this row, read under withActor, never from the request. The
-- record's institution is the document's (the package references the
-- document under the same institution), the same for every reader: it says
-- nothing about who asks. Input, access rule and outcomes are unchanged
-- from 20261019130000; only the result gains a column, so the function is
-- replaced.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_identity;

SET LOCAL ROLE ductus_identity;
DROP FUNCTION app.read_process_summary_source(text);
-- Outcomes: found (institution, package and its segments), not_found (no
-- session, not the teacher of the assignment's course nor its owning
-- student, another institution, no such document or an id that cannot be
-- one: one answer), unavailable (no package or more than one, or a listing
-- that does not end at the package head). No P-03 cut (#87 6256655038,
-- point 3); a short assignment is read like any other (D-144).
CREATE FUNCTION app.read_process_summary_source(p_document_id text)
RETURNS TABLE (outcome text, institution_id uuid, evidence_package_id text, segment_hashes text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_scope record;
  v_record record;
  v_head text;
  v_packages integer := 0;
BEGIN
  IF p_document_id IS NULL OR length(p_document_id) NOT BETWEEN 1 AND 256
     OR p_document_id ~ '[[:cntrl:]]' OR p_document_id <> pg_catalog.btrim(p_document_id) THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::text[];
    RETURN;
  END IF;
  SELECT * INTO v_scope FROM collaboration.document_scope(p_document_id);
  IF v_scope.institution_id IS NULL
     OR collaboration.actor_role(v_scope.institution_id, v_scope.assignment_id, v_scope.principal_id) IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::text[];
    RETURN;
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
REVOKE ALL ON FUNCTION app.read_process_summary_source(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_process_summary_source(text) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app TO ductus_identity;
SET LOCAL ROLE ductus_identity;
DROP FUNCTION app.read_process_summary_source(text);
CREATE FUNCTION app.read_process_summary_source(p_document_id text)
RETURNS TABLE (outcome text, evidence_package_id text, segment_hashes text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_scope record;
  v_record record;
  v_head text;
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
REVOKE CREATE ON SCHEMA app FROM ductus_identity;

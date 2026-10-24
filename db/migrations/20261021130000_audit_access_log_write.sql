-- DAN-228, step 2: the two reads through which a teacher of the assignment
-- reads a student's work write the access log in the same transaction
-- (docs/PRODUCT.md 5, rule 17; D-150; owner answers of 19 Oct 2026 on #497,
-- comment 6267554715). One opening is one row per reader, work and surface
-- for each 5-minute interval aligned to the database clock in which the
-- reader read at least once: the first read of an interval writes the row,
-- every further read of it writes nothing. The owning student's reads and
-- refused reads write nothing. A read whose row cannot be written fails, so
-- there is no read without its row. Comments are not logged (answer 2).
-- Input, access rule, outcomes and output of both reads are unchanged; they
-- become VOLATILE because they now write.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA audit TO ductus_identity;
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
GRANT CREATE ON SCHEMA app TO ductus_identity;

SET LOCAL ROLE ductus_identity;

-- The interval start is the only time a row holds (answer 1).
ALTER TABLE audit.access_log ADD CONSTRAINT access_log_interval_check
  CHECK (opened_at = date_bin('5 minutes', opened_at, timestamptz '2000-01-01 00:00:00+00'));
CREATE UNIQUE INDEX access_log_opening_idx
  ON audit.access_log (document_id, institution_id, reader_id, surface, opened_at);

-- Writes the opening of the caller, a teacher of the assignment, unless the
-- interval already has it. The reader comes from the session, never from a
-- parameter; the scope is what the calling read took from document_scope.
-- Not SECURITY DEFINER and executable by no runtime role: only the reads
-- below, which the owner role owns, call it.
CREATE FUNCTION audit.record_work_opening(
  p_institution_id uuid, p_document_id text, p_assignment_id uuid, p_owner_id uuid, p_surface text
) RETURNS void
LANGUAGE sql VOLATILE SET search_path = ''
AS $$
  INSERT INTO audit.access_log (institution_id, document_id, assignment_id, owner_id, reader_id, reader_role, surface, opened_at)
  SELECT p_institution_id, p_document_id, p_assignment_id, p_owner_id, a.user_id, 'teacher', p_surface,
         date_bin('5 minutes', now(), timestamptz '2000-01-01 00:00:00+00')
  FROM app.current_actor() a
  ON CONFLICT (document_id, institution_id, reader_id, surface, opened_at) DO NOTHING
$$;

-- As 20261019120000, and a teacher's read is logged before it is answered.
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

-- As 20261020160000, and a teacher's read is logged before it is answered,
-- also when the record is unavailable: the teacher opened the summary.
CREATE OR REPLACE FUNCTION app.read_process_summary_source(p_document_id text)
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
                                      v_scope.principal_id, 'process_summary');
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

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA audit FROM ductus_identity;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;
REVOKE CREATE ON SCHEMA app FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
GRANT CREATE ON SCHEMA app TO ductus_identity;
SET LOCAL ROLE ductus_identity;
CREATE OR REPLACE FUNCTION collaboration.read_live_state(p_document_id text, p_known_hash text)
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
CREATE OR REPLACE FUNCTION app.read_process_summary_source(p_document_id text)
RETURNS TABLE (outcome text, institution_id uuid, evidence_package_id text, segment_hashes text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_scope record;
  v_record record;
  v_head text;
  v_packages integer := 0;
BEGIN
  PERFORM institution.require_actor();
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
DROP FUNCTION audit.record_work_opening(uuid, text, uuid, uuid, text);
DROP INDEX audit.access_log_opening_idx;
ALTER TABLE audit.access_log DROP CONSTRAINT access_log_interval_check;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;
REVOKE CREATE ON SCHEMA app FROM ductus_identity;

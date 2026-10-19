-- B-12 step 4b1 / DAN-87: the stored record a submission request is
-- reconstructed from (docs/BACKEND.md 4.6; contract on #385). The web process
-- reads it in one statement, so the listing and the head come from one
-- snapshot, then reads the payloads by hash and checks every receipt under
-- the registry keys of the package's domain. Identity and institution come
-- from current_actor(); the only parameter is the request. Writes nothing.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;
-- Outcomes: found, unauthenticated (no session), not_found (no such request,
-- another student's or another institution's: one answer), unavailable (no
-- package or more than one, or no receipt names the requested revision).
-- The record is cut at the requested revision: the head is the last segment
-- whose receipt names that revision, and the listing is every segment of the
-- package up to it in chain order, each with the exact receipt text and the
-- stored signature (null while pending_signature). A segment accepted after
-- the request is not in it (plan item B4). Whether the student is still an
-- active student of the assignment is decided by record_submission.
CREATE FUNCTION app.read_submission_record(p_submission_request_id uuid)
RETURNS TABLE (
  outcome text, institution_id uuid, evidence_package_id text, evidence_domain_id uuid, document_id text,
  principal_id uuid, revision bigint, content_hash text, head_segment_hash text, segment_count integer,
  segments jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor record;
  v_request evidence.submission_request%ROWTYPE;
  v_package evidence.package%ROWTYPE;
  v_packages integer;
  v_head record;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RETURN QUERY SELECT 'unauthenticated'::text, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::uuid,
      NULL::bigint, NULL::text, NULL::text, NULL::integer, NULL::jsonb;
    RETURN;
  END IF;
  SELECT s.* INTO v_request
    FROM evidence.submission_request s
   WHERE s.id = p_submission_request_id AND s.institution_id = v_actor.institution_id
     AND s.principal_id = v_actor.user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::uuid,
      NULL::bigint, NULL::text, NULL::text, NULL::integer, NULL::jsonb;
    RETURN;
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_packages
    FROM evidence.package k
   WHERE k.document_id = v_request.document_id AND k.institution_id = v_request.institution_id;
  SELECT k.* INTO v_package
    FROM evidence.package k
   WHERE k.document_id = v_request.document_id AND k.institution_id = v_request.institution_id
     AND k.principal_id = v_request.principal_id;
  -- The last segment whose receipt names the requested revision.
  SELECT s.segment_hash, s.sequence_from INTO v_head
    FROM evidence.segment s
    JOIN evidence.receipt r
      ON r.segment_id = s.id AND r.evidence_package_id = s.evidence_package_id AND r.institution_id = s.institution_id
   WHERE s.evidence_package_id = v_package.id AND s.institution_id = v_package.institution_id
     AND pg_catalog.jsonb_typeof(r.receipt_payload::jsonb -> 'revision') = 'number'
     AND (r.receipt_payload::jsonb ->> 'revision')::numeric = v_request.revision
   ORDER BY s.sequence_from DESC
   LIMIT 1;
  IF v_packages <> 1 OR v_package.id IS NULL OR v_head.segment_hash IS NULL THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::uuid,
      NULL::bigint, NULL::text, NULL::text, NULL::integer, NULL::jsonb;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 'found'::text, v_package.institution_id, v_package.id, v_package.evidence_domain_id, v_request.document_id,
         v_request.principal_id, v_request.revision, v_request.content_hash, v_head.segment_hash,
         pg_catalog.count(*)::integer,
         pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'segmentHash', s.segment_hash, 'receiptPayload', r.receipt_payload, 'signature', r.signature)
           ORDER BY s.sequence_from)
    FROM evidence.segment s
    JOIN evidence.receipt r
      ON r.segment_id = s.id AND r.evidence_package_id = s.evidence_package_id AND r.institution_id = s.institution_id
   WHERE s.evidence_package_id = v_package.id AND s.institution_id = v_package.institution_id
     AND s.sequence_from <= v_head.sequence_from;
END
$$;
REVOKE ALL ON FUNCTION app.read_submission_record(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_submission_record(uuid) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.read_submission_record(uuid);
RESET ROLE;

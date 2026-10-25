-- DAN-289 A2 (contract #756, plan of attack #755 part B): the process summary
-- of a submitted work stops at the submitted revision, for the student and the
-- teacher alike (PRODUCT 5 t. 5). Only a submission cuts, never a request
-- alone. The cut is the rule of app.read_submission_record: the head is the
-- last segment whose receipt names the submitted revision, and the listing is
-- every segment of the package up to it in chain order. When no receipt names
-- that revision the head is '', which no listing ends at, so
-- read_process_summary_source answers unavailable and never the package head.
-- Signature, owner and grants are those of 20261019130000; the readers are
-- unchanged.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;
CREATE OR REPLACE FUNCTION app.process_summary_record(p_document_id text)
RETURNS TABLE (evidence_package_id text, head_segment_hash text, segment_hashes text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id,
         CASE WHEN sub.revision IS NULL THEN p.head_segment_hash ELSE coalesce(cut.segment_hash, '') END,
         coalesce((
           SELECT array_agg(s.segment_hash ORDER BY s.sequence_from)
             FROM evidence.segment s
            WHERE s.evidence_package_id = p.id AND s.institution_id = p.institution_id
              AND (sub.revision IS NULL OR cut.sequence_from IS NULL OR s.sequence_from <= cut.sequence_from)),
           ARRAY[]::text[])
    FROM evidence.package p
    -- The submission of this document, if any (one per student and assignment).
    LEFT JOIN LATERAL (
      SELECT s.revision
        FROM evidence.submission s
        JOIN evidence.submission_request r ON r.id = s.submission_request_id AND r.institution_id = s.institution_id
       WHERE r.document_id = p.document_id AND r.institution_id = p.institution_id
    ) sub ON true
    -- The last segment whose receipt names the submitted revision.
    LEFT JOIN LATERAL (
      SELECT s.segment_hash, s.sequence_from
        FROM evidence.segment s
        JOIN evidence.receipt r
          ON r.segment_id = s.id AND r.evidence_package_id = s.evidence_package_id AND r.institution_id = s.institution_id
       WHERE sub.revision IS NOT NULL
         AND s.evidence_package_id = p.id AND s.institution_id = p.institution_id
         AND pg_catalog.jsonb_typeof(r.receipt_payload::jsonb -> 'revision') = 'number'
         AND (r.receipt_payload::jsonb ->> 'revision')::numeric = sub.revision
       ORDER BY s.sequence_from DESC
       LIMIT 1
    ) cut ON true
   WHERE p.document_id = p_document_id
$$;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;
-- The record of 20261019130000, verbatim.
CREATE OR REPLACE FUNCTION app.process_summary_record(p_document_id text)
RETURNS TABLE (evidence_package_id text, head_segment_hash text, segment_hashes text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id, p.head_segment_hash, coalesce((
    SELECT array_agg(s.segment_hash ORDER BY s.sequence_from)
      FROM evidence.segment s
     WHERE s.evidence_package_id = p.id AND s.institution_id = p.institution_id), ARRAY[]::text[])
  FROM evidence.package p
  WHERE p.document_id = p_document_id
$$;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

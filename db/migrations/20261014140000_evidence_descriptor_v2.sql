-- DAN-189 / B-8: private canonical receipt and descriptor validation helpers.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA evidence TO ductus_evidence;
GRANT ductus_evidence TO ductus_identity WITH INHERIT FALSE, SET TRUE;

SET LOCAL ROLE ductus_identity;
SET LOCAL ROLE ductus_evidence;

-- Fixed ASCII receipt keys sort bytewise as required by this v2 receipt format.
CREATE FUNCTION evidence.canonical_receipt_v2(p_payload jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE v_result text;
BEGIN
  IF pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_each(p_payload) AS e(key, value)
       WHERE pg_catalog.jsonb_typeof(value) NOT IN ('string', 'number', 'null')
     ) THEN
    RAISE EXCEPTION 'invalid receipt payload' USING ERRCODE = 'ZD422';
  END IF;
  SELECT '{' || pg_catalog.string_agg(
           pg_catalog.to_json(e.key)::text || ':' ||
           CASE pg_catalog.jsonb_typeof(e.value)
             WHEN 'string' THEN pg_catalog.to_json(e.value #>> '{}')::text
             WHEN 'number' THEN e.value::text
             WHEN 'null' THEN 'null'
           END,
           ',' ORDER BY e.key COLLATE "C"
         ) || '}'
    INTO v_result
    FROM pg_catalog.jsonb_each(p_payload) AS e(key, value);
  RETURN v_result;
END
$$;
REVOKE ALL ON FUNCTION evidence.canonical_receipt_v2(jsonb) FROM PUBLIC;

-- Returns no row for malformed input so the caller can report "invalid".
CREATE FUNCTION evidence.validate_segment_descriptor_v2(p_descriptor jsonb, p_payload_sha256 text)
RETURNS TABLE (
  sequence_from bigint, sequence_to bigint, event_count integer, payload_bytes integer,
  observed_started_at timestamptz, observed_ended_at timestamptz
)
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  v_started timestamptz;
  v_ended timestamptz;
BEGIN
  IF pg_catalog.jsonb_typeof(p_descriptor) IS DISTINCT FROM 'object'
     OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(p_descriptor)) <> 16
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_object_keys(p_descriptor) AS k(key)
       WHERE key NOT IN (
         'evidencePackageId', 'documentId', 'sessionId', 'segmentId', 'evidenceSchema',
         'canonicalization', 'hashAlgorithm', 'evidenceProfileId', 'sequenceFrom', 'sequenceTo',
         'eventCount', 'observedStartedAt', 'observedEndedAt', 'segmentHash',
         'predecessorSegmentHash', 'payloadBytes'
       )
     )
     OR EXISTS (
       SELECT 1 FROM (VALUES
         ('evidencePackageId'), ('documentId'), ('sessionId'), ('segmentId'), ('evidenceSchema'),
         ('canonicalization'), ('hashAlgorithm'), ('evidenceProfileId'), ('sequenceFrom'), ('sequenceTo'),
         ('eventCount'), ('observedStartedAt'), ('observedEndedAt'), ('segmentHash'),
         ('predecessorSegmentHash'), ('payloadBytes')
       ) AS required(key) WHERE NOT (p_descriptor ? required.key)
     )
     OR pg_catalog.jsonb_typeof(p_descriptor->'evidencePackageId') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'documentId') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'sessionId') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'segmentId') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'evidenceSchema') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'canonicalization') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'hashAlgorithm') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'evidenceProfileId') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'sequenceFrom') <> 'number'
     OR pg_catalog.jsonb_typeof(p_descriptor->'sequenceTo') <> 'number'
     OR pg_catalog.jsonb_typeof(p_descriptor->'eventCount') <> 'number'
     OR pg_catalog.jsonb_typeof(p_descriptor->'observedStartedAt') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'observedEndedAt') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'segmentHash') <> 'string'
     OR pg_catalog.jsonb_typeof(p_descriptor->'payloadBytes') <> 'number' THEN
    RETURN;
  END IF;

  IF length(p_descriptor->>'evidencePackageId') NOT BETWEEN 1 AND 128
     OR p_descriptor->>'evidencePackageId' !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
     OR length(p_descriptor->>'documentId') NOT BETWEEN 1 AND 256
     OR p_descriptor->>'documentId' <> pg_catalog.btrim(p_descriptor->>'documentId')
     OR p_descriptor->>'documentId' ~ '[[:cntrl:]]'
     OR length(p_descriptor->>'sessionId') NOT BETWEEN 1 AND 256
     OR p_descriptor->>'sessionId' <> pg_catalog.btrim(p_descriptor->>'sessionId')
     OR p_descriptor->>'sessionId' ~ '[[:cntrl:]]'
     OR length(p_descriptor->>'segmentId') NOT BETWEEN 1 AND 256
     OR p_descriptor->>'segmentId' <> pg_catalog.btrim(p_descriptor->>'segmentId')
     OR p_descriptor->>'segmentId' ~ '[[:cntrl:]]'
     OR p_descriptor->>'evidenceSchema' <> 'ductus-evidence-segment-v2'
     OR p_descriptor->>'canonicalization' <> 'RFC8785-JCS'
     OR p_descriptor->>'hashAlgorithm' <> 'sha256'
     OR length(p_descriptor->>'evidenceProfileId') NOT BETWEEN 1 AND 120
     OR p_descriptor->>'evidenceProfileId' <> pg_catalog.btrim(p_descriptor->>'evidenceProfileId')
     OR p_descriptor->>'evidenceProfileId' ~ '[[:cntrl:]]'
     OR p_descriptor->>'segmentHash' !~ '^[0-9a-f]{64}$'
     OR p_descriptor->>'segmentHash' <> p_payload_sha256
     OR (p_descriptor->'predecessorSegmentHash' <> 'null'::jsonb
         AND (pg_catalog.jsonb_typeof(p_descriptor->'predecessorSegmentHash') <> 'string'
              OR p_descriptor->>'predecessorSegmentHash' !~ '^[0-9a-f]{64}$'))
     OR (p_descriptor->>'sequenceFrom')::numeric <> trunc((p_descriptor->>'sequenceFrom')::numeric)
     OR (p_descriptor->>'sequenceTo')::numeric <> trunc((p_descriptor->>'sequenceTo')::numeric)
     OR (p_descriptor->>'eventCount')::numeric <> trunc((p_descriptor->>'eventCount')::numeric)
     OR (p_descriptor->>'payloadBytes')::numeric <> trunc((p_descriptor->>'payloadBytes')::numeric)
     OR (p_descriptor->>'sequenceFrom')::numeric NOT BETWEEN 1 AND 9007199254740991
     OR (p_descriptor->>'sequenceTo')::numeric NOT BETWEEN 1 AND 9007199254740991
     OR (p_descriptor->>'eventCount')::numeric NOT BETWEEN 1 AND 5000
     OR (p_descriptor->>'payloadBytes')::numeric NOT BETWEEN 1 AND 2097152
     OR (p_descriptor->>'sequenceTo')::numeric - (p_descriptor->>'sequenceFrom')::numeric
        <> (p_descriptor->>'eventCount')::numeric - 1
     OR p_descriptor->>'observedStartedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[.]000Z$'
     OR p_descriptor->>'observedEndedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[.]000Z$' THEN
    RETURN;
  END IF;

  BEGIN
    v_started := (p_descriptor->>'observedStartedAt')::timestamptz;
    v_ended := (p_descriptor->>'observedEndedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
  IF pg_catalog.to_char(v_started AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:00.000"Z"') <> p_descriptor->>'observedStartedAt'
     OR pg_catalog.to_char(v_ended AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:00.000"Z"') <> p_descriptor->>'observedEndedAt'
     OR v_ended < v_started THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT (p_descriptor->>'sequenceFrom')::bigint, (p_descriptor->>'sequenceTo')::bigint,
    (p_descriptor->>'eventCount')::integer, (p_descriptor->>'payloadBytes')::integer, v_started, v_ended;
END
$$;
REVOKE ALL ON FUNCTION evidence.validate_segment_descriptor_v2(jsonb, text) FROM PUBLIC;

-- Bind a retry to the committed revision and storage location behind its receipt.
CREATE FUNCTION evidence.acceptance_retry_matches(
  p_receipt_id uuid, p_document_id text, p_principal_id uuid, p_expected_revision bigint,
  p_initial_document_hash text, p_final_document_hash text, p_storage_ref text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM evidence.receipt r
      JOIN evidence.package p
        ON p.id = r.evidence_package_id AND p.institution_id = r.institution_id
       AND p.document_id = p_document_id AND p.principal_id = p_principal_id
      JOIN evidence.document_revision committed
        ON committed.document_id = p.document_id AND committed.institution_id = p.institution_id
       AND committed.revision = (r.receipt_payload::jsonb->>'revision')::bigint
       AND committed.base_revision = p_expected_revision AND committed.principal_id = p_principal_id
       AND committed.content_hash = p_final_document_hash
      JOIN evidence.document_revision initial
        ON initial.document_id = committed.document_id AND initial.institution_id = committed.institution_id
       AND initial.revision = committed.base_revision AND initial.principal_id = p_principal_id
       AND initial.content_hash = p_initial_document_hash
      JOIN evidence.segment s
        ON s.id = r.segment_id AND s.evidence_package_id = r.evidence_package_id
       AND s.institution_id = r.institution_id AND s.document_id = p.document_id
       AND s.principal_id = p_principal_id AND s.storage_ref = p_storage_ref
     WHERE r.id = p_receipt_id AND r.principal_id = p_principal_id
  )
$$;
REVOKE ALL ON FUNCTION evidence.acceptance_retry_matches(uuid, text, uuid, bigint, text, text, text) FROM PUBLIC;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence FROM ductus_evidence;
REVOKE ductus_evidence FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA evidence TO ductus_evidence;
GRANT ductus_evidence TO ductus_identity WITH INHERIT FALSE, SET TRUE;
SET LOCAL ROLE ductus_identity;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION IF EXISTS evidence.acceptance_retry_matches(uuid, text, uuid, bigint, text, text, text);
DROP FUNCTION evidence.validate_segment_descriptor_v2(jsonb, text);
DROP FUNCTION evidence.canonical_receipt_v2(jsonb);
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence FROM ductus_evidence;
REVOKE ductus_evidence FROM ductus_identity;

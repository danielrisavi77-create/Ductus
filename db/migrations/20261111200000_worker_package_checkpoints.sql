-- DAN-293, M3.3-P03 (B-12, D-191 t. 4; docs/backend/suradnja.md 4.10):
-- the checkpoints a reconstruction asks for, read by the worker for one
-- evidence package of its own evidence domain. The package fixes the document
-- and the institution, so a checkpoint of another document, institution or
-- domain never leaves. Only the asked hashes whose text still hashes to its
-- key are returned; nothing else of the row, and the web role gets nothing
-- (D-71, D-74, D-102). The web replay reads (app.replay_document_checkpoints,
-- app.read_replay_checkpoints) stay as they are.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;

-- One row per asked hash that has a checkpoint; a hash without one, an
-- unknown package and a package of another domain give no row, so the answer
-- never tells them apart. The hash list is the port's: sorted is not needed
-- here, but every element must be a SHA-256 in lower-case hex, none repeated.
CREATE FUNCTION app.worker_package_checkpoints(
  p_evidence_domain_id uuid, p_evidence_package_id text, p_content_hashes text[])
RETURNS TABLE (content_hash text, body text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_evidence_domain_id IS NULL OR p_evidence_package_id IS NULL
     OR p_evidence_package_id !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
     OR p_content_hashes IS NULL OR pg_catalog.array_ndims(p_content_hashes) IS DISTINCT FROM 1
     OR pg_catalog.cardinality(p_content_hashes) NOT BETWEEN 1 AND 512
     OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_content_hashes) AS h (v)
                 WHERE h.v IS NULL OR h.v !~ '^[0-9a-f]{64}$')
     OR (SELECT pg_catalog.count(DISTINCT h.v) FROM pg_catalog.unnest(p_content_hashes) AS h (v))
        <> pg_catalog.cardinality(p_content_hashes) THEN
    RAISE EXCEPTION 'invalid worker request' USING ERRCODE = '22023';
  END IF;
  -- The same text may be checkpointed at two revisions; one row per hash.
  RETURN QUERY
    SELECT DISTINCT ON (c.content_hash) c.content_hash, c.body
      FROM evidence.package p
      JOIN evidence.document_checkpoint c
        ON c.document_id = p.document_id
       AND c.institution_id = p.institution_id
     WHERE p.id = p_evidence_package_id
       AND p.evidence_domain_id = p_evidence_domain_id
       AND c.content_hash = ANY (p_content_hashes)
       AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(c.body, 'UTF8')), 'hex') = c.content_hash
     ORDER BY c.content_hash, c.revision;
END
$$;

REVOKE ALL ON FUNCTION app.worker_package_checkpoints(uuid, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.worker_package_checkpoints(uuid, text, text[]) TO ductus_worker;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.worker_package_checkpoints(uuid, text, text[]);
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

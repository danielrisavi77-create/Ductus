-- migrate:up
-- DAN-302 L5: a checkpoint took its time from now(), the start of the
-- transaction, while the revision it belongs to takes clock_timestamp() in
-- the commit RPC (v_now). The checkpoint, written after its revision in the
-- same transaction, could then carry an earlier time than that revision.
-- It now takes clock_timestamp() too, so a checkpoint is never older than
-- its revision. The writer still gives only the bytes; nothing else in the
-- function changes.
--
-- Checkpoints the old trigger already wrote can be older than their
-- revision. Evidence times are never rewritten, so the migration does not
-- touch them: it fails instead, and the whole up section rolls back, while
-- any such checkpoint exists. Before the pilot only synthetic local data
-- exists; a database that fails here is recreated, and the invariant then
-- holds for every checkpoint on every database that carries this migration.
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA evidence TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM evidence.document_checkpoint k
      JOIN evidence.document_revision r
        ON r.document_id = k.document_id
       AND r.institution_id = k.institution_id
       AND r.revision = k.revision
     WHERE k.created_at < r.created_at
  ) THEN
    RAISE EXCEPTION 'DAN-302 L5: a checkpoint is older than its revision'
      USING DETAIL = 'Evidence times are never rewritten; this migration does not change them.',
            HINT = 'Only synthetic local data exists before the pilot: recreate this database and migrate again.';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION evidence.seal_document_checkpoint() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.content_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(NEW.body, 'UTF8')), 'hex');
  NEW.created_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END
$$;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA evidence TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;

CREATE OR REPLACE FUNCTION evidence.seal_document_checkpoint() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.content_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(NEW.body, 'UTF8')), 'hex');
  NEW.created_at := pg_catalog.now();
  RETURN NEW;
END
$$;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence FROM ductus_evidence;

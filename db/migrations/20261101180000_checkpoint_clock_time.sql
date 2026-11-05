-- migrate:up
-- DAN-302 L5: a checkpoint took its time from now(), the start of the
-- transaction, while the revision it belongs to takes clock_timestamp() in
-- the commit RPC (v_now). The checkpoint, written after its revision in the
-- same transaction, could then carry an earlier time than that revision.
-- It now takes clock_timestamp() too, so a checkpoint it seals is never
-- older than its revision. The writer still gives only the bytes; nothing
-- else in the function changes.
--
-- The guarantee covers checkpoints sealed after this migration commits
-- (owner decision, #87 c.6562442908). Checkpoints the old trigger sealed
-- before that, including any in a transaction still open while the
-- migration runs, keep their time: evidence times are never rewritten.
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA evidence TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;

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

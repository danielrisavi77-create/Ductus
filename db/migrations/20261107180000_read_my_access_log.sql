-- DAN-294 (M10.4-P01, contract on #1091, c.6710676431; plan of attack #1700):
-- the owning student reads who opened her work and when (docs/PRODUCT.md 5,
-- rule 17; D-150). One row per stored opening, as the reads wrote it: one per
-- reader, work, surface and 5-minute interval. No total of visits, no
-- duration, no count of any kind; the newest first, page by page, each page
-- ending on a whole 5-minute interval.
--
-- app.read_my_access_log: only the student who owns the document, in her own
-- institution. Any other caller, and a document that is malformed, unknown
-- or of another institution, gets the same ZD403. A limit outside 1..100 or
-- half a cursor is ZD422 before the document is looked at, so the input
-- check tells nothing about a document. No session is ZD401 before anything.
-- It writes nothing: reading one's own log is not an opening.
--
-- In the app schema, not audit: no runtime role has USAGE on audit (080).
-- Owned by the identity role, which owns audit.access_log and
-- identity.person_name and executes collaboration.document_scope.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_identity;

SET LOCAL ROLE ductus_identity;
CREATE FUNCTION app.read_my_access_log(
  p_document_id text, p_limit integer, p_before_at timestamptz, p_before_id uuid
)
RETURNS TABLE (
  entry_id uuid, opened_at timestamptz, surface text, reader_role text,
  reader_given_name text, reader_family_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor record;
  v_scope record;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR (p_before_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF p_document_id IS NULL OR pg_catalog.length(p_document_id) NOT BETWEEN 1 AND 256
     OR p_document_id ~ '[[:cntrl:]]' OR p_document_id <> pg_catalog.btrim(p_document_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- The owner is the document's principal, decided once per call.
  SELECT * INTO v_scope FROM collaboration.document_scope(p_document_id);
  IF v_scope.principal_id IS DISTINCT FROM v_actor.user_id
     OR v_scope.institution_id IS DISTINCT FROM v_actor.institution_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- The owner filter holds even against a row with another owner. A page
  -- ends on an interval: it holds the whole interval of its p_limit-th row,
  -- so it may be longer than p_limit by the rest of that interval, and the
  -- next page takes only older intervals (opened_at < p_before_at). Openings
  -- are written only into the current interval, so one written after a page
  -- shows on a fresh first page, never in a continuation (QA c.6711590695).
  -- p_before_id stays the other half of the cursor, checked as a pair above.
  RETURN QUERY
  WITH mine AS (
    SELECT l.id, l.opened_at, l.surface, l.reader_role, l.reader_id, l.institution_id
      FROM audit.access_log l
     WHERE l.document_id = p_document_id AND l.institution_id = v_actor.institution_id
       AND l.owner_id = v_actor.user_id
       AND (p_before_at IS NULL OR l.opened_at < p_before_at)
  ), edge AS (
    SELECT pg_catalog.min(f.opened_at) AS opened_at
      FROM (SELECT m.opened_at FROM mine m ORDER BY m.opened_at DESC LIMIT p_limit) f
  )
  SELECT m.id, m.opened_at, m.surface, m.reader_role, n.given_name, n.family_name
    FROM mine m
    CROSS JOIN edge e
    LEFT JOIN identity.person_name n ON n.user_id = m.reader_id AND n.institution_id = m.institution_id
   WHERE m.opened_at >= e.opened_at
   ORDER BY m.opened_at DESC, m.id DESC;
END
$$;
REVOKE ALL ON FUNCTION app.read_my_access_log(text, integer, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_my_access_log(text, integer, timestamptz, uuid) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_identity;
DROP FUNCTION app.read_my_access_log(text, integer, timestamptz, uuid);

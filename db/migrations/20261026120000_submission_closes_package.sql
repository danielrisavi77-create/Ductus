-- DAN-289 A1 (contract #756, plan of attack #755): a recorded submission
-- closes the evidence packages of its document in the same transaction, and a
-- package of a submitted document never accepts again (docs/ARCHITECTURE.md 2:
-- the submission freezes the work; docs/BACKEND.md 4.6). Only record_submission
-- writes a submission, and only in its "recorded" outcome, so every other
-- outcome closes nothing. commit_evidence_segment and evidence_commit_context
-- already answer not_accepting for a new key of a closed package; a retry of
-- a key accepted before the submission is answered as before, and its receipt
-- is still signed. Nothing here changes an RPC, a grant or a policy.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA evidence TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;
-- Runs inside record_submission's INSERT, after the locks it already holds
-- (assignment and membership FOR SHARE, then the submission row): the package
-- rows are the last lock taken. Not deferrable, so no snapshot sees the
-- submission with an open package.
CREATE FUNCTION evidence.close_submitted_packages() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  UPDATE evidence.package k
     SET accepts_evidence = false
    FROM evidence.submission_request r
   WHERE r.id = NEW.submission_request_id AND r.institution_id = NEW.institution_id
     AND k.document_id = r.document_id AND k.institution_id = r.institution_id
     AND k.accepts_evidence;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION evidence.close_submitted_packages() FROM PUBLIC;
CREATE TRIGGER evidence_submission_closes_package AFTER INSERT ON evidence.submission
  FOR EACH ROW EXECUTE FUNCTION evidence.close_submitted_packages();

-- A package of a submitted document is never opened again, nor created open.
-- The head and counter updates of an acceptance do not name accepts_evidence,
-- so they never fire this.
CREATE FUNCTION evidence.keep_submitted_package_closed() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.accepts_evidence AND EXISTS (
    SELECT 1
      FROM evidence.submission s
      JOIN evidence.submission_request r ON r.id = s.submission_request_id AND r.institution_id = s.institution_id
     WHERE r.document_id = NEW.document_id AND r.institution_id = NEW.institution_id
  ) THEN
    RAISE EXCEPTION 'a package of a submitted document stays closed' USING ERRCODE = 'ZD403';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION evidence.keep_submitted_package_closed() FROM PUBLIC;
CREATE TRIGGER evidence_package_stays_closed BEFORE INSERT OR UPDATE OF accepts_evidence ON evidence.package
  FOR EACH ROW EXECUTE FUNCTION evidence.keep_submitted_package_closed();

-- A submission recorded before this migration closes its packages too: a
-- repeated record_submission answers "existing" and inserts nothing, so the
-- trigger alone would never reach it.
UPDATE evidence.package k
   SET accepts_evidence = false
  FROM evidence.submission s
  JOIN evidence.submission_request r ON r.id = s.submission_request_id AND r.institution_id = s.institution_id
 WHERE k.document_id = r.document_id AND k.institution_id = r.institution_id
   AND k.accepts_evidence;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_evidence;
DROP TRIGGER evidence_package_stays_closed ON evidence.package;
DROP FUNCTION evidence.keep_submitted_package_closed();
DROP TRIGGER evidence_submission_closes_package ON evidence.submission;
DROP FUNCTION evidence.close_submitted_packages();
RESET ROLE;

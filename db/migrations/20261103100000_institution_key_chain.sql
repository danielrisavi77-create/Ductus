-- migrate:up
-- DAN-442 (M2.13-P01, D-199): the institution key through the last parents
-- that lacked it. An assignment version, an enrollment code and a signing key
-- were reached by a foreign key without the institution, so a row of one
-- institution could name a version, a code or a key of another, held back
-- only by the functions that write it. After this, every foreign key from a
-- table that carries the institution to an application table that carries it
-- includes it (D-103); db/tests/033-institution-key.sql checks that in the
-- catalogue and names the one exception.
--
-- The rules are those of 20261011100000_institution_assignment_key.sql:
-- institution_id is NOT NULL with no default, a row takes it from its parent,
-- no foreign key cascades. Existing rows take the institution of their
-- parent; a row whose parent belongs to another institution than its author
-- makes the whole migration fail, and nothing of it stays.
--
-- The lint exceptions below: each constraint is built and checked under
-- the lock this migration's one transaction already holds, on pilot tables of
-- a few rows per course; NOT VALID would leave old rows unchecked, and a
-- dropped foreign key is replaced in the same statement by a wider one.
SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; all revoked at the end.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
GRANT USAGE ON SCHEMA institution TO ductus_evidence;
GRANT CREATE ON SCHEMA evidence TO ductus_evidence;

SET LOCAL ROLE ductus_identity;

-- Assignment version: the institution of its assignment. Versions are
-- immutable; the trigger that says so is off for this one update only.
ALTER TABLE institution.assignment_version ADD COLUMN institution_id uuid;
ALTER TABLE institution.assignment_version DISABLE TRIGGER assignment_version_immutable;
UPDATE institution.assignment_version v SET institution_id = a.institution_id
  FROM institution.assignment a WHERE a.id = v.assignment_id;
ALTER TABLE institution.assignment_version ENABLE TRIGGER assignment_version_immutable;
-- squawk-ignore adding-not-nullable-field
ALTER TABLE institution.assignment_version ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE institution.assignment_version
  -- squawk-ignore constraint-missing-not-valid, disallowed-unique-constraint
  ADD CONSTRAINT assignment_version_id_institution_key UNIQUE (assignment_id, version_no, institution_id),
  -- squawk-ignore constraint-missing-not-valid, disallowed-unique-constraint
  ADD CONSTRAINT assignment_version_due_institution_key
    UNIQUE (assignment_id, version_no, due_at, institution_id),
  -- squawk-ignore ban-drop-constraint
  DROP CONSTRAINT assignment_version_assignment_id_fkey,
  -- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
  ADD CONSTRAINT assignment_version_assignment_institution_fkey
    FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment (id, institution_id),
  -- squawk-ignore ban-drop-constraint
  DROP CONSTRAINT assignment_version_created_by_fkey,
  -- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
  ADD CONSTRAINT assignment_version_created_by_institution_fkey
    FOREIGN KEY (created_by, institution_id) REFERENCES identity.user_account (id, institution_id);

-- The pointer to the current version and the acknowledgment of a version.
ALTER TABLE institution.assignment
  -- squawk-ignore ban-drop-constraint
  DROP CONSTRAINT assignment_current_version_fkey,
  -- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
  ADD CONSTRAINT assignment_current_version_institution_fkey
    FOREIGN KEY (id, current_version, institution_id)
    REFERENCES institution.assignment_version (assignment_id, version_no, institution_id)
    DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE institution.notice_acknowledgment
  -- squawk-ignore ban-drop-constraint
  DROP CONSTRAINT notice_acknowledgment_assignment_id_version_no_fkey,
  -- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
  ADD CONSTRAINT notice_acknowledgment_version_institution_fkey
    FOREIGN KEY (assignment_id, version_no, institution_id)
    REFERENCES institution.assignment_version (assignment_id, version_no, institution_id);

-- Enrollment code: the institution of its course.
ALTER TABLE institution.course_enrollment_code ADD COLUMN institution_id uuid;
UPDATE institution.course_enrollment_code e SET institution_id = c.institution_id
  FROM institution.course c WHERE c.id = e.course_id;
-- squawk-ignore adding-not-nullable-field
ALTER TABLE institution.course_enrollment_code ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE institution.course_enrollment_code
  -- squawk-ignore constraint-missing-not-valid, disallowed-unique-constraint
  ADD CONSTRAINT course_enrollment_code_id_institution_key UNIQUE (id, institution_id),
  -- squawk-ignore ban-drop-constraint
  DROP CONSTRAINT course_enrollment_code_course_id_fkey,
  -- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
  ADD CONSTRAINT course_enrollment_code_course_institution_fkey
    FOREIGN KEY (course_id, institution_id) REFERENCES institution.course (id, institution_id),
  -- squawk-ignore ban-drop-constraint
  DROP CONSTRAINT course_enrollment_code_created_by_fkey,
  -- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
  ADD CONSTRAINT course_enrollment_code_created_by_institution_fkey
    FOREIGN KEY (created_by, institution_id) REFERENCES identity.user_account (id, institution_id);
-- The application reads every column of a code but its hash.
GRANT SELECT (institution_id) ON institution.course_enrollment_code TO ductus_app;
ALTER TABLE audit.enrollment_code_event
  -- squawk-ignore ban-drop-constraint
  DROP CONSTRAINT enrollment_code_event_code_id_fkey,
  -- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
  ADD CONSTRAINT enrollment_code_event_code_institution_fkey
    FOREIGN KEY (code_id, institution_id) REFERENCES institution.course_enrollment_code (id, institution_id);

-- The functions that write versions and codes stay as they are: a row
-- written without the institution takes it from its parent, read under the
-- key lock its foreign key takes, so a parent that changes institution at the
-- same time fails the one or the other (tests/integration/
-- institution-key-chain-race.integration.test.ts). A row written with an
-- institution keeps it, and the foreign keys refuse one that is not the
-- parent's. Before the mentorship rule, which fires after it by name.
CREATE FUNCTION institution.assignment_version_institution_fill() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF NEW.institution_id IS NULL THEN
    SELECT a.institution_id INTO NEW.institution_id FROM institution.assignment a WHERE a.id = NEW.assignment_id;
  END IF;
  RETURN NEW;
END
$$;
CREATE FUNCTION institution.course_enrollment_code_institution_fill() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF NEW.institution_id IS NULL THEN
    SELECT c.institution_id INTO NEW.institution_id FROM institution.course c WHERE c.id = NEW.course_id;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION institution.assignment_version_institution_fill(),
  institution.course_enrollment_code_institution_fill() FROM PUBLIC;
CREATE TRIGGER assignment_version_institution_fill BEFORE INSERT ON institution.assignment_version
  FOR EACH ROW EXECUTE FUNCTION institution.assignment_version_institution_fill();
CREATE TRIGGER course_enrollment_code_institution_fill BEFORE INSERT ON institution.course_enrollment_code
  FOR EACH ROW EXECUTE FUNCTION institution.course_enrollment_code_institution_fill();

-- The request and the submission name the version with its institution.
GRANT REFERENCES ON institution.assignment_version TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;
ALTER TABLE evidence.submission_request
  -- squawk-ignore ban-drop-constraint
  DROP CONSTRAINT submission_request_assignment_id_assignment_version_fkey,
  -- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
  ADD CONSTRAINT submission_request_version_institution_fkey
    FOREIGN KEY (assignment_id, assignment_version, institution_id)
    REFERENCES institution.assignment_version (assignment_id, version_no, institution_id);
ALTER TABLE evidence.submission
  -- squawk-ignore ban-drop-constraint
  DROP CONSTRAINT submission_assignment_id_assignment_version_due_at_fkey,
  -- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
  ADD CONSTRAINT submission_version_institution_fkey
    FOREIGN KEY (assignment_id, assignment_version, due_at, institution_id)
    REFERENCES institution.assignment_version (assignment_id, version_no, due_at, institution_id);

-- Signing key: it already carries the institution; the issuance names the
-- key with it.
ALTER TABLE evidence.signing_key
  -- squawk-ignore constraint-missing-not-valid, disallowed-unique-constraint
  ADD CONSTRAINT signing_key_key_id_institution_key UNIQUE (key_id, institution_id);
ALTER TABLE evidence.submission_receipt_issuance
  -- squawk-ignore ban-drop-constraint
  DROP CONSTRAINT submission_receipt_issuance_key_id_fkey,
  -- squawk-ignore constraint-missing-not-valid, adding-foreign-key-constraint
  ADD CONSTRAINT submission_receipt_issuance_key_institution_fkey
    FOREIGN KEY (key_id, institution_id) REFERENCES evidence.signing_key (key_id, institution_id);

SET LOCAL ROLE ductus_identity;
REVOKE REFERENCES ON institution.assignment_version FROM ductus_evidence;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA evidence FROM ductus_evidence;
REVOKE USAGE ON SCHEMA institution FROM ductus_evidence;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
GRANT USAGE ON SCHEMA institution TO ductus_evidence;
SET LOCAL ROLE ductus_identity;
GRANT REFERENCES ON institution.assignment_version TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;
ALTER TABLE evidence.submission_receipt_issuance
  DROP CONSTRAINT submission_receipt_issuance_key_institution_fkey,
  ADD CONSTRAINT submission_receipt_issuance_key_id_fkey
    FOREIGN KEY (key_id) REFERENCES evidence.signing_key (key_id);
ALTER TABLE evidence.signing_key DROP CONSTRAINT signing_key_key_id_institution_key;
ALTER TABLE evidence.submission
  DROP CONSTRAINT submission_version_institution_fkey,
  ADD CONSTRAINT submission_assignment_id_assignment_version_due_at_fkey
    FOREIGN KEY (assignment_id, assignment_version, due_at)
    REFERENCES institution.assignment_version (assignment_id, version_no, due_at);
ALTER TABLE evidence.submission_request
  DROP CONSTRAINT submission_request_version_institution_fkey,
  ADD CONSTRAINT submission_request_assignment_id_assignment_version_fkey
    FOREIGN KEY (assignment_id, assignment_version)
    REFERENCES institution.assignment_version (assignment_id, version_no);
SET LOCAL ROLE ductus_identity;
REVOKE REFERENCES ON institution.assignment_version FROM ductus_evidence;

DROP TRIGGER course_enrollment_code_institution_fill ON institution.course_enrollment_code;
DROP TRIGGER assignment_version_institution_fill ON institution.assignment_version;
DROP FUNCTION institution.course_enrollment_code_institution_fill();
DROP FUNCTION institution.assignment_version_institution_fill();

ALTER TABLE audit.enrollment_code_event
  DROP CONSTRAINT enrollment_code_event_code_institution_fkey,
  ADD CONSTRAINT enrollment_code_event_code_id_fkey
    FOREIGN KEY (code_id) REFERENCES institution.course_enrollment_code (id);
ALTER TABLE institution.course_enrollment_code
  DROP CONSTRAINT course_enrollment_code_created_by_institution_fkey,
  ADD CONSTRAINT course_enrollment_code_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES identity.user_account (id),
  DROP CONSTRAINT course_enrollment_code_course_institution_fkey,
  ADD CONSTRAINT course_enrollment_code_course_id_fkey
    FOREIGN KEY (course_id) REFERENCES institution.course (id),
  DROP CONSTRAINT course_enrollment_code_id_institution_key,
  DROP COLUMN institution_id;

ALTER TABLE institution.notice_acknowledgment
  DROP CONSTRAINT notice_acknowledgment_version_institution_fkey,
  ADD CONSTRAINT notice_acknowledgment_assignment_id_version_no_fkey
    FOREIGN KEY (assignment_id, version_no) REFERENCES institution.assignment_version (assignment_id, version_no);
ALTER TABLE institution.assignment
  DROP CONSTRAINT assignment_current_version_institution_fkey,
  ADD CONSTRAINT assignment_current_version_fkey
    FOREIGN KEY (id, current_version) REFERENCES institution.assignment_version (assignment_id, version_no)
    DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE institution.assignment_version
  DROP CONSTRAINT assignment_version_created_by_institution_fkey,
  ADD CONSTRAINT assignment_version_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES identity.user_account (id),
  DROP CONSTRAINT assignment_version_assignment_institution_fkey,
  ADD CONSTRAINT assignment_version_assignment_id_fkey
    FOREIGN KEY (assignment_id) REFERENCES institution.assignment (id),
  DROP CONSTRAINT assignment_version_due_institution_key,
  DROP CONSTRAINT assignment_version_id_institution_key,
  DROP COLUMN institution_id;
SET LOCAL ROLE ductus_migrator;
REVOKE USAGE ON SCHEMA institution FROM ductus_evidence;

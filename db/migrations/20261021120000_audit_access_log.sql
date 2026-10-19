-- DAN-228, step 1: the access log of a student's work (docs/PRODUCT.md 5,
-- rule 17; contract in the PR description). One row says that a reader other
-- than the owning student opened the work through one named surface, to the
-- minute. This step adds only the table, its RLS and its append-only guard:
-- nothing writes a row yet and nothing reads one. Writing comes with the read
-- functions of the surfaces (step 2), reading for the student with step 3.
-- The table holds no text of the work, no session, no address and no device.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
CREATE SCHEMA audit;
-- The identity role owns the table and, from step 2, the functions that write
-- it from inside the read functions it already owns. The web role gets no
-- USAGE here: in this step it has nothing to call in the schema.
GRANT USAGE ON SCHEMA audit TO ductus_identity;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA audit TO ductus_identity;

SET LOCAL ROLE ductus_identity;

-- Any change of a stored row, its removal or emptying the table is refused,
-- for the owner too. Deleting rows by their retention rule arrives with the
-- retention job and changes this guard in its own migration.
CREATE FUNCTION audit.reject_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'append-only row' USING ERRCODE = 'ZD403';
END
$$;

-- No foreign key to evidence.document, as for comments and the live view
-- (docs/BACKEND.md 4.11, 4.12): the scope of the document is copied in when
-- the row is written. The reader is a person of the same institution and
-- never the owning student. The surface is a closed list; a new surface (the
-- replay of D-143, a teacher's reading of a submission, the checkpoint read
-- of 4.10) widens it in the migration that adds the surface.
CREATE TABLE audit.access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  document_id text NOT NULL CHECK (length(document_id) BETWEEN 1 AND 256),
  assignment_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  reader_id uuid NOT NULL,
  reader_role text NOT NULL CHECK (reader_role IN ('teacher')),
  surface text NOT NULL CHECK (surface IN ('live_view', 'process_summary')),
  opened_at timestamptz NOT NULL
    CHECK (opened_at = date_bin('1 minute', opened_at, timestamptz '2000-01-01 00:00:00+00')),
  CHECK (reader_id <> owner_id),
  FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment (id, institution_id),
  FOREIGN KEY (owner_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (reader_id, institution_id) REFERENCES identity.user_account (id, institution_id)
);
CREATE INDEX access_log_document_idx ON audit.access_log (document_id, institution_id, opened_at);

CREATE TRIGGER access_log_append_only BEFORE UPDATE OR DELETE ON audit.access_log
  FOR EACH ROW EXECUTE FUNCTION audit.reject_change();
CREATE TRIGGER access_log_no_truncate BEFORE TRUNCATE ON audit.access_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_change();

-- Forced RLS with only the owner's policy. No other role has any privilege on
-- the table; a row is written only from inside a read function the owner
-- role owns, and read only through a function, never directly (CLAUDE.md:
-- the client never writes the audit trail).
ALTER TABLE audit.access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.access_log FORCE ROW LEVEL SECURITY;
CREATE POLICY access_log_owner ON audit.access_log TO ductus_identity USING (true) WITH CHECK (true);

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA audit FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
DROP SCHEMA audit CASCADE;

-- Tenant-scoped evidence tables for DAN-189 / B-8 (D-103).
-- This step establishes metadata relationships and read isolation only; the
-- atomic acceptance RPC and payload storage adapters are separate steps.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
CREATE SCHEMA evidence;
GRANT USAGE, CREATE ON SCHEMA evidence TO ductus_identity, ductus_evidence;
GRANT USAGE ON SCHEMA evidence TO ductus_app;
GRANT ductus_evidence TO ductus_identity WITH INHERIT FALSE, SET TRUE;

SET LOCAL ROLE ductus_identity;

-- The domain id is signed into receipt v2 as evidenceDomainId: a lowercase
-- canonical UUID version 4 (docs/BACKEND.md 4.1), so the table holds no other.
CREATE TABLE evidence.domain (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  institution_id uuid NOT NULL REFERENCES identity.institution (id),
  region text NOT NULL CHECK (region ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, institution_id),
  UNIQUE (institution_id, region)
);

-- A demo project belongs to one student on one assignment. Mentorship-backed
-- projects remain a later extension because the current demo schema has no
-- mentorship table yet.
CREATE TABLE evidence.project (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256 AND id = btrim(id) AND id !~ '[[:cntrl:]]'),
  institution_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, institution_id),
  UNIQUE (id, institution_id, principal_id),
  FOREIGN KEY (assignment_id, institution_id)
    REFERENCES institution.assignment (id, institution_id),
  FOREIGN KEY (principal_id, institution_id)
    REFERENCES identity.user_account (id, institution_id)
);

CREATE TABLE evidence.document (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256 AND id = btrim(id) AND id !~ '[[:cntrl:]]'),
  institution_id uuid NOT NULL,
  project_id text NOT NULL,
  principal_id uuid NOT NULL,
  current_revision bigint NOT NULL DEFAULT 0
    CHECK (current_revision BETWEEN 0 AND 9007199254740991),
  current_content_hash text NOT NULL CHECK (current_content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, institution_id),
  UNIQUE (id, institution_id, principal_id),
  UNIQUE (id, institution_id, project_id, principal_id),
  UNIQUE (id, institution_id, current_revision, current_content_hash),
  FOREIGN KEY (project_id, institution_id, principal_id)
    REFERENCES evidence.project (id, institution_id, principal_id)
);

CREATE TABLE evidence.document_revision (
  document_id text NOT NULL,
  institution_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
  base_revision bigint,
  principal_id uuid NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, institution_id, revision),
  UNIQUE (document_id, institution_id, revision, content_hash),
  FOREIGN KEY (document_id, institution_id, principal_id)
    REFERENCES evidence.document (id, institution_id, principal_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (document_id, institution_id, base_revision)
    REFERENCES evidence.document_revision (document_id, institution_id, revision)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (principal_id, institution_id)
    REFERENCES identity.user_account (id, institution_id),
  CHECK ((revision = 0 AND base_revision IS NULL)
      OR (revision > 0 AND base_revision IS NOT NULL AND base_revision = revision - 1))
);

-- A document pointer cannot name a revision that has not been committed.
ALTER TABLE evidence.document
  ADD CONSTRAINT evidence_document_current_revision_fkey
  FOREIGN KEY (id, institution_id, current_revision, current_content_hash)
  REFERENCES evidence.document_revision (document_id, institution_id, revision, content_hash)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE evidence.package (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9_-]{0,127}$'),
  institution_id uuid NOT NULL,
  evidence_domain_id uuid NOT NULL,
  document_id text NOT NULL,
  project_id text NOT NULL,
  principal_id uuid NOT NULL,
  evidence_profile_id text NOT NULL CHECK (length(evidence_profile_id) BETWEEN 1 AND 120),
  max_payload_bytes integer NOT NULL CHECK (max_payload_bytes BETWEEN 1 AND 2097152),
  accepts_evidence boolean NOT NULL DEFAULT true,
  head_segment_hash text CHECK (head_segment_hash ~ '^[0-9a-f]{64}$'),
  head_receipt_id uuid,
  last_sequence_to bigint NOT NULL DEFAULT 0 CHECK (last_sequence_to BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, institution_id),
  UNIQUE (id, institution_id, evidence_domain_id),
  UNIQUE (id, institution_id, document_id, principal_id),
  FOREIGN KEY (evidence_domain_id, institution_id)
    REFERENCES evidence.domain (id, institution_id),
  FOREIGN KEY (document_id, institution_id, project_id, principal_id)
    REFERENCES evidence.document (id, institution_id, project_id, principal_id),
  CHECK ((head_receipt_id IS NULL) = (head_segment_hash IS NULL)),
  CHECK ((head_receipt_id IS NULL) = (last_sequence_to = 0))
);

CREATE TABLE evidence.segment (
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 256 AND id = btrim(id) AND id !~ '[[:cntrl:]]'),
  evidence_package_id text NOT NULL,
  institution_id uuid NOT NULL,
  document_id text NOT NULL,
  principal_id uuid NOT NULL,
  session_id text NOT NULL CHECK (length(session_id) BETWEEN 1 AND 256 AND session_id = btrim(session_id) AND session_id !~ '[[:cntrl:]]'),
  sequence_from bigint NOT NULL CHECK (sequence_from BETWEEN 1 AND 9007199254740991),
  sequence_to bigint NOT NULL CHECK (sequence_to BETWEEN sequence_from AND 9007199254740991),
  event_count integer NOT NULL CHECK (event_count BETWEEN 1 AND 5000),
  descriptor jsonb NOT NULL CHECK (jsonb_typeof(descriptor) = 'object'),
  segment_hash text NOT NULL CHECK (segment_hash ~ '^[0-9a-f]{64}$'),
  payload_bytes integer NOT NULL CHECK (payload_bytes BETWEEN 1 AND 2097152),
  storage_ref text NOT NULL CHECK (length(storage_ref) BETWEEN 1 AND 2048 AND storage_ref !~ '[[:cntrl:]]'),
  accepted_at timestamptz NOT NULL,
  PRIMARY KEY (id, evidence_package_id, institution_id),
  UNIQUE (id, evidence_package_id, institution_id, principal_id),
  UNIQUE (evidence_package_id, institution_id, sequence_from),
  FOREIGN KEY (evidence_package_id, institution_id, document_id, principal_id)
    REFERENCES evidence.package (id, institution_id, document_id, principal_id),
  FOREIGN KEY (principal_id, institution_id)
    REFERENCES identity.user_account (id, institution_id),
  CHECK (sequence_to - sequence_from = event_count - 1),
  CHECK ((descriptor->>'segmentHash') IS NOT DISTINCT FROM segment_hash),
  CHECK ((descriptor->>'payloadBytes') IS NOT DISTINCT FROM payload_bytes::text)
);

CREATE TABLE evidence.receipt (
  id uuid PRIMARY KEY,
  evidence_package_id text NOT NULL,
  institution_id uuid NOT NULL,
  evidence_domain_id uuid NOT NULL,
  segment_id text NOT NULL,
  principal_id uuid NOT NULL,
  client_request_id text NOT NULL CHECK (length(client_request_id) BETWEEN 1 AND 128 AND client_request_id !~ '[[:cntrl:]]'),
  previous_receipt_id uuid,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  descriptor jsonb NOT NULL CHECK (jsonb_typeof(descriptor) = 'object'),
  receipt_payload text NOT NULL CHECK (receipt_payload <> ''),
  status text NOT NULL CHECK (status IN ('pending_signature', 'signed')),
  signature jsonb,
  key_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, evidence_package_id, institution_id),
  UNIQUE (evidence_package_id, institution_id, principal_id, client_request_id),
  FOREIGN KEY (evidence_package_id, institution_id, evidence_domain_id)
    REFERENCES evidence.package (id, institution_id, evidence_domain_id),
  FOREIGN KEY (segment_id, evidence_package_id, institution_id, principal_id)
    REFERENCES evidence.segment (id, evidence_package_id, institution_id, principal_id),
  FOREIGN KEY (principal_id, institution_id)
    REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (previous_receipt_id, evidence_package_id, institution_id)
    REFERENCES evidence.receipt (id, evidence_package_id, institution_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK ((status = 'pending_signature' AND signature IS NULL AND key_id IS NULL)
      OR (status = 'signed' AND signature IS NOT NULL AND key_id IS NOT NULL))
);

ALTER TABLE evidence.package
  ADD CONSTRAINT evidence_package_head_receipt_fkey
  FOREIGN KEY (head_receipt_id, id, institution_id)
  REFERENCES evidence.receipt (id, evidence_package_id, institution_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX evidence_project_assignment_idx ON evidence.project (assignment_id, institution_id);
CREATE INDEX evidence_document_project_idx ON evidence.document (project_id, institution_id);
CREATE INDEX evidence_revision_principal_idx ON evidence.document_revision (principal_id, institution_id, document_id);
CREATE INDEX evidence_package_document_idx ON evidence.package (document_id, institution_id);
CREATE INDEX evidence_segment_principal_idx ON evidence.segment (principal_id, institution_id, evidence_package_id);
CREATE INDEX evidence_receipt_principal_idx ON evidence.receipt (principal_id, institution_id, evidence_package_id);

-- All application tables are forced-RLS. The NOLOGIN table owner acts only
-- inside narrow SECURITY DEFINER entrypoints. The app sees only its own
-- institution and student rows and still receives no DML grants.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['domain', 'project', 'document', 'document_revision', 'package', 'segment', 'receipt'] LOOP
    EXECUTE format('ALTER TABLE evidence.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE evidence.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON evidence.%I TO ductus_evidence USING (true) WITH CHECK (true)',
      'evidence_' || t || '_owner', t
    );
  END LOOP;
END
$$;

CREATE POLICY evidence_domain_read ON evidence.domain FOR SELECT TO ductus_app
  USING (institution_id = (SELECT app.current_institution_id()));
CREATE POLICY evidence_project_read ON evidence.project FOR SELECT TO ductus_app
  USING (institution_id = (SELECT app.current_institution_id()) AND principal_id = (SELECT app.current_user_id()));
CREATE POLICY evidence_document_read ON evidence.document FOR SELECT TO ductus_app
  USING (institution_id = (SELECT app.current_institution_id()) AND principal_id = (SELECT app.current_user_id()));
CREATE POLICY evidence_revision_read ON evidence.document_revision FOR SELECT TO ductus_app
  USING (institution_id = (SELECT app.current_institution_id()) AND principal_id = (SELECT app.current_user_id()));
CREATE POLICY evidence_package_read ON evidence.package FOR SELECT TO ductus_app
  USING (institution_id = (SELECT app.current_institution_id()) AND principal_id = (SELECT app.current_user_id()));
CREATE POLICY evidence_segment_read ON evidence.segment FOR SELECT TO ductus_app
  USING (institution_id = (SELECT app.current_institution_id()) AND principal_id = (SELECT app.current_user_id()));
CREATE POLICY evidence_receipt_read ON evidence.receipt FOR SELECT TO ductus_app
  USING (institution_id = (SELECT app.current_institution_id()) AND principal_id = (SELECT app.current_user_id()));

GRANT SELECT ON evidence.domain, evidence.project, evidence.document, evidence.document_revision,
  evidence.package, evidence.segment, evidence.receipt TO ductus_app;

-- identity owns the parent tables, so it creates the composite foreign keys
-- without granting ductus_evidence any rights in identity.* or institution.*.
-- Move the completed tables to their dedicated NOLOGIN owner before defining
-- the RPC and its private helpers.
ALTER TABLE evidence.domain OWNER TO ductus_evidence;
ALTER TABLE evidence.project OWNER TO ductus_evidence;
ALTER TABLE evidence.document OWNER TO ductus_evidence;
ALTER TABLE evidence.document_revision OWNER TO ductus_evidence;
ALTER TABLE evidence.package OWNER TO ductus_evidence;
ALTER TABLE evidence.segment OWNER TO ductus_evidence;
ALTER TABLE evidence.receipt OWNER TO ductus_evidence;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE ductus_evidence FROM ductus_identity;
REVOKE CREATE ON SCHEMA evidence FROM ductus_identity, ductus_evidence;
REVOKE USAGE ON SCHEMA evidence FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
DROP SCHEMA evidence CASCADE;
REVOKE ductus_evidence FROM ductus_identity;


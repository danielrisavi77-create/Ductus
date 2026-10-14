-- Evidence tables and the one atomic document-revision + reserve RPC (DAN-189).
-- The HTTP and object-storage adapters are later work. This migration stores
-- only metadata and the immutable receipt payload; it never connects to S3.
--
-- Tenant identity is copied from a parent/session, never a function argument.
-- Every cross-tenant relationship carries institution_id and has no cascade.
-- The web role may read its own rows and invoke one narrow app-schema wrapper;
-- it has no direct DML and no EXECUTE on functions in evidence.*.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
CREATE SCHEMA evidence;
GRANT USAGE, CREATE ON SCHEMA evidence TO ductus_identity, ductus_evidence;
GRANT CREATE ON SCHEMA app TO ductus_identity, ductus_evidence;
GRANT USAGE ON SCHEMA app TO ductus_evidence;
GRANT ductus_evidence TO ductus_identity WITH INHERIT FALSE, SET TRUE;

SET LOCAL ROLE ductus_identity;
-- Keep assignment authorization behind an identity-owned helper. The
-- evidence owner receives no USAGE or EXECUTE rights on institution.*.
CREATE FUNCTION app.current_assignment_role(p_assignment_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT institution.actor_assignment_role(p_assignment_id) $$;
GRANT EXECUTE ON FUNCTION app.current_actor() TO ductus_evidence;
GRANT EXECUTE ON FUNCTION app.current_assignment_role(uuid) TO ductus_evidence;

CREATE TABLE evidence.domain (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  UNIQUE (id, institution_id, current_revision),
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
  FOREIGN KEY (document_id, institution_id, principal_id)
    REFERENCES evidence.document (id, institution_id, principal_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (document_id, institution_id, base_revision)
    REFERENCES evidence.document_revision (document_id, institution_id, revision)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (principal_id, institution_id)
    REFERENCES identity.user_account (id, institution_id),
  CHECK ((revision = 0 AND base_revision IS NULL) OR (revision > 0 AND base_revision = revision - 1))
);

-- A document pointer cannot name a revision that has not been committed.
ALTER TABLE evidence.document
  ADD CONSTRAINT evidence_document_current_revision_fkey
  FOREIGN KEY (id, institution_id, current_revision)
  REFERENCES evidence.document_revision (document_id, institution_id, revision)
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
  FOREIGN KEY (evidence_domain_id, institution_id)
    REFERENCES evidence.domain (id, institution_id),
  FOREIGN KEY (document_id, institution_id, principal_id)
    REFERENCES evidence.document (id, institution_id, principal_id),
  FOREIGN KEY (project_id, institution_id, principal_id)
    REFERENCES evidence.project (id, institution_id, principal_id),
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
  UNIQUE (evidence_package_id, institution_id, sequence_from),
  FOREIGN KEY (evidence_package_id, institution_id)
    REFERENCES evidence.package (id, institution_id),
  FOREIGN KEY (document_id, institution_id, principal_id)
    REFERENCES evidence.document (id, institution_id, principal_id),
  FOREIGN KEY (principal_id, institution_id)
    REFERENCES identity.user_account (id, institution_id),
  CHECK (sequence_to - sequence_from = event_count - 1),
  CHECK (descriptor->>'segmentHash' = segment_hash),
  CHECK (descriptor->>'payloadBytes' = payload_bytes::text)
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
  FOREIGN KEY (segment_id, evidence_package_id, institution_id)
    REFERENCES evidence.segment (id, evidence_package_id, institution_id),
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
SET LOCAL ROLE ductus_evidence;

-- The v2 receipt is flat and contains only strings, integers and nulls. This
-- serializer sorts ASCII field names bytewise (the RFC 8785 order for these
-- fixed ASCII names) and uses PostgreSQL's JSON string escaping. No arbitrary
-- nested value or floating-point number can enter this payload.
CREATE FUNCTION evidence.canonical_receipt_v2(p_payload jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  v_result text;
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

-- One entrypoint for the web role. Identity and institution are always read
-- from current_actor(); the descriptor is validated upstream and its hash is
-- independently compared with the byte hash before anything is reserved.
CREATE FUNCTION app.commit_evidence_segment(
  p_evidence_package_id text,
  p_client_request_id text,
  p_expected_revision bigint,
  p_initial_document_hash text,
  p_final_document_hash text,
  p_descriptor jsonb,
  p_payload_sha256 text,
  p_storage_ref text
) RETURNS TABLE (
  outcome text,
  committed_revision bigint,
  receipt_payload text,
  receipt_id uuid,
  expected_previous_segment_hash text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor record;
  v_package evidence.package%ROWTYPE;
  v_project evidence.project%ROWTYPE;
  v_document evidence.document%ROWTYPE;
  v_existing evidence.receipt%ROWTYPE;
  v_previous_receipt uuid;
  v_new_receipt uuid;
  v_revision bigint;
  v_now timestamptz;
  v_accepted_at text;
  v_started timestamptz;
  v_ended timestamptz;
  v_receipt jsonb;
  v_receipt_text text;
  v_sequence_from bigint;
  v_sequence_to bigint;
  v_event_count integer;
  v_payload_bytes integer;
  v_previous_hash text;
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF pg_catalog.jsonb_typeof(p_descriptor) IS DISTINCT FROM 'object' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- Exact descriptor shape and bounds. Full JCS payload validation stays in
  -- the gateway; this RPC refuses a hash that does not match the descriptor.
  IF p_evidence_package_id IS NULL OR p_evidence_package_id !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
     OR p_client_request_id IS NULL
     OR pg_catalog.btrim(p_client_request_id,
          ' ' || pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(11) || pg_catalog.chr(12) || pg_catalog.chr(13)
          || pg_catalog.chr(160) || pg_catalog.chr(5760) || pg_catalog.chr(8192) || pg_catalog.chr(8193)
          || pg_catalog.chr(8194) || pg_catalog.chr(8195) || pg_catalog.chr(8196) || pg_catalog.chr(8197)
          || pg_catalog.chr(8198) || pg_catalog.chr(8199) || pg_catalog.chr(8200) || pg_catalog.chr(8201)
          || pg_catalog.chr(8202) || pg_catalog.chr(8232) || pg_catalog.chr(8233) || pg_catalog.chr(8239)
          || pg_catalog.chr(8287) || pg_catalog.chr(12288) || pg_catalog.chr(65279)) = ''
     OR p_client_request_id ~ '[[:cntrl:]]'
     OR length(p_client_request_id) + (
       SELECT count(*)
       FROM pg_catalog.regexp_split_to_table(p_client_request_id, '') AS codepoint(value)
       WHERE pg_catalog.octet_length(pg_catalog.convert_to(value, 'UTF8')) = 4
     ) > 128
     OR p_expected_revision IS NULL OR p_expected_revision < 0 OR p_expected_revision >= 9007199254740991
     OR p_initial_document_hash IS NULL OR p_initial_document_hash !~ '^[0-9a-f]{64}$'
     OR p_final_document_hash IS NULL OR p_final_document_hash !~ '^[0-9a-f]{64}$'
     OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[0-9a-f]{64}$'
     OR p_storage_ref IS NULL OR length(p_storage_ref) NOT BETWEEN 1 AND 2048 OR p_storage_ref ~ '[[:cntrl:]]'
     OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(p_descriptor)) <> 16
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
       ) AS required(key)
       WHERE NOT (p_descriptor ? required.key)
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
    RETURN QUERY SELECT 'invalid'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF length(p_descriptor->>'evidencePackageId') NOT BETWEEN 1 AND 128
     OR p_descriptor->>'evidencePackageId' !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
     OR length(p_descriptor->>'documentId') NOT BETWEEN 1 AND 256
     OR p_descriptor->>'documentId' <> btrim(p_descriptor->>'documentId')
     OR p_descriptor->>'documentId' ~ '[[:cntrl:]]'
     OR length(p_descriptor->>'sessionId') NOT BETWEEN 1 AND 256
     OR p_descriptor->>'sessionId' <> btrim(p_descriptor->>'sessionId')
     OR p_descriptor->>'sessionId' ~ '[[:cntrl:]]'
     OR length(p_descriptor->>'segmentId') NOT BETWEEN 1 AND 256
     OR p_descriptor->>'segmentId' <> btrim(p_descriptor->>'segmentId')
     OR p_descriptor->>'segmentId' ~ '[[:cntrl:]]'
     OR p_descriptor->>'evidenceSchema' <> 'ductus-evidence-segment-v2'
     OR p_descriptor->>'canonicalization' <> 'RFC8785-JCS'
     OR p_descriptor->>'hashAlgorithm' <> 'sha256'
     OR length(p_descriptor->>'evidenceProfileId') NOT BETWEEN 1 AND 120
     OR p_descriptor->>'evidenceProfileId' <> btrim(p_descriptor->>'evidenceProfileId')
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
     OR p_descriptor->>'observedStartedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$'
     OR p_descriptor->>'observedEndedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  BEGIN
    v_started := (p_descriptor->>'observedStartedAt')::timestamptz;
    v_ended := (p_descriptor->>'observedEndedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END;
  IF pg_catalog.to_char(v_started AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:00.000"Z"') <> p_descriptor->>'observedStartedAt'
     OR pg_catalog.to_char(v_ended AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:00.000"Z"') <> p_descriptor->>'observedEndedAt'
     OR v_ended < v_started THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  v_sequence_from := (p_descriptor->>'sequenceFrom')::bigint;
  v_sequence_to := (p_descriptor->>'sequenceTo')::bigint;
  v_event_count := (p_descriptor->>'eventCount')::integer;
  v_payload_bytes := (p_descriptor->>'payloadBytes')::integer;

  -- The app is authorized for this specific student assignment before any
  -- idempotency lookup. Both rows are locked in a fixed order to serialize
  -- concurrent reserves and avoid replaying a request after ownership changes.
  SELECT p.* INTO v_package
    FROM evidence.package p
   WHERE p.id = p_evidence_package_id AND p.institution_id = v_actor.institution_id
     AND p.principal_id = v_actor.user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  SELECT pr.* INTO v_project
    FROM evidence.project pr
   WHERE pr.id = v_package.project_id AND pr.institution_id = v_package.institution_id;
  IF NOT FOUND OR v_project.principal_id <> v_actor.user_id
     OR app.current_assignment_role(v_project.assignment_id) IS DISTINCT FROM 'student' THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF p_descriptor->>'evidencePackageId' <> v_package.id
     OR p_descriptor->>'documentId' <> v_package.document_id
     OR p_descriptor->>'evidenceProfileId' <> v_package.evidence_profile_id THEN
    RETURN QUERY SELECT 'context_mismatch'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT d.* INTO v_document
    FROM evidence.document d
   WHERE d.id = v_package.document_id AND d.institution_id = v_package.institution_id
     AND d.principal_id = v_actor.user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT r.* INTO v_existing
    FROM evidence.receipt r
   WHERE r.evidence_package_id = v_package.id
     AND r.institution_id = v_package.institution_id
     AND r.principal_id = v_actor.user_id
     AND r.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_existing.descriptor <> p_descriptor THEN
      RETURN QUERY SELECT 'idempotency_conflict'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    ELSIF v_existing.payload_sha256 <> p_payload_sha256 OR v_existing.segment_id <> p_descriptor->>'segmentId'
          OR v_existing.evidence_package_id <> p_evidence_package_id THEN
      RETURN QUERY SELECT 'invalid'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    ELSE
      RETURN QUERY SELECT
        CASE v_existing.status WHEN 'signed' THEN 'duplicate_signed' ELSE 'duplicate_pending' END,
        (v_existing.receipt_payload::jsonb->>'revision')::bigint,
        v_existing.receipt_payload,
        v_existing.id,
        NULL::text;
    END IF;
    RETURN;
  END IF;

  IF NOT v_package.accepts_evidence THEN
    RETURN QUERY SELECT 'not_accepting'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF v_payload_bytes > v_package.max_payload_bytes THEN
    RETURN QUERY SELECT 'too_large'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF v_document.current_revision <> p_expected_revision
     OR v_document.current_content_hash <> p_initial_document_hash THEN
    RETURN QUERY SELECT 'concurrent_conflict'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF v_sequence_from <> v_package.last_sequence_to + 1
     OR p_descriptor->>'predecessorSegmentHash' IS DISTINCT FROM v_package.head_segment_hash THEN
    RETURN QUERY SELECT 'chain_conflict'::text, NULL::bigint, NULL::text, NULL::uuid, v_package.head_segment_hash;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM evidence.segment s
     WHERE s.evidence_package_id = v_package.id AND s.institution_id = v_package.institution_id
       AND s.id = p_descriptor->>'segmentId'
  ) THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  v_revision := v_document.current_revision + 1;
  v_previous_receipt := v_package.head_receipt_id;
  v_new_receipt := gen_random_uuid();
  v_now := clock_timestamp();
  v_accepted_at := pg_catalog.to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:00.000"Z"');

  UPDATE evidence.document
     SET current_revision = v_revision, current_content_hash = p_final_document_hash
   WHERE id = v_document.id AND institution_id = v_document.institution_id
     AND current_revision = p_expected_revision AND current_content_hash = p_initial_document_hash;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'concurrent_conflict'::text, NULL::bigint, NULL::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  INSERT INTO evidence.document_revision (
    document_id, institution_id, revision, base_revision, principal_id, content_hash, created_at
  ) VALUES (
    v_document.id, v_document.institution_id, v_revision, p_expected_revision,
    v_actor.user_id, p_final_document_hash, v_now
  );

  INSERT INTO evidence.segment (
    id, evidence_package_id, institution_id, document_id, principal_id, session_id,
    sequence_from, sequence_to, event_count, descriptor, segment_hash, payload_bytes,
    storage_ref, accepted_at
  ) VALUES (
    p_descriptor->>'segmentId', v_package.id, v_package.institution_id, v_document.id,
    v_actor.user_id, p_descriptor->>'sessionId', v_sequence_from, v_sequence_to,
    v_event_count, p_descriptor, p_payload_sha256, v_payload_bytes, p_storage_ref, v_now
  );

  v_receipt := pg_catalog.jsonb_build_object(
    'receiptSchema', 'ductus-evidence-receipt-v2',
    'receiptId', v_new_receipt::text,
    'evidencePackageId', v_package.id,
    'documentId', v_document.id,
    'sessionId', p_descriptor->>'sessionId',
    'segmentId', p_descriptor->>'segmentId',
    'segmentHash', p_payload_sha256,
    'predecessorSegmentHash', CASE WHEN v_package.head_segment_hash IS NULL THEN NULL::text ELSE v_package.head_segment_hash END,
    'previousReceiptId', v_previous_receipt::text,
    'evidenceSchema', 'ductus-evidence-segment-v2',
    'evidenceProfileId', v_package.evidence_profile_id,
    'sequenceFrom', v_sequence_from,
    'sequenceTo', v_sequence_to,
    'eventCount', v_event_count,
    'payloadBytes', v_payload_bytes,
    'acceptedAt', v_accepted_at,
    'revision', v_revision,
    'clientTransactionId', p_client_request_id,
    'evidenceDomainId', v_package.evidence_domain_id::text,
    'principalId', v_actor.user_id::text
  );
  v_receipt_text := evidence.canonical_receipt_v2(v_receipt);

  INSERT INTO evidence.receipt (
    id, evidence_package_id, institution_id, evidence_domain_id, segment_id, principal_id,
    client_request_id, previous_receipt_id, payload_sha256, descriptor, receipt_payload, status
  ) VALUES (
    v_new_receipt, v_package.id, v_package.institution_id, v_package.evidence_domain_id,
    p_descriptor->>'segmentId', v_actor.user_id, p_client_request_id, v_previous_receipt,
    p_payload_sha256, p_descriptor, v_receipt_text, 'pending_signature'
  );

  UPDATE evidence.package
     SET head_segment_hash = p_payload_sha256,
         head_receipt_id = v_new_receipt,
         last_sequence_to = v_sequence_to
   WHERE id = v_package.id AND institution_id = v_package.institution_id;

  RETURN QUERY SELECT 'reserved'::text, v_revision, v_receipt_text, v_new_receipt, NULL::text;
END
$$;

GRANT EXECUTE ON FUNCTION app.commit_evidence_segment(text, text, bigint, text, text, jsonb, text, text)
  TO ductus_app;

-- Work and revisions are append-only. Receipt signatures may be attached once
-- by a future narrow worker function, without altering the signed payload.
CREATE FUNCTION evidence.reject_append_only_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'append-only row' USING ERRCODE = 'ZD403';
END
$$;

CREATE TRIGGER evidence_revision_immutable BEFORE UPDATE OR DELETE ON evidence.document_revision
  FOR EACH ROW EXECUTE FUNCTION evidence.reject_append_only_change();
CREATE TRIGGER evidence_revision_no_truncate BEFORE TRUNCATE ON evidence.document_revision
  FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();
CREATE TRIGGER evidence_segment_immutable BEFORE UPDATE OR DELETE ON evidence.segment
  FOR EACH ROW EXECUTE FUNCTION evidence.reject_append_only_change();
CREATE TRIGGER evidence_segment_no_truncate BEFORE TRUNCATE ON evidence.segment
  FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();

CREATE FUNCTION evidence.guard_receipt_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'receipt is immutable' USING ERRCODE = 'ZD403';
  END IF;
  IF OLD.status = 'pending_signature' AND NEW.status = 'signed'
     AND NEW.id = OLD.id
     AND NEW.evidence_package_id = OLD.evidence_package_id
     AND NEW.institution_id = OLD.institution_id
     AND NEW.evidence_domain_id = OLD.evidence_domain_id
     AND NEW.segment_id = OLD.segment_id
     AND NEW.principal_id = OLD.principal_id
     AND NEW.client_request_id = OLD.client_request_id
     AND NEW.previous_receipt_id IS NOT DISTINCT FROM OLD.previous_receipt_id
     AND NEW.payload_sha256 = OLD.payload_sha256
     AND NEW.descriptor = OLD.descriptor
     AND NEW.receipt_payload = OLD.receipt_payload
     AND NEW.created_at = OLD.created_at
     AND NEW.signature IS NOT NULL AND NEW.key_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'receipt is immutable' USING ERRCODE = 'ZD403';
END
$$;
CREATE TRIGGER evidence_receipt_immutable BEFORE UPDATE OR DELETE ON evidence.receipt
  FOR EACH ROW EXECUTE FUNCTION evidence.guard_receipt_transition();
CREATE TRIGGER evidence_receipt_no_truncate BEFORE TRUNCATE ON evidence.receipt
  FOR EACH STATEMENT EXECUTE FUNCTION evidence.reject_append_only_change();

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity, ductus_evidence;
REVOKE CREATE ON SCHEMA evidence FROM ductus_identity, ductus_evidence;
REVOKE USAGE ON SCHEMA evidence FROM ductus_identity;
REVOKE ductus_evidence FROM ductus_identity;
GRANT USAGE ON SCHEMA evidence TO ductus_app;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
DO $$
BEGIN
  IF (SELECT nspowner FROM pg_namespace WHERE nspname = 'evidence') <> 'ductus_evidence'::regrole THEN
    EXECUTE format('GRANT CREATE ON DATABASE %I TO ductus_evidence', current_database());
    ALTER SCHEMA evidence OWNER TO ductus_evidence;
  END IF;
END
$$;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.commit_evidence_segment(text, text, bigint, text, text, jsonb, text, text);
DROP SCHEMA evidence CASCADE;
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_identity;
REVOKE EXECUTE ON FUNCTION app.current_actor() FROM ductus_evidence;
REVOKE EXECUTE ON FUNCTION institution.actor_assignment_role(uuid) FROM ductus_evidence;
DO $$
BEGIN
  IF to_regprocedure('app.current_assignment_role(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION app.current_assignment_role(uuid) FROM ductus_evidence';
    EXECUTE 'DROP FUNCTION app.current_assignment_role(uuid)';
  END IF;
END
$$;
REVOKE REFERENCES (id) ON identity.institution FROM ductus_evidence;
REVOKE REFERENCES (id, institution_id) ON identity.user_account FROM ductus_evidence;
REVOKE REFERENCES (id, institution_id) ON institution.assignment FROM ductus_evidence;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity, ductus_evidence;
REVOKE USAGE ON SCHEMA app, identity, institution FROM ductus_evidence;
REVOKE ductus_evidence FROM ductus_identity;
DO $$
BEGIN
  IF has_database_privilege('ductus_evidence', current_database(), 'CREATE') THEN
    EXECUTE format('REVOKE CREATE ON DATABASE %I FROM ductus_evidence', current_database());
  END IF;
END
$$;

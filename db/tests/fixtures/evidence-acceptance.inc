-- Shared synthetic rows and call helpers for DAN-189 RPC tests.
\ir institution.inc

-- A document in these tests is a stand-in text, such as repeat('d', 64); its
-- hash is the SHA-256 of those bytes, as the snapshot table requires.
CREATE FUNCTION pg_temp.sha(p_body text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_body, 'UTF8')), 'hex')
$$;
CREATE FUNCTION pg_temp.h(p_letter text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_temp.sha(repeat(p_letter, 64))
$$;

SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.domain (id, institution_id, region) VALUES
  ('00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), 'eu-central-1'),
  ('00000000-0000-4000-8000-0000000000d2', pg_temp.id('fak_b'), 'eu-central-1');
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES
  ('project-a', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('ana')),
  ('project-b', pg_temp.id('fak_b'), pg_temp.id('z3'), pg_temp.id('tomo'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash) VALUES
  ('doc-a', pg_temp.id('fak_a'), 'project-a', pg_temp.id('ana'), pg_temp.h('a')),
  ('doc-b', pg_temp.id('fak_b'), 'project-b', pg_temp.id('tomo'), pg_temp.h('c'));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash) VALUES
  ('doc-a', pg_temp.id('fak_a'), 0, pg_temp.id('ana'), pg_temp.h('a')),
  ('doc-b', pg_temp.id('fak_b'), 0, pg_temp.id('tomo'), pg_temp.h('c'));
INSERT INTO evidence.package (
  id, institution_id, evidence_domain_id, document_id, project_id, principal_id,
  evidence_profile_id, max_payload_bytes
) VALUES
  ('pkg-a', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1',
   'doc-a', 'project-a', pg_temp.id('ana'), 'standard-v1', 2097152),
  ('pkg-b', pg_temp.id('fak_b'), '00000000-0000-4000-8000-0000000000d2',
   'doc-b', 'project-b', pg_temp.id('tomo'), 'standard-v1', 2097152);
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS evidence.evidence_document_current_revision_fkey DEFERRED;
RESET ROLE;

CREATE FUNCTION pg_temp.descriptor(
  p_package text DEFAULT 'pkg-a', p_document text DEFAULT 'doc-a', p_segment text DEFAULT 'segment-a-1',
  p_sequence_from bigint DEFAULT 1, p_sequence_to bigint DEFAULT 1, p_event_count integer DEFAULT 1,
  p_hash text DEFAULT repeat('b',64), p_predecessor text DEFAULT NULL, p_bytes integer DEFAULT 123,
  p_session text DEFAULT 'capture-session-a'
) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'evidencePackageId', p_package, 'documentId', p_document, 'sessionId', p_session,
    'segmentId', p_segment, 'evidenceSchema', 'ductus-evidence-segment-v2',
    'canonicalization', 'RFC8785-JCS', 'hashAlgorithm', 'sha256',
    'evidenceProfileId', 'standard-v1', 'sequenceFrom', p_sequence_from,
    'sequenceTo', p_sequence_to, 'eventCount', p_event_count,
    'observedStartedAt', '2026-10-14T10:00:00.000Z',
    'observedEndedAt', '2026-10-14T10:00:00.000Z', 'segmentHash', p_hash,
    'predecessorSegmentHash', p_predecessor, 'payloadBytes', p_bytes
  )
$$;

-- p_initial and p_final are the document before and after the segment: the
-- call sends their hashes and p_final as the snapshot.
CREATE FUNCTION pg_temp.call(
  p_actor text, p_package text, p_request text, p_descriptor jsonb,
  p_revision bigint, p_initial text, p_final text, p_payload_hash text,
  p_column text DEFAULT 'outcome', p_storage_ref text DEFAULT NULL
) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    'SELECT %I FROM app.commit_evidence_segment(%L, %L, %s, %L, %L, %L::jsonb, %L, %L, %L)',
    p_column, p_package, p_request, p_revision, pg_temp.sha(p_initial), pg_temp.sha(p_final),
    p_descriptor::text, p_payload_hash, coalesce(p_storage_ref, 'synthetic://' || p_package || '/' || p_request),
    p_final
  ))
$$;

CREATE FUNCTION pg_temp.call_with_spoofed_user_id() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_outcome text;
BEGIN
  PERFORM pg_catalog.set_config('app.user_id', pg_temp.id('tomo')::text, true);
  v_outcome := pg_temp.call('ana', 'pkg-a', 'request-auth', pg_temp.descriptor(),
    0, repeat('a',64), repeat('d',64), repeat('b',64));
  PERFORM pg_catalog.set_config('app.user_id', '', true);
  RETURN v_outcome;
END
$$;

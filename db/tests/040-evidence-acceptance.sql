-- DAN-189 / attack plan #356: evidence tables, identity isolation, tenant
-- relations, narrow RPC ACL, atomic CAS+reserve, retry, rollback and RLS.
-- All rows and identifiers are synthetic. HTTP, S3 bytes and signatures are
-- deliberately outside this database test; byte identity remains covered by
-- the existing gateway tests before this RPC receives the digest.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';
SELECT no_plan();

-- Two tenants, each with a student assignment and document. Revision zero is
-- the explicitly supplied synthetic initial document state.
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.domain (id, institution_id, region) VALUES
  ('00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), 'eu-central-1'),
  ('00000000-0000-4000-8000-0000000000d2', pg_temp.id('fak_b'), 'eu-central-1');
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES
  ('project-a', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('ana')),
  ('project-b', pg_temp.id('fak_b'), pg_temp.id('z3'), pg_temp.id('tomo'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_revision, current_content_hash) VALUES
  ('doc-a', pg_temp.id('fak_a'), 'project-a', pg_temp.id('ana'), 0, repeat('a', 64)),
  ('doc-b', pg_temp.id('fak_b'), 'project-b', pg_temp.id('tomo'), 0, repeat('c', 64));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash) VALUES
  ('doc-a', pg_temp.id('fak_a'), 0, NULL, pg_temp.id('ana'), repeat('a', 64)),
  ('doc-b', pg_temp.id('fak_b'), 0, NULL, pg_temp.id('tomo'), repeat('c', 64));
INSERT INTO evidence.package (
  id, institution_id, evidence_domain_id, document_id, project_id, principal_id,
  evidence_profile_id, max_payload_bytes
) VALUES
  ('pkg-a', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1', 'doc-a', 'project-a', pg_temp.id('ana'), 'standard-v1', 2097152),
  ('pkg-b', pg_temp.id('fak_b'), '00000000-0000-4000-8000-0000000000d2', 'doc-b', 'project-b', pg_temp.id('tomo'), 'standard-v1', 2097152);
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS evidence.evidence_document_current_revision_fkey DEFERRED;
RESET ROLE;

CREATE FUNCTION pg_temp.descriptor(
  p_package text DEFAULT 'pkg-a', p_document text DEFAULT 'doc-a', p_segment text DEFAULT 'segment-a-1',
  p_sequence_from bigint DEFAULT 1, p_sequence_to bigint DEFAULT 1, p_event_count integer DEFAULT 1,
  p_hash text DEFAULT repeat('b', 64), p_predecessor text DEFAULT NULL, p_bytes integer DEFAULT 123,
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

CREATE FUNCTION pg_temp.call(
  p_actor text, p_package text, p_request text, p_descriptor jsonb,
  p_revision bigint, p_initial_hash text, p_final_hash text, p_payload_hash text,
  p_column text DEFAULT 'outcome'
) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    'SELECT %I FROM app.commit_evidence_segment(%L, %L, %s, %L, %L, %L::jsonb, %L, %L)',
    p_column, p_package, p_request, p_revision, p_initial_hash, p_final_hash,
    p_descriptor::text, p_payload_hash, 'synthetic://' || p_package || '/' || p_request
  ))
$$;

CREATE FUNCTION pg_temp.call_with_spoofed_user_id() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_outcome text;
BEGIN
  PERFORM pg_catalog.set_config('app.user_id', pg_temp.id('tomo')::text, true);
  v_outcome := pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(),
    0, repeat('a',64), repeat('d',64), repeat('b',64));
  PERFORM pg_catalog.set_config('app.user_id', '', true);
  RETURN v_outcome;
END
$$;

CREATE SCHEMA evidence_attack;
CREATE FUNCTION evidence_attack.length(text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 1 $$;
GRANT USAGE ON SCHEMA evidence_attack TO ductus_app, ductus_evidence;
GRANT EXECUTE ON FUNCTION evidence_attack.length(text) TO ductus_app, ductus_evidence;
CREATE FUNCTION pg_temp.call_with_hostile_search_path() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_outcome text;
  v_original_search_path text := pg_catalog.current_setting('search_path', true);
BEGIN
  PERFORM pg_catalog.set_config('search_path', 'evidence_attack,pg_catalog', true);
  v_outcome := pg_temp.call('ana', 'pkg-a', repeat('x',129), pg_temp.descriptor(),
    0, repeat('a',64), repeat('d',64), repeat('b',64));
  PERFORM pg_catalog.set_config('search_path', v_original_search_path, true);
  RETURN v_outcome;
END
$$;

-- Catalogue, tenant-key and security-definer contract.
SELECT col_not_null('evidence', t, 'institution_id', t || '.institution_id is required')
FROM unnest(ARRAY['domain', 'project', 'document', 'document_revision', 'package', 'segment', 'receipt']) AS t;
SELECT col_hasnt_default('evidence', t, 'institution_id', t || '.institution_id has no default')
FROM unnest(ARRAY['domain', 'project', 'document', 'document_revision', 'package', 'segment', 'receipt']) AS t;
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'evidence' AND c.relkind IN ('r', 'p')
       AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
  ), 'every evidence table enables and forces RLS'
);
SELECT is(
  (SELECT r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.oid = 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text)'::regprocedure),
  'ductus_evidence', 'the only app entrypoint is owned by ductus_evidence'
);
SELECT ok(
  (SELECT prosecdef AND 'search_path=""' = ANY(proconfig)
     FROM pg_proc WHERE oid = 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text)'::regprocedure),
  'the entrypoint is SECURITY DEFINER with an empty search_path'
);
SELECT ok(
  has_function_privilege('ductus_app', 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_worker', 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_retention', 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_auth', 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_test_stranger', 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text)', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
    WHERE p.oid = 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text)'::regprocedure
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ),
  'only ductus_app receives EXECUTE on the narrow wrapper'
);
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'evidence' AND has_function_privilege('ductus_app', p.oid, 'EXECUTE') $$,
  'ductus_app cannot execute a function in evidence.*'
);
SELECT is_empty(
  $$ SELECT name FROM unnest((SELECT proargnames[1:pronargs]
       FROM pg_proc WHERE oid = 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text)'::regprocedure)) AS name
      WHERE name IN ('principal_id', 'p_principal_id', 'institution_id', 'p_institution_id') $$,
  'the entrypoint takes neither principal_id nor institution_id'
);
SELECT is_empty(
  $$ SELECT table_name || ':' || privilege
       FROM unnest(ARRAY['domain', 'project', 'document', 'document_revision', 'package', 'segment', 'receipt']) AS tables(table_name)
       CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS privileges(privilege)
      WHERE has_table_privilege('ductus_app', 'evidence.' || table_name, privilege) $$,
  'ductus_app starts with no direct evidence DML on any evidence table'
);
SELECT is_empty(
  $$ SELECT conrelid::regclass::text || '.' || conname
       FROM pg_constraint WHERE conrelid IN (
         'evidence.project'::regclass, 'evidence.document'::regclass,
         'evidence.document_revision'::regclass, 'evidence.package'::regclass,
         'evidence.segment'::regclass, 'evidence.receipt'::regclass
       ) AND contype = 'f' AND confdeltype <> 'a' $$,
  'evidence foreign keys do not cascade on delete'
);
SELECT throws_ok(
  $$ INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id)
     VALUES ('cross-tenant-project', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('tomo')) $$,
  '23503', NULL, 'composite person key rejects a different institution'
);
SELECT throws_ok(
  $$ INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash)
     VALUES ('cross-tenant-document', pg_temp.id('fak_b'), 'project-a', pg_temp.id('tomo'), repeat('a', 64)) $$,
  '23503', NULL, 'composite project key rejects a mixed tenant/document relation'
);
SELECT throws_ok(
  $$ INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
     VALUES ('doc-b', pg_temp.id('fak_a'), 1, 0, pg_temp.id('ana'), repeat('a', 64)) $$,
  '23503', NULL, 'composite revision key rejects a mixed tenant/document relation'
);
SELECT throws_ok(
  $$ INSERT INTO evidence.package
       (id, institution_id, evidence_domain_id, document_id, project_id, principal_id, evidence_profile_id, max_payload_bytes)
     VALUES ('cross-tenant-package', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d2',
       'doc-a', 'project-a', pg_temp.id('ana'), 'standard-v1', 1024) $$,
  '23503', NULL, 'composite domain key rejects a package from another tenant'
);
SELECT throws_ok(
  $$ INSERT INTO evidence.segment
       (id, evidence_package_id, institution_id, document_id, principal_id, session_id, sequence_from, sequence_to,
        event_count, descriptor, segment_hash, payload_bytes, storage_ref, accepted_at)
     VALUES ('cross-tenant-segment', 'pkg-b', pg_temp.id('fak_a'), 'doc-a', pg_temp.id('ana'), 'cross-tenant',
       1, 1, 1, pg_temp.descriptor(p_package => 'pkg-b', p_segment => 'cross-tenant-segment', p_hash => repeat('c',64)),
       repeat('c',64), 123, 'synthetic://cross-tenant/segment', now()) $$,
  '23503', NULL, 'composite package key rejects a segment from another tenant'
);

-- RLS read isolation across the same institution and a second institution.
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM evidence.project'), '1', 'Ana sees her project');
SELECT is(pg_temp.ask('tomo', 'SELECT count(*) FROM evidence.project'), '1', 'Tomo sees his own institution project only');
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM evidence.project WHERE id = ''project-b'''), '0', 'Ana cannot read another institution project');
SELECT is(pg_temp.ask('boris', 'SELECT count(*) FROM evidence.package WHERE id = ''pkg-a'''), '0', 'same-institution non-owner sees no package');

-- Force the exact privilege layer being tested: these grants are temporary,
-- and the transaction is rolled back at the end of this file.
GRANT SELECT, INSERT, UPDATE, DELETE ON evidence.domain, evidence.project, evidence.document,
  evidence.document_revision, evidence.package, evidence.segment, evidence.receipt
TO ductus_app, ductus_worker, ductus_retention, ductus_identity, ductus_auth, ductus_test_stranger, ductus_migrator;
GRANT USAGE ON SCHEMA evidence TO ductus_worker, ductus_retention, ductus_identity, ductus_auth, ductus_test_stranger, ductus_migrator;
GRANT USAGE ON SCHEMA app TO ductus_test_stranger;
SELECT ok(has_table_privilege('ductus_app', 'evidence.project', 'INSERT'), 'negative DML controls received a temporary INSERT grant');
SELECT ok(has_table_privilege('ductus_app', 'evidence.receipt', 'DELETE'), 'negative DML controls received a temporary DELETE grant');
SELECT is(pg_temp.ask('ana', $$ UPDATE evidence.project SET created_at = created_at WHERE id = 'project-b' RETURNING id $$),
  NULL, 'Ana cannot update another tenant project with direct DML granted');
SELECT is(pg_temp.ask('ana', $$ DELETE FROM evidence.project WHERE id = 'project-b' RETURNING id $$),
  NULL, 'Ana cannot delete another tenant project with direct DML granted');
SELECT matches(pg_temp.ask_as('ductus_test_stranger', 'ana',
  $$ SELECT outcome FROM app.commit_evidence_segment('pkg-a', 'request-no-execute', 0, repeat('a',64), repeat('d',64),
       pg_temp.descriptor(), repeat('b',64), 'synthetic://no-execute') $$),
  '^42501:.*$', 'an unrelated role with app-schema usage still cannot execute the wrapper');
SELECT is(pg_temp.call_with_hostile_search_path(), 'invalid', 'the wrapper ignores a hostile search_path function shadow');
SELECT matches(pg_temp.ask('ana',
  $$ INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id)
     VALUES ('app-forbidden', {fak_a}, {z1}, {ana}) RETURNING id $$),
  '^42501:.*$', 'RLS still denies INSERT when the grant is forced on');
SELECT is(pg_temp.ask('ana',
  $$ UPDATE evidence.project SET created_at = created_at WHERE id = 'project-a' RETURNING id $$),
  NULL, 'RLS exposes no UPDATE target even with a direct grant');
SELECT is(pg_temp.ask('ana',
  $$ DELETE FROM evidence.project WHERE id = 'project-a' RETURNING id $$),
  NULL, 'RLS exposes no DELETE target even with a direct grant');
SELECT is(pg_temp.ask_as('ductus_worker', 'ana', 'SELECT count(*) FROM evidence.project'), '0', 'worker sees no student rows');
SELECT is(pg_temp.ask_as('ductus_retention', 'ana', 'SELECT count(*) FROM evidence.project'), '0', 'retention sees no student rows');
SELECT is(pg_temp.ask_as('ductus_identity', 'ana', 'SELECT count(*) FROM evidence.project'), '0', 'identity sees no evidence rows');
SELECT is(pg_temp.ask_as('ductus_auth', 'ana', 'SELECT count(*) FROM evidence.project'), '0', 'auth sees no evidence rows');
SELECT is(pg_temp.ask_as('ductus_test_stranger', 'ana', 'SELECT count(*) FROM evidence.project'), '0', 'unrelated role sees no evidence rows');
SELECT is(pg_temp.ask_as('ductus_evidence', 'ana', 'SELECT count(*) FROM evidence.project'), '2', 'owner policy permits only the NOLOGIN evidence owner');

-- Seed the remaining evidence rows through the only permitted web entrypoint
-- before running the full table-by-role access matrix.
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a',64), repeat('d',64), repeat('b',64)),
  'reserved', 'one atomic CAS+reserve creates the rows used by the access matrix');
SELECT is(pg_temp.call_with_spoofed_user_id(), 'duplicate_pending', 'a forged user-id GUC cannot replace the session identity');
SELECT is(pg_temp.call('tomo', 'pkg-b', 'request-b',
  pg_temp.descriptor(p_package => 'pkg-b', p_document => 'doc-b', p_segment => 'segment-b-1', p_hash => repeat('d',64)),
  0, repeat('c',64), repeat('e',64), repeat('d',64)),
  'reserved', 'second tenant creates its own segment and receipt through the same narrow entrypoint');
SELECT throws_ok(
  $$ INSERT INTO evidence.receipt
       (id, evidence_package_id, institution_id, evidence_domain_id, segment_id, principal_id, client_request_id,
        payload_sha256, descriptor, receipt_payload, status)
     VALUES ('00000000-0000-4000-8000-0000000000e2', 'pkg-b', pg_temp.id('fak_b'),
       '00000000-0000-4000-8000-0000000000d2', 'segment-a-1', pg_temp.id('tomo'), 'cross-tenant-receipt',
       repeat('d',64), '{}', '{}', 'pending_signature') $$,
  '23503', NULL, 'composite segment key rejects a receipt linked across tenants'
);

-- RLS access matrix for every initial table and every database role from the
-- backend role contract. The temporary grants above ensure these rows measure
-- RLS rather than a missing schema/table privilege.
SELECT is(pg_temp.ask(actor, format('SELECT count(*) FROM evidence.%I', table_name)), expected_count,
  actor || ' sees only its own ' || table_name || ' rows')
FROM (VALUES
  ('ana', 'domain', '1'), ('ana', 'project', '1'), ('ana', 'document', '1'),
  ('ana', 'document_revision', '2'), ('ana', 'package', '1'), ('ana', 'segment', '1'), ('ana', 'receipt', '1'),
  ('tomo', 'domain', '1'), ('tomo', 'project', '1'), ('tomo', 'document', '1'),
  ('tomo', 'document_revision', '2'), ('tomo', 'package', '1'), ('tomo', 'segment', '1'), ('tomo', 'receipt', '1')
) AS matrix(actor, table_name, expected_count);
SELECT is(pg_temp.ask_as(role_name, 'ana', format('SELECT count(*) FROM evidence.%I', table_name)), '0',
  role_name || ' cannot SELECT ' || table_name)
FROM unnest(ARRAY['ductus_migrator', 'ductus_worker', 'ductus_retention', 'ductus_identity', 'ductus_auth', 'ductus_test_stranger']) AS roles(role_name)
CROSS JOIN unnest(ARRAY['domain', 'project', 'document', 'document_revision', 'package', 'segment', 'receipt']) AS tables(table_name);

-- Exercise INSERT, UPDATE and DELETE on each table under an explicit DML
-- grant. Valid synthetic INSERTs fail only because there is no applicable
-- write policy; mutable and append-only rows alike have no UPDATE/DELETE target.
WITH roles(role_name) AS (
  SELECT unnest(ARRAY['ductus_app', 'ductus_migrator', 'ductus_worker', 'ductus_retention', 'ductus_identity', 'ductus_auth', 'ductus_test_stranger'])
), insert_cases(table_name, statement) AS (VALUES
  ('domain', $$ INSERT INTO evidence.domain (id, institution_id, region)
       VALUES ('00000000-0000-4000-8000-0000000000d3', {fak_a}, 'matrix-insert') RETURNING id $$),
  ('project', $$ INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id)
       VALUES ('matrix-insert-project', {fak_a}, {z1}, {ana}) RETURNING id $$),
  ('document', $$ WITH d AS (
       INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_revision, current_content_hash)
       VALUES ('doc-a', {fak_a}, 'project-a', {ana}, 0, repeat('a',64))
       RETURNING id
     ) SELECT id FROM d $$),
  ('document_revision', $$ INSERT INTO evidence.document_revision
       (document_id, institution_id, revision, base_revision, principal_id, content_hash)
       VALUES ('doc-a', {fak_a}, 2, 1, {ana}, repeat('a',64)) RETURNING revision $$),
  ('package', $$ INSERT INTO evidence.package
       (id, institution_id, evidence_domain_id, document_id, project_id, principal_id, evidence_profile_id, max_payload_bytes)
       VALUES ('matrix-insert-package', {fak_a}, '00000000-0000-4000-8000-0000000000d1', 'doc-a', 'project-a', {ana}, 'standard-v1', 1024)
       RETURNING id $$),
  ('segment', $$ INSERT INTO evidence.segment
       (id, evidence_package_id, institution_id, document_id, principal_id, session_id, sequence_from, sequence_to,
        event_count, descriptor, segment_hash, payload_bytes, storage_ref, accepted_at)
       VALUES ('matrix-insert-segment', 'pkg-a', {fak_a}, 'doc-a', {ana}, 'matrix-session', 50, 50, 1,
         jsonb_build_object('segmentHash', repeat('b',64), 'payloadBytes', 123), repeat('b',64), 123,
         'synthetic://matrix/segment', now()) RETURNING id $$),
  ('receipt', $$ INSERT INTO evidence.receipt
       (id, evidence_package_id, institution_id, evidence_domain_id, segment_id, principal_id,
        client_request_id, payload_sha256, descriptor, receipt_payload, status)
       VALUES ('00000000-0000-4000-8000-0000000000e1', 'pkg-a', {fak_a}, '00000000-0000-4000-8000-0000000000d1',
         'segment-a-1', {ana}, 'matrix-insert-receipt', repeat('b',64), pg_temp.descriptor(), '{}', 'pending_signature')
       RETURNING id $$)
)
SELECT matches(pg_temp.ask_as(role_name, 'ana', statement), '^42501:.*$',
  role_name || ' cannot INSERT ' || table_name || ' despite the temporary grant')
FROM roles CROSS JOIN insert_cases;
SELECT is(pg_temp.ask_as(role_name, 'ana', format(
    'UPDATE evidence.%I SET institution_id = institution_id WHERE institution_id = {fak_a} RETURNING 1', table_name)),
  NULL, role_name || ' cannot UPDATE ' || table_name || ' despite the temporary grant')
FROM unnest(ARRAY['ductus_app', 'ductus_migrator', 'ductus_worker', 'ductus_retention', 'ductus_identity', 'ductus_auth', 'ductus_test_stranger']) AS roles(role_name)
CROSS JOIN unnest(ARRAY['domain', 'project', 'document', 'document_revision', 'package', 'segment', 'receipt']) AS tables(table_name);
SELECT is(pg_temp.ask_as(role_name, 'ana', format(
    'DELETE FROM evidence.%I WHERE institution_id = {fak_a} RETURNING 1', table_name)),
  NULL, role_name || ' cannot DELETE ' || table_name || ' despite the temporary grant')
FROM unnest(ARRAY['ductus_app', 'ductus_migrator', 'ductus_worker', 'ductus_retention', 'ductus_identity', 'ductus_auth', 'ductus_test_stranger']) AS roles(role_name)
CROSS JOIN unnest(ARRAY['domain', 'project', 'document', 'document_revision', 'package', 'segment', 'receipt']) AS tables(table_name);

-- The NOLOGIN owner has an explicit policy for SECURITY DEFINER work; this
-- control proves the ownership path, then removes only its synthetic row.
SELECT is(pg_temp.ask_as('ductus_evidence', 'ana', $$ INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id)
  VALUES ('owner-dml-control', {fak_a}, {z1}, {ana}) RETURNING id $$), 'owner-dml-control', 'evidence owner can INSERT through its owner policy');
SELECT is(pg_temp.ask_as('ductus_evidence', 'ana', $$ UPDATE evidence.project SET created_at = created_at WHERE id = 'owner-dml-control' RETURNING id $$),
  'owner-dml-control', 'evidence owner can UPDATE through its owner policy');
SELECT is(pg_temp.ask_as('ductus_evidence', 'ana', $$ DELETE FROM evidence.project WHERE id = 'owner-dml-control' RETURNING id $$),
  'owner-dml-control', 'evidence owner can DELETE through its owner policy');

-- FORCE RLS is active even for the owner. This negative control demonstrates
-- that removing FORCE lets the same owner bypass a missing row policy.
DROP POLICY evidence_project_owner ON evidence.project;
SELECT is(pg_temp.ask_as('ductus_evidence', 'ana', 'SELECT count(*) FROM evidence.project'), '0', 'forced RLS still applies to the owner when its policy is absent');
ALTER TABLE evidence.project NO FORCE ROW LEVEL SECURITY;
SELECT is(pg_temp.ask_as('ductus_evidence', 'ana', 'SELECT count(*) FROM evidence.project'), '2', 'negative control: without FORCE the owner bypasses RLS');
ALTER TABLE evidence.project FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_project_owner ON evidence.project TO ductus_evidence USING (true) WITH CHECK (true);

-- Authentication precedes idempotency lookup, and package ownership is derived
-- from the active actor plus the parent assignment membership.
SELECT is(pg_temp.call('anon', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a',64), repeat('d',64), repeat('b',64)), 'unauthorized', 'anonymous call is refused');
SELECT is(pg_temp.call('expired', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a',64), repeat('d',64), repeat('b',64)), 'unauthorized', 'expired session is refused');
SELECT is(pg_temp.call('tomo', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a',64), repeat('d',64), repeat('b',64)), 'unauthorized', 'other institution cannot probe a request id');
SELECT is(pg_temp.call('boris', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a',64), repeat('d',64), repeat('b',64)), 'unauthorized', 'same institution non-member cannot probe a request id');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(p_package => 'pkg-b', p_document => 'doc-b'), 0, repeat('a',64), repeat('d',64), repeat('b',64)), 'context_mismatch', 'descriptor cannot mix package and document context');
SELECT is(pg_temp.call('ana', 'pkg-a', '   ', pg_temp.descriptor(), 0, repeat('a',64), repeat('d',64), repeat('b',64)),
  'invalid', 'blank client request ids are refused before reserve');
SELECT is(pg_temp.call('ana', 'pkg-a', pg_catalog.chr(160), pg_temp.descriptor(), 0, repeat('a',64), repeat('d',64), repeat('b',64)),
  'invalid', 'Unicode-whitespace-only client request ids are refused');
SELECT is(pg_temp.call('ana', 'pkg-a', repeat('😀', 65), pg_temp.descriptor(), 0, repeat('a',64), repeat('d',64), repeat('b',64)),
  'invalid', 'client request id is bounded by 128 UTF-16 units, not Unicode code points');

-- The one RPC committed revision 1, segment 1 and a pending v2 receipt above.
SELECT is(pg_temp.ask('ana', $$ SELECT current_revision::text FROM evidence.document WHERE id = 'doc-a' $$), '1', 'the document revision advanced atomically');
SELECT is(pg_temp.ask('ana', $$ SELECT count(*) FROM evidence.document_revision WHERE document_id = 'doc-a' $$), '2', 'the new immutable revision was recorded');
SELECT is(pg_temp.ask('ana', $$ SELECT count(*) FROM evidence.segment WHERE evidence_package_id = 'pkg-a' $$), '1', 'the segment was recorded');
SELECT is(pg_temp.ask('ana', $$ SELECT count(*) FROM evidence.receipt WHERE evidence_package_id = 'pkg-a' $$), '1', 'the receipt was recorded');
SELECT is(pg_temp.ask('ana', $$ SELECT status FROM evidence.receipt WHERE evidence_package_id = 'pkg-a' $$), 'pending_signature', 'new receipt awaits the later signing step');
SELECT is(pg_temp.ask('ana', $$ SELECT (receipt_payload::jsonb - 'receiptId' - 'acceptedAt') = jsonb_build_object(
    'receiptSchema', 'ductus-evidence-receipt-v2', 'evidencePackageId', 'pkg-a', 'documentId', 'doc-a',
    'sessionId', 'capture-session-a', 'segmentId', 'segment-a-1', 'segmentHash', repeat('b',64),
    'predecessorSegmentHash', NULL, 'previousReceiptId', NULL, 'evidenceSchema', 'ductus-evidence-segment-v2',
    'evidenceProfileId', 'standard-v1', 'sequenceFrom', 1, 'sequenceTo', 1, 'eventCount', 1,
    'payloadBytes', 123, 'revision', 1, 'clientTransactionId', 'request-1',
    'evidenceDomainId', '00000000-0000-4000-8000-0000000000d1', 'principalId', {ana})
  FROM evidence.receipt WHERE evidence_package_id = 'pkg-a' $$), 'true', 'v2 payload binds actor, domain, transaction and committed revision');
SELECT is(pg_temp.ask_as('ductus_evidence', 'ana', $$ SELECT receipt_payload = evidence.canonical_receipt_v2(receipt_payload::jsonb)
  FROM evidence.receipt WHERE evidence_package_id = 'pkg-a' $$), 'true', 'stored receipt bytes are JCS for the fixed v2 scalar contract');
SELECT is(pg_temp.ask('ana', $$ SELECT receipt_payload::jsonb->>'acceptedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:00[.]000Z$'
  FROM evidence.receipt WHERE evidence_package_id = 'pkg-a' $$), 'true', 'acceptedAt is the canonical UTC minute');
SELECT is(pg_temp.call('ana', 'pkg-a', repeat('😀', 64), pg_temp.descriptor(),
  1, repeat('d',64), repeat('e',64), repeat('b',64)),
  'chain_conflict', 'the maximum 128 UTF-16-unit client request id is accepted by the v2 boundary');

-- Identical retry returns the immutable original. Changed descriptor conflicts;
-- changed bytes with the same descriptor fail the descriptor/hash comparison.
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a',64), repeat('d',64), repeat('b',64)), 'duplicate_pending', 'identical retry is idempotent after CAS already advanced');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a',64), repeat('d',64), repeat('b',64), 'receipt_payload'),
  pg_temp.ask('ana', $$ SELECT receipt_payload FROM evidence.receipt WHERE evidence_package_id='pkg-a' $$), 'retry returns exact original receipt bytes');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(p_segment => 'segment-other', p_hash => repeat('c',64)), 0, repeat('a',64), repeat('d',64), repeat('c',64)), 'idempotency_conflict', 'same request with changed descriptor conflicts');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a',64), repeat('d',64), repeat('c',64)), 'invalid', 'same descriptor with changed payload hash is rejected');

-- A package closure or a newly lowered limit must not block a legitimate retry.
UPDATE evidence.package SET accepts_evidence = false, max_payload_bytes = 100 WHERE id = 'pkg-a';
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a',64), repeat('d',64), repeat('b',64)), 'duplicate_pending', 'retry precedes changed package acceptance and size limits');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-new', pg_temp.descriptor(p_segment => 'segment-a-2', p_sequence_from => 2, p_sequence_to => 2, p_hash => repeat('c',64), p_predecessor => repeat('b',64)), 1, repeat('d',64), repeat('e',64), repeat('c',64)), 'not_accepting', 'a new request respects a closed package');
UPDATE evidence.package SET accepts_evidence = true, max_payload_bytes = 2097152 WHERE id = 'pkg-a';
UPDATE evidence.package SET max_payload_bytes = 100 WHERE id = 'pkg-a';
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-too-large',
  pg_temp.descriptor(p_segment => 'segment-too-large', p_sequence_from => 2, p_sequence_to => 2, p_hash => repeat('c',64), p_predecessor => repeat('b',64)),
  1, repeat('d',64), repeat('e',64), repeat('c',64)), 'too_large', 'new segment obeys the package byte limit');
UPDATE evidence.package SET max_payload_bytes = 2097152 WHERE id = 'pkg-a';

-- Chain and CAS failures do not mutate either chain head or document state.
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-gap', pg_temp.descriptor(p_segment => 'segment-gap', p_sequence_from => 3, p_sequence_to => 3, p_hash => repeat('c',64)), 1, repeat('d',64), repeat('e',64), repeat('c',64)), 'chain_conflict', 'non-contiguous sequence is refused');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-gap-again', pg_temp.descriptor(p_segment => 'segment-gap-2', p_sequence_from => 3, p_sequence_to => 3, p_hash => repeat('c',64)), 1, repeat('d',64), repeat('e',64), repeat('c',64), 'expected_previous_segment_hash'),
  repeat('b',64), 'chain conflict returns the current segment hash');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-stale', pg_temp.descriptor(p_segment => 'segment-stale', p_sequence_from => 2, p_sequence_to => 2, p_hash => repeat('c',64), p_predecessor => repeat('b',64)), 0, repeat('a',64), repeat('e',64), repeat('c',64)), 'concurrent_conflict', 'stale document revision is refused');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-bad-hash', pg_temp.descriptor(p_segment => 'segment-bad-hash', p_sequence_from => 2, p_sequence_to => 2, p_hash => repeat('c',64), p_predecessor => repeat('b',64)), 1, repeat('d',64), repeat('e',64), repeat('f',64)), 'invalid', 'declared segment hash must match received bytes hash');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-bad-range', pg_temp.descriptor(p_segment => 'segment-bad-range', p_sequence_from => 2, p_sequence_to => 3, p_event_count => 1, p_hash => repeat('c',64), p_predecessor => repeat('b',64)), 1, repeat('d',64), repeat('e',64), repeat('c',64)), 'invalid', 'sequence range must match event count');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-bad-predecessor',
  pg_temp.descriptor(p_segment => 'segment-bad-predecessor', p_sequence_from => 2, p_sequence_to => 2,
    p_hash => repeat('c',64), p_predecessor => repeat('f',64)),
  1, repeat('d',64), repeat('e',64), repeat('c',64)),
  'chain_conflict', 'the next valid sequence still requires the current predecessor hash');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-bad-initial-hash',
  pg_temp.descriptor(p_segment => 'segment-bad-initial', p_sequence_from => 2, p_sequence_to => 2,
    p_hash => repeat('c',64), p_predecessor => repeat('b',64)),
  1, repeat('c',64), repeat('e',64), repeat('c',64)),
  'concurrent_conflict', 'the correct revision with a wrong initial document hash is refused');
SELECT is(pg_temp.ask('ana', $$ SELECT concat_ws(':', current_revision, current_content_hash) FROM evidence.document WHERE id='doc-a' $$), '1:' || repeat('d',64), 'refused requests do not change the document');
SELECT is(pg_temp.ask('ana', $$ SELECT concat_ws(':', last_sequence_to, head_segment_hash) FROM evidence.package WHERE id='pkg-a' $$), '1:' || repeat('b',64), 'refused requests do not change the evidence head');

-- Inject a synthetic failure after the revision and segment writes. PostgreSQL
-- rolls the whole RPC statement back; the same request can then reserve.
CREATE FUNCTION pg_temp.fail_receipt_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'synthetic mid-transaction failure' USING ERRCODE = 'ZD422'; END
$$;
CREATE TRIGGER evidence_test_fail_receipt BEFORE INSERT ON evidence.receipt
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_receipt_insert();
SELECT matches(pg_temp.call('ana', 'pkg-a', 'request-rollback',
  pg_temp.descriptor(p_segment => 'segment-a-2', p_sequence_from => 2, p_sequence_to => 2, p_hash => repeat('c',64), p_predecessor => repeat('b',64)),
  1, repeat('d',64), repeat('e',64), repeat('c',64)), '^ZD422:.*$', 'injected failure reaches the receipt insert');
DROP TRIGGER evidence_test_fail_receipt ON evidence.receipt;
DROP FUNCTION pg_temp.fail_receipt_insert();
SELECT is(pg_temp.ask('ana', $$ SELECT count(*) FROM evidence.document_revision WHERE document_id='doc-a' $$), '2', 'mid-RPC failure rolled back the new revision');
SELECT is(pg_temp.ask('ana', $$ SELECT count(*) FROM evidence.segment WHERE evidence_package_id='pkg-a' $$), '1', 'mid-RPC failure rolled back the segment');
SELECT is(pg_temp.ask('ana', $$ SELECT count(*) FROM evidence.receipt WHERE evidence_package_id='pkg-a' $$), '1', 'mid-RPC failure rolled back the receipt');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-rollback',
  pg_temp.descriptor(p_segment => 'segment-a-2', p_sequence_from => 2, p_sequence_to => 2, p_hash => repeat('c',64), p_predecessor => repeat('b',64)),
  1, repeat('d',64), repeat('e',64), repeat('c',64)), 'reserved', 'rollback did not consume revision, sequence or idempotency key');

-- The payload and descriptor are immutable. Only pending -> signed with a
-- non-null synthetic signature envelope may transition.
SELECT matches(pg_temp.ask_as('ductus_evidence', 'ana',
  $$ UPDATE evidence.receipt SET receipt_payload = '{}' WHERE client_request_id='request-1' RETURNING id $$),
  '^ZD403:.*$', 'receipt payload cannot be rewritten');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'ana',
  $$ DELETE FROM evidence.receipt WHERE client_request_id='request-1' RETURNING id $$),
  '^ZD403:.*$', 'receipt cannot be deleted');
UPDATE evidence.receipt SET status = 'signed', signature = '{"signature":"synthetic"}'::jsonb, key_id = 'synthetic-key'
 WHERE client_request_id = 'request-1';
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a',64), repeat('d',64), repeat('b',64)), 'duplicate_signed', 'signed retry returns the original accepted receipt');

-- Revoke the only EXECUTE grant as a negative control: the application call is
-- refused, then the grant is restored before the outer rollback.
REVOKE EXECUTE ON FUNCTION app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text) FROM ductus_app;
SELECT matches(pg_temp.call('ana', 'pkg-a', 'request-disabled', pg_temp.descriptor(p_segment => 'segment-never', p_hash => repeat('e',64)), 2, repeat('e',64), repeat('f',64), repeat('e',64)),
  '^42501:.*$', 'removing the narrow EXECUTE grant blocks the wrapper');
GRANT EXECUTE ON FUNCTION app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text) TO ductus_app;

SELECT * FROM finish();
ROLLBACK;

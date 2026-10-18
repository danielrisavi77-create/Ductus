-- DAN-189 / D-103: synthetic tenant, FK and RLS contract for evidence metadata.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';
SELECT no_plan();

-- Create one complete synthetic evidence chain for each test institution.
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.domain (id, institution_id, region) VALUES
  ('00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), 'eu-central-1'),
  ('00000000-0000-4000-8000-0000000000d2', pg_temp.id('fak_b'), 'eu-central-1');
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES
  ('project-a', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('ana')),
  ('project-a2', pg_temp.id('fak_a'), pg_temp.id('z2'), pg_temp.id('ana')),
  ('project-b', pg_temp.id('fak_b'), pg_temp.id('z3'), pg_temp.id('tomo'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash) VALUES
  ('doc-a', pg_temp.id('fak_a'), 'project-a', pg_temp.id('ana'), repeat('a', 64)),
  ('doc-a2', pg_temp.id('fak_a'), 'project-a2', pg_temp.id('ana'), repeat('c', 64)),
  ('doc-b', pg_temp.id('fak_b'), 'project-b', pg_temp.id('tomo'), repeat('c', 64));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash) VALUES
  ('doc-a', pg_temp.id('fak_a'), 0, pg_temp.id('ana'), repeat('a', 64)),
  ('doc-a2', pg_temp.id('fak_a'), 0, pg_temp.id('ana'), repeat('c', 64)),
  ('doc-b', pg_temp.id('fak_b'), 0, pg_temp.id('tomo'), repeat('c', 64));
INSERT INTO evidence.package (
  id, institution_id, evidence_domain_id, document_id, project_id, principal_id, evidence_profile_id, max_payload_bytes
) VALUES
  ('pkg-a', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1', 'doc-a', 'project-a', pg_temp.id('ana'), 'standard-v1', 2097152),
  ('pkg-b', pg_temp.id('fak_b'), '00000000-0000-4000-8000-0000000000d2', 'doc-b', 'project-b', pg_temp.id('tomo'), 'standard-v1', 2097152);
INSERT INTO evidence.segment (
  id, evidence_package_id, institution_id, document_id, principal_id, session_id, sequence_from, sequence_to,
  event_count, descriptor, segment_hash, payload_bytes, storage_ref, accepted_at
) VALUES
  ('segment-a', 'pkg-a', pg_temp.id('fak_a'), 'doc-a', pg_temp.id('ana'), 'synthetic-session-a', 1, 1, 1,
   jsonb_build_object('segmentHash', repeat('b',64), 'payloadBytes', 123), repeat('b',64), 123,
   'synthetic://pkg-a/segment-a', now()),
  ('segment-b', 'pkg-b', pg_temp.id('fak_b'), 'doc-b', pg_temp.id('tomo'), 'synthetic-session-b', 1, 1, 1,
   jsonb_build_object('segmentHash', repeat('d',64), 'payloadBytes', 123), repeat('d',64), 123,
   'synthetic://pkg-b/segment-b', now());
INSERT INTO evidence.receipt (
  id, evidence_package_id, institution_id, evidence_domain_id, segment_id, principal_id, client_request_id,
  payload_sha256, descriptor, receipt_payload, status
) VALUES
  ('00000000-0000-4000-8000-0000000000e1', 'pkg-a', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1',
   'segment-a', pg_temp.id('ana'), 'synthetic-request-a', repeat('e',64), '{}', '{}', 'pending_signature'),
  ('00000000-0000-4000-8000-0000000000e2', 'pkg-b', pg_temp.id('fak_b'), '00000000-0000-4000-8000-0000000000d2',
   'segment-b', pg_temp.id('tomo'), 'synthetic-request-b', repeat('f',64), '{}', '{}', 'pending_signature');
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;

SELECT col_not_null('evidence', t, 'institution_id', t || ' requires institution_id')
FROM unnest(ARRAY['domain', 'project', 'document', 'document_revision', 'package', 'segment', 'receipt']) AS t;
SELECT col_hasnt_default('evidence', t, 'institution_id', t || ' has no tenant default')
FROM unnest(ARRAY['domain', 'project', 'document', 'document_revision', 'package', 'segment', 'receipt']) AS t;
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'evidence' AND c.relkind IN ('r','p') AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
), 'every evidence table enables and forces RLS');
SELECT is_empty(
  $$ SELECT relname FROM pg_class WHERE relnamespace = 'evidence'::regnamespace AND relkind IN ('r','p')
      AND relowner <> 'ductus_evidence'::regrole $$,
  'the NOLOGIN evidence role owns every evidence table'
);
SELECT ok(has_schema_privilege('ductus_app', 'evidence', 'USAGE'), 'the web role can reach its SELECT policies');
SELECT ok(NOT has_schema_privilege('ductus_app', 'evidence', 'CREATE'), 'the web role cannot create in evidence');
SELECT ok(NOT has_schema_privilege('ductus_identity', 'evidence', 'USAGE'), 'the temporary identity role has no evidence-schema access');
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'evidence' AND has_function_privilege('ductus_app', p.oid, 'EXECUTE') $$,
  'the web role cannot execute evidence-schema functions');
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['domain','project','document','document_revision','package','segment','receipt']) AS t
    CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE']) AS p
    WHERE has_table_privilege('ductus_app', 'evidence.' || t, p)
  ), 'the web role has no direct evidence DML'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid IN (
      'evidence.domain'::regclass, 'evidence.project'::regclass, 'evidence.document'::regclass, 'evidence.document_revision'::regclass,
      'evidence.package'::regclass, 'evidence.segment'::regclass, 'evidence.receipt'::regclass
    ) AND contype = 'f' AND confdeltype <> 'a'
  ), 'evidence foreign keys never cascade on delete'
);
SELECT matches(pg_temp.ask_as('ductus_evidence','anon', $$ INSERT INTO evidence.project (id,institution_id,assignment_id,principal_id)
     VALUES ('mixed-assignment',pg_temp.id('fak_b'),pg_temp.id('z1'),
             pg_temp.id('ana')) $$), '^23503:', 'a project cannot combine an assignment from another institution');
SELECT matches(pg_temp.ask_as('ductus_evidence','anon', $$ INSERT INTO evidence.project (id,institution_id,assignment_id,principal_id)
     VALUES ('mixed-person',pg_temp.id('fak_a'),pg_temp.id('z1'),
             pg_temp.id('tomo')) $$), '^23503:', 'a project cannot combine a person from another institution');
SELECT matches(pg_temp.ask_as('ductus_evidence','anon', $$ INSERT INTO evidence.document (id,institution_id,project_id,principal_id,current_content_hash)
     VALUES ('mixed-document',pg_temp.id('fak_b'),'project-a',
             pg_temp.id('tomo'),repeat('a',64)) $$), '^23503:', 'a document cannot cross its project tenant');
SELECT matches(pg_temp.ask_as('ductus_evidence','anon', $$ INSERT INTO evidence.package (id,institution_id,evidence_domain_id,document_id,project_id,principal_id,evidence_profile_id,max_payload_bytes)
     VALUES ('mixed-package',pg_temp.id('fak_a'),'00000000-0000-4000-8000-0000000000d1','doc-a','project-a2',pg_temp.id('ana'),'standard-v1',1024) $$), '^23503:', 'a package cannot pair a document with another project');
SELECT matches(pg_temp.ask_as('ductus_evidence','anon', $$ INSERT INTO evidence.document_revision (document_id,institution_id,revision,base_revision,principal_id,content_hash)
     VALUES ('doc-b',pg_temp.id('fak_a'),1,0,
             pg_temp.id('ana'),repeat('a',64)) $$), '^23503:', 'a revision cannot cross its document tenant');
SELECT matches(pg_temp.ask_as('ductus_evidence','anon', $$ INSERT INTO evidence.document_revision
     (document_id,institution_id,revision,base_revision,principal_id,content_hash)
     VALUES ('doc-a',pg_temp.id('fak_a'),1,NULL,pg_temp.id('ana'),repeat('b',64)) $$),
  '^23514:', 'a positive revision must name its preceding revision');
SELECT matches(pg_temp.ask_as('ductus_evidence','anon', $$ UPDATE evidence.document
     SET current_content_hash = repeat('f',64) WHERE id = 'doc-a' $$),
  '^23503:', 'the current document hash must match the pointed revision');
SELECT matches(pg_temp.ask_as('ductus_evidence','anon', $$ INSERT INTO evidence.package
     (id,institution_id,evidence_domain_id,document_id,project_id,principal_id,evidence_profile_id,max_payload_bytes)
     VALUES ('mixed-package',pg_temp.id('fak_a'),'00000000-0000-4000-8000-0000000000d2',
             'doc-a','project-a',pg_temp.id('ana'),'standard-v1',1024) $$), '^23503:', 'a package cannot use another institution domain');
SELECT matches(pg_temp.ask_as('ductus_evidence','anon', $$ INSERT INTO evidence.segment
     (id,evidence_package_id,institution_id,document_id,principal_id,session_id,sequence_from,sequence_to,event_count,
      descriptor,segment_hash,payload_bytes,storage_ref,accepted_at)
     VALUES ('mixed-segment','pkg-b',pg_temp.id('fak_a'),'doc-a',
      pg_temp.id('ana'),'synthetic-session',1,1,1,
      jsonb_build_object('segmentHash',repeat('b',64),'payloadBytes',123),repeat('b',64),123,'synthetic://bad',now()) $$), '^23503:', 'a segment cannot cross its package tenant');
SELECT matches(pg_temp.ask_as('ductus_evidence','anon', $$ INSERT INTO evidence.segment (id,evidence_package_id,institution_id,document_id,principal_id,session_id,sequence_from,sequence_to,event_count,descriptor,segment_hash,payload_bytes,storage_ref,accepted_at)
     VALUES ('mixed-document-segment','pkg-a',pg_temp.id('fak_a'),'doc-a2',pg_temp.id('ana'),'session',2,2,1,jsonb_build_object('segmentHash',repeat('b',64),'payloadBytes',123),repeat('b',64),123,'synthetic://bad',now()) $$), '^23503:', 'a segment cannot leave its package document');
SELECT matches(pg_temp.ask_as('ductus_evidence','anon', $$ INSERT INTO evidence.receipt
     (id,evidence_package_id,institution_id,evidence_domain_id,segment_id,principal_id,client_request_id,
      payload_sha256,descriptor,receipt_payload,status)
     VALUES ('00000000-0000-4000-8000-0000000000e3','pkg-a',pg_temp.id('fak_a'),
      '00000000-0000-4000-8000-0000000000d1','segment-b',pg_temp.id('ana'),
      'mixed-receipt',repeat('a',64),'{}','{}','pending_signature') $$), '^23503:', 'a receipt cannot reference a segment from another tenant');
SELECT matches(pg_temp.ask_as('ductus_evidence','anon', $$ INSERT INTO evidence.receipt (id,evidence_package_id,institution_id,evidence_domain_id,segment_id,principal_id,client_request_id,payload_sha256,descriptor,receipt_payload,status)
     VALUES ('00000000-0000-4000-8000-0000000000e4','pkg-a',pg_temp.id('fak_a'),'00000000-0000-4000-8000-0000000000d1','segment-a',pg_temp.id('dora'),'mixed-principal',repeat('a',64),'{}','{}','pending_signature') $$), '^23503:', 'a receipt cannot change its segment principal');
SELECT matches(pg_temp.ask_as('ductus_evidence','anon', $$ INSERT INTO evidence.segment (id,evidence_package_id,institution_id,document_id,principal_id,session_id,sequence_from,sequence_to,event_count,descriptor,segment_hash,payload_bytes,storage_ref,accepted_at)
     VALUES ('missing-hash','pkg-a',pg_temp.id('fak_a'),'doc-a',pg_temp.id('ana'),'session',2,2,1,'{"payloadBytes":123}',repeat('b',64),123,'synthetic://bad',now()) $$), '^23514:', 'a segment descriptor must include its hash');
SELECT matches(pg_temp.ask_as('ductus_evidence','anon', $$ INSERT INTO evidence.segment (id,evidence_package_id,institution_id,document_id,principal_id,session_id,sequence_from,sequence_to,event_count,descriptor,segment_hash,payload_bytes,storage_ref,accepted_at)
     VALUES ('missing-bytes','pkg-a',pg_temp.id('fak_a'),'doc-a',pg_temp.id('ana'),'session',2,2,1,'{"segmentHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}',repeat('b',64),123,'synthetic://bad',now()) $$), '^23514:', 'a segment descriptor must include its payload size');
SELECT is(pg_temp.ask('ana',
  $$ SELECT concat_ws(' ',(SELECT count(*) FROM evidence.domain),(SELECT count(*) FROM evidence.project),
    (SELECT count(*) FROM evidence.document),(SELECT count(*) FROM evidence.document_revision),
    (SELECT count(*) FROM evidence.package),(SELECT count(*) FROM evidence.segment),(SELECT count(*) FROM evidence.receipt)) $$),
  '1 2 2 2 1 1 1', 'a student sees her institution domain and own evidence chains');
SELECT is(pg_temp.ask('tomo',
  $$ SELECT concat_ws(' ',(SELECT count(*) FROM evidence.domain),(SELECT count(*) FROM evidence.project),
    (SELECT count(*) FROM evidence.document),(SELECT count(*) FROM evidence.document_revision),
    (SELECT count(*) FROM evidence.package),(SELECT count(*) FROM evidence.segment),(SELECT count(*) FROM evidence.receipt)) $$),
  '1 1 1 1 1 1 1', 'a second-institution student sees only the second evidence chain');
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM evidence.project WHERE id = ''project-b'''),
  '0', 'another institution project is invisible');
SELECT is(pg_temp.ask('boris',
  $$ SELECT concat_ws(' ',(SELECT count(*) FROM evidence.project),(SELECT count(*) FROM evidence.document),
    (SELECT count(*) FROM evidence.package),(SELECT count(*) FROM evidence.receipt)) $$),
  '0 0 0 0', 'another student at the same institution sees no evidence rows');
SELECT ok(NOT has_table_privilege('ductus_identity','evidence.project','SELECT')
  AND NOT has_table_privilege('ductus_worker','evidence.project','SELECT'),
  'other service roles receive no direct evidence SELECT');

-- The evidence domain id is the signed evidenceDomainId: UUID version 4 only
-- (docs/BACKEND.md 4.1). A generated id passes; any other version, the nil id
-- and a wrong variant are refused by the table itself.
SELECT is(pg_temp.ask_as('ductus_evidence','anon', $$ WITH d AS (INSERT INTO evidence.domain (institution_id,region)
     VALUES ({fak_a},'eu-west-1') RETURNING id) SELECT count(*) FROM d $$),
  '1', 'a generated evidence domain id is a UUID version 4');
SELECT matches(pg_temp.ask_as('ductus_evidence','anon', format(
     $$ INSERT INTO evidence.domain (id,institution_id,region) VALUES (%L,{fak_a},%L) $$, v.id, v.region)),
  '^23514:', 'an evidence domain id cannot be ' || v.what)
FROM (VALUES
  ('00000000-0000-1000-8000-0000000000d3', 'eu-north-1', 'a version 1 UUID'),
  ('00000000-0000-7000-8000-0000000000d4', 'eu-south-1', 'a version 7 UUID'),
  ('00000000-0000-4000-c000-0000000000d5', 'eu-south-2', 'a UUID of another variant'),
  ('00000000-0000-0000-0000-000000000000', 'eu-north-2', 'the nil UUID')
) AS v (id, region, what);

-- A mistaken grant is not access: with USAGE and a direct table privilege
-- granted for this transaction only, the RLS policies still refuse a web
-- write and show a role without a policy no rows.
GRANT INSERT, UPDATE, DELETE ON evidence.project TO ductus_app;
SELECT matches(pg_temp.ask('ana', $$ INSERT INTO evidence.project (id,institution_id,assignment_id,principal_id)
     VALUES ('granted-project',{fak_a},{z1},{ana}) $$),
  '^42501: new row violates row-level security policy', 'a mistaken INSERT grant still lets no web write through');
SELECT is(pg_temp.ask('ana', $$ WITH u AS (UPDATE evidence.project SET assignment_id = {z1} RETURNING 1)
     SELECT count(*) FROM u $$), '0', 'a mistaken UPDATE grant still changes no evidence row');
SELECT is(pg_temp.ask('ana', $$ WITH d AS (DELETE FROM evidence.project RETURNING 1) SELECT count(*) FROM d $$),
  '0', 'a mistaken DELETE grant still removes no evidence row');
REVOKE INSERT, UPDATE, DELETE ON evidence.project FROM ductus_app;
GRANT USAGE ON SCHEMA evidence TO ductus_worker;
GRANT SELECT ON evidence.project, evidence.receipt TO ductus_worker;
SELECT is(pg_temp.ask_as('ductus_worker','ana',
     $$ SELECT (SELECT count(*) FROM evidence.project) + (SELECT count(*) FROM evidence.receipt) $$),
  '0', 'a mistaken SELECT grant shows a role without a policy no evidence rows');
REVOKE SELECT ON evidence.project, evidence.receipt FROM ductus_worker;
REVOKE USAGE ON SCHEMA evidence FROM ductus_worker;

SELECT * FROM finish();
ROLLBACK;

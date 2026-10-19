-- B-12 step 4b1 / DAN-87: the stored record a submission request is
-- reconstructed from (contract on #385). Every person, document and hash
-- below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

-- Ana commits revisions 1 and 2, requests revision 2, then commits revision 3
-- while the request waits (plan item B4). Dora gets a request on a document
-- without a package, written by the owner.
SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'reserved', 'fixture: Ana commits revision 1');
SELECT is(pg_temp.call('ana','pkg-a','request-2',
    pg_temp.descriptor(p_segment=>'segment-a-2',p_sequence_from=>2,p_sequence_to=>2,p_hash=>repeat('c',64),
      p_predecessor=>repeat('b',64)),1,repeat('d',64),repeat('e',64),repeat('c',64)),
  'reserved', 'fixture: Ana commits revision 2');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a', 2) $$), 'requested',
  'fixture: Ana requests revision 2');
SELECT is(pg_temp.call('ana','pkg-a','request-3',
    pg_temp.descriptor(p_segment=>'segment-a-3',p_sequence_from=>3,p_sequence_to=>3,p_hash=>repeat('9',64),
      p_predecessor=>repeat('c',64)),2,repeat('e',64),repeat('f',64),repeat('9',64)),
  'reserved', 'fixture: Ana commits revision 3 after the request');
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES
  ('project-d', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('dora'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_revision, current_content_hash) VALUES
  ('doc-d', pg_temp.id('fak_a'), 'project-d', pg_temp.id('dora'), 1, repeat('e',64));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash) VALUES
  ('doc-d', pg_temp.id('fak_a'), 0, NULL, pg_temp.id('dora'), repeat('a',64)),
  ('doc-d', pg_temp.id('fak_a'), 1, 0, pg_temp.id('dora'), repeat('e',64));
INSERT INTO evidence.submission_request (
  institution_id, assignment_id, assignment_version, project_id, document_id, principal_id, revision,
  content_hash, requested_at
) VALUES
  (pg_temp.id('fak_a'), pg_temp.id('z1'), 2, 'project-d', 'doc-d', pg_temp.id('dora'), 1, repeat('e',64), now());
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;

CREATE FUNCTION pg_temp.req(p_student text) RETURNS text LANGUAGE sql AS $$
  SELECT id::text FROM evidence.submission_request WHERE principal_id = pg_temp.id(p_student)
$$;
CREATE FUNCTION pg_temp.read(p_actor text, p_request text, p_column text DEFAULT 'outcome') RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format('SELECT %s::text FROM app.read_submission_record(%L::uuid)', p_column, p_request))
$$;

-- Shape of the entrypoint: owner, definer, search_path, read only, grants,
-- the request as the only argument (F1).
SELECT ok((SELECT r.rolname = 'ductus_evidence' AND p.prosecdef AND 'search_path=""' = ANY(p.proconfig)
    AND p.provolatile = 's'
  FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.oid = 'app.read_submission_record(uuid)'::regprocedure),
  'the record RPC is a STABLE SECURITY DEFINER function of the evidence role with an empty search_path');
SELECT ok(
  has_function_privilege('ductus_app', 'app.read_submission_record(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_worker', 'app.read_submission_record(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_retention', 'app.read_submission_record(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_auth', 'app.read_submission_record(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_identity', 'app.read_submission_record(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_test_stranger', 'app.read_submission_record(uuid)', 'EXECUTE'),
  'only ductus_app executes the record RPC');
SELECT is((SELECT proargnames[1:pronargs]::text FROM pg_proc
  WHERE oid = 'app.read_submission_record(uuid)'::regprocedure),
  '{p_submission_request_id}', 'the RPC takes only the request: no identity, institution or revision');

-- The record of the own request, cut at its revision (B4): two segments in
-- chain order, the head is the segment that made revision 2, the receipt text
-- is the stored one and a pending acceptance has no signature.
SELECT is(pg_temp.read('ana', pg_temp.req('ana')), 'found', 'the student reads the record of the own request');
SELECT is(pg_temp.read('ana', pg_temp.req('ana'),
    $$concat_ws(' ', institution_id = {fak_a}, evidence_package_id, evidence_domain_id, document_id,
      principal_id = {ana}, revision, content_hash = pg_temp.sha(repeat('e',64)), head_segment_hash = repeat('c',64),
      segment_count)$$),
  't pkg-a 00000000-0000-4000-8000-0000000000d1 doc-a t 2 t t 2',
  'the record names the package, its domain, the request''s revision and hash and the head at that revision');
SELECT is(pg_temp.read('ana', pg_temp.req('ana'),
    $$(SELECT string_agg(e ->> 'segmentHash', ',' ORDER BY n) FROM jsonb_array_elements(segments) WITH ORDINALITY AS x(e, n))$$),
  repeat('b',64) || ',' || repeat('c',64), 'the listing ends at the requested revision; the later segment is not in it');
SELECT is(pg_temp.read('ana', pg_temp.req('ana'),
    $$(SELECT string_agg(e ->> 'receiptPayload', '|' ORDER BY n) FROM jsonb_array_elements(segments) WITH ORDINALITY AS x(e, n))$$),
  (SELECT string_agg(r.receipt_payload, '|' ORDER BY s.sequence_from)
     FROM evidence.receipt r
     JOIN evidence.segment s ON s.id = r.segment_id AND s.evidence_package_id = r.evidence_package_id
    WHERE r.evidence_package_id = 'pkg-a' AND s.sequence_from <= 2),
  'each listed segment carries its exact stored receipt text');
SELECT is(pg_temp.read('ana', pg_temp.req('ana'),
    $$(SELECT string_agg(jsonb_typeof(e -> 'signature') || ':' || (SELECT count(*) FROM jsonb_object_keys(e)), ','
         ORDER BY n) FROM jsonb_array_elements(segments) WITH ORDINALITY AS x(e, n))$$),
  'null:3,null:3', 'a pending acceptance has no signature, and each entry has exactly three keys');
-- Who may read (F1 to F3, F7): one answer for every refusal, a separate one
-- for a missing session.
SELECT is(pg_temp.read('anon', pg_temp.req('ana')), 'unauthenticated', 'an anonymous session is unauthenticated');
SELECT is(pg_temp.read('expired', pg_temp.req('ana')), 'unauthenticated', 'an expired session is unauthenticated');
SELECT is(pg_temp.read('dora', pg_temp.req('ana')), 'not_found', 'a classmate cannot read another student''s record');
SELECT is(pg_temp.read('vesna', pg_temp.req('ana')), 'not_found', 'the teacher cannot read the raw record');
SELECT is(pg_temp.read('iva', pg_temp.req('ana')), 'not_found', 'the administrator cannot read the raw record');
SELECT is(pg_temp.read('tomo', pg_temp.req('ana')), 'not_found', 'a student of another institution cannot read it');
SELECT is(pg_temp.read('ana', '00000000-0000-4000-8000-0000000000ff'), 'not_found',
  'a missing request gets the same answer as a foreign one');
SELECT is(pg_temp.read('vesna', pg_temp.req('ana'), 'segments'), NULL, 'a refusal carries no listing');
CREATE FUNCTION pg_temp.read_with_spoofed_user_id() RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('app.user_id', pg_temp.id('ana')::text, true);
  v := pg_temp.read('tomo', pg_temp.req('ana'));
  PERFORM set_config('app.user_id', '', true);
  RETURN v;
END
$$;
SELECT is(pg_temp.read_with_spoofed_user_id(), 'not_found', 'a forged user-id setting cannot replace the session');

-- A request whose document has no package has no record to reconstruct.
SELECT is(pg_temp.read('dora', pg_temp.req('dora')), 'unavailable', 'a request without a package is unavailable');
SELECT is(pg_temp.read('dora', pg_temp.req('dora'), 'segments'), NULL, 'an unavailable record carries no listing');

SELECT * FROM finish();
ROLLBACK;

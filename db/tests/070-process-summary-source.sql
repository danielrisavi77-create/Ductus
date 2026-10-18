-- B-13 step 3 / DAN-85: the record a process summary is built from (plan of
-- attack #384, items 7, 8, 11 to 13, 17, 18, 62). Every person, document and
-- hash below is invented.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';
SELECT no_plan();

-- Z4 of K1 is short (3 hours, D-37). Ana writes doc-a on Z1 (three segments,
-- the last one accepted in the current P-03 window), doc-two on Z1 with two
-- packages, doc-none on Z1 without a package and doc-short on Z4; Tomo writes
-- doc-b on Z3 of fak-b.
SET LOCAL ROLE ductus_identity;
INSERT INTO institution.assignment (id, course_id, institution_id, current_version, created_by)
VALUES ('00000000-0000-4000-8000-0000000000a4', pg_temp.id('k1'), pg_temp.id('fak_a'), 1, pg_temp.id('vesna'));
INSERT INTO institution.assignment_version (
  assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
  evidence_profile, import_allowed, created_by
) VALUES ('00000000-0000-4000-8000-0000000000a4', 1, 'Z4', 'Upute za izmišljeni kratki zadatak.', 'essay',
  now() - interval '1 hour', now() + interval '2 hours', 'partially_allowed', '{}', 'basic', false,
  pg_temp.id('vesna'));
RESET ROLE;

SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.domain (id, institution_id, region) VALUES
  ('00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), 'eu-central-1'),
  ('00000000-0000-4000-8000-0000000000d2', pg_temp.id('fak_b'), 'eu-central-1');
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES
  ('project-a', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('ana')),
  ('project-short', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000a4', pg_temp.id('ana')),
  ('project-b', pg_temp.id('fak_b'), pg_temp.id('z3'), pg_temp.id('tomo'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash)
SELECT d.id, p.institution_id, d.project, p.id, repeat('a', 64)
FROM (VALUES ('doc-a', 'project-a', 'ana'), ('doc-two', 'project-a', 'ana'), ('doc-none', 'project-a', 'ana'),
             ('doc-short', 'project-short', 'ana'), ('doc-b', 'project-b', 'tomo')) AS d (id, project, owner)
JOIN person p ON p.name = d.owner;
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash)
SELECT id, institution_id, 0, principal_id, repeat('a', 64) FROM evidence.document;
INSERT INTO evidence.package (
  id, institution_id, evidence_domain_id, document_id, project_id, principal_id, evidence_profile_id, max_payload_bytes
)
SELECT k.id, d.institution_id, k.domain::uuid, d.id, d.project_id, d.principal_id, 'standard-v1', 2097152
FROM (VALUES ('pkg-a', 'doc-a', '00000000-0000-4000-8000-0000000000d1'),
             ('pkg-two-1', 'doc-two', '00000000-0000-4000-8000-0000000000d1'),
             ('pkg-two-2', 'doc-two', '00000000-0000-4000-8000-0000000000d1'),
             ('pkg-short', 'doc-short', '00000000-0000-4000-8000-0000000000d1'),
             ('pkg-b', 'doc-b', '00000000-0000-4000-8000-0000000000d2')) AS k (id, document, domain)
JOIN evidence.document d ON d.id = k.document;
-- Inserted out of chain order: the cut orders by sequence, not by row.
INSERT INTO evidence.segment (
  id, evidence_package_id, institution_id, document_id, principal_id, session_id, sequence_from, sequence_to,
  event_count, descriptor, segment_hash, payload_bytes, storage_ref, accepted_at
)
SELECT s.id, k.id, k.institution_id, k.document_id, k.principal_id, 'synthetic-session', s.seq, s.seq, 1,
       jsonb_build_object('segmentHash', repeat(s.hash, 64), 'payloadBytes', 100), repeat(s.hash, 64), 100,
       'synthetic://' || s.id, now() - s.age
FROM (VALUES ('segment-a2', 'pkg-a', 2, '2', interval '1 hour'),
             ('segment-a1', 'pkg-a', 1, '1', interval '2 hours'),
             ('segment-a3', 'pkg-a', 3, '3', interval '0'),
             ('segment-s1', 'pkg-short', 1, '4', interval '2 hours'),
             ('segment-b1', 'pkg-b', 1, '5', interval '2 hours')) AS s (id, package, seq, hash, age)
JOIN evidence.package k ON k.id = s.package;
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;

CREATE FUNCTION pg_temp.source(p_actor text, p_document text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    'SELECT row(outcome, evidence_package_id, segment_hashes)::text FROM app.read_process_summary_source(%L)',
    p_document))
$$;
CREATE TEMP TABLE expected (name text PRIMARY KEY, val text NOT NULL);
INSERT INTO expected VALUES
  ('a', format('(found,pkg-a,"{%s,%s}")', repeat('1', 64), repeat('2', 64))),
  ('b', format('(found,pkg-b,{%s})', repeat('5', 64))),
  ('not_found', '(not_found,,)'),
  ('withheld', '(withheld,,)'),
  ('unavailable', '(unavailable,,)');
CREATE FUNCTION pg_temp.expected(p_name text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT val FROM expected WHERE name = p_name $$;

-- Shape: owners, definer, search_path, grants, the document as the only input.
SELECT is((SELECT proowner::regrole::text FROM pg_proc WHERE oid = 'app.read_process_summary_source(text)'::regprocedure),
  'ductus_identity', 'the identity role owns the read RPC');
SELECT is((SELECT proowner::regrole::text FROM pg_proc WHERE oid = 'app.process_summary_cut(text,timestamptz)'::regprocedure),
  'ductus_evidence', 'the evidence role owns the one helper that reads segments');
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.oid IN ('app.read_process_summary_source(text)'::regprocedure,
                      'app.process_summary_cut(text,timestamptz)'::regprocedure)
        AND NOT (p.prosecdef AND 'search_path=""' = ANY (p.proconfig)) $$,
  'both functions are SECURITY DEFINER with an empty search_path');
SELECT bag_eq(
  $$ SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth',
                                'ductus_identity', 'ductus_test_stranger']) AS r
      WHERE has_function_privilege(r, 'app.read_process_summary_source(text)', 'EXECUTE') $$,
  $$ VALUES ('ductus_app'), ('ductus_identity') $$,
  'only the web role and the owner execute the read RPC');
SELECT bag_eq(
  $$ SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth',
                                'ductus_identity', 'ductus_test_stranger']) AS r
      WHERE has_function_privilege(r, 'app.process_summary_cut(text,timestamptz)', 'EXECUTE') $$,
  $$ VALUES ('ductus_identity') $$,
  'only the identity role executes the cut helper; the web role names no time (item 62)');
SELECT is((SELECT proargnames[1:pronargs]::text FROM pg_proc
  WHERE oid = 'app.read_process_summary_source(text)'::regprocedure),
  '{p_document_id}', 'the read RPC takes only the document: no role, institution, threshold or time (item 62)');
SELECT is(pg_get_function_result('app.read_process_summary_source(text)'::regprocedure),
  'TABLE(outcome text, evidence_package_id text, segment_hashes text[])',
  'the read RPC returns an outcome, a package and segment hashes, nothing about who asks');
SELECT ok(NOT has_schema_privilege('ductus_identity', 'evidence', 'USAGE')
  AND NOT has_schema_privilege('ductus_identity', 'app', 'CREATE')
  AND NOT has_schema_privilege('ductus_evidence', 'app', 'CREATE')
  AND NOT pg_has_role('ductus_identity', 'ductus_evidence', 'MEMBER'),
  'the migration leaves no schema right or role membership behind');

-- One answer for the owner and the teacher (items 1, 2, 7). The cut ends
-- before the current P-03 window: segment-a3 was accepted inside it.
SELECT is(pg_temp.source(a.name, 'doc-a'), pg_temp.expected('a'),
  a.name || ' gets package pkg-a and the two segments accepted before the current window, in chain order')
FROM (VALUES ('ana'), ('vesna')) AS a (name);
SELECT is(pg_temp.source(a.name, 'doc-b'), pg_temp.expected('b'),
  a.name || ' reads Tomo''s record in fak-b')
FROM (VALUES ('tomo'), ('petra')) AS a (name);

-- Refusal looks like absence (items 11 to 13, 17, 18).
SELECT is(pg_temp.source(a.name, 'doc-a'), pg_temp.expected('not_found'),
  a.name || ' gets the answer for a missing document on Ana''s')
FROM (VALUES ('dora'), ('marko'), ('iva'), ('boris'), ('nina'), ('lea'), ('petra'), ('tomo'),
             ('anon'), ('expired'), ('closed'), ('unknown')) AS a (name);
SELECT is(pg_temp.source('vesna', d.id), pg_temp.expected('not_found'),
  'Vesna gets not_found for ' || d.label)
FROM (VALUES ('doc-b', 'a document of fak-b'), ('doc-nema', 'a missing document'), ('', 'an empty id'),
             (' doc-a', 'an id with a blank at its edge'), ('doc-a' || chr(1), 'an id with a control character'),
             (repeat('x', 257), 'an id longer than 256 characters')) AS d (id, label);
SELECT is(pg_temp.ask('vesna', $$ SELECT row(outcome, evidence_package_id, segment_hashes)::text
  FROM app.read_process_summary_source(NULL) $$), pg_temp.expected('not_found'), 'Vesna gets not_found for a null id');

-- D-37 (item 8): a short assignment shows nothing before submission, to
-- every reader alike; a refused reader still gets the absence answer.
SELECT is(pg_temp.source(a.name, 'doc-short'), pg_temp.expected('withheld'),
  a.name || ' gets withheld for Ana''s document on the short assignment Z4')
FROM (VALUES ('ana'), ('vesna')) AS a (name);
SELECT is(pg_temp.source(a.name, 'doc-short'), pg_temp.expected('not_found'),
  a.name || ' does not learn that the short assignment has a document')
FROM (VALUES ('dora'), ('marko'), ('petra')) AS a (name);

-- No package or two packages: no guess which record is the work's.
SELECT is(pg_temp.source(a.name, d.id), pg_temp.expected('unavailable'),
  a.name || ' gets unavailable for ' || d.label)
FROM (VALUES ('ana'), ('vesna')) AS a (name)
CROSS JOIN (VALUES ('doc-none', 'a document without a package'), ('doc-two', 'a document with two packages')) AS d (id, label);

-- Revocation is immediate (item 17): Vesna leaves K1, Ana is unaffected.
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('vesna');
SELECT is(pg_temp.source('vesna', 'doc-a'), pg_temp.expected('not_found'),
  'a teacher who left the course reads nothing at once');
SELECT is(pg_temp.source('ana', 'doc-a'), pg_temp.expected('a'), 'the owner still reads her record');

SELECT * FROM finish();
ROLLBACK;

-- DAN-228, step 2: a teacher's read of the live view and of the process
-- summary writes the access log in the same transaction; one row per reader,
-- work and surface for each 5-minute interval (owner answers on #497, comment
-- 6267554715). The owning student's reads and refused reads write nothing,
-- and a read whose row cannot be written fails. Every person, document and
-- text below is invented (fixtures/institution.inc).
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';
SELECT no_plan();

-- doc-a of Ana on Z1 with a package and one segment; doc-d of Dora on Z1
-- without a package and without a live state; doc-b of Tomo on Z3 (fak-b).
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.domain (id, institution_id, region) VALUES
  ('00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), 'eu-central-1');
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES
  ('project-a', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('ana')),
  ('project-d', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('dora')),
  ('project-b', pg_temp.id('fak_b'), pg_temp.id('z3'), pg_temp.id('tomo'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash) VALUES
  ('doc-a', pg_temp.id('fak_a'), 'project-a', pg_temp.id('ana'), repeat('a', 64)),
  ('doc-d', pg_temp.id('fak_a'), 'project-d', pg_temp.id('dora'), repeat('d', 64)),
  ('doc-b', pg_temp.id('fak_b'), 'project-b', pg_temp.id('tomo'), repeat('c', 64));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash)
SELECT id, institution_id, 0, principal_id, current_content_hash FROM evidence.document;
INSERT INTO evidence.package (
  id, institution_id, evidence_domain_id, document_id, project_id, principal_id, evidence_profile_id, max_payload_bytes
) VALUES
  ('pkg-a', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1', 'doc-a', 'project-a', pg_temp.id('ana'), 'standard-v1', 2097152);
INSERT INTO evidence.segment (
  id, evidence_package_id, institution_id, document_id, principal_id, session_id, sequence_from, sequence_to,
  event_count, descriptor, segment_hash, payload_bytes, storage_ref, accepted_at
) VALUES
  ('segment-a', 'pkg-a', pg_temp.id('fak_a'), 'doc-a', pg_temp.id('ana'), 'synthetic-session-a', 1, 1, 1,
   jsonb_build_object('segmentHash', repeat('b', 64), 'payloadBytes', 123), repeat('b', 64), 123,
   'synthetic://pkg-a/segment-a', now());
INSERT INTO evidence.receipt (
  id, evidence_package_id, institution_id, evidence_domain_id, segment_id, principal_id, client_request_id,
  payload_sha256, descriptor, receipt_payload, status
) VALUES ('00000000-0000-4000-8000-0000000000e1', 'pkg-a', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1',
  'segment-a', pg_temp.id('ana'), 'synthetic-request-a', repeat('b', 64), '{}', '{}', 'pending_signature');
RESET ROLE;
UPDATE evidence.package SET head_receipt_id = '00000000-0000-4000-8000-0000000000e1',
  head_segment_hash = repeat('b', 64), last_sequence_to = 1 WHERE id = 'pkg-a';
SET CONSTRAINTS ALL IMMEDIATE;

INSERT INTO ref VALUES
  ('body', '{"content":[{"content":[{"text":"Prva rečenica.","type":"text"}],"type":"paragraph"}],"type":"doc"}');
-- Marko becomes a second teacher of K1, for a reader with no row yet.
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('marko'), 'teacher');

CREATE FUNCTION pg_temp.live(p_actor text, p_document text, p_known text DEFAULT repeat('0', 64)) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    $q$ SELECT outcome FROM collaboration.read_live_state(%L, %L) $q$, p_document, p_known))
$$;
CREATE FUNCTION pg_temp.summary(p_actor text, p_document text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    $q$ SELECT outcome FROM app.read_process_summary_source(%L) $q$, p_document))
$$;
-- The interval of this transaction, as the reads compute it.
CREATE FUNCTION pg_temp.now_interval() RETURNS timestamptz
LANGUAGE sql STABLE AS $$ SELECT date_bin('5 minutes', now(), timestamptz '2000-01-01 00:00:00+00') $$;
-- Every row of the log, one line each, with names in place of ids.
CREATE FUNCTION pg_temp.log() RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(line ORDER BY line), '{}') FROM (
    SELECT format('%s|%s|%s|%s|%s|%s|%s|%s', l.document_id, i.name, z.name, o.name, r.name, l.reader_role, l.surface,
                  CASE WHEN l.opened_at = pg_temp.now_interval() THEN 'now' ELSE 'earlier' END) AS line
    FROM audit.access_log l
    JOIN ref i ON i.val = l.institution_id::text
    JOIN ref z ON z.val = l.assignment_id::text
    JOIN ref o ON o.val = l.owner_id::text
    JOIN ref r ON r.val = l.reader_id::text
  ) AS t
$$;
CREATE FUNCTION pg_temp.val(p_name text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT val FROM ref WHERE name = p_name $$;

-- Catalogue: both reads write now; the writer runs for no runtime role.
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.oid IN ('collaboration.read_live_state(text,text)'::regprocedure,
                      'app.read_process_summary_source(text)'::regprocedure)
        AND NOT (p.provolatile = 'v' AND p.prosecdef AND p.proowner = 'ductus_identity'::regrole
                 AND 'search_path=""' = ANY (p.proconfig)) $$,
  'both reads are VOLATILE SECURITY DEFINER functions of the identity role with an empty search_path');
SELECT is(
  (SELECT format('%s %s %s %s', proowner::regrole, prosecdef, 'search_path=""' = ANY (proconfig), proargnames)
     FROM pg_proc WHERE oid = 'audit.record_work_opening(uuid,text,uuid,uuid,text)'::regprocedure),
  'ductus_identity f t {p_institution_id,p_document_id,p_assignment_id,p_owner_id,p_surface}',
  'the writer belongs to the identity role, is no SECURITY DEFINER and takes no reader');
SELECT is_empty(
  $$ SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence',
                                'ductus_test_stranger']) AS r
      WHERE has_function_privilege(r, 'audit.record_work_opening(uuid,text,uuid,uuid,text)', 'EXECUTE') $$,
  'no runtime role calls the writer');
SELECT ok(NOT has_schema_privilege('ductus_app', 'audit', 'USAGE'), 'the web role still has no way into audit');
SELECT ok(NOT has_schema_privilege('ductus_identity', 'audit', 'CREATE')
  AND NOT has_schema_privilege('ductus_identity', 'collaboration', 'CREATE')
  AND NOT has_schema_privilege('ductus_identity', 'app', 'CREATE'),
  'the migration leaves no CREATE right behind');
SELECT is(pg_temp.ask('vesna', 'SELECT audit.record_work_opening(NULL, NULL, NULL, NULL, NULL)'),
  '42501: permission denied for schema audit', 'the web role cannot call the writer');
SELECT has_index('audit', 'access_log', 'access_log_opening_idx', 'one row per reader, work, surface and interval');
SELECT index_is_unique('audit', 'access_log', 'access_log_opening_idx', 'and the index enforces it');
-- A row holds the start of its interval and nothing finer, for the owner too.
SELECT is(left(pg_temp.ask_as('ductus_identity', 'anon', format(
  $q$ INSERT INTO audit.access_log (institution_id, document_id, assignment_id, owner_id, reader_id, reader_role, surface, opened_at)
      VALUES (%L, 'doc-a', %L, %L, %L, 'teacher', 'live_view', '2026-10-19 12:06:00+00') RETURNING 'written' $q$,
  pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('ana'), pg_temp.id('vesna'))), 6),
  '23514:', 'a time inside an interval is refused');

-- Ana publishes; her own reads write nothing.
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM collaboration.publish_live_state('doc-a', NULL, {body}) $$),
  'accepted', 'Ana publishes doc-a');
SELECT is(pg_temp.live('ana', 'doc-a'), 'state', 'Ana reads her live view');
SELECT is(pg_temp.summary('ana', 'doc-a'), 'found', 'Ana reads her summary');
SELECT is(pg_temp.log(), '{}'::text[], 'the owning student''s reads write nothing');

-- Refused reads write nothing.
SELECT is(pg_temp.live(a.name, 'doc-a'), 'ZD403: forbidden', a.name || ' may not read the live view of doc-a')
FROM (VALUES ('dora'), ('petra'), ('iva'), ('boris')) AS a (name);
SELECT is(pg_temp.live('anon', 'doc-a'), 'ZD401: not authenticated', 'no session reads nothing');
SELECT is(pg_temp.live('vesna', 'doc-a', 'zz'), 'ZD422: invalid input', 'a malformed known hash is refused');
SELECT is(pg_temp.live('vesna', 'doc-nema'), 'ZD403: forbidden', 'a missing document is refused');
SELECT is(pg_temp.summary(a.name, 'doc-a'), 'not_found', a.name || ' may not read the summary of doc-a')
FROM (VALUES ('dora'), ('petra'), ('iva')) AS a (name);
SELECT is(pg_temp.summary('vesna', 'doc-b'), 'not_found', 'Vesna may not read the summary of a fak-b work');
SELECT is(pg_temp.log(), '{}'::text[], 'refused reads write nothing');

-- An earlier interval does not cover this one.
SET LOCAL ROLE ductus_identity;
INSERT INTO audit.access_log (institution_id, document_id, assignment_id, owner_id, reader_id, reader_role, surface, opened_at)
VALUES (pg_temp.id('fak_a'), 'doc-a', pg_temp.id('z1'), pg_temp.id('ana'), pg_temp.id('vesna'), 'teacher', 'live_view',
        pg_temp.now_interval() - interval '5 minutes');
RESET ROLE;

-- Vesna reads every second: one row per surface and interval, whatever the outcome.
SELECT is(pg_temp.live('vesna', 'doc-a'), 'state', 'Vesna reads the live view of doc-a');
SELECT is(pg_temp.live('vesna', 'doc-a'), 'state', 'and again');
SELECT is(pg_temp.live('vesna', 'doc-a', encode(sha256(convert_to(pg_temp.val('body'), 'UTF8')), 'hex')), 'unchanged',
  'and again with the hash she holds');
SELECT is(pg_temp.live('vesna', 'doc-d'), 'empty', 'Vesna opens the live view of doc-d, where nothing is published');
SELECT is(pg_temp.summary('vesna', 'doc-a'), 'found', 'Vesna reads the summary of doc-a');
SELECT is(pg_temp.summary('vesna', 'doc-a'), 'found', 'and again');
SELECT is(pg_temp.summary('vesna', 'doc-d'), 'unavailable', 'Vesna opens the summary of doc-d, which has no record');
SELECT is(pg_temp.log(), ARRAY[
  'doc-a|fak_a|z1|ana|vesna|teacher|live_view|earlier',
  'doc-a|fak_a|z1|ana|vesna|teacher|live_view|now',
  'doc-a|fak_a|z1|ana|vesna|teacher|process_summary|now',
  'doc-d|fak_a|z1|dora|vesna|teacher|live_view|now',
  'doc-d|fak_a|z1|dora|vesna|teacher|process_summary|now'
], 'one row per work, surface and interval, with the scope of the work and the reader from the session');

-- No read without its row: a log that refuses the row fails the read.
CREATE TRIGGER access_log_refuse_insert BEFORE INSERT ON audit.access_log
  FOR EACH ROW EXECUTE FUNCTION audit.reject_change();
SELECT is(pg_temp.live('marko', 'doc-a'), 'ZD403: append-only row',
  'when the row cannot be written, Marko gets no live view');
SELECT is(pg_temp.summary('marko', 'doc-a'), 'ZD403: append-only row',
  'when the row cannot be written, Marko gets no summary');
SELECT is(pg_temp.live('ana', 'doc-a'), 'state', 'the owner''s read writes no row, so it is not affected');
DROP TRIGGER access_log_refuse_insert ON audit.access_log;
SELECT is(pg_temp.live('marko', 'doc-a'), 'state', 'with the log working again Marko reads');
SELECT is(cardinality(pg_temp.log()), 6, 'and his opening is the one new row');

-- Revocation is immediate: a teacher who left the course reads and writes nothing.
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('vesna');
SELECT is(pg_temp.live('vesna', 'doc-a'), 'ZD403: forbidden', 'Vesna, gone from K1, reads no live view');
SELECT is(pg_temp.summary('vesna', 'doc-a'), 'not_found', 'nor the summary');
SELECT is(cardinality(pg_temp.log()), 6, 'and writes no row');

SELECT * FROM finish();
ROLLBACK;

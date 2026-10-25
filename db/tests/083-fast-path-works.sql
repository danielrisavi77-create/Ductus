-- B-11b / DAN-308: the teacher's fast path (#757, QA criteria D5 B-11b, P-03
-- window D3). One call returns every enrolled student of an assignment with
-- the name pair, the work at the window's revision and its text, and writes
-- the teacher's opening of each text to the access log. Every person, name,
-- document and text below is invented (fixtures/institution.inc).
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

-- Ana has a name pair and doc-a on Z1 at revision 0; Dora has no name and no
-- work yet. Tomo's doc-b on Z3 has no checkpoint at revision 0.
INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body)
VALUES ('doc-a', pg_temp.id('fak_a'), 0, repeat('a', 64));
INSERT INTO identity.person_name (user_id, institution_id, given_name, family_name)
VALUES (pg_temp.id('ana'), pg_temp.id('fak_a'), 'Ana', 'Testić');

-- One line per returned row, ids replaced by fixture names; hashes and texts
-- as their first letter (and the text's length). "-" is null.
CREATE FUNCTION pg_temp.fp(p_actor text, p_assignment text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v text;
  p record;
BEGIN
  v := pg_temp.ask(p_actor, format($q$
    SELECT coalesce(string_agg(concat_ws('|', student_id, coalesce(given_name, '-'), coalesce(family_name, '-'),
             coalesce(document_id, '-'), coalesce(submitted::text, '-'), coalesce(revision::text, '-'),
             coalesce(evidence_package_id, '-'), coalesce(left(head_segment_hash, 1), '-'),
             CASE WHEN segment_hashes IS NULL THEN '-'
                  ELSE '{' || array_to_string(ARRAY(SELECT left(h, 1) FROM unnest(segment_hashes) h), '') || '}' END,
             coalesce(left(body, 1) || length(body), '-')), '; ' ORDER BY student_id), 'empty')
      FROM app.fast_path_works(%s) $q$, p_assignment));
  FOR p IN SELECT name, id FROM person LOOP
    v := replace(v, p.id::text, p.name);
  END LOOP;
  RETURN v;
END
$$;
CREATE FUNCTION pg_temp.fast_path_rows() RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM audit.access_log WHERE surface = 'fast_path'
$$;
CREATE FUNCTION pg_temp.windows() RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM evidence.fast_path_window
$$;
-- Moves every window of p_reader back by P-03, as if it had expired.
CREATE FUNCTION pg_temp.expire(p_reader text) RETURNS void LANGUAGE sql AS $$
  UPDATE evidence.fast_path_window SET opened_at = opened_at - interval '5 minutes'
   WHERE reader_id = pg_temp.id(p_reader)
$$;
-- Row counts of every evidence and submission table, to show the read writes none.
CREATE FUNCTION pg_temp.evidence_counts() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(format('%s=%s', c.oid::regclass,
           (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %s', c.oid::regclass), false, true, '')))[1]),
         ' ' ORDER BY c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'evidence' AND c.relkind = 'r' AND c.relname <> 'fast_path_window'
$$;

-- Catalogue (criteria 8, 9).
SELECT is(
  (SELECT format('%s %s %s %s', proowner::regrole, prosecdef, provolatile, 'search_path=""' = ANY (proconfig))
     FROM pg_proc WHERE oid = 'app.fast_path_works(uuid)'::regprocedure),
  'ductus_evidence t v t', 'the fast path is a VOLATILE SECURITY DEFINER function of the evidence role, empty search_path');
SELECT is(pg_get_function_result('app.fast_path_works(uuid)'::regprocedure),
  'TABLE(student_id uuid, given_name text, family_name text, document_id text, submitted boolean, revision bigint, '
  'evidence_package_id text, head_segment_hash text, segment_hashes text[], body text)',
  'it returns the student, the name pair and the work, nothing else about the person');
SELECT bag_eq(
  $$ SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_identity',
                                'ductus_evidence', 'ductus_test_stranger']) AS r
      WHERE has_function_privilege(r, 'app.fast_path_works(uuid)', 'EXECUTE') $$,
  $$ VALUES ('ductus_app'), ('ductus_evidence') $$, 'only the web role and the owner execute the fast path');
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p, aclexplode(p.proacl) a
      WHERE p.oid IN ('app.fast_path_works(uuid)'::regprocedure,
                      'app.teacher_assignment_student_names(uuid)'::regprocedure,
                      'app.record_fast_path_opening(text)'::regprocedure)
        AND a.grantee = 0 $$,
  'PUBLIC executes none of the three functions');
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.oid IN ('app.teacher_assignment_student_names(uuid)'::regprocedure,
                      'app.record_fast_path_opening(text)'::regprocedure)
        AND NOT (p.proowner = 'ductus_identity'::regrole AND p.prosecdef AND 'search_path=""' = ANY (p.proconfig)) $$,
  'the name and opening helpers are SECURITY DEFINER functions of the identity role with an empty search_path');
SELECT bag_eq(
  $$ SELECT f || ' ' || r FROM unnest(ARRAY['app.teacher_assignment_student_names(uuid)',
                                            'app.record_fast_path_opening(text)']) AS f,
                             unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth',
                                          'ductus_evidence', 'ductus_test_stranger']) AS r
      WHERE has_function_privilege(r, f, 'EXECUTE') $$,
  $$ VALUES ('app.teacher_assignment_student_names(uuid) ductus_evidence'),
            ('app.record_fast_path_opening(text) ductus_evidence') $$,
  'of the runtime roles only the evidence role reaches the names and the opening writer');
SELECT is(
  (SELECT format('%s %s %s', relowner::regrole, relrowsecurity, relforcerowsecurity)
     FROM pg_class WHERE oid = 'evidence.fast_path_window'::regclass),
  'ductus_evidence t t', 'the window table belongs to the evidence role with ENABLE and FORCE RLS');
SELECT is_empty(
  $$ SELECT r || ' ' || t || ' ' || p
       FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_identity',
                         'ductus_test_stranger']) AS r,
            unnest(ARRAY['evidence.fast_path_window', 'evidence.document_checkpoint', 'identity.person_name']) AS t,
            unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p
      WHERE has_table_privilege(r, t, p) AND NOT (r = 'ductus_identity' AND t = 'identity.person_name') $$,
  'no runtime role reads or writes the window, the checkpoints or the names directly');
SELECT is((SELECT relacl FROM pg_class WHERE oid = 'evidence.fast_path_window'::regclass), NULL,
  'the window table has no grant at all');
SELECT ok(pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'access_log_surface_check'))
  LIKE '%fast_path%', 'the access log accepts the fast_path surface');
SELECT ok(NOT has_schema_privilege('ductus_identity', 'evidence', 'USAGE')
  AND NOT has_schema_privilege('ductus_identity', 'evidence', 'CREATE')
  AND NOT has_schema_privilege('ductus_evidence', 'evidence', 'CREATE')
  AND NOT has_schema_privilege('ductus_identity', 'app', 'CREATE')
  AND NOT has_schema_privilege('ductus_evidence', 'app', 'CREATE')
  AND NOT pg_has_role('ductus_identity', 'ductus_evidence', 'MEMBER'),
  'the migration leaves no schema right or role membership behind');

-- Criterion 1: everyone but the teacher of the assignment, and a missing
-- assignment, get the same empty set; no window and no log row.
SELECT is(pg_temp.fp(a.name, quote_literal(pg_temp.id('z1')) || '::uuid'), 'empty',
  a.name || ' gets the empty set for Z1')
FROM (VALUES ('marko'), ('petra'), ('ana'), ('dora'), ('iva'), ('boris'), ('nina'), ('lea'), ('tomo')) AS a (name);
SELECT is(pg_temp.fp('vesna', z.arg), 'empty', 'Vesna gets the empty set for ' || z.label)
FROM (VALUES (quote_literal(pg_temp.id('z3')) || '::uuid', 'Z3 of fak-b'),
             (quote_literal(pg_temp.id('z2')) || '::uuid', 'Z2 of another course'),
             ('''00000000-0000-4000-8000-0000000000ff''::uuid', 'a missing assignment'),
             ('NULL', 'a null assignment')) AS z (arg, label);
SELECT is(pg_temp.windows(), 0::bigint, 'an empty set opens no window');
SELECT is(pg_temp.fast_path_rows(), 0::bigint, 'and writes no log row');

-- Criterion 2.
SELECT is(pg_temp.fp(a.name, quote_literal(pg_temp.id('z1')) || '::uuid'), 'ZD401: not authenticated',
  a.name || ' is not signed in')
FROM (VALUES ('anon'), ('expired'), ('closed'), ('unknown')) AS a (name);

-- The first read opens Vesna's window (criteria 4, 6): Ana at revision 0
-- with her name, Dora without a name and without a work.
SELECT is(pg_temp.fp('vesna', quote_literal(pg_temp.id('z1')) || '::uuid'),
  'ana|Ana|Testić|doc-a|false|0|pkg-a|-|{}|a64; dora|-|-|-|-|-|-|-|-|-',
  'Vesna reads Ana''s work at revision 0 and Dora with no name and no work');
SELECT is((SELECT works FROM evidence.fast_path_window WHERE reader_id = pg_temp.id('vesna')),
  '{"doc-a": {"revision": 0, "submitted": false}}'::jsonb,
  'the window holds only the revision and the submission flag per work');
SELECT is(pg_temp.fast_path_rows(), 1::bigint, 'one log row for the one text read (criterion 5)');
SELECT is((SELECT format('%s %s %s %s', document_id, owner_id = pg_temp.id('ana'), reader_id = pg_temp.id('vesna'), reader_role)
  FROM audit.access_log WHERE surface = 'fast_path'), 'doc-a t t teacher', 'the row names the work, its owner and the reader');

-- A wrong grant shows the web role nothing: the only policy is the owner's.
GRANT SELECT ON evidence.fast_path_window TO ductus_app;
SELECT is(pg_temp.ask('vesna', 'SELECT count(*) FROM evidence.fast_path_window'), '0',
  'with a wrong grant the web role still sees no window row');
REVOKE SELECT ON evidence.fast_path_window FROM ductus_app;

-- Criterion 7: within the window a new commit and a new work do not show.
SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'reserved', 'fixture: Ana commits revision 1');
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES
  ('project-d', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('dora'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash) VALUES
  ('doc-d', pg_temp.id('fak_a'), 'project-d', pg_temp.id('dora'), pg_temp.h('f'));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash) VALUES
  ('doc-d', pg_temp.id('fak_a'), 0, pg_temp.id('dora'), pg_temp.h('f'));
INSERT INTO evidence.package (
  id, institution_id, evidence_domain_id, document_id, project_id, principal_id, evidence_profile_id, max_payload_bytes
) VALUES ('pkg-d', pg_temp.id('fak_a'), '00000000-0000-4000-8000-0000000000d1', 'doc-d', 'project-d',
  pg_temp.id('dora'), 'standard-v1', 2097152);
INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body)
VALUES ('doc-d', pg_temp.id('fak_a'), 0, repeat('f', 64));
SET CONSTRAINTS ALL IMMEDIATE;
-- Back to the initially deferred default, which commit_evidence_segment relies on.
SET CONSTRAINTS ALL DEFERRED;
RESET ROLE;
SELECT is(pg_temp.fp('vesna', quote_literal(pg_temp.id('z1')) || '::uuid'),
  'ana|Ana|Testić|doc-a|false|0|pkg-a|-|{}|a64; dora|-|-|-|-|-|-|-|-|-',
  'within the window Vesna still reads revision 0 and Dora''s new work has no record yet');
SELECT is(pg_temp.fast_path_rows(), 1::bigint, 'a read within the same 5-minute interval adds no row');

-- After P-03 the next read opens a new window with the current state.
SELECT pg_temp.expire('vesna');
SELECT is(pg_temp.fp('vesna', quote_literal(pg_temp.id('z1')) || '::uuid'),
  'ana|Ana|Testić|doc-a|false|1|pkg-a|b|{b}|d64; dora|-|-|doc-d|false|0|pkg-d|-|{}|f64',
  'after P-03 Vesna reads revision 1 of Ana''s work and Dora''s new work');
SELECT is(pg_temp.fast_path_rows(), 2::bigint, 'and Dora''s text is logged once');
-- Criterion 4: head and listing are those of the process summary record.
SELECT is(
  pg_temp.ask('vesna', format($q$ SELECT row(evidence_package_id, head_segment_hash, segment_hashes)::text
    FROM app.fast_path_works(%L) WHERE document_id = 'doc-a' $q$, pg_temp.id('z1'))),
  pg_temp.ask_as('ductus_identity', 'vesna', $q$ SELECT row(evidence_package_id, head_segment_hash, segment_hashes)::text
    FROM app.process_summary_record('doc-a') $q$),
  'a fresh window carries the package, head and listing of app.process_summary_record');

-- Ana commits revision 2 and submits it: Vesna's window still shows revision
-- 1, not submitted, with the listing cut at it.
SELECT is(pg_temp.call('ana','pkg-a','request-2',
    pg_temp.descriptor(p_segment=>'segment-a-2',p_sequence_from=>2,p_sequence_to=>2,p_hash=>repeat('c',64),
      p_predecessor=>repeat('b',64)),1,repeat('d',64),repeat('e',64),repeat('c',64)),
  'reserved', 'fixture: Ana commits revision 2');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a', 2) $$), 'requested',
  'fixture: Ana requests revision 2');
SELECT is(pg_temp.ask('ana', format($$ SELECT outcome FROM app.record_submission(%L, %L) $$,
    (SELECT id FROM evidence.submission_request WHERE principal_id = pg_temp.id('ana')), pg_temp.h('e'))),
  'recorded', 'fixture: Ana submits revision 2');
SELECT is(pg_temp.fp('vesna', quote_literal(pg_temp.id('z1')) || '::uuid'),
  'ana|Ana|Testić|doc-a|false|1|pkg-a|b|{b}|d64; dora|-|-|doc-d|false|0|pkg-d|-|{}|f64',
  'within the window the new revision and the submission do not show, and the listing ends at revision 1');

-- Marko becomes a second teacher of K1: his window is his own.
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('marko'), 'teacher');
SELECT is(pg_temp.fp('marko', quote_literal(pg_temp.id('z1')) || '::uuid'),
  'ana|Ana|Testić|doc-a|true|2|pkg-a|c|{bc}|e64; dora|-|-|doc-d|false|0|pkg-d|-|{}|f64',
  'Marko''s first read opens his own window at the submitted revision 2');
SELECT is(pg_temp.fp('vesna', quote_literal(pg_temp.id('z1')) || '::uuid'),
  'ana|Ana|Testić|doc-a|false|1|pkg-a|b|{b}|d64; dora|-|-|doc-d|false|0|pkg-d|-|{}|f64',
  'and Vesna''s window is not moved by his');
SELECT pg_temp.expire('vesna');
SELECT is(pg_temp.fp('vesna', quote_literal(pg_temp.id('z1')) || '::uuid'),
  'ana|Ana|Testić|doc-a|true|2|pkg-a|c|{bc}|e64; dora|-|-|doc-d|false|0|pkg-d|-|{}|f64',
  'after P-03 Vesna reads the submitted revision 2');
SELECT is(
  pg_temp.ask('vesna', format($q$ SELECT row(evidence_package_id, head_segment_hash, segment_hashes)::text
    FROM app.fast_path_works(%L) WHERE document_id = 'doc-a' $q$, pg_temp.id('z1'))),
  pg_temp.ask_as('ductus_identity', 'vesna', $q$ SELECT row(evidence_package_id, head_segment_hash, segment_hashes)::text
    FROM app.process_summary_record('doc-a') $q$),
  'for the submitted work too the row carries the record of app.process_summary_record');
SELECT is((SELECT array_agg(format('%s %s', d.name, r.name) ORDER BY d.name, r.name)
  FROM audit.access_log l JOIN person d ON d.id = l.owner_id JOIN person r ON r.id = l.reader_id
  WHERE l.surface = 'fast_path'),
  ARRAY['ana marko', 'ana vesna', 'dora marko', 'dora vesna'],
  'one row per reader and work in this interval, however often they read');

-- Criterion 10: a read that opens a window writes nothing in evidence but the window.
CREATE TEMP TABLE before_read AS SELECT pg_temp.evidence_counts() AS counts;
SELECT pg_temp.expire('vesna');
SELECT isnt(pg_temp.fp('vesna', quote_literal(pg_temp.id('z1')) || '::uuid'), 'empty', 'Vesna reads again in a new window');
SELECT is(pg_temp.evidence_counts(), (SELECT counts FROM before_read), 'no evidence or submission table changed');

-- Criterion 5: no read without its row; the window is not moved either.
SELECT pg_temp.expire('vesna');
CREATE TRIGGER access_log_refuse_insert BEFORE INSERT ON audit.access_log
  FOR EACH ROW EXECUTE FUNCTION audit.reject_change();
SELECT is(pg_temp.fp('vesna', quote_literal(pg_temp.id('z1')) || '::uuid'), 'ZD403: append-only row',
  'when the row cannot be written, Vesna gets nothing');
DROP TRIGGER access_log_refuse_insert ON audit.access_log;
SELECT ok((SELECT opened_at < now() FROM evidence.fast_path_window WHERE reader_id = pg_temp.id('vesna')),
  'and the failed read did not open a new window');

-- A work whose checkpoint is missing fails the whole call (ZD503), with no
-- window and no row.
SELECT is(pg_temp.fp('petra', quote_literal(pg_temp.id('z3')) || '::uuid'), 'ZD503: work unavailable',
  'Petra gets no partial list when Tomo''s checkpoint is missing');
SELECT is((SELECT count(*) FROM evidence.fast_path_window WHERE reader_id = pg_temp.id('petra')), 0::bigint,
  'and no window');
SELECT is((SELECT count(*) FROM audit.access_log WHERE reader_id = pg_temp.id('petra')), 0::bigint, 'and no row');

-- Criterion 3: the list of students is always current.
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('dora');
SELECT is(pg_temp.fp('vesna', quote_literal(pg_temp.id('z1')) || '::uuid'),
  'ana|Ana|Testić|doc-a|true|2|pkg-a|c|{bc}|e64',
  'a student whose membership closed is gone at once, within the window too');
-- A teacher who left the course reads nothing.
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('vesna');
SELECT is(pg_temp.fp('vesna', quote_literal(pg_temp.id('z1')) || '::uuid'), 'empty',
  'Vesna, gone from K1, gets the empty set');

SELECT * FROM finish();
ROLLBACK;

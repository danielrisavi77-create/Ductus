-- DAN-344 PR A (contract on #923, comment 6429438582): the record and the
-- checkpoint texts the replay of a work is read from. Every person, document,
-- text and hash below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

-- The whole row of a source read, to compare the replay with the summary.
CREATE FUNCTION pg_temp.row_of(p_actor text, p_function text, p_document text DEFAULT 'doc-a') RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    $q$ SELECT row(outcome, institution_id, evidence_package_id, segment_hashes)::text FROM app.%I(%L) $q$,
    p_function, p_document))
$$;
-- outcome, segment count and the first letter of the last segment hash.
CREATE FUNCTION pg_temp.source(p_actor text, p_document text DEFAULT 'doc-a') RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format($q$ SELECT concat_ws(' ', outcome, cardinality(segment_hashes),
      left(segment_hashes[cardinality(segment_hashes)], 1))
    FROM app.read_replay_source(%L) $q$, p_document))
$$;
-- The first letter of every text returned, in order, with "!" after one whose
-- bytes do not hash to the hash it came with; "-" for no row.
CREATE FUNCTION pg_temp.texts(p_actor text, p_hashes text[], p_document text DEFAULT 'doc-a') RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    $q$ SELECT coalesce(string_agg(left(body, 1)
               || CASE WHEN content_hash = encode(sha256(convert_to(body, 'UTF8')), 'hex') THEN '' ELSE '!' END,
               ',' ORDER BY body), '-')
          FROM app.read_replay_checkpoints(%L, %L::text[]) $q$, p_document, p_hashes))
$$;
CREATE FUNCTION pg_temp.req() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT id::text FROM evidence.submission_request WHERE document_id = 'doc-a'
$$;
-- The replay rows of the access log, one line each, with names in place of ids.
CREATE FUNCTION pg_temp.replay_log() RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(format('%s|%s|%s|%s', l.document_id, o.name, r.name, l.reader_role)
                             ORDER BY l.document_id, r.name), '{}')
    FROM audit.access_log l
    JOIN ref o ON o.val = l.owner_id::text
    JOIN ref r ON r.val = l.reader_id::text
   WHERE l.surface = 'replay'
$$;
CREATE TEMP TABLE hashes (name text PRIMARY KEY, val text[] NOT NULL);
INSERT INTO hashes VALUES ('def', ARRAY[pg_temp.h('d'), pg_temp.h('e'), pg_temp.h('f')]);
CREATE FUNCTION pg_temp.def() RETURNS text[] LANGUAGE sql STABLE AS $$ SELECT val FROM hashes WHERE name = 'def' $$;

-- Ana commits revision 1 (segment b...b) and requests it, then revisions 2
-- (c...c) and 3 (9...9); Tomo commits revision 1 of doc-b, whose text is the
-- same as Ana's revision 1.
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64),
  repeat('b', 64)), 'reserved', 'fixture: Ana commits revision 1');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a', 1) $$), 'requested',
  'fixture: Ana requests revision 1');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-2',
    pg_temp.descriptor(p_segment => 'segment-a-2', p_sequence_from => 2, p_sequence_to => 2,
                       p_hash => repeat('c', 64), p_predecessor => repeat('b', 64)),
    1, repeat('d', 64), repeat('e', 64), repeat('c', 64)), 'reserved', 'fixture: Ana commits revision 2');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-3',
    pg_temp.descriptor(p_segment => 'segment-a-3', p_sequence_from => 3, p_sequence_to => 3,
                       p_hash => repeat('9', 64), p_predecessor => repeat('c', 64)),
    2, repeat('e', 64), repeat('f', 64), repeat('9', 64)), 'reserved', 'fixture: Ana commits revision 3');
SELECT is(pg_temp.call('tomo', 'pkg-b', 'request-b1',
    pg_temp.descriptor(p_package => 'pkg-b', p_document => 'doc-b', p_segment => 'segment-b-1'),
    0, repeat('c', 64), repeat('d', 64), repeat('b', 64)), 'reserved', 'fixture: Tomo commits revision 1');

-- Shape: two reads of the identity role for the web role, one helper of the
-- evidence role for the identity role alone, all with an empty search_path.
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.oid IN ('app.read_replay_source(text)'::regprocedure, 'app.read_replay_checkpoints(text,text[])'::regprocedure)
        AND NOT (p.provolatile = 'v' AND p.prosecdef AND p.proowner = 'ductus_identity'::regrole
                 AND 'search_path=""' = ANY (p.proconfig)) $$,
  'both reads are VOLATILE SECURITY DEFINER functions of the identity role with an empty search_path');
SELECT is(
  (SELECT format('%s %s %s %s', proowner::regrole, provolatile, prosecdef, 'search_path=""' = ANY (proconfig))
     FROM pg_proc WHERE oid = 'app.replay_document_checkpoints(text,text[])'::regprocedure),
  'ductus_evidence s t t', 'the evidence role owns the one helper that reads checkpoints');
SELECT bag_eq(
  $$ SELECT r || ' ' || f FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth',
                                            'ductus_identity', 'ductus_evidence', 'ductus_test_stranger']) AS r
      CROSS JOIN unnest(ARRAY['app.read_replay_source(text)', 'app.read_replay_checkpoints(text,text[])',
                              'app.replay_document_checkpoints(text,text[])']) AS f
      WHERE has_function_privilege(r, f, 'EXECUTE') $$,
  $$ VALUES ('ductus_app app.read_replay_source(text)'), ('ductus_identity app.read_replay_source(text)'),
            ('ductus_app app.read_replay_checkpoints(text,text[])'),
            ('ductus_identity app.read_replay_checkpoints(text,text[])'),
            ('ductus_identity app.replay_document_checkpoints(text,text[])'),
            ('ductus_evidence app.replay_document_checkpoints(text,text[])') $$,
  'the web role executes the two reads, never the helper; only the identity role and the owner execute the helper');
SELECT is(pg_get_function_arguments('app.read_replay_source(text)'::regprocedure), 'p_document_id text',
  'the source takes only the document: no role, institution, page or time');
SELECT is(pg_get_function_arguments('app.read_replay_checkpoints(text,text[])'::regprocedure),
  'p_document_id text, p_content_hashes text[]', 'the checkpoint read takes the document and hashes only');
SELECT is(pg_get_function_result('app.read_replay_source(text)'::regprocedure),
  pg_get_function_result('app.read_process_summary_source(text)'::regprocedure),
  'the source returns what the summary source returns');
SELECT is(pg_get_function_result('app.read_replay_checkpoints(text,text[])'::regprocedure),
  'TABLE(content_hash text, body text)', 'a checkpoint comes back as its hash and text, no revision, time or id');
SELECT ok(NOT has_schema_privilege('ductus_identity', 'evidence', 'USAGE')
  AND NOT has_schema_privilege('ductus_identity', 'app', 'CREATE')
  AND NOT has_schema_privilege('ductus_evidence', 'app', 'CREATE'),
  'the migration leaves no schema right behind');
SELECT ok(pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'access_log_surface_check'))
  LIKE '%''replay''%', 'the access log accepts the replay surface');

-- The same record as the summary, for every reader and every refusal (rule 5, D-154).
SELECT is(pg_temp.source(a.name), 'found 3 9', a.name || ' reads the record up to the package head')
FROM (VALUES ('ana'), ('vesna')) AS a (name);
SELECT is(pg_temp.row_of(a.name, 'read_replay_source', d.id), pg_temp.row_of(a.name, 'read_process_summary_source', d.id),
  a.name || ' gets for ' || d.id || ' what the summary source answers')
FROM (VALUES ('ana'), ('vesna'), ('dora'), ('marko'), ('iva'), ('boris'), ('petra'), ('tomo'), ('anon'),
             ('expired')) AS a (name)
CROSS JOIN (VALUES ('doc-a'), ('doc-b'), ('doc-nema')) AS d (id);
SELECT is(pg_temp.source(a.name), 'not_found', a.name || ' gets the answer for a missing document')
FROM (VALUES ('dora'), ('marko'), ('iva'), ('boris'), ('nina'), ('petra'), ('tomo')) AS a (name);
SELECT is(pg_temp.source(a.name), 'ZD401: not authenticated', a.name || ' is not signed in')
FROM (VALUES ('anon'), ('expired'), ('closed'), ('unknown')) AS a (name);
SELECT is(pg_temp.source('vesna', d.id), 'not_found', 'Vesna gets not_found for ' || d.label)
FROM (VALUES ('doc-nema', 'a missing document'), ('', 'an empty id'), (' doc-a', 'an id with a blank at its edge'),
             ('doc-a' || chr(1), 'an id with a control character'), (repeat('x', 257), 'an id over 256 characters'))
  AS d (id, label);

-- Checkpoints: the texts of the asked hashes in the caller's institution.
SELECT is(pg_temp.texts(a.name, pg_temp.def()), 'd,e,f', a.name || ' gets the text of revisions 1 to 3')
FROM (VALUES ('ana'), ('vesna')) AS a (name);
SELECT is(pg_temp.texts('vesna', ARRAY[pg_temp.h('e'), pg_temp.h('x'), pg_temp.h('e')]), 'e',
  'a hash no checkpoint has gives no row, and a repeated hash one row');
SELECT is(pg_temp.texts('tomo', ARRAY[pg_temp.h('d')], 'doc-b'), 'd', 'Tomo gets the text of his own revision 1');
SELECT is(pg_temp.texts(a.name, pg_temp.def()), '-', a.name || ' gets no text of doc-a, as for a missing document')
FROM (VALUES ('dora'), ('marko'), ('iva'), ('boris'), ('petra'), ('tomo')) AS a (name);
SELECT is(pg_temp.texts('vesna', ARRAY[pg_temp.h('d')], d.id), '-', 'Vesna gets no text for ' || d.id)
FROM (VALUES ('doc-b'), ('doc-nema'), (''), (repeat('x', 257))) AS d (id);
SELECT is(pg_temp.texts(a.name, pg_temp.def()), 'ZD401: not authenticated', a.name || ' is not signed in for the texts')
FROM (VALUES ('anon'), ('expired')) AS a (name);
SELECT is(pg_temp.texts('anon', NULL), 'ZD401: not authenticated', 'the session is checked before the input');
SELECT is(pg_temp.texts('vesna', h.val), 'ZD422: invalid input', 'Vesna is refused ' || h.label)
FROM (VALUES (NULL::text[], 'no hash list'), ('{}'::text[], 'an empty hash list'),
             (ARRAY[upper(pg_temp.h('d'))], 'an upper-case hash'), (ARRAY[NULL::text], 'a null hash'),
             (ARRAY[left(pg_temp.h('d'), 63)], 'a short hash'),
             (array_fill(pg_temp.h('d'), ARRAY[513]), 'more than 512 hashes')) AS h (val, label);
SELECT is(pg_temp.texts('vesna', array_fill(pg_temp.h('d'), ARRAY[512])), 'd', '512 hashes are accepted');

-- Text whose bytes no longer hash to its key is never returned.
ALTER TABLE evidence.document_checkpoint DISABLE TRIGGER evidence_checkpoint_immutable;
UPDATE evidence.document_checkpoint SET body = repeat('z', 64) WHERE document_id = 'doc-a' AND revision = 2;
ALTER TABLE evidence.document_checkpoint ENABLE TRIGGER evidence_checkpoint_immutable;
SELECT is(pg_temp.texts(a.name, pg_temp.def()), 'd,f', a.name || ' does not get a text that does not hash to its key')
FROM (VALUES ('ana'), ('vesna')) AS a (name);

-- The teacher's reads are logged, one row per interval; the owner's and refused ones are not.
SELECT is(pg_temp.replay_log(), ARRAY['doc-a|ana|vesna|teacher', 'doc-b|tomo|petra|teacher'],
  'each teacher''s reads of a work are one row (Vesna on doc-a, Petra on doc-b); the owners'' and every refused read none');
-- Marko becomes a second teacher of K1 and reads only texts, without the source.
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('marko'), 'teacher');
SELECT is(pg_temp.texts('marko', pg_temp.def()), 'd,f', 'Marko, now a teacher of K1, reads the texts');
SELECT is(pg_temp.replay_log(), ARRAY['doc-a|ana|marko|teacher', 'doc-a|ana|vesna|teacher', 'doc-b|tomo|petra|teacher'],
  'and a read of texts alone is logged too');
CREATE TRIGGER access_log_refuse_insert BEFORE INSERT ON audit.access_log
  FOR EACH ROW EXECUTE FUNCTION audit.reject_change();
SELECT is(pg_temp.source('vesna'), 'ZD403: append-only row', 'when the row cannot be written, Vesna gets no record');
SELECT is(pg_temp.texts('vesna', pg_temp.def()), 'ZD403: append-only row', 'nor any text');
SELECT is(pg_temp.source('ana'), 'found 3 9', 'the owner''s read writes no row, so it is not affected');
DROP TRIGGER access_log_refuse_insert ON audit.access_log;

-- The submission of revision 1 cuts the replay there, for everyone who may read.
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.record_submission(%L::uuid, %L)', pg_temp.req(),
  pg_temp.h('d'))), 'recorded', 'fixture: the submission of revision 1 is recorded');
SELECT is(pg_temp.source(a.name), 'found 1 b', a.name || ' reads the record up to the submitted revision')
FROM (VALUES ('ana'), ('vesna')) AS a (name);
SELECT is(pg_temp.row_of('vesna', 'read_replay_source'), pg_temp.row_of('ana', 'read_replay_source'),
  'student and teacher get the same row');
SELECT is(pg_temp.row_of('vesna', 'read_replay_source'), pg_temp.row_of('vesna', 'read_process_summary_source'),
  'the same row as the summary of the submitted work');

-- Revocation is immediate: a teacher who left the course reads nothing.
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('vesna');
SELECT is(pg_temp.source('vesna'), 'not_found', 'Vesna, gone from K1, gets no record');
SELECT is(pg_temp.texts('vesna', pg_temp.def()), '-', 'and no text');
SELECT is(pg_temp.source('ana'), 'found 1 b', 'Ana still reads her record');

SELECT * FROM finish();
ROLLBACK;

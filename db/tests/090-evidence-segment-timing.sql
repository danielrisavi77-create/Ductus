-- DAN-344 P1-b (addenda on #923: c.6429779006 and c.6435323774): the timing
-- hash a segment row keeps, the acceptance that writes it and the replay
-- source that lists it. Every person, document and hash below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

-- The acceptance with a timing hash (NULL for none), as pg_temp.call otherwise.
CREATE FUNCTION pg_temp.tcall(
  p_actor text, p_request text, p_descriptor jsonb, p_revision bigint, p_initial text, p_final text,
  p_payload_hash text, p_timing text
) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    'SELECT outcome FROM app.commit_evidence_segment(%L, %L, %s, %L, %L, %L::jsonb, %L, %L, %L, %L)',
    'pkg-a', p_request, p_revision, pg_temp.sha(p_initial), pg_temp.sha(p_final), p_descriptor::text,
    p_payload_hash, 'synthetic://pkg-a/' || p_request, p_final, p_timing))
$$;
-- The timing hash of each segment of pkg-a in chain order, "-" for none.
CREATE FUNCTION pg_temp.stored() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(coalesce(left(timing_sha256, 1), '-'), ',' ORDER BY sequence_from)
    FROM evidence.segment WHERE evidence_package_id = 'pkg-a'
$$;
-- outcome, the number of segment and timing hashes, and the first letter of
-- each timing hash ("-" for none); a refusal has neither list, so only its outcome.
CREATE FUNCTION pg_temp.source(p_actor text, p_document text DEFAULT 'doc-a') RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format($q$ SELECT concat_ws(' ', outcome, cardinality(segment_hashes),
      cardinality(timing_hashes),
      (SELECT string_agg(coalesce(left(t, 1), '-'), ',' ORDER BY o) FROM unnest(timing_hashes) WITH ORDINALITY u (t, o)))
    FROM app.read_replay_source(%L) $q$, p_document))
$$;

-- Shape of the column, the acceptance and the helper.
SELECT col_type_is('evidence', 'segment', 'timing_sha256', 'text', 'the segment keeps a timing hash as text');
SELECT col_is_null('evidence', 'segment', 'timing_sha256', 'a segment may have no timing');
SELECT col_hasnt_default('evidence', 'segment', 'timing_sha256', 'the timing hash has no default');
SELECT is(pg_get_function_arguments(
    'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text,text)'::regprocedure),
  'p_evidence_package_id text, p_client_request_id text, p_expected_revision bigint, p_initial_document_hash text, '
  || 'p_final_document_hash text, p_descriptor jsonb, p_payload_sha256 text, p_storage_ref text, p_snapshot text, '
  || 'p_timing_sha256 text DEFAULT NULL::text',
  'the acceptance takes the timing hash last, NULL when left out');
SELECT is(to_regprocedure('app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)')::text, NULL,
  'the acceptance without a timing parameter is gone');
SELECT is(
  (SELECT format('%s %s %s %s', proowner::regrole, provolatile, prosecdef, 'search_path=""' = ANY (proconfig))
     FROM pg_proc WHERE oid = 'app.replay_segment_timings(text,text[])'::regprocedure),
  'ductus_evidence s t t', 'the evidence role owns the helper that reads timing hashes');
SELECT bag_eq(
  $$ SELECT r || ' ' || f FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth',
                                            'ductus_identity', 'ductus_evidence', 'ductus_test_stranger']) AS r
      CROSS JOIN unnest(ARRAY['app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text,text)',
                              'app.replay_segment_timings(text,text[])']) AS f
      WHERE has_function_privilege(r, f, 'EXECUTE') $$,
  $$ VALUES ('ductus_app app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text,text)'),
            ('ductus_evidence app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text,text)'),
            ('ductus_identity app.replay_segment_timings(text,text[])'),
            ('ductus_evidence app.replay_segment_timings(text,text[])') $$,
  'only the web role runs the acceptance; only the identity role and the owner run the helper');
SELECT ok(NOT has_schema_privilege('ductus_identity', 'evidence', 'USAGE')
  AND NOT has_schema_privilege('ductus_identity', 'app', 'CREATE')
  AND NOT has_schema_privilege('ductus_evidence', 'app', 'CREATE'),
  'the migration leaves no schema right behind');

-- Attack 16: an acceptance without timing works as before, and keeps none.
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64),
  repeat('b', 64)), 'reserved', 'the nine arguments of today are accepted');
SELECT is(pg_temp.stored(), '-', 'and the segment has no timing hash');

-- A timing hash that is not lowercase SHA-256 hex is refused, and nothing is written.
SELECT is(pg_temp.tcall('ana', 'request-2',
    pg_temp.descriptor(p_segment => 'segment-a-2', p_sequence_from => 2, p_sequence_to => 2,
                       p_hash => repeat('c', 64), p_predecessor => repeat('b', 64)),
    1, repeat('d', 64), repeat('e', 64), repeat('c', 64), t.val), 'invalid', 'a timing hash ' || t.label || ' is invalid')
FROM (VALUES (upper(repeat('7', 63)) || 'A', 'in upper case'), (repeat('7', 63), 'one character short'),
             ('', 'that is empty'), (repeat('7', 64) || ' ', 'with a blank')) AS t (val, label);
SELECT is(pg_temp.stored(), '-', 'no refused acceptance left a segment behind');

-- With a timing hash, the row keeps it.
SELECT is(pg_temp.tcall('ana', 'request-2',
    pg_temp.descriptor(p_segment => 'segment-a-2', p_sequence_from => 2, p_sequence_to => 2,
                       p_hash => repeat('c', 64), p_predecessor => repeat('b', 64)),
    1, repeat('d', 64), repeat('e', 64), repeat('c', 64), repeat('7', 64)), 'reserved',
  'an acceptance with a timing hash is reserved');
SELECT is(pg_temp.stored(), '-,7', 'and its segment keeps that hash');
-- A retry under the same key with another timing hash, or none, gets the first answer and changes nothing.
SELECT is(pg_temp.tcall('ana', 'request-2',
    pg_temp.descriptor(p_segment => 'segment-a-2', p_sequence_from => 2, p_sequence_to => 2,
                       p_hash => repeat('c', 64), p_predecessor => repeat('b', 64)),
    1, repeat('d', 64), repeat('e', 64), repeat('c', 64), t.val), 'duplicate_pending',
  'a retry with ' || t.label || ' is the same acceptance')
FROM (VALUES (repeat('8', 64), 'another timing hash'), (NULL, 'no timing hash')) AS t (val, label);
SELECT is(pg_temp.stored(), '-,7', 'and the row keeps the first timing hash');
-- The row is append-only: the timing hash is never added or changed later.
SELECT is(pg_temp.ask_as('ductus_evidence', 'ana',
    $$ UPDATE evidence.segment SET timing_sha256 = repeat('6', 64) WHERE evidence_package_id = 'pkg-a' RETURNING 'changed' $$),
  'ZD403: append-only row', 'not even the owner of the table adds a timing hash afterwards');

-- Attacks 13 and 14: the source lists one timing hash per segment, the same for the student and the teacher.
SELECT is(pg_temp.source(a.name), 'found 2 2 -,7', a.name || ' reads both segments and their timing hashes')
FROM (VALUES ('ana'), ('vesna')) AS a (name);
SELECT is(pg_temp.ask('vesna', $$ SELECT row(segment_hashes, timing_hashes)::text FROM app.read_replay_source('doc-a') $$),
  pg_temp.ask('ana', $$ SELECT row(segment_hashes, timing_hashes)::text FROM app.read_replay_source('doc-a') $$),
  'the teacher gets the student''s hashes, byte for byte');
SELECT is(pg_temp.source(a.name), 'not_found', a.name || ' gets no timing for a document they may not read')
FROM (VALUES ('dora'), ('petra'), ('tomo')) AS a (name);
SELECT is(pg_temp.source('anon'), 'ZD401: not authenticated', 'without a session nothing is read');

-- The helper takes the institution from the session: another institution's package reads as having no timing.
SELECT is(pg_temp.ask_as('ductus_identity', 'tomo',
    format($$ SELECT app.replay_segment_timings('pkg-a', %L::text[])::text $$, ARRAY[repeat('b', 64), repeat('c', 64)])),
  '{NULL,NULL}', 'Tomo''s session gives no timing hash of Ana''s package');
SELECT is(pg_temp.ask_as('ductus_identity', 'ana', $$ SELECT app.replay_segment_timings('pkg-a', '{}')::text $$),
  '{}', 'an empty list gives an empty list');
SELECT is(pg_temp.ask('ana', $$ SELECT app.replay_segment_timings('pkg-a', '{}')::text $$),
  '42501: permission denied for function replay_segment_timings', 'the web role cannot call the helper');

SELECT * FROM finish();
ROLLBACK;

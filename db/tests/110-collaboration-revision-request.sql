-- DAN-314 step 2a (docs/backend/suradnja.md 4.14, attack plan #1506, contract
-- on #1091 c.6684460326): the revision request store, creating, reading and
-- the retention delete. The four transitions come in step 2b. Every person,
-- document and text below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

INSERT INTO ref VALUES
  ('anchor', '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"prvi odlomak","prefix":"","suffix":" teksta","startHint":0,"endHint":12}'),
  ('anchor_b', '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000002","quote":"odlomak","prefix":"","suffix":"","startHint":0,"endHint":7}');

-- A create as one line: state and version, or the error. The anchor is SQL,
-- by default the stored placeholder.
CREATE FUNCTION pg_temp.create_as(
  p_actor text, p_document text, p_instruction text, p_revision bigint DEFAULT 0, p_anchor text DEFAULT '{anchor}'
) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    $q$ SELECT format('%%s|%%s', state, version) FROM collaboration.create_revision_request(%L, %s, %L, %s) $q$,
    p_document, p_anchor, p_instruction, coalesce(p_revision::text, 'NULL')))
$$;
-- Everything a reader sees but the *_is_own columns, as one line.
CREATE FUNCTION pg_temp.listing(p_actor text, p_document text DEFAULT 'doc-a') RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format($q$
    SELECT string_agg(concat_ws('|', request_id, request_state, request_version, request_row_seq, anchor, version,
      instruction, requested_revision, opened_window, response_kind, response_explanation, response_revision,
      response_window, closed_as, closed_window, accepted_revision, accepted_range_hash), ';'
      ORDER BY request_row_seq, version)
    FROM collaboration.list_revision_requests(%L) $q$, p_document))
$$;
-- Rows of the three tables for one document.
CREATE FUNCTION pg_temp.rows(p_document text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT (SELECT count(*) FROM collaboration.revision_request WHERE document_id = p_document)
       + (SELECT count(*) FROM collaboration.revision_request_version v
            JOIN collaboration.revision_request r ON r.id = v.request_id WHERE r.document_id = p_document)
       + (SELECT count(*) FROM collaboration.revision_response s
            JOIN collaboration.revision_request r ON r.id = s.request_id WHERE r.document_id = p_document)
$$;
-- Every table of schema evidence, as one value (H1).
CREATE FUNCTION pg_temp.evidence_print() RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  t text;
  part text;
  acc text := '';
BEGIN
  FOR t IN SELECT relname FROM pg_class WHERE relnamespace = 'evidence'::regnamespace AND relkind IN ('r', 'p') ORDER BY relname LOOP
    EXECUTE format('SELECT string_agg(row_to_json(x)::text, ''|'' ORDER BY row_to_json(x)::text) FROM evidence.%I x', t) INTO part;
    acc := acc || t || ':' || coalesce(part, '') || ';';
  END LOOP;
  RETURN md5(acc);
END
$$;
CREATE TEMP TABLE print_before AS SELECT pg_temp.evidence_print() AS v;

-- Catalogue (A10, A11, C4, D6, H5).
SELECT bag_eq(
  $$ SELECT relname::text FROM pg_class WHERE relnamespace = 'collaboration'::regnamespace AND relkind = 'r'
      AND relname::text LIKE 'revision%' AND relowner = 'ductus_identity'::regrole AND relrowsecurity AND relforcerowsecurity $$,
  $$ VALUES ('revision_request'), ('revision_request_version'), ('revision_response') $$,
  'the identity role owns the three request tables and RLS is forced on each');
SELECT bag_eq(
  $$ SELECT tablename::text, policyname::text, roles::text, cmd FROM pg_policies
      WHERE schemaname = 'collaboration' AND tablename::text LIKE 'revision%' $$,
  $$ VALUES ('revision_request', 'revision_request_owner', '{ductus_identity}', 'ALL'),
            ('revision_request_version', 'revision_request_version_owner', '{ductus_identity}', 'ALL'),
            ('revision_response', 'revision_response_owner', '{ductus_identity}', 'ALL') $$,
  'each table has one policy, for its owner alone');
SELECT is((SELECT relowner::regrole::text FROM pg_class WHERE oid = 'collaboration.revision_request_seq'::regclass),
  'ductus_identity', 'the identity role owns the counter sequence');
SELECT is_empty(
  $$ SELECT c.relname || ' ' || a.grantee::regrole::text FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid IN ('collaboration.revision_request'::regclass, 'collaboration.revision_request_version'::regclass,
        'collaboration.revision_response'::regclass, 'collaboration.revision_request_seq'::regclass)
        AND a.grantee <> c.relowner $$,
  'no role but the owner has any privilege on the request tables or the sequence');
SELECT is_empty(
  $$ SELECT r || ' ' || p || ' ' || t FROM unnest(ARRAY['revision_request', 'revision_request_version', 'revision_response']) AS t
      CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p
      CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence', 'ductus_test_stranger']) AS r
      WHERE has_table_privilege(r, 'collaboration.' || t, p) $$,
  'no runtime role reads or writes a request table directly (A10)');
SELECT is_empty(
  $$ SELECT r || ' ' || p FROM unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) AS p
      CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence', 'ductus_test_stranger']) AS r
      WHERE has_sequence_privilege(r, 'collaboration.revision_request_seq', p) $$,
  'no runtime role reads or advances the counter sequence (C4)');
SELECT row_eq(
  $$ SELECT seqtypid::regtype::text, seqmin, seqmax, seqcycle FROM pg_sequence
      WHERE seqrelid = 'collaboration.revision_request_seq'::regclass $$,
  ROW('bigint'::text, 1::bigint, 9007199254740991::bigint, false),
  'the sequence is a bigint from 1 to 2^53 - 1 that never cycles (C4)');
SELECT col_is_unique('collaboration', 'revision_request', 'row_seq', 'row_seq is UNIQUE (C4)');
SELECT is_empty(
  $$ SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('collaboration.revision_request'::regclass,
      'collaboration.revision_request_version'::regclass, 'collaboration.revision_response'::regclass) $$,
  'no trigger on the request tables (D6)');
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.oid IN ('collaboration.create_revision_request(text,jsonb,text,bigint)'::regprocedure,
        'collaboration.list_revision_requests(text)'::regprocedure, 'collaboration.delete_revision_requests(text,uuid)'::regprocedure)
        AND (NOT p.prosecdef OR p.proowner <> 'ductus_identity'::regrole OR NOT 'search_path=""' = ANY (p.proconfig)) $$,
  'the three RPCs are SECURITY DEFINER functions of the identity role with an empty search_path');
SELECT ok((SELECT prosecdef AND proowner = 'ductus_evidence'::regrole AND 'search_path=""' = ANY (proconfig) FROM pg_proc
    WHERE oid = 'collaboration.lock_document_for_write(text)'::regprocedure),
  'the evidence role owns lock_document_for_write, a SECURITY DEFINER function with an empty search_path');
SELECT bag_eq(
  $$ SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_identity', 'ductus_test_stranger']) AS r
      WHERE has_function_privilege(r, 'collaboration.lock_document_for_write(text)', 'EXECUTE') $$,
  $$ VALUES ('ductus_identity') $$,
  'only the identity role executes lock_document_for_write (A11)');
SELECT ok((SELECT prosecdef AND proowner = 'ductus_evidence'::regrole AND 'search_path=""' = ANY (proconfig) FROM pg_proc
    WHERE oid = 'collaboration.revision_above_document(text,uuid,bigint)'::regprocedure),
  'the evidence role owns revision_above_document, a SECURITY DEFINER function with an empty search_path (#1091 c.6696580072)');
SELECT bag_eq(
  $$ SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_identity', 'ductus_test_stranger']) AS r
      WHERE has_function_privilege(r, 'collaboration.revision_above_document(text,uuid,bigint)', 'EXECUTE') $$,
  $$ VALUES ('ductus_identity') $$,
  'only the identity role executes revision_above_document, so the web role cannot probe revisions with it');
SELECT bag_eq(
  $$ SELECT r || ' ' || f FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence', 'ductus_test_stranger']) AS r
      CROSS JOIN unnest(ARRAY['collaboration.create_revision_request(text,jsonb,text,bigint)',
        'collaboration.list_revision_requests(text)', 'collaboration.delete_revision_requests(text,uuid)']) AS f
      WHERE has_function_privilege(r, f, 'EXECUTE') $$,
  $$ VALUES ('ductus_app collaboration.create_revision_request(text,jsonb,text,bigint)'),
            ('ductus_app collaboration.list_revision_requests(text)'),
            ('ductus_retention collaboration.delete_revision_requests(text,uuid)') $$,
  'the web role creates and reads, the retention role alone deletes (A11)');
SELECT ok(NOT has_schema_privilege('ductus_evidence', 'collaboration', 'USAGE')
  AND NOT has_schema_privilege('ductus_evidence', 'collaboration', 'CREATE')
  AND NOT has_schema_privilege('ductus_identity', 'collaboration', 'CREATE')
  AND NOT has_schema_privilege('ductus_identity', 'evidence', 'USAGE'),
  'after the migration neither the evidence nor the identity role keeps an extra schema right');
SELECT is(pg_get_function_arguments('collaboration.create_revision_request(text,jsonb,text,bigint)'::regprocedure),
  'p_document_id text, p_anchor jsonb, p_instruction text, p_requested_revision bigint',
  'creating takes no author, institution or time: they come from the session and the document (H2)');
SELECT is(pg_get_function_result('collaboration.list_revision_requests(text)'::regprocedure),
  'TABLE(request_id uuid, request_state text, request_version integer, request_row_seq bigint, anchor jsonb, version integer, '
  'instruction text, requested_revision bigint, opened_is_own boolean, opened_window timestamp with time zone, '
  'response_kind text, response_explanation text, response_revision bigint, response_is_own boolean, '
  'response_window timestamp with time zone, closed_as text, closed_is_own boolean, closed_window timestamp with time zone, '
  'accepted_revision bigint, accepted_range_hash text)',
  'reading returns no person id, institution, exact time or document content (H5)');

-- Creating: only the teacher of the assignment's course (A1 to A8, A12).
INSERT INTO ref SELECT 'r1', pg_temp.ask('vesna', $$ SELECT request_id || '|' || row_seq
  FROM collaboration.create_revision_request('doc-a', {anchor}, 'Ovdje nedostaje izvor.', 0) $$);
SELECT matches((SELECT val FROM ref WHERE name = 'r1'), '^[0-9a-f-]{36}\|[1-9][0-9]*$', 'the teacher of K1 opens a request on Ana''s document (A2)');
UPDATE ref SET val = split_part(val, '|', 1) WHERE name = 'r1';
SELECT is(pg_temp.create_as(a.name, 'doc-a', 'Tekst.'), 'ZD403: forbidden', a.name || ' cannot open a request on Ana''s document (A1, A6)')
FROM (VALUES ('ana'), ('dora'), ('marko'), ('iva'), ('petra'), ('tomo'), ('boris'), ('nina')) AS a (name);
SELECT is(pg_temp.create_as(a.name, 'doc-a', '', NULL, $$'[]'::jsonb$$), 'ZD403: forbidden',
  a.name || ' with malformed input still gets only the forbidden answer (A3)')
FROM (VALUES ('ana'), ('dora'), ('marko'), ('iva'), ('petra'), ('boris'), ('nina')) AS a (name);
SELECT is(pg_temp.create_as('vesna', 'doc-b', 'Tekst.', 0, '{anchor_b}'), 'ZD403: forbidden',
  'a teacher cannot open a request on a document of another institution (A4)');
SELECT is(pg_temp.create_as('vesna', 'doc-nema', 'Tekst.'), 'ZD403: forbidden', 'a missing document reads as a forbidden one (A12)');
SELECT is(pg_temp.create_as('vesna', 'doc-nema', NULL, NULL, 'NULL'), 'ZD403: forbidden',
  'a missing document with malformed input reads as a forbidden one (A12)');
SELECT matches(pg_temp.create_as(t.name, 'doc-a', 'Tekst.'), '^ZD401', 'a request with session ' || t.name || ' is not signed in')
FROM (VALUES ('anon'), ('expired'), ('closed'), ('unknown')) AS t (name);
SELECT is(pg_temp.create_as('petra', 'doc-b', 'Zahtjev u drugoj ustanovi.', 0, '{anchor_b}'), 'open|1',
  'the teacher of K3 opens a request on Tomo''s document');

-- Scope, owner and author come from the document and the session (H2).
SELECT row_eq(
  $$ SELECT institution_id, document_id, assignment_id, owner_id, created_by, state, version, anchor
      FROM collaboration.revision_request WHERE id = pg_temp.id('r1') $$,
  ROW(pg_temp.id('fak_a'), 'doc-a'::text, pg_temp.id('z1'), pg_temp.id('ana'), pg_temp.id('vesna'), 'open'::text, 1,
      (SELECT val::jsonb FROM ref WHERE name = 'anchor')),
  'the request takes institution, assignment and owner from the document and the author from the session');
SELECT row_eq(
  $$ SELECT institution_id, version, instruction, requested_revision, opened_by, closed_as, closed_by, closed_at,
            accepted_revision, accepted_range_hash
      FROM collaboration.revision_request_version WHERE request_id = pg_temp.id('r1') $$,
  ROW(pg_temp.id('fak_a'), 1, 'Ovdje nedostaje izvor.'::text, 0::bigint, pg_temp.id('vesna'), NULL::text, NULL::uuid,
      NULL::timestamptz, NULL::bigint, NULL::text),
  'version 1 is open, carries the instruction and the teacher of the session');

-- Input classes (#1506 classes 8 to 10): one row per class, after authorisation.
SELECT is(pg_temp.create_as('vesna', 'doc-a', i.instruction), i.outcome, 'an instruction that is ' || i.what)
FROM (VALUES
  (NULL::text, 'ZD422: invalid input', 'missing is refused'),
  ('', 'ZD422: invalid input', 'empty is refused'),
  ('   ', 'ZD422: invalid input', 'only blanks is refused'),
  (E' \n\t\r ', 'ZD422: invalid input', 'only blanks and line breaks is refused'),
  (E'  ', 'ZD422: invalid input', 'only no-break spaces is refused'),
  (E'​‌‍', 'ZD422: invalid input', 'only zero-width characters (U+200B to U+200D) is refused'),
  (E'⁠', 'ZD422: invalid input', 'only a word joiner is refused'),
  (E'﻿', 'ZD422: invalid input', 'only a byte-order mark is refused'),
  (E'　  ', 'ZD422: invalid input', 'only other Unicode spaces is refused'),
  (repeat('a', 2001), 'ZD422: invalid input', 'over 2000 code points is refused'),
  (repeat('a', 1048576), 'ZD422: invalid input', 'one megabyte is refused'),
  (E'é', 'ZD422: invalid input', 'not NFC is refused'),
  (E'a\u0001b', 'ZD422: invalid input', 'with a control character is refused'),
  (E'a\u007Fb', 'ZD422: invalid input', 'with a delete character is refused'),
  (E'a‪b', 'ZD422: invalid input', 'with U+202A is refused'),
  (E'a‮b', 'ZD422: invalid input', 'with a right-to-left override is refused'),
  (E'a⁦b', 'ZD422: invalid input', 'with U+2066 is refused'),
  (E'a⁩b', 'ZD422: invalid input', 'with U+2069 is refused'),
  (repeat('a', 2000), 'open|1', '2000 code points is accepted'),
  (repeat('ž', 1999) || E'\n', 'open|1', '2000 code points of two bytes with a line break is accepted'),
  (E'Prvi red.\nDrugi\tred.', 'open|1', 'with a line break and a tab is accepted'),
  (E' x​', 'open|1', 'with one visible character among invisible ones is accepted'),
  ('Dodaj izvor za ovu tvrdnju.', 'open|1', 'a plain sentence is accepted')
) AS i (instruction, outcome, what);
SELECT is(pg_temp.create_as('vesna', 'doc-a', 'Tekst.', 0, a.anchor), a.outcome, 'an anchor that is ' || a.what)
FROM (VALUES
  ('NULL', 'ZD422: invalid input', 'missing is refused'),
  ($$'null'::jsonb$$, 'ZD422: invalid input', 'a JSON null is refused'),
  ($$'[]'::jsonb$$, 'ZD422: invalid input', 'of the wrong shape is refused'),
  ($$'{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"x","prefix":"","suffix":"","startHint":0,"endHint":1,"html":"<b>"}'::jsonb$$,
   'ZD422: invalid input', 'with an unknown field is refused'),
  ($$'{"nodeId":"odlomak-1","quote":"x","prefix":"","suffix":"","startHint":0,"endHint":1}'::jsonb$$,
   'ZD422: invalid input', 'with a node id that is no UUID is refused'),
  ($$'{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"x","prefix":"","suffix":"","startHint":1,"endHint":1}'::jsonb$$,
   'ZD422: invalid input', 'an empty range is refused'),
  ($$'{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"x‮","prefix":"","suffix":"","startHint":0,"endHint":1}'::jsonb$$,
   'ZD422: invalid input', 'with a right-to-left override is refused'),
  ('{anchor}', 'open|1', 'valid is accepted')
) AS a (anchor, outcome, what);
SELECT is(pg_temp.create_as('vesna', 'doc-a', 'Tekst.', r.revision), r.outcome, 'a requested revision ' || r.what)
FROM (VALUES
  (NULL::bigint, 'ZD422: invalid input', 'that is missing is refused'),
  (-1, 'ZD422: invalid input', 'of -1 is refused'),
  (9007199254740992, 'ZD422: invalid input', 'of 2^53 is refused'),
  (1, 'ZD422: invalid input', 'of 1, above the current revision 0 of the document, is refused (#1091 c.6696580072)'),
  (9007199254740991, 'ZD422: invalid input', 'of 2^53 - 1, above the current revision of the document, is refused'),
  (0, 'open|1', 'of 0 is accepted'),
  (0, 'open|1', 'equal to the current revision 0 of the document is accepted')
) AS r (revision, outcome, what);
SELECT is((SELECT count(*) FROM collaboration.revision_request WHERE document_id = 'doc-a'), 9::bigint,
  'only the accepted inputs wrote a request');
SELECT is((SELECT count(DISTINCT row_seq) FROM collaboration.revision_request), (SELECT count(*) FROM collaboration.revision_request),
  'every request has its own row_seq (C4)');

-- Reading: the same for student and teacher, nobody else anything (H4, H5).
SELECT is(pg_temp.ask(a.name, $$ SELECT count(*) FROM collaboration.list_revision_requests('doc-a') $$), '9',
  a.name || ' reads every request on Ana''s document')
FROM (VALUES ('ana'), ('vesna')) AS a (name);
SELECT is(pg_temp.listing('ana'), pg_temp.listing('vesna'), 'Ana and Vesna read the same rows but for the *_is_own columns (H4)');
SELECT matches(pg_temp.listing('ana'), (SELECT val FROM ref WHERE name = 'r1'), 'the listing holds the first request');
SELECT is(pg_temp.ask('ana', $$ SELECT string_agg(DISTINCT format('%s|%s|%s', opened_is_own, response_is_own, closed_is_own), ',')
    FROM collaboration.list_revision_requests('doc-a') $$), 'f||', 'the student sees no request as her own');
SELECT is(pg_temp.ask('vesna', $$ SELECT string_agg(DISTINCT format('%s|%s|%s', opened_is_own, response_is_own, closed_is_own), ',')
    FROM collaboration.list_revision_requests('doc-a') $$), 't||', 'the teacher sees her requests as her own');
SELECT is(pg_temp.ask('vesna', $$ SELECT bool_and(extract(epoch FROM opened_window)::bigint % 300 = 0
      AND opened_window <= now() AND opened_window > now() - interval '5 minutes')
    FROM collaboration.list_revision_requests('doc-a') $$), 'true', 'time is given only to the five-minute window (H5)');
SELECT is(pg_temp.ask('ana', format($$ SELECT anchor = {anchor} FROM collaboration.list_revision_requests('doc-a')
    WHERE request_id = %L $$, pg_temp.id('r1'))), 'true', 'the anchor comes back exactly as stored');
SELECT is(pg_temp.ask(a.name, $$ SELECT count(*) FROM collaboration.list_revision_requests('doc-a') $$), 'ZD403: forbidden',
  a.name || ' reads nothing on Ana''s document (A1)')
FROM (VALUES ('dora'), ('marko'), ('iva'), ('petra'), ('tomo'), ('boris'), ('nina')) AS a (name);
SELECT matches(pg_temp.ask(t.name, $$ SELECT count(*) FROM collaboration.list_revision_requests('doc-a') $$), '^ZD401',
  'reading with session ' || t.name || ' is not signed in')
FROM (VALUES ('anon'), ('expired'), ('closed'), ('unknown')) AS t (name);
SELECT is(pg_temp.ask('vesna', $$ SELECT count(*) FROM collaboration.list_revision_requests('doc-nema') $$), 'ZD403: forbidden',
  'reading a missing document gives the same answer as a forbidden one (A12)');
SELECT is(pg_temp.ask('vesna', $$ SELECT count(*) FROM collaboration.list_revision_requests('doc-b') $$), 'ZD403: forbidden',
  'the teacher of K1 cannot read a request of another institution');
SELECT is(pg_temp.ask(a.name, $$ SELECT count(*) FROM collaboration.list_revision_requests('doc-b') $$), '1',
  a.name || ' reads the one request on Tomo''s document')
FROM (VALUES ('tomo'), ('petra')) AS a (name);

-- The table constraints hold even for the owner role, not only in the RPC.
SELECT matches(pg_temp.ask_as('ductus_identity', 'vesna', format(
    $$ INSERT INTO collaboration.revision_request_version (request_id, institution_id, version, instruction, requested_revision,
         opened_by, closed_as, closed_by, closed_at, accepted_revision, accepted_range_hash)
       VALUES (%L, {fak_a}, %s, %L, %s, {vesna}, %s, %s, %s, %s, %s) $$,
    pg_temp.id('r1'), c.version, c.instruction, c.requested, c.closed_as, c.closed_by, c.closed_at, c.accepted, c.hash)),
  '^23514', 'the version table refuses ' || c.what || ' even from its owner')
FROM (VALUES
  (2, 'Tekst.', 0, $$'accepted'$$, 'NULL', 'now()', '0', 'NULL', 'a closing without who closed it'),
  (2, 'Tekst.', 0, $$'withdrawn'$$, '{vesna}', 'NULL', 'NULL', 'NULL', 'a closing without when'),
  (2, 'Tekst.', 0, 'NULL', '{vesna}', 'NULL', 'NULL', 'NULL', 'who closed it without a closing'),
  (2, 'Tekst.', 0, 'NULL', 'NULL', 'now()', 'NULL', 'NULL', 'a closing time without a closing'),
  (2, 'Tekst.', 0, $$'accepted'$$, '{vesna}', 'now()', 'NULL', 'NULL', 'an acceptance without a revision'),
  (2, 'Tekst.', 0, $$'withdrawn'$$, '{vesna}', 'now()', '3', 'NULL', 'an accepted revision on a withdrawal'),
  (2, 'Tekst.', 0, 'NULL', 'NULL', 'NULL', '3', 'NULL', 'an accepted revision on an open version'),
  (2, 'Tekst.', 0, $$'reopened'$$, '{vesna}', 'now()', 'NULL', quote_literal(repeat('a', 64)), 'a range hash on a reopening'),
  (2, 'Tekst.', 0, 'NULL', 'NULL', 'NULL', 'NULL', quote_literal(repeat('a', 64)), 'a range hash on an open version'),
  (2, 'Tekst.', 0, $$'accepted'$$, '{vesna}', 'now()', '3', quote_literal(repeat('A', 64)), 'a range hash that is not lower-case hex'),
  (2, 'Tekst.', 0, $$'rejected'$$, '{vesna}', 'now()', 'NULL', 'NULL', 'an unknown closing'),
  (2, E' ', 0, 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'an instruction of no-break spaces'),
  (2, E'a‮b', 0, 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'a right-to-left override'),
  (0, 'Tekst.', 0, 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'version 0'),
  (1001, 'Tekst.', 0, 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'version 1001'),
  (2, 'Tekst.', -1, 'NULL', 'NULL', 'NULL', 'NULL', 'NULL', 'a negative requested revision'),
  (2, 'Tekst.', 0, $$'accepted'$$, '{vesna}', 'now()', '-1', 'NULL', 'a negative accepted revision')
) AS c (version, instruction, requested, closed_as, closed_by, closed_at, accepted, hash, what);
SELECT is(pg_temp.ask_as('ductus_identity', 'vesna', format(
    $$ WITH i AS (
         INSERT INTO collaboration.revision_request_version (request_id, institution_id, version, instruction, requested_revision,
           opened_by, closed_as, closed_by, closed_at, accepted_revision, accepted_range_hash)
         VALUES (%L, {fak_a}, %s, 'Tekst.', 0, {vesna}, %s, %s, %s, %s, %s) RETURNING version)
       SELECT version FROM i $$,
    pg_temp.id('r1'), c.version, c.closed_as, c.closed_by, c.closed_at, c.accepted, c.hash)),
  c.version::text, 'the version table accepts ' || c.what)
FROM (VALUES
  (900, $$'accepted'$$, '{vesna}', 'now()', '3', quote_literal(repeat('a', 64)), 'an acceptance with a revision and a range hash'),
  (901, $$'accepted'$$, '{vesna}', 'now()', '3', 'NULL', 'an acceptance without a range hash'),
  (902, $$'withdrawn'$$, '{vesna}', 'now()', 'NULL', 'NULL', 'a withdrawal'),
  (903, $$'reopened'$$, '{vesna}', 'now()', 'NULL', 'NULL', 'a reopening')
) AS c (version, closed_as, closed_by, closed_at, accepted, hash, what);
SELECT matches(pg_temp.ask_as('ductus_identity', 'vesna', s.sql), '^23514', 'the request tables refuse ' || s.what || ' even from their owner')
FROM (VALUES
  ($$ UPDATE collaboration.revision_request SET state = 'resolved' WHERE id = {r1} $$, 'an unknown state'),
  ($$ UPDATE collaboration.revision_request SET version = 0 WHERE id = {r1} $$, 'version 0'),
  ($$ UPDATE collaboration.revision_request SET row_seq = 9007199254740992 WHERE id = {r1} $$, 'a row_seq of 2^53'),
  ($$ UPDATE collaboration.revision_request SET anchor = '{}' WHERE id = {r1} $$, 'a malformed anchor'),
  ($$ INSERT INTO collaboration.revision_response (request_id, institution_id, version, kind, explanation, response_revision, author_id)
       VALUES ({r1}, {fak_a}, 1, 'maybe', 'Tekst.', 0, {ana}) $$, 'an unknown response kind'),
  ($$ INSERT INTO collaboration.revision_response (request_id, institution_id, version, kind, explanation, response_revision, author_id)
       VALUES ({r1}, {fak_a}, 1, 'done', E'​', 0, {ana}) $$, 'an explanation of zero-width characters')
) AS s (sql, what);
SELECT matches(pg_temp.ask_as('ductus_identity', 'vesna',
    $$ UPDATE collaboration.revision_request SET row_seq = (SELECT row_seq FROM collaboration.revision_request
         WHERE document_id = 'doc-b') WHERE id = {r1} $$),
  '^23505', 'two requests cannot share a row_seq (C4)');

-- No runtime role reaches the tables or the sequence (A10, A11), even with a
-- mistaken grant: forced RLS without a policy for it shows and changes nothing.
SELECT matches(pg_temp.ask_as(r.role, 'vesna', format(s.sql, t.name)), '^42501', r.role || ' cannot ' || s.what || ' ' || t.name)
FROM (VALUES ('ductus_app'), ('ductus_worker'), ('ductus_retention')) AS r (role)
CROSS JOIN (VALUES ('revision_request'), ('revision_request_version'), ('revision_response')) AS t (name)
CROSS JOIN (VALUES
  ('SELECT count(*) FROM collaboration.%I', 'read'),
  ('INSERT INTO collaboration.%I DEFAULT VALUES', 'insert into'),
  ('UPDATE collaboration.%I SET institution_id = institution_id', 'update'),
  ('DELETE FROM collaboration.%I', 'delete from')
) AS s (sql, what);
SELECT matches(pg_temp.ask_as(r.role, 'vesna', $$ SELECT nextval('collaboration.revision_request_seq') $$), '^42501',
  r.role || ' cannot advance the counter sequence (C4)')
FROM (VALUES ('ductus_app'), ('ductus_worker'), ('ductus_retention')) AS r (role);
SELECT matches(pg_temp.ask('vesna', $$ SELECT collaboration.delete_revision_requests('doc-a', {fak_a}) $$), '^42501',
  'the web role cannot delete requests (A1)');
SELECT matches(pg_temp.ask('vesna', $$ SELECT collaboration.lock_document_for_write('doc-a') $$), '^42501',
  'the web role cannot take the document lock itself');
SELECT matches(pg_temp.ask('vesna', $$ SELECT collaboration.revision_above_document('doc-a', {fak_a}, 0) $$), '^42501',
  'the web role cannot read the revision of a document through the ceiling helper');
GRANT SELECT, INSERT, UPDATE, DELETE ON collaboration.revision_request, collaboration.revision_request_version,
  collaboration.revision_response TO ductus_app;
SELECT is(pg_temp.ask('vesna', $$ SELECT (SELECT count(*) FROM collaboration.revision_request)
    + (SELECT count(*) FROM collaboration.revision_request_version) + (SELECT count(*) FROM collaboration.revision_response) $$),
  '0', 'a mistaken SELECT grant still shows the web role no request');
SELECT matches(pg_temp.ask('vesna',
    $$ INSERT INTO collaboration.revision_request (institution_id, assignment_id, owner_id, document_id, anchor, state, version, row_seq, created_by)
       VALUES ({fak_a}, {z1}, {ana}, 'doc-a', {anchor}, 'open', 1, 9007199254740990, {vesna}) $$),
  '^42501: new row violates row-level security policy', 'a mistaken INSERT grant still lets no web write through');
SELECT is(pg_temp.ask('vesna', $$ WITH u AS (UPDATE collaboration.revision_request SET state = 'accepted' RETURNING 1) SELECT count(*) FROM u $$),
  '0', 'a mistaken UPDATE grant still changes no request');
SELECT is(pg_temp.ask('vesna', $$ WITH d AS (DELETE FROM collaboration.revision_request_version RETURNING 1) SELECT count(*) FROM d $$),
  '0', 'a mistaken DELETE grant still removes no version');
REVOKE SELECT, INSERT, UPDATE, DELETE ON collaboration.revision_request, collaboration.revision_request_version,
  collaboration.revision_response FROM ductus_app;

-- Requests change no evidence (H1).
SELECT is(pg_temp.evidence_print(), (SELECT v FROM print_before), 'creating and reading requests change nothing in schema evidence');

-- A teacher who leaves the course loses reading and creating at once (A9).
UPDATE institution.course_member SET member_to = now()
WHERE course_id = pg_temp.id('k3') AND user_id = pg_temp.id('petra') AND member_to IS NULL;
SELECT is(pg_temp.ask('petra', $$ SELECT count(*) FROM collaboration.list_revision_requests('doc-b') $$), 'ZD403: forbidden',
  'a removed teacher can no longer read');
SELECT is(pg_temp.create_as('petra', 'doc-b', 'Tekst.', 0, '{anchor_b}'), 'ZD403: forbidden', 'a removed teacher can no longer create');
SELECT is(pg_temp.create_as('petra', 'doc-b', 'Tekst.', 1, '{anchor_b}'), 'ZD403: forbidden',
  'a removed teacher asking for a revision above the document gets the forbidden answer, not invalid input');
SELECT is(pg_temp.ask('tomo', $$ SELECT count(*) FROM collaboration.list_revision_requests('doc-b') $$), '1',
  'the student still reads the request of the removed teacher');

-- After the submission is recorded creating writes nothing, reading still
-- works (B8). A submission request alone does not stop creating.
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64),
  repeat('b', 64)), 'reserved', 'fixture: Ana commits revision 1');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a', 1) $$), 'requested',
  'fixture: Ana requests revision 1');
SELECT is(pg_temp.create_as('vesna', 'doc-a', 'Prije upisa predaje.', 1), 'open|1', 'a requested but unrecorded submission does not stop creating');
SELECT is(pg_temp.create_as('vesna', 'doc-a', 'Iznad revizije.', 2), 'ZD422: invalid input',
  'after the commit of revision 1 a request for revision 2 is still above the document and refused');
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.record_submission(%L::uuid, %L)',
    (SELECT id FROM evidence.submission_request WHERE document_id = 'doc-a'), pg_temp.h('d'))), 'recorded',
  'fixture: the submission of revision 1 is recorded');
CREATE TEMP TABLE rows_submitted AS SELECT pg_temp.rows('doc-a') AS n;
SELECT is(pg_temp.create_as('vesna', 'doc-a', 'Nakon predaje.', 1), 'ZD403: forbidden', 'the teacher cannot create on a submitted document (B8)');
SELECT is(pg_temp.create_as('vesna', 'doc-a', 'Nakon predaje.', 2), 'ZD403: forbidden',
  'a revision above the document on a submitted document still gets the forbidden answer');
SELECT is(pg_temp.create_as('vesna', 'doc-a', '', NULL, 'NULL'), 'ZD403: forbidden',
  'a malformed create on a submitted document still gets the forbidden answer');
SELECT is(pg_temp.rows('doc-a'), (SELECT n FROM rows_submitted), 'creating on a submitted document wrote nothing');
SELECT is(pg_temp.ask(a.name, $$ SELECT count(DISTINCT request_id) || '|' || count(*) FROM collaboration.list_revision_requests('doc-a') $$),
  '10|14', a.name || ' still reads every request after the submission, with the four owner-written versions of r1')
FROM (VALUES ('ana'), ('vesna')) AS a (name);

-- The retention delete takes every request of one document with its versions
-- and responses, and nothing else (B9).
SELECT is(pg_temp.ask_as('ductus_identity', 'ana',
    $$ WITH i AS (INSERT INTO collaboration.revision_response (request_id, institution_id, version, kind, explanation, response_revision, author_id)
       VALUES ({r1}, {fak_a}, 1, 'done', 'Dodala sam izvor.', 1, {ana}) RETURNING kind) SELECT kind FROM i $$),
  'done', 'fixture: the owner stores a response, so the delete has all three tables to clear');
SELECT is(pg_temp.ask_as('ductus_identity', 'tomo',
    $$ WITH i AS (INSERT INTO collaboration.revision_response (request_id, institution_id, version, kind, explanation, response_revision, author_id)
       SELECT r.id, {fak_b}, 1, 'declined', 'Izvor je naveden u bilješci.', 0, {tomo} FROM collaboration.revision_request r WHERE r.document_id = 'doc-b'
       RETURNING kind) SELECT kind FROM i $$),
  'declined', 'fixture: the other document has a response too, so a too-wide delete would show');
SELECT ok(pg_temp.rows('doc-a') > 0 AND pg_temp.rows('doc-b') = 3, 'fixture: both documents have requests before the delete');
SET LOCAL ROLE ductus_retention;
SELECT collaboration.delete_revision_requests('doc-b', pg_temp.id('fak_a'));
SELECT collaboration.delete_revision_requests('doc-a', pg_temp.id('fak_a'));
SELECT collaboration.delete_revision_requests('doc-nema', pg_temp.id('fak_a'));
RESET ROLE;
SELECT is(pg_temp.rows('doc-a'), 0::bigint, 'after the delete no request, version or response of the document is left (B9)');
SELECT is((SELECT count(*) FROM collaboration.revision_response WHERE request_id = pg_temp.id('r1')::uuid), 0::bigint, 'the response went with its request');
SELECT is(pg_temp.rows('doc-b'), 3::bigint, 'a delete with another institution leaves the document''s requests alone');

SELECT * FROM finish();
ROLLBACK;

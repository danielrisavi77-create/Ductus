-- DAN-314, changed after acceptance (docs/backend/suradnja.md 4.14, contract
-- #1091 c.6752687836 as narrowed by #1091 c.6754441692): an accepted request
-- goes to a new version only when the database itself finds that its anchored
-- range changed in a later revision of the document. The caller sends the
-- request and its counter, never a hash, a revision or text. The classes of
-- the stored work as tables, the reader, the counter, the roles and what is
-- stored. Every person, document and text below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

-- A document body as the editor stores it: paragraphs 1..n with fixed ids; a
-- NULL paragraph is left out and "¦" splits a paragraph into two inline
-- texts.
CREATE FUNCTION pg_temp.doc(VARIADIC p text[]) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('schemaVersion', 1, 'nodes', coalesce(jsonb_agg(jsonb_build_object(
      'type', 'paragraph', 'id', '0f0e0d0c-0b0a-4000-8000-00000000000' || x.i,
      'children', (SELECT jsonb_agg(jsonb_build_object('type', 'text', 'text', c.part) ORDER BY c.n)
                     FROM unnest(string_to_array(x.t, '¦')) WITH ORDINALITY AS c (part, n))) ORDER BY x.i), '[]'))::text
    FROM unnest(p) WITH ORDINALITY AS x (t, i) WHERE x.t IS NOT NULL
$$;
-- Ana's work: paragraph 1 holds the accepted range of most requests below,
-- paragraph 2 a range that never changes, paragraph 3 the same phrase twice,
-- paragraph 4 "ab" 1000 times, paragraph 5 "ab" 1001 times, paragraph 6
-- overlapping occurrences and paragraph 7 characters of more than one byte.
CREATE FUNCTION pg_temp.work(p_first text, p_second text DEFAULT 'Ovo je dru¦gi odlomak rada.',
  p_third text DEFAULT 'isti izraz i isti izraz') RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_temp.doc(p_first, p_second, p_third, 'xab' || repeat(' ab', 999), 'xab' || repeat(' ab', 1000), 'aaa', 'čaša 😀 čaša')
$$;
CREATE TEMP TABLE page (name text PRIMARY KEY, body text NOT NULL);
INSERT INTO page VALUES
  ('not_json', 'nije json'),
  ('scalar', '"prvi odlomak"'),
  ('no_nodes', '{"schemaVersion":1,"nodes":{}}'),
  ('no_children', '{"schemaVersion":1,"nodes":[{"type":"paragraph","id":"0f0e0d0c-0b0a-4000-8000-000000000001","children":"prvi odlomak"}]}'),
  ('main', pg_temp.work('Ovo je prvi, dopunjeni odlomak teksta.')),
  ('restored', pg_temp.work('Ovo je prvi odlomak teksta o izmišljenoj temi.')),
  ('elsewhere', pg_temp.work('Ovo je prvi odlomak teksta o izmišljenoj temi.', p_third => 'isti izraz i isti izraz, pa treći.')),
  ('edited', pg_temp.work('Ovo je prvi, dopunjeni odlomak teksta.', p_third => 'isti izraz i isti izraz, pa treći.')),
  ('later', pg_temp.work('Ovo je prvi, dopunjeni odlomak teksta.', 'Ovo je drugi odlomak rada. Dodana je rečenica.')),
  ('submitted', pg_temp.work('Ovo je prvi, dopunjeni i predani odlomak teksta.'));
-- The next revision of Ana's document, with the named page as its checkpoint
-- or with none. Returns the new revision.
CREATE FUNCTION pg_temp.revise(p_page text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  v_fak uuid := pg_temp.id('fak_a');
  v_ana uuid := pg_temp.id('ana');
  v_body text := (SELECT body FROM page WHERE name = p_page);
  v_hash text := coalesce(pg_temp.sha(v_body), pg_temp.h('a'));
  v_next bigint;
BEGIN
  IF p_page IS NOT NULL AND v_body IS NULL THEN
    RAISE EXCEPTION 'fixture: no page %', p_page;
  END IF;
  SET LOCAL ROLE ductus_evidence;
  SELECT current_revision + 1 INTO v_next FROM evidence.document WHERE id = 'doc-a';
  INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
  VALUES ('doc-a', v_fak, v_next, v_next - 1, v_ana, v_hash);
  IF v_body IS NOT NULL THEN
    INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body) VALUES ('doc-a', v_fak, v_next, v_body);
  END IF;
  UPDATE evidence.document SET current_revision = v_next, current_content_hash = v_hash WHERE id = 'doc-a';
  RESET ROLE;
  RETURN v_next;
END
$$;

INSERT INTO ref VALUES
  ('anchor', '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"prvi odlomak","prefix":"","suffix":" teksta","startHint":7,"endHint":19}'),
  ('anchor_u', '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000002","quote":"drugi odlomak","prefix":"Ovo je ","suffix":" rada","startHint":7,"endHint":20}'),
  ('anchor_gone', '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000009","quote":"nestali odlomak","prefix":"","suffix":"","startHint":0,"endHint":15}'),
  ('anchor_tie', '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000003","quote":"isti izraz","prefix":"","suffix":"","startHint":0,"endHint":10}'),
  ('anchor_pre', '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000003","quote":"isti izraz","prefix":"i ","suffix":"","startHint":13,"endHint":23}'),
  ('anchor_b', '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000002","quote":"odlomak","prefix":"","suffix":"","startHint":0,"endHint":7}');

-- One valid call per action, with :id, :seq and :rev (the document's current
-- revision) to fill in, and who makes it. An acceptance stores the hash the
-- teacher's client computed for the range, which is the hash of the quote.
CREATE TEMP TABLE action (name text PRIMARY KEY, actor text NOT NULL, call text NOT NULL);
INSERT INTO action VALUES
  ('respond', 'ana', $$ respond_revision_request(:id, :seq, 'done', 'Dodala sam izvor.', 5) $$),
  ('accept', 'vesna', format('accept_revision_request(:id, :seq, 5, %L)', pg_temp.sha('prvi odlomak'))),
  ('accept_now', 'vesna', format('accept_revision_request(:id, :seq, :rev, %L)', pg_temp.sha('prvi odlomak'))),
  ('accept_u', 'vesna', format('accept_revision_request(:id, :seq, 5, %L)', pg_temp.sha('drugi odlomak'))),
  ('accept_other', 'vesna', format('accept_revision_request(:id, :seq, 5, %L)', repeat('e', 64))),
  ('accept_gone', 'vesna', format('accept_revision_request(:id, :seq, 5, %L)', pg_temp.sha('nestali odlomak'))),
  ('accept_tie', 'vesna', format('accept_revision_request(:id, :seq, 5, %L)', pg_temp.sha('isti izraz'))),
  ('accept_nohash', 'vesna', 'accept_revision_request(:id, :seq, 5, NULL)'),
  ('reopen', 'vesna', $$ reopen_revision_request(:id, :seq, 'Nova uputa.', 5) $$),
  ('withdraw', 'vesna', $$ withdraw_revision_request(:id, :seq) $$),
  ('rereview', 'ana', 'rereview_revision_request(:id, :seq)');
-- A request driven to a state: its anchor and the steps after its creation.
CREATE TEMP TABLE shape (state text PRIMARY KEY, anchor text NOT NULL, steps text[] NOT NULL);
INSERT INTO shape VALUES
  ('open', 'anchor', '{}'), ('responded', 'anchor', '{respond}'), ('reopened', 'anchor', '{reopen}'),
  ('withdrawn', 'anchor', '{withdraw}'),
  ('accepted', 'anchor', '{respond,accept}'),
  ('accepted_now', 'anchor', '{respond,accept_now}'),
  ('accepted_nohash', 'anchor', '{respond,accept_nohash}'),
  ('accepted_same', 'anchor_u', '{respond,accept_u}'),
  ('accepted_other', 'anchor_u', '{respond,accept_other}'),
  ('accepted_gone', 'anchor_gone', '{respond,accept_gone}'),
  ('accepted_tie', 'anchor_tie', '{respond,accept_tie}'),
  ('accepted_pre', 'anchor_pre', '{respond,accept_tie}');

-- The helpers of 112: a call as one line, the counter, the stored request as
-- one value, a request driven to a state, and one call on such a request.
CREATE FUNCTION pg_temp.run(p_actor text, p_call text, p_id uuid, p_seq bigint) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format($q$ SELECT concat_ws('|', outcome, row_seq, version, state) FROM collaboration.%s $q$,
    replace(replace(replace(p_call, ':id', coalesce(quote_literal(p_id), 'NULL')), ':seq', coalesce(p_seq::text, 'NULL')),
      ':rev', (SELECT current_revision::text FROM evidence.document WHERE id = 'doc-a'))))
$$;
CREATE FUNCTION pg_temp.act(p_action text, p_id uuid, p_seq bigint, p_actor text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.run(coalesce(p_actor, a.actor), a.call, p_id, p_seq) FROM action a WHERE a.name = p_action
$$;
CREATE FUNCTION pg_temp.seq(p_id uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT row_seq FROM collaboration.revision_request WHERE id = p_id
$$;
CREATE FUNCTION pg_temp.snapshot(p_id uuid) RETURNS text LANGUAGE sql AS $$
  SELECT md5(concat(
    (SELECT row_to_json(q)::text FROM collaboration.revision_request q WHERE q.id = p_id), '#',
    (SELECT string_agg(row_to_json(v)::text, ';' ORDER BY v.version) FROM collaboration.revision_request_version v WHERE v.request_id = p_id), '#',
    (SELECT string_agg(row_to_json(s)::text, ';' ORDER BY s.version) FROM collaboration.revision_response s WHERE s.request_id = p_id)))
$$;
CREATE FUNCTION pg_temp.evidence_print() RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  t text;
  part text;
  acc text := '';
BEGIN
  FOR t IN SELECT relname FROM pg_class WHERE relnamespace = 'evidence'::regnamespace AND relkind IN ('r', 'p') ORDER BY relname LOOP
    EXECUTE format('SELECT string_agg(md5(row_to_json(x)::text), ''|'' ORDER BY md5(row_to_json(x)::text)) FROM evidence.%I x', t) INTO part;
    acc := acc || t || ':' || coalesce(part, '') || ';';
  END LOOP;
  RETURN md5(acc);
END
$$;
CREATE FUNCTION pg_temp.make(p_state text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  s shape;
  v_id uuid;
  v_step text;
  v_out text;
BEGIN
  SELECT * INTO STRICT s FROM shape WHERE state = p_state;
  v_id := pg_temp.ask('vesna', format($q$ SELECT request_id FROM collaboration.create_revision_request('doc-a', {%s},
    'Ovdje nedostaje izvor.', 0) $q$, s.anchor))::uuid;
  FOREACH v_step IN ARRAY s.steps LOOP
    v_out := pg_temp.act(v_step, v_id, pg_temp.seq(v_id));
    IF split_part(v_out, '|', 1) <> 'applied' THEN
      RAISE EXCEPTION 'fixture % failed at %: %', p_state, v_step, v_out;
    END IF;
  END LOOP;
  RETURN v_id;
END
$$;
-- applied|version|state|stored when the answer matches the stored row, the
-- counter moved and schema evidence stayed as it was; otherwise the answer
-- with |unchanged, or |changed when the request or schema evidence differs.
CREATE FUNCTION pg_temp.try(p_state text, p_actor text, p_call text DEFAULT 'rereview_revision_request(:id, :seq)')
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid := pg_temp.make(p_state);
  v_seq bigint := pg_temp.seq(v_id);
  v_before text := pg_temp.snapshot(v_id);
  v_print text := pg_temp.evidence_print();
  v_out text := pg_temp.run(p_actor, p_call, v_id, v_seq);
  v_same_print boolean := pg_temp.evidence_print() = v_print;
BEGIN
  IF split_part(v_out, '|', 1) = 'applied' THEN
    RETURN format('applied|%s|%s|%s', split_part(v_out, '|', 3), split_part(v_out, '|', 4),
      CASE WHEN split_part(v_out, '|', 2)::bigint = pg_temp.seq(v_id) AND pg_temp.seq(v_id) > v_seq AND v_same_print
             AND (SELECT format('%s|%s', version, state) FROM collaboration.revision_request WHERE id = v_id)
                 = split_part(v_out, '|', 3) || '|' || split_part(v_out, '|', 4)
           THEN 'stored' ELSE 'not stored' END);
  END IF;
  RETURN v_out || '|' || CASE WHEN pg_temp.snapshot(v_id) = v_before AND v_same_print THEN 'unchanged' ELSE 'changed' END;
END
$$;
-- The reader called directly, as the role that may: revision|hash, or
-- revision|none when the range does not resolve.
CREATE FUNCTION pg_temp.read(p_node integer, p_quote text, p_prefix text DEFAULT '', p_suffix text DEFAULT '',
  p_document text DEFAULT 'doc-a', p_institution text DEFAULT 'fak_a', p_role text DEFAULT 'ductus_identity')
RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask_as(p_role, 'vesna', format(
    $q$ SELECT concat_ws('|', revision, coalesce(range_hash, 'none')) FROM collaboration.current_range_hash(%L, %L, %L::jsonb) $q$,
    p_document, pg_temp.id(p_institution), jsonb_build_object('nodeId', '0f0e0d0c-0b0a-4000-8000-00000000000' || p_node,
      'quote', p_quote, 'prefix', p_prefix, 'suffix', p_suffix, 'startHint', 0, 'endHint', char_length(p_quote))))
$$;

-- Catalogue.
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.oid = 'collaboration.rereview_revision_request(uuid,bigint)'::regprocedure
        AND (NOT p.prosecdef OR p.proowner <> 'ductus_identity'::regrole OR NOT 'search_path=""' = ANY (p.proconfig)) $$,
  'the rereview is a SECURITY DEFINER function of the identity role with an empty search_path');
SELECT bag_eq(
  $$ SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence', 'ductus_test_stranger', 'public']) AS r
      WHERE has_function_privilege(r, 'collaboration.rereview_revision_request(uuid,bigint)', 'EXECUTE') $$,
  $$ VALUES ('ductus_app') $$, 'only the web role executes the rereview');
SELECT is(pg_get_function_arguments('collaboration.rereview_revision_request(uuid,bigint)'::regprocedure),
  'p_request_id uuid, p_expected_seq bigint',
  'the arguments are the request and its counter: no hash, revision, person, institution, time, text or verdict');
SELECT is(pg_get_function_result('collaboration.rereview_revision_request(uuid,bigint)'::regprocedure),
  'TABLE(outcome text, row_seq bigint, version integer, state text)', 'the answer is the outcome, the counter, the version and the state');
SELECT is((SELECT string_agg(p.oid::regprocedure::text, ',') FROM pg_proc p
    WHERE p.pronamespace = 'collaboration'::regnamespace AND p.proname = 'rereview_revision_request'),
  'collaboration.rereview_revision_request(uuid,bigint)',
  'there is one rereview, and none that takes a hash or a revision from the caller (c.6754364680)');
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.oid = 'collaboration.current_range_hash(text,uuid,jsonb)'::regprocedure
        AND (NOT p.prosecdef OR p.proowner <> 'ductus_evidence'::regrole OR NOT 'search_path=""' = ANY (p.proconfig)
             OR p.provolatile <> 's') $$,
  'the reader of the range is a stable SECURITY DEFINER function of the evidence role with an empty search_path');
SELECT bag_eq(
  $$ SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_identity', 'ductus_test_stranger', 'public']) AS r
      WHERE has_function_privilege(r, 'collaboration.current_range_hash(text,uuid,jsonb)', 'EXECUTE') $$,
  $$ VALUES ('ductus_identity') $$, 'only the identity role executes the reader: the web role cannot ask it');
SELECT is(pg_get_function_result('collaboration.current_range_hash(text,uuid,jsonb)'::regprocedure),
  'TABLE(revision bigint, range_hash text)', 'the reader returns a revision and a hash, never text');
SELECT ok(NOT has_schema_privilege('ductus_identity', 'collaboration', 'CREATE'),
  'after the migration the identity role keeps no CREATE on the schema');
SELECT ok(NOT has_schema_privilege('ductus_evidence', 'collaboration', 'USAGE') AND NOT has_schema_privilege('ductus_evidence', 'collaboration', 'CREATE'),
  'after the migration the evidence role keeps no right on the schema');
SELECT bag_eq(
  $$ SELECT attname::text FROM pg_attribute
      WHERE attrelid = 'collaboration.revision_request_version'::regclass AND attnum > 0 AND NOT attisdropped $$,
  $$ VALUES ('request_id'), ('institution_id'), ('version'), ('instruction'), ('requested_revision'), ('opened_by'), ('opened_at'),
            ('closed_as'), ('closed_by'), ('closed_at'), ('accepted_revision'), ('accepted_range_hash'), ('opened_as'),
            ('observed_range_hash') $$,
  'a version gains how it was opened and the observed hash, and no grade, verdict or authorship column (PRODUCT 5, rule 7)');

-- Work the database cannot read is never "changed": the rereview fails
-- closed and writes nothing. Revisions 1 to 5 have no checkpoint; 6 to 9 have
-- one that is not a document.
INSERT INTO ref SELECT 'rev5', max(r) FROM (SELECT pg_temp.revise() AS r FROM generate_series(1, 5)) AS x;
SELECT is(pg_temp.try('accepted', p.name), 'ZD503: work unavailable|unchanged',
  'without a checkpoint of the current revision the rereview of ' || p.name || ' is unavailable, not applied')
FROM (VALUES ('ana'), ('vesna')) AS p (name);
SELECT is(pg_temp.revise(u.page) || '|' || pg_temp.try('accepted', 'ana'), u.revision || '|ZD503: work unavailable|unchanged',
  'a checkpoint ' || u.what || ' is unavailable, not applied')
FROM (VALUES
  (6, 'not_json', 'that is not JSON'),
  (7, 'scalar', 'that is a JSON string'),
  (8, 'no_nodes', 'whose nodes are not a list'),
  (9, 'no_children', 'whose paragraph has no list of inline texts')
) AS u (revision, page, what) ORDER BY u.revision;
SELECT is(pg_temp.try(o.state, o.actor, o.call), o.outcome, 'with unreadable work ' || o.what)
FROM (VALUES
  ('open', 'ana', 'rereview_revision_request(:id, :seq)', 'ZD409: transition not allowed|unchanged', 'the state is still checked first'),
  ('accepted_nohash', 'ana', 'rereview_revision_request(:id, :seq)', 'ZD409: transition not allowed|unchanged',
   'an acceptance without a hash is refused before the work is read'),
  ('accepted', 'ana', 'rereview_revision_request(:id, 0)', 'ZD422: invalid input|unchanged', 'the shape of the counter is still checked first'),
  ('accepted', 'dora', 'rereview_revision_request(:id, :seq)', 'ZD403: forbidden|unchanged', 'a student who does not own it is still forbidden')
) AS o (state, actor, call, outcome, what);

-- Revision 10 is a readable document in which paragraph 1 was edited.
INSERT INTO ref SELECT 'rev10', pg_temp.revise('main');
SELECT is((SELECT val FROM ref WHERE name = 'rev10'), '10', 'fixture: the document is at revision 10');
-- A checkpoint is read only while it is the checkpoint of the document's
-- current content: with another current hash the work is unavailable again.
CREATE FUNCTION pg_temp.content_hash(p_hash text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_was text;
BEGIN
  SET LOCAL ROLE ductus_evidence;
  SELECT current_content_hash INTO v_was FROM evidence.document WHERE id = 'doc-a';
  UPDATE evidence.document SET current_content_hash = p_hash WHERE id = 'doc-a';
  RESET ROLE;
  RETURN v_was;
END $$;
INSERT INTO ref SELECT 'hash10', pg_temp.content_hash(pg_temp.h('b'));
SELECT is(pg_temp.try('accepted', 'ana'), 'ZD503: work unavailable|unchanged',
  'a checkpoint whose hash is not the current hash of the document is unavailable, not applied');
SELECT is(pg_temp.content_hash((SELECT val FROM ref WHERE name = 'hash10')), pg_temp.h('b'),
  'fixture: the document has the hash of its checkpoint again');
CREATE TEMP TABLE print_main AS SELECT pg_temp.evidence_print() AS v;

-- The reader: resolveTextAnchor over the checkpoint of the current revision.
SELECT is(pg_temp.read(c.node, c.quote, c.prefix, c.suffix), '10|' || coalesce(pg_temp.sha(c.resolved), 'none'), 'the reader: ' || c.what)
FROM (VALUES
  (2, 'drugi odlomak', 'Ovo je ', ' rada', 'drugi odlomak', 'a quote across two inline texts resolves to the hash of the quote'),
  (1, 'prvi odlomak', '', ' teksta', NULL, 'a quote that is no longer in the paragraph does not resolve'),
  (9, 'nestali odlomak', '', '', NULL, 'a paragraph that is gone does not resolve'),
  (3, 'isti izraz', '', '', NULL, 'two occurrences without context do not resolve'),
  (3, 'isti izraz', 'i ', '', 'isti izraz', 'the prefix picks one of two occurrences'),
  (3, 'isti izraz', '', ' i', 'isti izraz', 'the suffix picks one of two occurrences'),
  (3, 'isti izraz', 'i ', ' i', NULL, 'a prefix on one occurrence and a suffix on the other is a tie'),
  (3, 'isti izraz', 'nema ', ' nema', NULL, 'context that matches neither occurrence is a tie'),
  (4, 'ab', 'x', '', 'ab', '1000 occurrences are searched and the prefix picks the first'),
  (5, 'ab', 'x', '', NULL, '1001 occurrences never resolve'),
  (6, 'aa', '', '', NULL, 'overlapping occurrences are both counted'),
  (6, 'aa', 'a', '', 'aa', 'the prefix picks the second of two overlapping occurrences'),
  (6, 'aaa', 'aaa', 'aaa', 'aaa', 'a prefix longer than the text before the quote gives no point and the one occurrence resolves'),
  (7, 'čaša', '😀 ', '', 'čaša', 'characters of several bytes are compared whole'),
  (7, 'čaša', '', ' 😀', 'čaša', 'a suffix with a character outside the basic plane picks the first occurrence')
) AS c (node, quote, prefix, suffix, resolved, what);
SELECT is(pg_temp.read(2, 'drugi odlomak', p_document => c.document, p_institution => c.institution), 'ZD503: work unavailable',
  'the reader: ' || c.what)
FROM (VALUES
  ('doc-a', 'fak_b', 'a document asked for under another institution is unavailable'),
  ('doc-x', 'fak_a', 'an unknown document is unavailable'),
  ('doc-b', 'fak_b', 'a document without a checkpoint is unavailable')
) AS c (document, institution, what);
SELECT matches(pg_temp.read(2, 'drugi odlomak', p_role => r), '^42501', 'the reader: ' || r || ' cannot call it')
FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention']) AS r;

-- The change rule, for the student owner and for the teacher: the rereview is
-- applied only when the range the database resolves at the current revision
-- differs from the accepted one. Neither caller can say that it changed.
SELECT is(pg_temp.try(h.state, p.name), h.outcome, 'a rereview by ' || p.name || ' ' || h.what)
FROM (VALUES
  ('accepted', 'applied|2|reopened|stored', 'of a range whose quote was edited opens version 2'),
  ('accepted_gone', 'applied|2|reopened|stored', 'of a range whose paragraph is gone opens version 2'),
  ('accepted_tie', 'applied|2|reopened|stored', 'of a range that no longer resolves to one place opens version 2'),
  ('accepted_other', 'applied|2|reopened|stored', 'of a range whose hash differs from the stored accepted one opens version 2'),
  ('accepted_same', 'ZD409: transition not allowed|unchanged',
   'of an unchanged range is refused although another paragraph changed (c.6754364680)'),
  ('accepted_pre', 'ZD409: transition not allowed|unchanged', 'of an unchanged range that its prefix still picks is refused'),
  ('accepted_now', 'ZD409: transition not allowed|unchanged', 'accepted at the current revision is refused: the document has no later revision'),
  ('accepted_nohash', 'ZD409: transition not allowed|unchanged', 'of an acceptance without a hash is refused: nothing to compare')
) AS h (state, outcome, what)
CROSS JOIN (VALUES ('ana'), ('vesna')) AS p (name);
-- The call the review reached: a hash, or none, sent by the caller. No such
-- function exists any more, for an unchanged range or for a changed one.
SELECT matches(pg_temp.try(s.state, p.name, c.call), '^42883.*\|unchanged$',
  'the old call by ' || p.name || ' with ' || c.what || ' on ' || s.state || ' does not exist and writes nothing')
FROM (VALUES ('accepted_same'), ('accepted')) AS s (state)
CROSS JOIN (VALUES ('ana'), ('vesna')) AS p (name)
CROSS JOIN (VALUES
  ('rereview_revision_request(:id, :seq, 10, NULL)', 'no hash'),
  (format('rereview_revision_request(:id, :seq, 10, %L)', repeat('f', 64)), 'an invented hash')
) AS c (call, what);

-- Only an accepted request is rereviewed.
SELECT is(pg_temp.try(s.state, 'ana'), 'ZD409: transition not allowed|unchanged', 'a rereview of a request that is ' || s.state || ' is refused')
FROM (VALUES ('open'), ('responded'), ('reopened'), ('withdrawn')) AS s (state);
INSERT INTO ref SELECT 'v999', pg_temp.make('open');
SELECT is(pg_temp.ask_as('ductus_identity', 'vesna',
    $$ WITH u AS (UPDATE collaboration.revision_request SET version = 999 WHERE id = {v999} RETURNING version) SELECT version FROM u $$),
  '999', 'fixture: the owner moves the request to version 999');
SELECT matches(pg_temp.act(s.name, pg_temp.id('v999'), pg_temp.seq(pg_temp.id('v999'))), '^applied\|[0-9]+\|1000\|' || s.state || '$',
  'fixture: version 1000 is ' || s.state)
FROM (VALUES (1, 'reopen', 'reopened'), (2, 'respond', 'responded'), (3, 'accept', 'accepted')) AS s (n, name, state) ORDER BY s.n;
INSERT INTO ref SELECT 'v1000', pg_temp.snapshot(pg_temp.id('v999'));
SELECT is(pg_temp.act('rereview', pg_temp.id('v999'), pg_temp.seq(pg_temp.id('v999'))), 'ZD409: transition not allowed',
  'an accepted version 1000 whose range changed is not rereviewed: there is no version 1001');
SELECT is(pg_temp.snapshot(pg_temp.id('v999')), (SELECT val FROM ref WHERE name = 'v1000'), 'the refused rereview wrote nothing');

-- The counter, and the order of the checks around it.
SELECT is(pg_temp.try('accepted', 'ana', 'rereview_revision_request(:id, ' || s.seq || ')'), 'ZD422: invalid input|unchanged',
  'a rereview with a counter that is ' || s.what || ' is refused')
FROM (VALUES ('NULL', 'missing'), ('0', '0'), ('-1', '-1'), ('9007199254740992', '2^53')) AS s (seq, what);
INSERT INTO ref SELECT 'c1', pg_temp.make('accepted');
INSERT INTO ref SELECT 'c1_before', pg_temp.snapshot(pg_temp.id('c1'));
INSERT INTO ref SELECT 'c2', pg_temp.make('open');
INSERT INTO ref SELECT 'c3', pg_temp.make('accepted_same');
SELECT is(pg_temp.act('rereview', pg_temp.id(c.id), pg_temp.seq(pg_temp.id(c.id)) + c.shift),
  'conflict|' || pg_temp.seq(pg_temp.id(c.id)) || '|1|' || c.state, c.what)
FROM (VALUES
  ('c1', -1, 'accepted', 'a stale rereview is a conflict with the current counter, version and state'),
  ('c1', 1000, 'accepted', 'a counter from the future is a conflict'),
  ('c3', -1, 'accepted', 'a stale rereview of an unchanged range is a conflict, not a transition error'),
  ('c2', -1, 'open', 'a stale rereview of an open request is a conflict, not a transition error')
) AS c (id, shift, state, what);
SELECT is(pg_temp.snapshot(pg_temp.id('c1')), (SELECT val FROM ref WHERE name = 'c1_before'), 'a conflict writes nothing');
SELECT is(pg_temp.try('open', 'ana', 'rereview_revision_request(:id, 0)'), 'ZD422: invalid input|unchanged',
  'the shape of the counter is checked before the state');

-- Roles: the student owner and a teacher of the course; nobody else, whether
-- the range changed or not, and even with malformed input.
SELECT is(pg_temp.try(s.state, p.name, c.call), 'ZD403: forbidden|unchanged',
  p.name || ' cannot fire the rereview of ' || s.what || c.what)
FROM (VALUES ('dora'), ('marko'), ('iva'), ('petra'), ('tomo'), ('boris'), ('nina')) AS p (name)
CROSS JOIN (VALUES ('accepted', 'a changed range'), ('accepted_same', 'an unchanged range')) AS s (state, what)
CROSS JOIN (VALUES ('rereview_revision_request(:id, :seq)', ''), ('rereview_revision_request(:id, 0)', ', malformed or not')) AS c (call, what);
SELECT matches(pg_temp.try('accepted', t.name), '^ZD401.*\|unchanged$', 'a rereview with session ' || t.name || ' is not signed in')
FROM (VALUES ('anon'), ('expired'), ('closed'), ('unknown')) AS t (name);
SELECT is(pg_temp.act('rereview', pg_temp.id('nobody'), 1, p.name), 'ZD403: forbidden', 'a missing request reads as a forbidden one to ' || p.name)
FROM (VALUES ('ana'), ('vesna')) AS p (name);
INSERT INTO ref SELECT 'rb', pg_temp.ask('petra', $$ SELECT request_id FROM collaboration.create_revision_request('doc-b', {anchor_b}, 'Tekst.', 0) $$);
SELECT is(pg_temp.act('rereview', pg_temp.id('rb'), pg_temp.seq(pg_temp.id('rb')), p.name), 'ZD403: forbidden',
  'a request of another institution reads as a forbidden one to ' || p.name)
FROM (VALUES ('ana'), ('vesna')) AS p (name);
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('marko'), 'teacher');
SELECT is(pg_temp.try('accepted', 'marko'), 'applied|2|reopened|stored', 'a second teacher of K1 fires the rereview of a changed range');
UPDATE institution.course_member SET member_to = now()
WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('marko') AND member_to IS NULL;
SELECT is(pg_temp.try('accepted', 'marko'), 'ZD403: forbidden|unchanged', 'a teacher who left K1 cannot fire the rereview');

-- What is stored: the accepted version stays as it was; the new one repeats
-- the teacher's instruction, names the caller of the session, the revision the
-- database read and the hash it computed there, and carries no answer,
-- acceptance or verdict.
INSERT INTO ref SELECT 's1', pg_temp.make('accepted');
SELECT matches(pg_temp.act('rereview', pg_temp.id('s1'), pg_temp.seq(pg_temp.id('s1'))), '^applied\|[0-9]+\|2\|reopened$', 'fixture: Ana fires the rereview');
SELECT row_eq(
  $$ SELECT closed_as, closed_by, accepted_revision, accepted_range_hash, opened_as, observed_range_hash
       FROM collaboration.revision_request_version WHERE request_id = pg_temp.id('s1') AND version = 1 $$,
  ROW('accepted'::text, pg_temp.id('vesna'), 5::bigint, pg_temp.sha('prvi odlomak'), 'instruction'::text, NULL::text),
  'version 1 stays accepted by the teacher at revision 5 with its hash: the acceptance is not undone');
SELECT row_eq(
  $$ SELECT instruction, requested_revision, opened_by, opened_as, observed_range_hash, closed_as, closed_by, closed_at::text,
            accepted_revision, accepted_range_hash
       FROM collaboration.revision_request_version WHERE request_id = pg_temp.id('s1') AND version = 2 $$,
  ROW('Ovdje nedostaje izvor.'::text, 10::bigint, pg_temp.id('ana'), 'rereview'::text, NULL::text, NULL::text, NULL::uuid, NULL::text,
      NULL::bigint, NULL::text),
  'version 2 repeats the instruction at the revision the database read, opened by the caller as a rereview, without a hash because the range no longer resolves, and is not closed');
SELECT is((SELECT string_agg(version::text, ',') FROM collaboration.revision_response WHERE request_id = pg_temp.id('s1')), '1',
  'the answer of version 1 stays and version 2 has none');
INSERT INTO ref SELECT 's2', pg_temp.make('accepted_other');
SELECT matches(pg_temp.act('rereview', pg_temp.id('s2'), pg_temp.seq(pg_temp.id('s2')), 'vesna'), '^applied\|[0-9]+\|2\|reopened$',
  'fixture: Vesna fires the rereview of a range that still resolves');
SELECT row_eq(
  $$ SELECT requested_revision, opened_by, opened_as, observed_range_hash FROM collaboration.revision_request_version
      WHERE request_id = pg_temp.id('s2') AND version = 2 $$,
  ROW(10::bigint, pg_temp.id('vesna'), 'rereview'::text, pg_temp.sha('drugi odlomak')),
  'a rereview of a range that resolves stores the teacher of the session and the hash the database computed');
SELECT bag_eq(
  $$ SELECT DISTINCT requested_revision, observed_range_hash FROM collaboration.revision_request_version WHERE opened_as = 'rereview' $$,
  $$ VALUES (10::bigint, NULL::text), (10::bigint, pg_temp.sha('drugi odlomak')) $$,
  'every version a rereview opened so far names revision 10 and a hash the database computed, or none');
INSERT INTO ref SELECT 's3', pg_temp.make('reopened');
SELECT is((SELECT string_agg(format('%s|%s|%s', version, opened_as, observed_range_hash IS NULL), ';' ORDER BY version)
    FROM collaboration.revision_request_version WHERE request_id = pg_temp.id('s3')),
  '1|instruction|t;2|instruction|t', 'a created version and a teacher''s reopen are opened as an instruction');
SELECT matches(pg_temp.ask_as('ductus_identity', 'vesna', format(
    $$ WITH u AS (UPDATE collaboration.revision_request_version SET %s WHERE request_id = {%s} AND version = 2 RETURNING 1) SELECT count(*) FROM u $$,
    k.change, k.id)), '^23514', 'the table refuses ' || k.what)
FROM (VALUES
  ('s1', $$ opened_as = 'verdict' $$, 'an unknown way of opening'),
  ('s1', $$ observed_range_hash = 'changed' $$, 'an observed hash of the wrong shape'),
  ('s3', format('observed_range_hash = %L', repeat('f', 64)), 'an observed hash on a version opened as an instruction')
) AS k (id, change, what);
SELECT is(pg_temp.evidence_print(), (SELECT v FROM print_main), 'no call since revision 10 changed anything in schema evidence');

-- The new cycle (O7; #87 c.6691142048): the student answers version 2, only
-- the teacher's acceptance closes it, and the next rereview compares the
-- document with that acceptance.
SELECT is(pg_temp.act('respond', pg_temp.id('s1'), pg_temp.seq(pg_temp.id('s1'))), 'ZD422: invalid input',
  'an answer at revision 5, below the revision of the rereview, is refused');
CREATE FUNCTION pg_temp.cycle(p_page text, p_actor text, p_call text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_page IS NOT NULL THEN
    PERFORM pg_temp.revise(p_page);
  END IF;
  RETURN pg_temp.run(p_actor, p_call, pg_temp.id('s1'), pg_temp.seq(pg_temp.id('s1')));
END
$$;
SELECT matches(pg_temp.cycle(c.page, c.actor, c.call), c.outcome, c.what)
FROM (VALUES
  (1, NULL, 'ana', $$ respond_revision_request(:id, :seq, 'done', 'Vratila sam izvor.', 10) $$, '^applied\|[0-9]+\|2\|responded$',
   'the student answers version 2: STUDENT_RESPONDED, not accepted'),
  (2, NULL, 'ana', 'rereview_revision_request(:id, :seq)', '^ZD409: transition not allowed$', 'an answered request is not rereviewed'),
  (3, 'restored', 'vesna', format('accept_revision_request(:id, :seq, 11, %L)', pg_temp.sha('prvi odlomak')), '^applied\|[0-9]+\|2\|accepted$',
   'at revision 11 the quote is back and only the teacher''s acceptance closes the new cycle'),
  (4, NULL, 'ana', 'rereview_revision_request(:id, :seq)', '^ZD409: transition not allowed$',
   'the revision of the second acceptance is no later revision'),
  (5, 'elsewhere', 'ana', 'rereview_revision_request(:id, :seq)', '^ZD409: transition not allowed$',
   'revision 12 changes another paragraph only: the accepted range is unchanged and the student cannot reopen it'),
  (6, NULL, 'vesna', 'rereview_revision_request(:id, :seq)', '^ZD409: transition not allowed$', 'nor can the teacher through the rereview'),
  (7, 'edited', 'ana', 'rereview_revision_request(:id, :seq)', '^applied\|[0-9]+\|3\|reopened$',
   'revision 13 edits the accepted range again: version 3'),
  (8, NULL, 'vesna', 'withdraw_revision_request(:id, :seq)', '^applied\|[0-9]+\|3\|withdrawn$', 'the teacher may withdraw a rereviewed request')
) AS c (n, page, actor, call, outcome, what) ORDER BY c.n;
SELECT is((SELECT string_agg(format('%s|%s|%s|%s|%s', version, opened_as, requested_revision, closed_as, accepted_revision), ';' ORDER BY version)
    FROM collaboration.revision_request_version WHERE request_id = pg_temp.id('s1')),
  '1|instruction|0|accepted|5;2|rereview|10|accepted|11;3|rereview|13|withdrawn|', 'every version keeps how and where it was opened and closed');

-- Concurrency (negative): of two calls that loaded the same counter one is
-- applied and the other is a conflict that writes nothing.
INSERT INTO ref SELECT 'k1r', pg_temp.make('accepted');
INSERT INTO ref SELECT 'k1r_seq', pg_temp.seq(pg_temp.id('k1r'));
SELECT matches(pg_temp.act('rereview', pg_temp.id('k1r'), (SELECT val FROM ref WHERE name = 'k1r_seq')::bigint), '^applied\|[0-9]+\|2\|reopened$',
  'the first of two rereviews with the same counter is applied');
INSERT INTO ref SELECT 'k1r_after', pg_temp.snapshot(pg_temp.id('k1r'));
SELECT is(pg_temp.act('rereview', pg_temp.id('k1r'), (SELECT val FROM ref WHERE name = 'k1r_seq')::bigint, p.name),
  'conflict|' || pg_temp.seq(pg_temp.id('k1r')) || '|2|reopened', 'the second, of ' || p.name || ', is a conflict')
FROM (VALUES ('vesna'), ('ana')) AS p (name);
SELECT is(pg_temp.snapshot(pg_temp.id('k1r')), (SELECT val FROM ref WHERE name = 'k1r_after'), 'the second rereview wrote nothing');
SELECT is((SELECT count(*) FROM collaboration.revision_request_version WHERE request_id = pg_temp.id('k1r')), 2::bigint,
  'two rereviews with the same counter open exactly one version');
-- The rereview against the teacher's own reopen, in both orders: the text of
-- the one that was applied stays.
INSERT INTO ref SELECT 'k2r', pg_temp.make('accepted');
INSERT INTO ref SELECT 'k2r_seq', pg_temp.seq(pg_temp.id('k2r'));
SELECT matches(pg_temp.act('reopen', pg_temp.id('k2r'), (SELECT val FROM ref WHERE name = 'k2r_seq')::bigint), '^applied\|[0-9]+\|2\|reopened$',
  'the teacher reopens first');
SELECT is(pg_temp.act('rereview', pg_temp.id('k2r'), (SELECT val FROM ref WHERE name = 'k2r_seq')::bigint),
  'conflict|' || pg_temp.seq(pg_temp.id('k2r')) || '|2|reopened', 'the rereview with the same counter is a conflict');
INSERT INTO ref SELECT 'k3r', pg_temp.make('accepted');
INSERT INTO ref SELECT 'k3r_seq', pg_temp.seq(pg_temp.id('k3r'));
SELECT matches(pg_temp.act('rereview', pg_temp.id('k3r'), (SELECT val FROM ref WHERE name = 'k3r_seq')::bigint), '^applied\|[0-9]+\|2\|reopened$',
  'the rereview is first');
SELECT is(pg_temp.act('reopen', pg_temp.id('k3r'), (SELECT val FROM ref WHERE name = 'k3r_seq')::bigint),
  'conflict|' || pg_temp.seq(pg_temp.id('k3r')) || '|2|reopened', 'the teacher''s reopen with the same counter is a conflict');
SELECT is((SELECT string_agg(format('%s|%s|%s', version, opened_as, instruction), ';' ORDER BY request_id = pg_temp.id('k3r'), version)
    FROM collaboration.revision_request_version WHERE request_id IN (pg_temp.id('k2r'), pg_temp.id('k3r')) AND version = 2),
  '2|instruction|Nova uputa.;2|rereview|Ovdje nedostaje izvor.', 'each request has one version 2, of the call that was applied, with its text');
-- An acceptance and a new revision of the document at the same moment: the
-- rereview loaded before the acceptance is a conflict; after it, the accepted
-- revision is no change, and the next revision, read by the database, is.
INSERT INTO ref SELECT 'k4r', pg_temp.make('responded');
INSERT INTO ref SELECT 'k4r_seq', pg_temp.seq(pg_temp.id('k4r'));
SELECT matches(pg_temp.act('accept_now', pg_temp.id('k4r'), (SELECT val FROM ref WHERE name = 'k4r_seq')::bigint), '^applied\|[0-9]+\|1\|accepted$',
  'the teacher accepts at the current revision 13');
SELECT is(pg_temp.act('rereview', pg_temp.id('k4r'), (SELECT val FROM ref WHERE name = 'k4r_seq')::bigint),
  'conflict|' || pg_temp.seq(pg_temp.id('k4r')) || '|1|accepted', 'a rereview with the counter loaded before the acceptance is a conflict');
SELECT is(pg_temp.act('rereview', pg_temp.id('k4r'), pg_temp.seq(pg_temp.id('k4r'))),
  'ZD409: transition not allowed', 'a rereview at the revision that was just accepted is refused');
INSERT INTO ref SELECT 'rev14', pg_temp.revise('later');
SELECT matches(pg_temp.act('rereview', pg_temp.id('k4r'), pg_temp.seq(pg_temp.id('k4r'))), '^applied\|[0-9]+\|2\|reopened$',
  'a rereview after the next revision 14 of the document is applied');
SELECT is((SELECT requested_revision FROM collaboration.revision_request_version WHERE request_id = pg_temp.id('k4r') AND version = 2), 14::bigint,
  'and it names revision 14, which the database read');

-- After the submission is recorded the rereview is forbidden, malformed or
-- not: the acceptance is not the submission, and the submission ends it.
INSERT INTO ref SELECT 'b8', pg_temp.make('accepted');
INSERT INTO ref SELECT 'b8_req', pg_temp.make('accepted');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 14, (SELECT body FROM page WHERE name = 'later'),
  (SELECT body FROM page WHERE name = 'submitted'), repeat('b', 64)), 'reserved', 'fixture: Ana commits revision 15');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a', 15) $$), 'requested', 'fixture: Ana requests revision 15');
SELECT matches(pg_temp.act('rereview', pg_temp.id('b8_req'), pg_temp.seq(pg_temp.id('b8_req'))),
  '^applied\|[0-9]+\|2\|reopened$', 'a requested but unrecorded submission does not stop a rereview');
SELECT is((SELECT requested_revision FROM collaboration.revision_request_version WHERE request_id = pg_temp.id('b8_req') AND version = 2), 15::bigint,
  'and it reads the revision the RPC of the evidence path committed');
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.record_submission(%L::uuid, %L)',
    (SELECT id FROM evidence.submission_request WHERE document_id = 'doc-a'), pg_temp.sha((SELECT body FROM page WHERE name = 'submitted')))),
  'recorded', 'fixture: the submission of revision 15 is recorded');
INSERT INTO ref SELECT 'b8_before', pg_temp.snapshot(pg_temp.id('b8'));
SELECT is(pg_temp.run(p.name, c.call, pg_temp.id('b8'), pg_temp.seq(pg_temp.id('b8'))), 'ZD403: forbidden',
  'a rereview of ' || p.name || ' on a submitted document is forbidden' || c.what)
FROM (VALUES ('ana'), ('vesna')) AS p (name)
CROSS JOIN (VALUES ('rereview_revision_request(:id, :seq)', ''), ('rereview_revision_request(:id, 0)', ', malformed or not')) AS c (call, what);
SELECT is(pg_temp.snapshot(pg_temp.id('b8')), (SELECT val FROM ref WHERE name = 'b8_before'), 'no rereview on a submitted document wrote anything');

SELECT * FROM finish();
ROLLBACK;

-- DAN-314 step 2b (docs/backend/suradnja.md 4.14, attack plan #1506, contract
-- on #1091): respond, accept, reopen and withdraw, each with the expected
-- write counter. The full transition table, the counter cases C1 to C6 and
-- the roles. Every person, document and text below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

INSERT INTO ref VALUES
  ('anchor', '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"prvi odlomak","prefix":"","suffix":" teksta","startHint":0,"endHint":12}'),
  ('anchor_b', '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000002","quote":"odlomak","prefix":"","suffix":"","startHint":0,"endHint":7}');

-- One valid call per action, with :id and :seq to fill in, and who may make it.
CREATE TEMP TABLE action (name text PRIMARY KEY, actor text NOT NULL, call text NOT NULL);
INSERT INTO action VALUES
  ('respond', 'ana', $$ respond_revision_request(:id, :seq, 'done', 'Dodala sam izvor.', 5) $$),
  ('accept', 'vesna', format('accept_revision_request(:id, :seq, 5, %L)', repeat('e', 64))),
  ('reopen', 'vesna', $$ reopen_revision_request(:id, :seq, 'Nova uputa.', 5) $$),
  ('withdraw', 'vesna', $$ withdraw_revision_request(:id, :seq) $$);

-- A transition as one line: outcome|row_seq|version|state, or the error.
CREATE FUNCTION pg_temp.run(p_actor text, p_call text, p_id uuid, p_seq bigint) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format($q$ SELECT concat_ws('|', outcome, row_seq, version, state) FROM collaboration.%s $q$,
    replace(replace(p_call, ':id', coalesce(quote_literal(p_id), 'NULL')), ':seq', coalesce(p_seq::text, 'NULL'))))
$$;
CREATE FUNCTION pg_temp.act(p_action text, p_id uuid, p_seq bigint, p_actor text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.run(coalesce(p_actor, a.actor), a.call, p_id, p_seq) FROM action a WHERE a.name = p_action
$$;
-- The stored counter of a request.
CREATE FUNCTION pg_temp.seq(p_id uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT row_seq FROM collaboration.revision_request WHERE id = p_id
$$;
-- The request with its versions and responses, as one value (C6).
CREATE FUNCTION pg_temp.snapshot(p_id uuid) RETURNS text LANGUAGE sql AS $$
  SELECT md5(concat(
    (SELECT row_to_json(q)::text FROM collaboration.revision_request q WHERE q.id = p_id), '#',
    (SELECT string_agg(row_to_json(v)::text, ';' ORDER BY v.version) FROM collaboration.revision_request_version v WHERE v.request_id = p_id), '#',
    (SELECT string_agg(row_to_json(s)::text, ';' ORDER BY s.version) FROM collaboration.revision_response s WHERE s.request_id = p_id)))
$$;
-- A new request of Vesna on Ana's document, driven to the given state with
-- the valid calls. A fixture step that fails stops the file.
CREATE FUNCTION pg_temp.make(p_state text, p_revision bigint DEFAULT 0) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_step text;
  v_out text;
BEGIN
  v_id := pg_temp.ask('vesna', format($q$ SELECT request_id FROM collaboration.create_revision_request('doc-a', {anchor},
    'Ovdje nedostaje izvor.', %s) $q$, p_revision))::uuid;
  FOREACH v_step IN ARRAY CASE p_state WHEN 'open' THEN '{}'::text[] WHEN 'responded' THEN '{respond}' WHEN 'accepted' THEN '{respond,accept}'
      WHEN 'reopened' THEN '{reopen}' WHEN 'withdrawn' THEN '{withdraw}' END LOOP
    v_out := pg_temp.act(v_step, v_id, pg_temp.seq(v_id));
    IF split_part(v_out, '|', 1) <> 'applied' THEN
      RAISE EXCEPTION 'fixture % failed at %: %', p_state, v_step, v_out;
    END IF;
  END LOOP;
  RETURN v_id;
END
$$;
-- One call on a request in the given state, read with the current counter.
-- applied|version|state|stored when the answer matches the stored row and
-- the counter moved; otherwise the error with |unchanged or |changed.
CREATE FUNCTION pg_temp.try(p_state text, p_actor text, p_call text, p_revision bigint DEFAULT 0) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid := pg_temp.make(p_state, p_revision);
  v_seq bigint := pg_temp.seq(v_id);
  v_before text := pg_temp.snapshot(v_id);
  v_out text := pg_temp.run(p_actor, p_call, v_id, v_seq);
BEGIN
  IF split_part(v_out, '|', 1) = 'applied' THEN
    RETURN format('applied|%s|%s|%s', split_part(v_out, '|', 3), split_part(v_out, '|', 4),
      CASE WHEN split_part(v_out, '|', 2)::bigint = pg_temp.seq(v_id) AND pg_temp.seq(v_id) > v_seq
             AND (SELECT format('%s|%s', version, state) FROM collaboration.revision_request WHERE id = v_id)
                 = split_part(v_out, '|', 3) || '|' || split_part(v_out, '|', 4)
           THEN 'stored' ELSE 'not stored' END);
  END IF;
  RETURN v_out || '|' || CASE WHEN pg_temp.snapshot(v_id) = v_before THEN 'unchanged' ELSE 'changed' END;
END
$$;
CREATE FUNCTION pg_temp.transition(p_state text, p_action text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.try(p_state, a.actor, a.call) FROM action a WHERE a.name = p_action
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

-- Catalogue (A10, A11, H2).
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.oid IN ('collaboration.respond_revision_request(uuid,bigint,text,text,bigint)'::regprocedure,
        'collaboration.accept_revision_request(uuid,bigint,bigint,text)'::regprocedure,
        'collaboration.reopen_revision_request(uuid,bigint,text,bigint)'::regprocedure,
        'collaboration.withdraw_revision_request(uuid,bigint)'::regprocedure)
        AND (NOT p.prosecdef OR p.proowner <> 'ductus_identity'::regrole OR NOT 'search_path=""' = ANY (p.proconfig)) $$,
  'the four transitions are SECURITY DEFINER functions of the identity role with an empty search_path');
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.oid IN ('collaboration.revision_request_for_write(uuid,text)'::regprocedure,
        'collaboration.is_revision_seq(bigint)'::regprocedure, 'collaboration.is_revision_number(bigint)'::regprocedure)
        AND (p.prosecdef OR p.proowner <> 'ductus_identity'::regrole OR NOT 'search_path=""' = ANY (p.proconfig)) $$,
  'the three helpers are plain functions of the identity role with an empty search_path');
SELECT bag_eq(
  $$ SELECT r || ' ' || f FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence', 'ductus_test_stranger']) AS r
      CROSS JOIN unnest(ARRAY['collaboration.respond_revision_request(uuid,bigint,text,text,bigint)',
        'collaboration.accept_revision_request(uuid,bigint,bigint,text)', 'collaboration.reopen_revision_request(uuid,bigint,text,bigint)',
        'collaboration.withdraw_revision_request(uuid,bigint)', 'collaboration.revision_request_for_write(uuid,text)',
        'collaboration.is_revision_seq(bigint)', 'collaboration.is_revision_number(bigint)']) AS f
      WHERE has_function_privilege(r, f, 'EXECUTE') $$,
  $$ VALUES ('ductus_app collaboration.respond_revision_request(uuid,bigint,text,text,bigint)'),
            ('ductus_app collaboration.accept_revision_request(uuid,bigint,bigint,text)'),
            ('ductus_app collaboration.reopen_revision_request(uuid,bigint,text,bigint)'),
            ('ductus_app collaboration.withdraw_revision_request(uuid,bigint)') $$,
  'the web role executes the four transitions and no runtime role a helper (A11)');
SELECT ok(NOT has_schema_privilege('ductus_identity', 'collaboration', 'CREATE'),
  'after the migration the identity role keeps no CREATE on the schema');
SELECT is(pg_get_function_arguments(a.f::regprocedure), a.args, 'the arguments of ' || a.f || ' hold no person, institution or time (H2)')
FROM (VALUES
  ('collaboration.respond_revision_request(uuid,bigint,text,text,bigint)',
   'p_request_id uuid, p_expected_seq bigint, p_kind text, p_explanation text, p_response_revision bigint'),
  ('collaboration.accept_revision_request(uuid,bigint,bigint,text)',
   'p_request_id uuid, p_expected_seq bigint, p_accepted_revision bigint, p_range_hash text'),
  ('collaboration.reopen_revision_request(uuid,bigint,text,bigint)',
   'p_request_id uuid, p_expected_seq bigint, p_instruction text, p_requested_revision bigint'),
  ('collaboration.withdraw_revision_request(uuid,bigint)', 'p_request_id uuid, p_expected_seq bigint')
) AS a (f, args);
SELECT is(pg_get_function_result(a.f::regprocedure), 'TABLE(outcome text, row_seq bigint, version integer, state text)',
  a.f || ' returns the outcome, the counter, the version and the state')
FROM (VALUES ('collaboration.respond_revision_request(uuid,bigint,text,text,bigint)'),
  ('collaboration.accept_revision_request(uuid,bigint,bigint,text)'), ('collaboration.reopen_revision_request(uuid,bigint,text,bigint)'),
  ('collaboration.withdraw_revision_request(uuid,bigint)')) AS a (f);

-- The transition table (B1, B2, B7): every state against every action, with
-- the current counter. A refused transition is ZD409 and changes nothing.
SELECT is(pg_temp.transition(t.state, t.action), t.outcome, t.action || ' on a request that is ' || t.state)
FROM (VALUES
  ('open', 'respond', 'applied|1|responded|stored'),
  ('open', 'accept', 'ZD409: transition not allowed|unchanged'),
  ('open', 'reopen', 'applied|2|reopened|stored'),
  ('open', 'withdraw', 'applied|1|withdrawn|stored'),
  ('responded', 'respond', 'ZD409: transition not allowed|unchanged'),
  ('responded', 'accept', 'applied|1|accepted|stored'),
  ('responded', 'reopen', 'applied|2|reopened|stored'),
  ('responded', 'withdraw', 'applied|1|withdrawn|stored'),
  ('accepted', 'respond', 'ZD409: transition not allowed|unchanged'),
  ('accepted', 'accept', 'ZD409: transition not allowed|unchanged'),
  ('accepted', 'reopen', 'applied|2|reopened|stored'),
  ('accepted', 'withdraw', 'ZD409: transition not allowed|unchanged'),
  ('reopened', 'respond', 'applied|2|responded|stored'),
  ('reopened', 'accept', 'ZD409: transition not allowed|unchanged'),
  ('reopened', 'reopen', 'applied|3|reopened|stored'),
  ('reopened', 'withdraw', 'applied|2|withdrawn|stored'),
  ('withdrawn', 'respond', 'ZD409: transition not allowed|unchanged'),
  ('withdrawn', 'accept', 'ZD409: transition not allowed|unchanged'),
  ('withdrawn', 'reopen', 'ZD409: transition not allowed|unchanged'),
  ('withdrawn', 'withdraw', 'ZD409: transition not allowed|unchanged')
) AS t (state, action, outcome);

-- The counter (C1 to C6, D3).
INSERT INTO ref SELECT 'c1', pg_temp.make('open');
INSERT INTO ref SELECT 'c1_seq', pg_temp.seq(pg_temp.id('c1'));
SELECT matches(pg_temp.act('respond', pg_temp.id('c1'), (SELECT val FROM ref WHERE name = 'c1_seq')::bigint), '^applied\|[0-9]+\|1\|responded$',
  'the first answer with the loaded counter is applied');
INSERT INTO ref SELECT 'c1_after', pg_temp.snapshot(pg_temp.id('c1'));
SELECT is(pg_temp.act('respond', pg_temp.id('c1'), (SELECT val FROM ref WHERE name = 'c1_seq')::bigint),
  'conflict|' || pg_temp.seq(pg_temp.id('c1')) || '|1|responded',
  'the same answer again with the old counter is a conflict with the current counter, version and state (C1, C3)');
SELECT is((SELECT count(*) FROM collaboration.revision_response WHERE request_id = pg_temp.id('c1')), 1::bigint,
  'a double send leaves exactly one answer (C3)');
SELECT is(pg_temp.snapshot(pg_temp.id('c1')), (SELECT val FROM ref WHERE name = 'c1_after'), 'a conflict writes nothing (C6)');
SELECT is(pg_temp.act(a.name, pg_temp.id('c1'), (SELECT val FROM ref WHERE name = 'c1_seq')::bigint),
  'conflict|' || pg_temp.seq(pg_temp.id('c1')) || '|1|responded', 'a stale ' || a.name || ' is a conflict, not a transition error (C1)')
FROM (VALUES ('accept'), ('reopen'), ('withdraw')) AS a (name);
SELECT is(pg_temp.snapshot(pg_temp.id('c1')), (SELECT val FROM ref WHERE name = 'c1_after'), 'stale calls of every kind write nothing (C6)');

-- Two tabs that loaded the same counter: the first wins, the second is told (C2).
INSERT INTO ref SELECT 'c2', pg_temp.make('responded');
INSERT INTO ref SELECT 'c2_seq', pg_temp.seq(pg_temp.id('c2'));
SELECT matches(pg_temp.act('accept', pg_temp.id('c2'), (SELECT val FROM ref WHERE name = 'c2_seq')::bigint), '^applied\|[0-9]+\|1\|accepted$',
  'the first tab accepts');
SELECT is(pg_temp.act('withdraw', pg_temp.id('c2'), (SELECT val FROM ref WHERE name = 'c2_seq')::bigint),
  'conflict|' || pg_temp.seq(pg_temp.id('c2')) || '|1|accepted', 'the second tab with the same counter cannot withdraw (C2)');
SELECT is((SELECT closed_as FROM collaboration.revision_request_version WHERE request_id = pg_temp.id('c2')), 'accepted',
  'the version stays accepted');

-- A counter of another request, from the future or of the wrong shape (C4).
INSERT INTO ref SELECT 'c4', pg_temp.make('open');
SELECT is(pg_temp.act('respond', pg_temp.id('c4'), pg_temp.seq(pg_temp.id('c1'))),
  'conflict|' || pg_temp.seq(pg_temp.id('c4')) || '|1|open', 'the counter of another request is a conflict (C4)');
SELECT is(pg_temp.act('respond', pg_temp.id('c4'), pg_temp.seq(pg_temp.id('c4')) + 1000),
  'conflict|' || pg_temp.seq(pg_temp.id('c4')) || '|1|open', 'a counter from the future is a conflict (C4)');
SELECT is(pg_temp.try(CASE a.name WHEN 'accept' THEN 'responded' ELSE 'open' END, a.actor,
    replace(a.call, ':seq', s.seq)), 'ZD422: invalid input|unchanged', a.name || ' with a counter that is ' || s.what || ' is refused (C4)')
FROM action a
CROSS JOIN (VALUES ('NULL', 'missing'), ('0', '0'), ('-1', '-1'), ('9007199254740992', '2^53')) AS s (seq, what);

-- The counter belongs to the request, not to the document (C5, B5, D4):
-- writing the live state and committing a revision between loading and
-- sending change no request.
INSERT INTO ref SELECT 'c5', pg_temp.make('open');
INSERT INTO ref SELECT 'c5_before', pg_temp.snapshot(pg_temp.id('c5'));
SELECT matches(pg_temp.ask('ana', $$ SELECT outcome FROM collaboration.publish_live_state('doc-a', NULL,
    '{"content":[{"type":"paragraph"}],"type":"doc"}') $$), '^[a-z]+$', 'fixture: Ana writes the live state of her document');
SELECT is(pg_temp.snapshot(pg_temp.id('c5')), (SELECT val FROM ref WHERE name = 'c5_before'),
  'writing the live state changes no request, its counter or version (B5)');

-- Every applied transition above changed no evidence (H1).
SELECT is(pg_temp.evidence_print(), (SELECT v FROM print_before), 'the transitions change nothing in schema evidence (H1)');

SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64),
  repeat('b', 64)), 'reserved', 'fixture: Ana commits revision 1');
SELECT is(pg_temp.snapshot(pg_temp.id('c5')), (SELECT val FROM ref WHERE name = 'c5_before'),
  'committing a revision changes no request, its counter or version (D4)');
SELECT matches(pg_temp.act('respond', pg_temp.id('c5'), pg_temp.seq(pg_temp.id('c5'))), '^applied\|[0-9]+\|1\|responded$',
  'the answer with the counter loaded before the commit is still applied (C5)');

-- A reopen moves the counter, so an answer to the old version is stale (D3).
INSERT INTO ref SELECT 'd3', pg_temp.make('open');
INSERT INTO ref SELECT 'd3_seq', pg_temp.seq(pg_temp.id('d3'));
SELECT matches(pg_temp.act('reopen', pg_temp.id('d3'), (SELECT val FROM ref WHERE name = 'd3_seq')::bigint), '^applied\|[0-9]+\|2\|reopened$',
  'the teacher reopens');
SELECT is(pg_temp.act('respond', pg_temp.id('d3'), (SELECT val FROM ref WHERE name = 'd3_seq')::bigint),
  'conflict|' || pg_temp.seq(pg_temp.id('d3')) || '|2|reopened', 'an answer with the counter of version 1 is a conflict (D3)');
SELECT is((SELECT count(*) FROM collaboration.revision_response WHERE request_id = pg_temp.id('d3')), 0::bigint,
  'the stale answer wrote nothing');

-- Reopening keeps the old version and its answer (D1, D2, D5).
INSERT INTO ref SELECT 'd1', pg_temp.make('responded');
SELECT matches(pg_temp.act('reopen', pg_temp.id('d1'), pg_temp.seq(pg_temp.id('d1'))), '^applied\|[0-9]+\|2\|reopened$', 'fixture: reopen after an answer');
SELECT matches(pg_temp.act('respond', pg_temp.id('d1'), pg_temp.seq(pg_temp.id('d1'))), '^applied\|[0-9]+\|2\|responded$', 'fixture: answer version 2');
SELECT is((SELECT string_agg(format('%s|%s|%s', v.version, v.closed_as, s.version), ';' ORDER BY v.version)
    FROM collaboration.revision_request_version v
    LEFT JOIN collaboration.revision_response s ON s.request_id = v.request_id AND s.version = v.version
    WHERE v.request_id = pg_temp.id('d1')),
  '1|reopened|1;2||2', 'version 1 is closed as reopened and keeps its answer; the new answer belongs to version 2 (D1, D2)');
INSERT INTO ref SELECT 'd5', pg_temp.make('accepted');
SELECT matches(pg_temp.act('reopen', pg_temp.id('d5'), pg_temp.seq(pg_temp.id('d5'))), '^applied\|[0-9]+\|2\|reopened$', 'fixture: reopen after an acceptance');
SELECT is((SELECT string_agg(format('%s|%s|%s|%s', version, closed_as, accepted_revision, accepted_range_hash = repeat('e', 64)), ';' ORDER BY version)
    FROM collaboration.revision_request_version WHERE request_id = pg_temp.id('d5')),
  '1|accepted|5|t;2|||', 'an accepted version stays accepted after a reopen (D5)');

-- Who and when are stored from the session (H2).
SELECT row_eq(
  $$ SELECT author_id, kind, explanation, response_revision FROM collaboration.revision_response
      WHERE request_id = pg_temp.id('d1') AND version = 1 $$,
  ROW(pg_temp.id('ana'), 'done'::text, 'Dodala sam izvor.'::text, 5::bigint), 'the answer stores the student of the session');
SELECT row_eq(
  $$ SELECT closed_by, closed_at IS NOT NULL FROM collaboration.revision_request_version WHERE request_id = pg_temp.id('d5') AND version = 1 $$,
  ROW(pg_temp.id('vesna'), true), 'the acceptance stores the teacher and the time');
SELECT row_eq(
  $$ SELECT opened_by, instruction, requested_revision FROM collaboration.revision_request_version
      WHERE request_id = pg_temp.id('d5') AND version = 2 $$,
  ROW(pg_temp.id('vesna'), 'Nova uputa.'::text, 5::bigint), 'the new version stores the teacher who reopened');

-- Input classes, after authorisation (E1, E2, #1506 classes 8 to 10).
SELECT is(pg_temp.try('open', 'ana', format('respond_revision_request(:id, :seq, %L, %L, %L)', i.kind, i.explanation, i.revision)),
  i.outcome, 'an answer ' || i.what)
FROM (VALUES
  (NULL::text, 'Tekst.'::text, 5::bigint, 'ZD422: invalid input|unchanged', 'without a kind is refused'),
  ('maybe', 'Tekst.', 5, 'ZD422: invalid input|unchanged', 'of an unknown kind is refused'),
  ('DONE', 'Tekst.', 5, 'ZD422: invalid input|unchanged', 'of a kind in capitals is refused'),
  ('declined', NULL, 5, 'ZD422: invalid input|unchanged', 'declined without an explanation is refused (E2)'),
  ('declined', '', 5, 'ZD422: invalid input|unchanged', 'declined with an empty explanation is refused (E2)'),
  ('declined', E' \n\t ', 5, 'ZD422: invalid input|unchanged', 'with only blanks is refused (E2)'),
  ('declined', E'  ', 5, 'ZD422: invalid input|unchanged', 'with only no-break spaces is refused (E2)'),
  ('declined', E'​‌‍', 5, 'ZD422: invalid input|unchanged', 'with only zero-width characters is refused (E2)'),
  ('done', E'a‮b', 5, 'ZD422: invalid input|unchanged', 'with a right-to-left override is refused'),
  ('done', repeat('a', 2001), 5, 'ZD422: invalid input|unchanged', 'with over 2000 code points is refused'),
  ('done', 'Tekst.', NULL, 'ZD422: invalid input|unchanged', 'without a revision is refused'),
  ('done', 'Tekst.', -1, 'ZD422: invalid input|unchanged', 'with revision -1 is refused'),
  ('done', 'Tekst.', 9007199254740992, 'ZD422: invalid input|unchanged', 'with revision 2^53 is refused'),
  ('done', repeat('a', 2000), 0, 'applied|1|responded|stored', 'with 2000 code points and revision 0 is accepted'),
  ('declined', 'Izvor je naveden u bilješci.', 9007199254740991, 'applied|1|responded|stored', 'declined with an explanation is accepted (E1)')
) AS i (kind, explanation, revision, outcome, what);
SELECT is(pg_temp.try('responded', 'vesna', format('accept_revision_request(:id, :seq, %L, %L)', i.revision, i.hash)), i.outcome,
  'an acceptance ' || i.what)
FROM (VALUES
  (NULL::bigint, NULL::text, 'ZD422: invalid input|unchanged', 'without a revision is refused'),
  (-1, NULL, 'ZD422: invalid input|unchanged', 'with revision -1 is refused'),
  (9007199254740992, NULL, 'ZD422: invalid input|unchanged', 'with revision 2^53 is refused'),
  (5, repeat('E', 64), 'ZD422: invalid input|unchanged', 'with a hash in capitals is refused'),
  (5, repeat('e', 63), 'ZD422: invalid input|unchanged', 'with a hash of 63 characters is refused'),
  (5, repeat('g', 64), 'ZD422: invalid input|unchanged', 'with a hash that is not hex is refused'),
  (5, '', 'ZD422: invalid input|unchanged', 'with an empty hash is refused'),
  (5, NULL, 'applied|1|accepted|stored', 'without a hash is accepted'),
  (9007199254740991, repeat('0', 64), 'applied|1|accepted|stored', 'with revision 2^53 - 1 and a hash is accepted')
) AS i (revision, hash, outcome, what);
SELECT is(pg_temp.try('open', 'vesna', format('reopen_revision_request(:id, :seq, %L, %L)', i.instruction, i.revision)), i.outcome,
  'a reopen ' || i.what)
FROM (VALUES
  (NULL::text, 5::bigint, 'ZD422: invalid input|unchanged', 'without an instruction is refused'),
  ('', 5, 'ZD422: invalid input|unchanged', 'with an empty instruction is refused'),
  (E'⁠', 5, 'ZD422: invalid input|unchanged', 'with only a word joiner is refused'),
  (repeat('a', 2001), 5, 'ZD422: invalid input|unchanged', 'with over 2000 code points is refused'),
  ('Tekst.', NULL, 'ZD422: invalid input|unchanged', 'without a revision is refused'),
  ('Tekst.', -1, 'ZD422: invalid input|unchanged', 'with revision -1 is refused'),
  ('Tekst.', 9007199254740992, 'ZD422: invalid input|unchanged', 'with revision 2^53 is refused'),
  (repeat('a', 2000), 0, 'applied|2|reopened|stored', 'with 2000 code points and revision 0 is accepted')
) AS i (instruction, revision, outcome, what);
INSERT INTO ref SELECT 'e1', pg_temp.make('open');
SELECT matches(pg_temp.run('ana', $$ respond_revision_request(:id, :seq, 'declined', 'Izvor je naveden u bilješci.', 0) $$,
  pg_temp.id('e1'), pg_temp.seq(pg_temp.id('e1'))), '^applied\|[0-9]+\|1\|responded$', 'fixture: Ana declines');
SELECT matches(pg_temp.act('accept', pg_temp.id('e1'), pg_temp.seq(pg_temp.id('e1'))), '^applied\|[0-9]+\|1\|accepted$',
  'a declined answer stays until the teacher acts, and the teacher may accept it (E1)');

-- Revision order (B3, B4): an answer, an acceptance and a new version never
-- point below what the request already recorded; equal is allowed.
SELECT is(pg_temp.try(o.state, o.actor, o.call, o.created), o.outcome, o.what)
FROM (VALUES
  ('open', 'ana', $$ respond_revision_request(:id, :seq, 'done', 'Tekst.', 2) $$, 3, 'ZD422: invalid input|unchanged',
   'an answer below the requested revision is refused (B3)'),
  ('open', 'ana', $$ respond_revision_request(:id, :seq, 'done', 'Tekst.', 3) $$, 3, 'applied|1|responded|stored',
   'an answer at the requested revision is accepted'),
  ('responded', 'vesna', $$ accept_revision_request(:id, :seq, 4, NULL) $$, 0, 'ZD422: invalid input|unchanged',
   'an acceptance below the revision of the answer is refused (B4)'),
  ('responded', 'vesna', $$ reopen_revision_request(:id, :seq, 'Tekst.', 4) $$, 0, 'ZD422: invalid input|unchanged',
   'a new version below the revision of the answer is refused'),
  ('open', 'vesna', $$ reopen_revision_request(:id, :seq, 'Tekst.', 6) $$, 7, 'ZD422: invalid input|unchanged',
   'a new version below the requested revision is refused'),
  ('open', 'vesna', $$ reopen_revision_request(:id, :seq, 'Tekst.', 7) $$, 7, 'applied|2|reopened|stored',
   'a new version at the requested revision is accepted')
) AS o (state, actor, call, created, outcome, what);
INSERT INTO ref SELECT 'b4', pg_temp.make('responded');
SELECT matches(pg_temp.run('vesna', 'accept_revision_request(:id, :seq, 9, NULL)', pg_temp.id('b4'), pg_temp.seq(pg_temp.id('b4'))),
  '^applied\|[0-9]+\|1\|accepted$', 'fixture: accept at revision 9');
SELECT is(pg_temp.run('vesna', $$ reopen_revision_request(:id, :seq, 'Tekst.', 8) $$, pg_temp.id('b4'), pg_temp.seq(pg_temp.id('b4'))),
  'ZD422: invalid input', 'a new version below the accepted revision is refused');

-- The last version is 1000 (B7).
INSERT INTO ref SELECT 'v999', pg_temp.make('open');
SELECT is(pg_temp.ask_as('ductus_identity', 'vesna',
    $$ WITH u AS (UPDATE collaboration.revision_request SET version = 999 WHERE id = {v999} RETURNING version) SELECT version FROM u $$),
  '999', 'fixture: the owner moves the request to version 999');
SELECT matches(pg_temp.act('reopen', pg_temp.id('v999'), pg_temp.seq(pg_temp.id('v999'))), '^applied\|[0-9]+\|1000\|reopened$',
  'a reopen from version 999 opens version 1000');
INSERT INTO ref SELECT 'v1000', pg_temp.snapshot(pg_temp.id('v999'));
SELECT is(pg_temp.act('reopen', pg_temp.id('v999'), pg_temp.seq(pg_temp.id('v999'))), 'ZD409: transition not allowed',
  'there is no version 1001');
SELECT is(pg_temp.snapshot(pg_temp.id('v999')), (SELECT val FROM ref WHERE name = 'v1000'), 'the refused reopen wrote nothing');

-- Roles: the student owner answers, a teacher of the course decides, nobody
-- else does anything, even with malformed input (A1 to A9, A12).
SELECT is(pg_temp.try('responded', p.name, a.call), 'ZD403: forbidden|unchanged', p.name || ' cannot ' || a.name)
FROM (VALUES ('dora'), ('marko'), ('iva'), ('petra'), ('tomo'), ('boris'), ('nina')) AS p (name)
CROSS JOIN action a;
SELECT is(pg_temp.try('open', p.name, replace(a.call, ':seq', 'NULL')), 'ZD403: forbidden|unchanged',
  p.name || ' with a missing counter still gets only the forbidden answer on ' || a.name)
FROM (VALUES ('dora'), ('marko'), ('petra'), ('boris')) AS p (name)
CROSS JOIN action a;
SELECT is(pg_temp.try('responded', 'ana', a.call), 'ZD403: forbidden|unchanged', 'the student cannot ' || a.name)
FROM action a WHERE a.name <> 'respond';
SELECT is(pg_temp.try('open', 'vesna', a.call), 'ZD403: forbidden|unchanged', 'the teacher cannot answer for the student')
FROM action a WHERE a.name = 'respond';
SELECT matches(pg_temp.try('open', t.name, a.call), '^ZD401.*\|unchanged$', a.name || ' with session ' || t.name || ' is not signed in')
FROM (VALUES ('anon'), ('expired'), ('closed'), ('unknown')) AS t (name)
CROSS JOIN action a;
SELECT is(pg_temp.act(a.name, pg_temp.id('nobody'), 1), 'ZD403: forbidden', 'a missing request reads as a forbidden one on ' || a.name)
FROM action a;
INSERT INTO ref SELECT 'rb', pg_temp.ask('petra', $$ SELECT request_id FROM collaboration.create_revision_request('doc-b', {anchor_b}, 'Tekst.', 0) $$);
SELECT is(pg_temp.act(a.name, pg_temp.id('rb'), pg_temp.seq(pg_temp.id('rb'))), 'ZD403: forbidden',
  'a request of another institution reads as a forbidden one on ' || a.name)
FROM action a;
-- A teacher added to the course decides at once; one who leaves cannot (A7, A9).
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('marko'), 'teacher');
SELECT is(pg_temp.try('responded', 'marko', a.call), 'applied|1|accepted|stored', 'a second teacher of K1 accepts (A7)')
FROM action a WHERE a.name = 'accept';
UPDATE institution.course_member SET member_to = now()
WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('marko') AND member_to IS NULL;
SELECT is(pg_temp.try('responded', 'marko', a.call), 'ZD403: forbidden|unchanged', 'a teacher who left K1 cannot ' || a.name || ' (A9)')
FROM action a WHERE a.name <> 'respond';

-- Owner decision (#87 c.6691142048, O7 c.6581656612): REREVIEW_REQUIRED to
-- STUDENT_RESPONDED is a reopened request answered on its new version. The
-- answer opens a new response cycle and carries no verdict.
INSERT INTO ref SELECT 'o7', pg_temp.make('accepted');
SELECT matches(pg_temp.act('reopen', pg_temp.id('o7'), pg_temp.seq(pg_temp.id('o7'))), '^applied\|[0-9]+\|2\|reopened$',
  'fixture: the teacher asks for a new review of an accepted request');
SELECT matches(pg_temp.act('respond', pg_temp.id('o7'), pg_temp.seq(pg_temp.id('o7'))), '^applied\|[0-9]+\|2\|responded$',
  'the student answers the new version: STUDENT_RESPONDED, not accepted (O7)');
SELECT is((SELECT string_agg(format('%s|%s|%s|%s|%s|%s', v.version, v.closed_as, v.accepted_revision,
      v.accepted_range_hash IS NULL, v.closed_at IS NULL, s.version), ';' ORDER BY v.version)
    FROM collaboration.revision_request_version v
    LEFT JOIN collaboration.revision_response s ON s.request_id = v.request_id AND s.version = v.version
    WHERE v.request_id = pg_temp.id('o7')),
  '1|accepted|5|f|f|1;2|||t|t|2', 'version 1 stays accepted with its answer; version 2 has its answer and no verdict (O7)');
SELECT is(pg_temp.act('respond', pg_temp.id('o7'), pg_temp.seq(pg_temp.id('o7'))), 'ZD409: transition not allowed',
  'a second answer on the same version is not allowed (O7)');
SELECT matches(pg_temp.act('accept', pg_temp.id('o7'), pg_temp.seq(pg_temp.id('o7'))), '^applied\|[0-9]+\|2\|accepted$',
  'only the teacher''s acceptance closes the new cycle (O7)');
SELECT is((SELECT closed_as FROM collaboration.revision_request_version WHERE request_id = pg_temp.id('o7') AND version = 2),
  'accepted', 'version 2 is closed as accepted by the teacher');

-- After the submission is recorded every transition is forbidden, malformed
-- or not, and nothing changes (B8).
INSERT INTO ref SELECT 'b8_open', pg_temp.make('open');
INSERT INTO ref SELECT 'b8_responded', pg_temp.make('responded');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a', 1) $$), 'requested', 'fixture: Ana requests revision 1');
SELECT matches(pg_temp.act('withdraw', pg_temp.id('b8_open'), pg_temp.seq(pg_temp.id('b8_open'))), '^applied\|[0-9]+\|1\|withdrawn$',
  'a requested but unrecorded submission does not stop a transition');
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.record_submission(%L::uuid, %L)',
    (SELECT id FROM evidence.submission_request WHERE document_id = 'doc-a'), pg_temp.h('d'))), 'recorded',
  'fixture: the submission of revision 1 is recorded');
INSERT INTO ref SELECT 'b8_responded_before', pg_temp.snapshot(pg_temp.id('b8_responded'));
SELECT is(pg_temp.act(a.name, pg_temp.id('b8_responded'), pg_temp.seq(pg_temp.id('b8_responded'))), 'ZD403: forbidden',
  a.name || ' on a submitted document is forbidden (B8)')
FROM action a;
SELECT is(pg_temp.act(a.name, pg_temp.id('b8_responded'), NULL), 'ZD403: forbidden',
  a.name || ' with a missing counter on a submitted document is still forbidden')
FROM action a;
SELECT is(pg_temp.snapshot(pg_temp.id('b8_responded')), (SELECT val FROM ref WHERE name = 'b8_responded_before'),
  'no transition on a submitted document wrote anything');

SELECT * FROM finish();
ROLLBACK;

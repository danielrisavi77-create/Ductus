-- DAN-314, changed after acceptance (docs/backend/suradnja.md 4.14, contract
-- #1091 c.6752687836): rereview_revision_request moves an accepted request
-- to a new version when the hash of its anchored range no longer matches the
-- accepted one. The input classes as tables, the counter, the roles and what
-- is stored. Every person, document and text below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

-- Ana's document has revisions up to 10.
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
SELECT 'doc-a', pg_temp.id('fak_a'), n, n - 1, pg_temp.id('ana'), pg_temp.h('a') FROM generate_series(1, 10) AS n;
UPDATE evidence.document SET current_revision = 10 WHERE id = 'doc-a';
RESET ROLE;

INSERT INTO ref VALUES
  ('anchor', '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"prvi odlomak","prefix":"","suffix":" teksta","startHint":0,"endHint":12}'),
  ('anchor_b', '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000002","quote":"odlomak","prefix":"","suffix":"","startHint":0,"endHint":7}');

-- One valid call per action, with :id and :seq to fill in, and who makes it.
-- The acceptance is at revision 5 with hash e; the rereview names revision 6
-- and hash f.
CREATE TEMP TABLE action (name text PRIMARY KEY, actor text NOT NULL, call text NOT NULL);
INSERT INTO action VALUES
  ('respond', 'ana', $$ respond_revision_request(:id, :seq, 'done', 'Dodala sam izvor.', 5) $$),
  ('accept', 'vesna', format('accept_revision_request(:id, :seq, 5, %L)', repeat('e', 64))),
  ('accept_nohash', 'vesna', 'accept_revision_request(:id, :seq, 5, NULL)'),
  ('reopen', 'vesna', $$ reopen_revision_request(:id, :seq, 'Nova uputa.', 5) $$),
  ('withdraw', 'vesna', $$ withdraw_revision_request(:id, :seq) $$),
  ('rereview', 'ana', format('rereview_revision_request(:id, :seq, 6, %L)', repeat('f', 64)));

-- The helpers of 112: a call as one line, the counter, the stored request as
-- one value, a request driven to a state, and one call on such a request.
CREATE FUNCTION pg_temp.run(p_actor text, p_call text, p_id uuid, p_seq bigint) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format($q$ SELECT concat_ws('|', outcome, row_seq, version, state) FROM collaboration.%s $q$,
    replace(replace(p_call, ':id', coalesce(quote_literal(p_id), 'NULL')), ':seq', coalesce(p_seq::text, 'NULL'))))
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
CREATE FUNCTION pg_temp.make(p_state text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_step text;
  v_out text;
BEGIN
  v_id := pg_temp.ask('vesna', $q$ SELECT request_id FROM collaboration.create_revision_request('doc-a', {anchor},
    'Ovdje nedostaje izvor.', 0) $q$)::uuid;
  FOREACH v_step IN ARRAY CASE p_state WHEN 'open' THEN '{}'::text[] WHEN 'responded' THEN '{respond}' WHEN 'accepted' THEN '{respond,accept}'
      WHEN 'accepted_nohash' THEN '{respond,accept_nohash}' WHEN 'reopened' THEN '{reopen}' WHEN 'withdrawn' THEN '{withdraw}' END LOOP
    v_out := pg_temp.act(v_step, v_id, pg_temp.seq(v_id));
    IF split_part(v_out, '|', 1) <> 'applied' THEN
      RAISE EXCEPTION 'fixture % failed at %: %', p_state, v_step, v_out;
    END IF;
  END LOOP;
  RETURN v_id;
END
$$;
-- applied|version|state|stored when the answer matches the stored row and
-- the counter moved; otherwise the answer with |unchanged or |changed.
CREATE FUNCTION pg_temp.try(p_state text, p_actor text, p_call text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid := pg_temp.make(p_state);
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
CREATE FUNCTION pg_temp.rereview(p_revision text, p_hash text) RETURNS text LANGUAGE sql AS $$
  SELECT format('rereview_revision_request(:id, :seq, %s, %s)', p_revision, coalesce(quote_literal(p_hash), 'NULL'))
$$;
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

-- Catalogue.
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.oid = 'collaboration.rereview_revision_request(uuid,bigint,bigint,text)'::regprocedure
        AND (NOT p.prosecdef OR p.proowner <> 'ductus_identity'::regrole OR NOT 'search_path=""' = ANY (p.proconfig)) $$,
  'the rereview is a SECURITY DEFINER function of the identity role with an empty search_path');
SELECT bag_eq(
  $$ SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence', 'ductus_test_stranger', 'public']) AS r
      WHERE has_function_privilege(r, 'collaboration.rereview_revision_request(uuid,bigint,bigint,text)', 'EXECUTE') $$,
  $$ VALUES ('ductus_app') $$, 'only the web role executes the rereview');
SELECT ok(NOT has_schema_privilege('ductus_identity', 'collaboration', 'CREATE'),
  'after the migration the identity role keeps no CREATE on the schema');
SELECT is(pg_get_function_arguments('collaboration.rereview_revision_request(uuid,bigint,bigint,text)'::regprocedure),
  'p_request_id uuid, p_expected_seq bigint, p_current_revision bigint, p_range_hash text',
  'the arguments hold no person, institution, time, text or verdict');
SELECT is(pg_get_function_result('collaboration.rereview_revision_request(uuid,bigint,bigint,text)'::regprocedure),
  'TABLE(outcome text, row_seq bigint, version integer, state text)', 'the answer is the outcome, the counter, the version and the state');
SELECT bag_eq(
  $$ SELECT attname::text FROM pg_attribute
      WHERE attrelid = 'collaboration.revision_request_version'::regclass AND attnum > 0 AND NOT attisdropped $$,
  $$ VALUES ('request_id'), ('institution_id'), ('version'), ('instruction'), ('requested_revision'), ('opened_by'), ('opened_at'),
            ('closed_as'), ('closed_by'), ('closed_at'), ('accepted_revision'), ('accepted_range_hash'), ('opened_as'),
            ('observed_range_hash') $$,
  'a version gains how it was opened and the observed hash, and no grade, verdict or authorship column (PRODUCT 5, rule 7)');

-- The change rule: the sent hash against the accepted one. Equal is no
-- change; an acceptance without a hash can never be compared.
SELECT is(pg_temp.try(h.state, 'ana', pg_temp.rereview('6', h.sent)), h.outcome, 'a rereview ' || h.what)
FROM (VALUES
  ('accepted', repeat('f', 64), 'applied|2|reopened|stored', 'with a hash other than the accepted one opens version 2'),
  ('accepted', NULL, 'applied|2|reopened|stored', 'without a hash, the range no longer resolves, opens version 2'),
  ('accepted', repeat('e', 64), 'ZD409: transition not allowed|unchanged', 'with the accepted hash is refused: nothing changed'),
  ('accepted_nohash', repeat('f', 64), 'ZD409: transition not allowed|unchanged', 'of an acceptance without a hash is refused'),
  ('accepted_nohash', NULL, 'ZD409: transition not allowed|unchanged', 'without a hash of an acceptance without a hash is refused')
) AS h (state, sent, outcome, what);

-- Only an accepted request is rereviewed.
SELECT is(pg_temp.try(s.state, 'ana', a.call), 'ZD409: transition not allowed|unchanged', 'a rereview of a request that is ' || s.state || ' is refused')
FROM (VALUES ('open'), ('responded'), ('reopened'), ('withdrawn')) AS s (state)
CROSS JOIN action a WHERE a.name = 'rereview';
INSERT INTO ref SELECT 'v999', pg_temp.make('open');
SELECT is(pg_temp.ask_as('ductus_identity', 'vesna',
    $$ WITH u AS (UPDATE collaboration.revision_request SET version = 999 WHERE id = {v999} RETURNING version) SELECT version FROM u $$),
  '999', 'fixture: the owner moves the request to version 999');
SELECT matches(pg_temp.act(s.name, pg_temp.id('v999'), pg_temp.seq(pg_temp.id('v999'))), '^applied\|[0-9]+\|1000\|' || s.state || '$',
  'fixture: version 1000 is ' || s.state)
FROM (VALUES (1, 'reopen', 'reopened'), (2, 'respond', 'responded'), (3, 'accept', 'accepted')) AS s (n, name, state) ORDER BY s.n;
INSERT INTO ref SELECT 'v1000', pg_temp.snapshot(pg_temp.id('v999'));
SELECT is(pg_temp.act('rereview', pg_temp.id('v999'), pg_temp.seq(pg_temp.id('v999'))), 'ZD409: transition not allowed',
  'an accepted version 1000 is not rereviewed: there is no version 1001');
SELECT is(pg_temp.snapshot(pg_temp.id('v999')), (SELECT val FROM ref WHERE name = 'v1000'), 'the refused rereview wrote nothing');

-- The revision: above the accepted one (5) and at most the current one (10).
SELECT is(pg_temp.try('accepted', 'ana', pg_temp.rereview(i.revision, repeat('f', 64))), i.outcome, 'a rereview ' || i.what)
FROM (VALUES
  ('NULL', 'ZD422: invalid input|unchanged', 'without a revision is refused'),
  ('-1', 'ZD422: invalid input|unchanged', 'with revision -1 is refused'),
  ('9007199254740992', 'ZD422: invalid input|unchanged', 'with revision 2^53 is refused'),
  ('4', 'ZD422: invalid input|unchanged', 'below the accepted revision is refused'),
  ('5', 'ZD422: invalid input|unchanged', 'at the accepted revision is refused: there is no new version of the document'),
  ('6', 'applied|2|reopened|stored', 'one revision above the accepted one is applied'),
  ('10', 'applied|2|reopened|stored', 'at the current revision 10 of the document is applied'),
  ('11', 'ZD422: invalid input|unchanged', 'with revision 11, above the document, is refused'),
  ('9007199254740991', 'ZD422: invalid input|unchanged', 'with revision 2^53 - 1, above the document, is refused')
) AS i (revision, outcome, what);
SELECT is(pg_temp.try('accepted', 'ana', pg_temp.rereview('6', i.hash)), 'ZD422: invalid input|unchanged', 'a rereview with a hash ' || i.what || ' is refused')
FROM (VALUES (repeat('F', 64), 'in capitals'), (repeat('f', 63), 'of 63 characters'), (repeat('f', 65), 'of 65 characters'),
  (repeat('g', 64), 'that is not hex'), ('', 'that is empty'), (repeat('f', 64) || E'\n', 'with a trailing newline')) AS i (hash, what);

-- The counter, and the order of the checks around it.
SELECT is(pg_temp.try('accepted', 'ana', replace(a.call, ':seq', s.seq)), 'ZD422: invalid input|unchanged',
  'a rereview with a counter that is ' || s.what || ' is refused')
FROM action a
CROSS JOIN (VALUES ('NULL', 'missing'), ('0', '0'), ('-1', '-1'), ('9007199254740992', '2^53')) AS s (seq, what)
WHERE a.name = 'rereview';
INSERT INTO ref SELECT 'c1', pg_temp.make('accepted');
INSERT INTO ref SELECT 'c1_before', pg_temp.snapshot(pg_temp.id('c1'));
INSERT INTO ref SELECT 'c2', pg_temp.make('open');
SELECT is(pg_temp.run('ana', pg_temp.rereview(c.revision, c.hash), pg_temp.id(c.id), pg_temp.seq(pg_temp.id(c.id)) + c.shift),
  'conflict|' || pg_temp.seq(pg_temp.id(c.id)) || '|1|' || c.state, c.what)
FROM (VALUES
  ('c1', -1, '6', repeat('f', 64), 'accepted', 'a stale rereview is a conflict with the current counter, version and state'),
  ('c1', 1000, '6', repeat('f', 64), 'accepted', 'a counter from the future is a conflict'),
  ('c1', -1, '6', repeat('e', 64), 'accepted', 'a stale rereview with the accepted hash is a conflict, not a transition error'),
  ('c1', -1, '11', repeat('f', 64), 'accepted', 'a stale rereview above the document is a conflict, not an input error'),
  ('c2', -1, '6', repeat('f', 64), 'open', 'a stale rereview of an open request is a conflict, not a transition error')
) AS c (id, shift, revision, hash, state, what);
SELECT is(pg_temp.snapshot(pg_temp.id('c1')), (SELECT val FROM ref WHERE name = 'c1_before'), 'a conflict writes nothing');
SELECT is(pg_temp.try(o.state, 'ana', pg_temp.rereview(o.revision, o.hash)), o.outcome, o.what)
FROM (VALUES
  ('open', '4', repeat('f', 64), 'ZD409: transition not allowed|unchanged', 'the state is checked before the revision order'),
  ('accepted', '4', repeat('e', 64), 'ZD409: transition not allowed|unchanged', 'the change rule is checked before the revision order'),
  ('open', '6', repeat('F', 64), 'ZD422: invalid input|unchanged', 'the shape of the input is checked before the state')
) AS o (state, revision, hash, outcome, what);

-- Roles: the student owner and a teacher of the course; nobody else, even
-- with malformed input.
SELECT is(pg_temp.try('accepted', p.name, a.call), 'applied|2|reopened|stored', p.what || ' fires the rereview')
FROM (VALUES ('ana', 'the student owner'), ('vesna', 'the teacher of the course')) AS p (name, what)
CROSS JOIN action a WHERE a.name = 'rereview';
SELECT is(pg_temp.try('accepted', p.name, c.call), 'ZD403: forbidden|unchanged', p.name || ' cannot fire the rereview' || c.what)
FROM (VALUES ('dora'), ('marko'), ('iva'), ('petra'), ('tomo'), ('boris'), ('nina')) AS p (name)
CROSS JOIN (VALUES (pg_temp.rereview('6', repeat('f', 64)), ''), (pg_temp.rereview('NULL', 'x'), ', malformed or not')) AS c (call, what);
SELECT matches(pg_temp.try('accepted', t.name, a.call), '^ZD401.*\|unchanged$', 'a rereview with session ' || t.name || ' is not signed in')
FROM (VALUES ('anon'), ('expired'), ('closed'), ('unknown')) AS t (name)
CROSS JOIN action a WHERE a.name = 'rereview';
SELECT is(pg_temp.act('rereview', pg_temp.id('nobody'), 1, p.name), 'ZD403: forbidden', 'a missing request reads as a forbidden one to ' || p.name)
FROM (VALUES ('ana'), ('vesna')) AS p (name);
INSERT INTO ref SELECT 'rb', pg_temp.ask('petra', $$ SELECT request_id FROM collaboration.create_revision_request('doc-b', {anchor_b}, 'Tekst.', 0) $$);
SELECT is(pg_temp.act('rereview', pg_temp.id('rb'), pg_temp.seq(pg_temp.id('rb')), p.name), 'ZD403: forbidden',
  'a request of another institution reads as a forbidden one to ' || p.name)
FROM (VALUES ('ana'), ('vesna')) AS p (name);
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('marko'), 'teacher');
SELECT is(pg_temp.try('accepted', 'marko', a.call), 'applied|2|reopened|stored', 'a second teacher of K1 fires the rereview')
FROM action a WHERE a.name = 'rereview';
UPDATE institution.course_member SET member_to = now()
WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('marko') AND member_to IS NULL;
SELECT is(pg_temp.try('accepted', 'marko', a.call), 'ZD403: forbidden|unchanged', 'a teacher who left K1 cannot fire the rereview')
FROM action a WHERE a.name = 'rereview';

-- What is stored: the accepted version stays as it was; the new one repeats
-- the teacher's instruction, names the caller of the session and the observed
-- hash, and carries no answer, acceptance or verdict.
INSERT INTO ref SELECT 's1', pg_temp.make('accepted');
SELECT matches(pg_temp.act('rereview', pg_temp.id('s1'), pg_temp.seq(pg_temp.id('s1'))), '^applied\|[0-9]+\|2\|reopened$', 'fixture: Ana fires the rereview');
SELECT row_eq(
  $$ SELECT closed_as, closed_by, accepted_revision, accepted_range_hash, opened_as, observed_range_hash
       FROM collaboration.revision_request_version WHERE request_id = pg_temp.id('s1') AND version = 1 $$,
  ROW('accepted'::text, pg_temp.id('vesna'), 5::bigint, repeat('e', 64), 'instruction'::text, NULL::text),
  'version 1 stays accepted by the teacher at revision 5 with its hash: the acceptance is not undone');
SELECT row_eq(
  $$ SELECT instruction, requested_revision, opened_by, opened_as, observed_range_hash, closed_as, closed_by, closed_at::text,
            accepted_revision, accepted_range_hash
       FROM collaboration.revision_request_version WHERE request_id = pg_temp.id('s1') AND version = 2 $$,
  ROW('Ovdje nedostaje izvor.'::text, 6::bigint, pg_temp.id('ana'), 'rereview'::text, repeat('f', 64), NULL::text, NULL::uuid, NULL::text,
      NULL::bigint, NULL::text),
  'version 2 repeats the instruction at revision 6, opened by the caller as a rereview with the observed hash, and is not closed');
SELECT is((SELECT string_agg(version::text, ',') FROM collaboration.revision_response WHERE request_id = pg_temp.id('s1')), '1',
  'the answer of version 1 stays and version 2 has none');
INSERT INTO ref SELECT 's2', pg_temp.make('accepted');
SELECT matches(pg_temp.run('vesna', pg_temp.rereview('7', NULL), pg_temp.id('s2'), pg_temp.seq(pg_temp.id('s2'))), '^applied\|[0-9]+\|2\|reopened$',
  'fixture: Vesna fires the rereview without a hash');
SELECT row_eq(
  $$ SELECT requested_revision, opened_by, opened_as, observed_range_hash FROM collaboration.revision_request_version
      WHERE request_id = pg_temp.id('s2') AND version = 2 $$,
  ROW(7::bigint, pg_temp.id('vesna'), 'rereview'::text, NULL::text), 'a rereview without a hash stores the teacher of the session and no hash');
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

-- The new cycle (O7; #87 c.6691142048): the student answers version 2, only
-- the teacher's acceptance closes it, and the next rereview compares with the
-- hash of that acceptance.
SELECT is(pg_temp.act('respond', pg_temp.id('s1'), pg_temp.seq(pg_temp.id('s1'))), 'ZD422: invalid input',
  'an answer at revision 5, below the revision of the rereview, is refused');
SELECT matches(pg_temp.run(c.actor, c.call, pg_temp.id('s1'), pg_temp.seq(pg_temp.id('s1'))), c.outcome, c.what)
FROM (VALUES
  (1, 'ana', $$ respond_revision_request(:id, :seq, 'done', 'Vratila sam izvor.', 6) $$, '^applied\|[0-9]+\|2\|responded$',
   'the student answers version 2: STUDENT_RESPONDED, not accepted'),
  (2, 'ana', pg_temp.rereview('7', repeat('a', 64)), '^ZD409: transition not allowed$', 'an answered request is not rereviewed'),
  (3, 'vesna', format('accept_revision_request(:id, :seq, 7, %L)', repeat('a', 64)), '^applied\|[0-9]+\|2\|accepted$',
   'only the teacher''s acceptance closes the new cycle'),
  (4, 'ana', pg_temp.rereview('8', repeat('a', 64)), '^ZD409: transition not allowed$', 'the hash of the second acceptance is no change'),
  (5, 'ana', pg_temp.rereview('7', repeat('e', 64)), '^ZD422: invalid input$', 'the revision of the second acceptance is no new version'),
  (6, 'ana', pg_temp.rereview('8', repeat('e', 64)), '^applied\|[0-9]+\|3\|reopened$',
   'the hash of the first acceptance is a change against the second: version 3'),
  (7, 'vesna', 'withdraw_revision_request(:id, :seq)', '^applied\|[0-9]+\|3\|withdrawn$', 'the teacher may withdraw a rereviewed request')
) AS c (n, actor, call, outcome, what) ORDER BY c.n;
SELECT is((SELECT string_agg(format('%s|%s|%s|%s', version, opened_as, closed_as, accepted_revision), ';' ORDER BY version)
    FROM collaboration.revision_request_version WHERE request_id = pg_temp.id('s1')),
  '1|instruction|accepted|5;2|rereview|accepted|7;3|rereview|withdrawn|', 'every version keeps how it was opened and closed');

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
-- An acceptance and a new version of the document at the same moment: the
-- rereview loaded before the acceptance is a conflict; after it, the accepted
-- revision is no change and a later one is.
INSERT INTO ref SELECT 'k4r', pg_temp.make('responded');
INSERT INTO ref SELECT 'k4r_seq', pg_temp.seq(pg_temp.id('k4r'));
SELECT matches(pg_temp.act('accept', pg_temp.id('k4r'), (SELECT val FROM ref WHERE name = 'k4r_seq')::bigint), '^applied\|[0-9]+\|1\|accepted$',
  'the teacher accepts at revision 5');
SELECT is(pg_temp.act('rereview', pg_temp.id('k4r'), (SELECT val FROM ref WHERE name = 'k4r_seq')::bigint),
  'conflict|' || pg_temp.seq(pg_temp.id('k4r')) || '|1|accepted', 'a rereview with the counter loaded before the acceptance is a conflict');
SELECT is(pg_temp.run('ana', pg_temp.rereview('5', repeat('f', 64)), pg_temp.id('k4r'), pg_temp.seq(pg_temp.id('k4r'))),
  'ZD422: invalid input', 'a rereview at the revision that was just accepted is refused');
SELECT matches(pg_temp.act('rereview', pg_temp.id('k4r'), pg_temp.seq(pg_temp.id('k4r'))), '^applied\|[0-9]+\|2\|reopened$',
  'a rereview at the next revision of the document is applied');

-- No rereview above changed anything in schema evidence.
SELECT is(pg_temp.evidence_print(), (SELECT v FROM print_before), 'the rereview changes nothing in schema evidence');

-- After the submission is recorded the rereview is forbidden, malformed or
-- not: the acceptance is not the submission, and the submission ends it.
INSERT INTO ref SELECT 'b8', pg_temp.make('accepted');
INSERT INTO ref SELECT 'b8_req', pg_temp.make('accepted');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 10, repeat('a', 64), repeat('d', 64),
  repeat('b', 64)), 'reserved', 'fixture: Ana commits revision 11');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a', 11) $$), 'requested', 'fixture: Ana requests revision 11');
SELECT matches(pg_temp.run('ana', pg_temp.rereview('11', repeat('f', 64)), pg_temp.id('b8_req'), pg_temp.seq(pg_temp.id('b8_req'))),
  '^applied\|[0-9]+\|2\|reopened$', 'a requested but unrecorded submission does not stop a rereview at the new revision 11');
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.record_submission(%L::uuid, %L)',
    (SELECT id FROM evidence.submission_request WHERE document_id = 'doc-a'), pg_temp.h('d'))), 'recorded',
  'fixture: the submission of revision 11 is recorded');
INSERT INTO ref SELECT 'b8_before', pg_temp.snapshot(pg_temp.id('b8'));
SELECT is(pg_temp.run(p.name, c.call, pg_temp.id('b8'), pg_temp.seq(pg_temp.id('b8'))), 'ZD403: forbidden',
  'a rereview of ' || p.name || ' on a submitted document is forbidden' || c.what)
FROM (VALUES ('ana'), ('vesna')) AS p (name)
CROSS JOIN (VALUES (pg_temp.rereview('11', repeat('f', 64)), ''), (pg_temp.rereview('NULL', 'x'), ', malformed or not')) AS c (call, what);
SELECT is(pg_temp.snapshot(pg_temp.id('b8')), (SELECT val FROM ref WHERE name = 'b8_before'), 'no rereview on a submitted document wrote anything');

SELECT * FROM finish();
ROLLBACK;

-- DAN-215 (M6.1-P03, D-201 t. 3(c)): the student who owns the work opens a
-- thread and deletes only their own comments; the deletion stays in the
-- thread's history. Attacks N1 to N7 and N10 to N20 of issue #1886; N8 and N9
-- (two connections) are in tests/integration/comment-delete-race. Personas of
-- institution.inc; the works, texts and group names are invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
SELECT no_plan();

-- Ana's and Dora's works on Z1 of K1 (fak-a) and Tomo's on Z3 of K3 (fak-b).
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES
  ('project-a', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('ana')),
  ('project-d', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('dora')),
  ('project-b', pg_temp.id('fak_b'), pg_temp.id('z3'), pg_temp.id('tomo'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash) VALUES
  ('doc-a', pg_temp.id('fak_a'), 'project-a', pg_temp.id('ana'), repeat('a', 64)),
  ('doc-d', pg_temp.id('fak_a'), 'project-d', pg_temp.id('dora'), repeat('d', 64)),
  ('doc-b', pg_temp.id('fak_b'), 'project-b', pg_temp.id('tomo'), repeat('c', 64));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash) VALUES
  ('doc-a', pg_temp.id('fak_a'), 0, pg_temp.id('ana'), repeat('a', 64)),
  ('doc-d', pg_temp.id('fak_a'), 0, pg_temp.id('dora'), repeat('d', 64)),
  ('doc-b', pg_temp.id('fak_b'), 0, pg_temp.id('tomo'), repeat('c', 64));
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;

-- Everything outside the collaboration schema that a write could touch:
-- evidence, submission and the audit trail, as one value (N19).
CREATE FUNCTION pg_temp.outside_print() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  v_rows text;
  v_all text := '';
BEGIN
  FOR r IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname IN ('evidence', 'institution', 'audit', 'app') AND c.relkind IN ('r', 'p')
            ORDER BY 1, 2 LOOP
    EXECUTE format('SELECT md5(coalesce(string_agg(row_to_json(x)::text, ''|'' ORDER BY row_to_json(x)::text), '''')) FROM %I.%I x',
                   r.nspname, r.relname) INTO v_rows;
    v_all := v_all || r.nspname || '.' || r.relname || '=' || v_rows || ';';
  END LOOP;
  RETURN md5(v_all);
END
$$;
-- Every comment row, to show that a refused call changed none of them.
CREATE FUNCTION pg_temp.comment_print() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT md5(coalesce(string_agg(row_to_json(x)::text, '|' ORDER BY x.id), '')) FROM collaboration.comment x
$$;
-- One deletion as p_actor, "done" or the error.
CREATE FUNCTION pg_temp.del(p_actor text, p_comment text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format($q$ SELECT 'done' FROM collaboration.delete_comment(%s) $q$, p_comment))
$$;
-- The id of a comment by thread and position, as the owner reads it.
CREATE FUNCTION pg_temp.comment_id(p_thread text, p_position integer) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT id::text FROM collaboration.comment WHERE thread_id = pg_temp.id(p_thread) AND position = p_position
$$;

INSERT INTO ref VALUES
  ('anchor', '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"prvi odlomak","prefix":"","suffix":" teksta","startHint":0,"endHint":12}'),
  ('anchor_b', '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000002","quote":"odlomak","prefix":"","suffix":"","startHint":0,"endHint":7}');

-- 1. Catalogue (N19): delete_comment is a definer RPC of the identity role,
-- with an empty search_path, called by the web role and by no other.
SELECT is(
  (SELECT p.proowner::regrole::text || ' ' || p.provolatile::text || ' ' || p.prosecdef::text
          || ' ' || array_to_string(p.proconfig, ',') || ' ' || pg_get_function_result(p.oid)
   FROM pg_proc p WHERE p.oid = 'collaboration.delete_comment(uuid)'::regprocedure),
  'ductus_identity v true search_path="" void',
  'delete_comment is a volatile definer RPC of the identity role that returns nothing');
SELECT is_empty(
  $$ SELECT r FROM unnest(ARRAY['ductus_evidence', 'ductus_worker', 'ductus_auth', 'ductus_retention', 'public']) r
      WHERE has_function_privilege(r, 'collaboration.delete_comment(uuid)', 'EXECUTE') $$,
  'only the web role calls delete_comment');
SELECT ok(has_function_privilege('ductus_app', 'collaboration.delete_comment(uuid)', 'EXECUTE'),
  'the web role calls delete_comment');
SELECT has_column('collaboration', 'comment', 'deleted_at', 'a comment records when it was deleted');
SELECT col_type_is('collaboration', 'comment', 'deleted_at', 'timestamp with time zone', 'deleted_at is a timestamptz');

CREATE FUNCTION pg_temp.ref(p_name text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT val FROM ref WHERE name = p_name $$;
-- One thread's state, read as the test's own role.
CREATE FUNCTION pg_temp.state(p_thread text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT state FROM collaboration.comment_thread WHERE id = pg_temp.id(p_thread) $$;
-- Every row list_comments gives p_actor on doc-a, except is_own, which
-- differs by who asks.
CREATE FUNCTION pg_temp.view(p_actor text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, $q$
    SELECT md5(string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s|%s', thread_id, comment_id, comment_position, author_role,
                                 body, anchor, state, created_window, deleted_window), ';' ORDER BY thread_id, comment_position))
    FROM collaboration.list_comments('doc-a') $q$)
$$;

-- 2. Marko teaches seminar group G1 of K1, which holds Ana: he reaches her
-- work through the group scope and comments as a teacher.
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.set_course_holder({k1}, {vesna}) $$), 'ok',
  'Vesna becomes the holder of K1');
INSERT INTO ref VALUES ('g1', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa 1') $$));
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_teacher({g1}, {marko}) $$), 'ok',
  'Marko becomes the teacher of G1');
SELECT is(pg_temp.ask('vesna', $$ SELECT 'ok' FROM institution.assign_group_student({g1}, {ana}) $$), 'ok',
  'Ana joins G1');

-- 3. The threads. tv: Vesna's, with Ana's and Marko's replies (open).
-- ts: Ana's own (N14). tr: Vesna's with Ana's reply, resolved. td: on Dora's
-- work with her reply. tb: Petra's on Tomo's work in fak-b with his reply.
CREATE TEMP TABLE print_before AS SELECT pg_temp.outside_print() AS v;
INSERT INTO ref SELECT 'tv', pg_temp.ask('vesna', $$ SELECT collaboration.create_comment('doc-a', 'Ovdje nedostaje izvor.', {anchor}) $$);
SELECT is(pg_temp.ask('ana', $$ SELECT collaboration.reply_comment({tv}, 'Moj odgovor na primjedbu.') IS NOT NULL $$), 'true',
  'Ana replies in Vesna''s thread');
SELECT is(pg_temp.ask('marko', $$ SELECT collaboration.reply_comment({tv}, 'Dopuna voditelja grupe.') IS NOT NULL $$), 'true',
  'Marko replies in it through the group scope');
INSERT INTO ref SELECT 'ts', pg_temp.ask('ana', $$ SELECT collaboration.create_comment('doc-a', 'Je li ovaj izvor dovoljan?', {anchor_b}) $$);
INSERT INTO ref SELECT 'tr', pg_temp.ask('vesna', $$ SELECT collaboration.create_comment('doc-a', 'Provjeri citat.', {anchor}) $$);
SELECT is(pg_temp.ask('ana', $$ SELECT collaboration.reply_comment({tr}, 'Provjereno.') IS NOT NULL $$), 'true',
  'Ana replies in the thread to be resolved');
SELECT is(pg_temp.ask('vesna', $$ SELECT 'done' FROM collaboration.resolve_thread({tr}) $$), 'done', 'Vesna resolves it');
INSERT INTO ref SELECT 'td', pg_temp.ask('vesna', $$ SELECT collaboration.create_comment('doc-d', 'Primjedba Dori.', {anchor}) $$);
SELECT is(pg_temp.ask('dora', $$ SELECT collaboration.reply_comment({td}, 'Dorin odgovor.') IS NOT NULL $$), 'true',
  'Dora replies on her own work');
INSERT INTO ref SELECT 'tb', pg_temp.ask('petra', $$ SELECT collaboration.create_comment('doc-b', 'Primjedba Tomi.', {anchor}) $$);
SELECT is(pg_temp.ask('tomo', $$ SELECT collaboration.reply_comment({tb}, 'Tomin odgovor.') IS NOT NULL $$), 'true',
  'Tomo replies on his own work in fak-b');
INSERT INTO ref VALUES
  ('cv1', pg_temp.comment_id('tv', 1)), ('cv2', pg_temp.comment_id('tv', 2)), ('cv3', pg_temp.comment_id('tv', 3)),
  ('cs1', pg_temp.comment_id('ts', 1)), ('cr2', pg_temp.comment_id('tr', 2)),
  ('cd2', pg_temp.comment_id('td', 2)), ('cb2', pg_temp.comment_id('tb', 2));

-- 4. A thread the student opens (N14, N15, N16).
SELECT is(
  (SELECT format('%s|%s|%s', t.state, t.created_by = pg_temp.id('ana'), t.anchor = pg_temp.ref('anchor_b')::jsonb)
   FROM collaboration.comment_thread t WHERE t.id = pg_temp.id('ts')),
  'answered|t|t', 'Ana''s thread opens waiting on the teacher, with her anchor');
SELECT results_eq(
  $$ SELECT position, author_role, author_id FROM collaboration.comment WHERE thread_id = pg_temp.id('ts') $$,
  $$ VALUES (1, 'student'::text, pg_temp.id('ana')) $$,
  'its first comment is Ana''s, as a student');
SELECT is(pg_temp.ask(a.name, format($$ SELECT collaboration.create_comment(%L, 'Tekst.', {anchor}) $$, a.doc)), 'ZD403: forbidden',
  a.name || ' cannot open a thread on ' || a.what || ' (N14)')
FROM (VALUES ('ana', 'doc-d', 'Dora''s work'), ('ana', 'doc-b', 'a work of another institution'),
             ('ana', 'doc-nema', 'a missing work'), ('dora', 'doc-a', 'Ana''s work'), ('tomo', 'doc-a', 'Ana''s work'),
             ('boris', 'doc-a', 'Ana''s work')) AS a (name, doc, what);
SELECT is(pg_temp.ask('dora', $$ SELECT collaboration.create_comment('doc-a', '', '{}') $$), 'ZD403: forbidden',
  'authorisation comes before validation: Dora learns nothing from a malformed request');
SELECT is(pg_temp.ask('ana', format($$ SELECT collaboration.create_comment('doc-a', %L, {anchor}) $$, b.body)), 'ZD422: invalid input',
  'Ana''s comment body that is ' || b.what || ' is refused (N15)')
FROM (VALUES ('', 'empty'), ('   ', 'only blanks'), (E'a\u0001b', 'a control character'), (repeat('a', 2001), 'over 2000 characters'),
             (E'a‮b', 'a right-to-left override'), (E'é', 'not NFC')) AS b (body, what);
SELECT is(pg_temp.ask('ana', format($$ SELECT collaboration.create_comment('doc-a', 'Tekst.', %L) $$, b.anchor)), 'ZD422: invalid input',
  'Ana''s anchor that is ' || b.what || ' is refused (N15)')
FROM (VALUES ('{}', 'empty'), ('null', 'null'), ('{"nodeId":"x","quote":"a","prefix":"","suffix":"","startHint":0,"endHint":1}', 'a bad node id'),
             ('{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"a","prefix":"","suffix":"","startHint":1,"endHint":0}',
              'a range that ends before it starts')) AS b (anchor, what);
SELECT is(pg_temp.ask('ana', format($$ SELECT collaboration.%s({ts}) $$, f.fn)), 'ZD403: forbidden',
  'Ana cannot ' || f.fn || ' the thread she opened (N16)')
FROM (VALUES ('resolve_thread'), ('reopen_thread')) AS f (fn);

-- 5. Every deletion that is not the owner's own comment is refused, and no
-- comment changes (N1 to N6, N18). Another person's comment, one of another
-- institution and one that does not exist give the same answer.
CREATE TEMP TABLE comments_before AS SELECT pg_temp.comment_print() AS v;
SELECT is(pg_temp.del(d.actor, d.target), 'ZD403: forbidden', d.what)
FROM (VALUES
  ('ana', '{cv1}', 'N1: Ana cannot delete Vesna''s comment in a thread on her work'),
  ('ana', '{cv3}', 'N2: Ana cannot delete the comment of Marko, teacher of her group'),
  ('dora', '{cv2}', 'N3: Dora cannot delete Ana''s comment'),
  ('ana', '{cd2}', 'N3: Ana cannot delete Dora''s comment on Dora''s work'),
  ('tomo', '{cv2}', 'N4: Tomo of fak-b cannot delete Ana''s comment'),
  ('petra', '{cv2}', 'N4: Petra of fak-b cannot delete Ana''s comment'),
  ('lea', '{cv2}', 'N4: Lea, administrator of fak-b, cannot delete Ana''s comment'),
  ('ana', '{cb2}', 'N4: Ana cannot delete Tomo''s comment in fak-b by its id'),
  ('ana', '{nobody}', 'N5: a missing comment reads as a forbidden one'),
  ('ana', 'NULL', 'N5: a null id reads as a missing comment'),
  ('ana', '{tv}', 'N5: a thread id is not a comment id'),
  ('vesna', '{cv1}', 'N18: Vesna cannot delete her own comment'),
  ('vesna', '{cv2}', 'N18: Vesna cannot delete Ana''s comment'),
  ('marko', '{cv3}', 'N18: Marko cannot delete his own comment'),
  ('marko', '{cv2}', 'N18: Marko cannot delete Ana''s comment'),
  ('iva', '{cv2}', 'the administrator of fak-a cannot delete Ana''s comment'),
  ('boris', '{cv2}', 'a student of no course cannot delete Ana''s comment'),
  ('nina', '{cv2}', 'an unconfirmed teacher cannot delete Ana''s comment')
) AS d (actor, target, what);
SELECT matches(pg_temp.del(s.name, '{cv2}'), '^ZD401', 'N6: deleting with ' || s.what || ' is not signed in')
FROM (VALUES ('anon', 'no session'), ('expired', 'an expired session'), ('closed', 'a closed session'),
             ('unknown', 'an unknown session')) AS s (name, what);
SELECT matches(pg_temp.del('ana', quote_literal('not-a-uuid')), '^22P02',
  'N5: an id that is not a UUID never reaches the function (the route refuses it first)');
SELECT is(pg_temp.comment_print(), (SELECT v FROM comments_before), 'no refused deletion changed any comment');

-- 6. Ana deletes her reply in an open thread (N10, N11, N12).
SELECT is(pg_temp.del('ana', '{cv2}'), 'done', 'Ana deletes her own reply');
SELECT is(
  (SELECT format('%s|%s|%s|%s|%s', position, author_role, author_id = pg_temp.id('ana'), body IS NULL, deleted_at = now())
   FROM collaboration.comment WHERE id = pg_temp.id('cv2')),
  '2|student|t|t|t', 'the row stays at its place with its author; only the text goes, with the time of deletion');
SELECT is(pg_temp.state('tv'), 'open', 'N12: the open thread stays open');
SELECT is(
  (SELECT string_agg(format('%s:%s', position, body IS NOT NULL), ',' ORDER BY position) FROM collaboration.comment
    WHERE thread_id = pg_temp.id('tv')),
  '1:t,2:f,3:t', 'the other comments of the thread keep their text');
SELECT is(pg_temp.ask(a.name, $$ SELECT format('%s|%s|%s|%s|%s', comment_position, author_role, body IS NULL,
                                               extract(epoch FROM deleted_window)::bigint % 300, deleted_window <= now())
                                  FROM collaboration.list_comments('doc-a') WHERE comment_id = {cv2} $$),
  '2|student|t|0|t', 'N10: ' || a.name || ' reads the deleted comment at its place, without text, with the window of deletion')
FROM (VALUES ('ana'), ('vesna'), ('marko')) AS a (name);
SELECT is(pg_temp.view('vesna'), pg_temp.view('ana'), 'N10: the teacher and the student read the same rows');
SELECT is(pg_temp.view('marko'), pg_temp.view('ana'), 'N10: so does the teacher of her group');
SELECT is(pg_temp.ask('vesna', $$ SELECT count(*) FILTER (WHERE deleted_window IS NOT NULL) || '/' || count(*)
                                   FROM collaboration.list_comments('doc-a') WHERE thread_id = {tv} $$),
  '1/3', 'only the deleted comment carries a window of deletion');
SELECT matches(pg_temp.ask('ana', $$ SELECT body FROM collaboration.comment LIMIT 1 $$), '^42501',
  'N11: the web role still cannot read the comment table directly');
SELECT is(
  (SELECT count(*)::integer FROM (
     SELECT row_to_json(x)::text FROM collaboration.comment x UNION ALL
     SELECT row_to_json(x)::text FROM collaboration.comment_thread x) AS s (r)
   WHERE r LIKE '%Moj odgovor na primjedbu%'),
  0, 'N11: the deleted text is nowhere in the collaboration schema');

-- 7. A second deletion is a conflict and keeps the first time (N7). The
-- first deletion is moved an hour back, so a rewrite would show.
UPDATE collaboration.comment SET created_at = created_at - interval '2 hours', deleted_at = deleted_at - interval '1 hour'
 WHERE id = pg_temp.id('cv2');
SELECT is(pg_temp.del('ana', '{cv2}'), 'ZD409: conflict', 'N7: deleting the same comment again is a conflict');
SELECT is((SELECT deleted_at FROM collaboration.comment WHERE id = pg_temp.id('cv2')), now() - interval '1 hour',
  'N7: the time of the first deletion stays');

-- 8. Deleting the first comment, which carries the anchor, in an answered
-- thread (N12, N13); the teacher still reads and replies (N17).
SELECT is(pg_temp.del('ana', '{cs1}'), 'done', 'N13: Ana deletes the first comment of the thread she opened');
SELECT is(pg_temp.state('ts'), 'answered', 'N12: the answered thread stays answered');
SELECT is(pg_temp.ask('vesna', $$ SELECT format('%s|%s|%s', comment_position, body IS NULL, anchor = {anchor_b})
                                   FROM collaboration.list_comments('doc-a') WHERE thread_id = {ts} $$),
  '1|t|t', 'N13: the thread is still listed and anchored, at its deleted first comment');
SELECT is(pg_temp.ask('vesna', $$ SELECT collaboration.reply_comment({ts}, 'Izvor je dovoljan.') IS NOT NULL $$), 'true',
  'N17: Vesna replies in the thread Ana opened');
SELECT is(pg_temp.state('ts'), 'open', 'N17: her reply makes it open');
SELECT is(pg_temp.ask('ana', $$ SELECT collaboration.reply_comment({ts}, 'Hvala.') IS NOT NULL $$), 'true',
  'N17: Ana answers');
SELECT is(pg_temp.state('ts'), 'answered', 'N17: her answer makes it answered');
SELECT is(pg_temp.ask('vesna', $$ SELECT 'done' FROM collaboration.resolve_thread({ts}) $$), 'done',
  'N16: the teacher resolves the thread Ana opened');

-- 9. Deleting in a resolved thread (N12).
SELECT is(pg_temp.del('ana', '{cr2}'), 'done', 'N12: Ana deletes her reply in a resolved thread');
SELECT is(pg_temp.state('tr'), 'resolved', 'N12: the resolved thread stays resolved');

-- 10. Nothing outside the collaboration schema changed (N19).
SELECT is(pg_temp.outside_print(), (SELECT v FROM print_before),
  'N19: opening, replying and deleting write nothing to evidence, submission, institution or audit tables');

-- 11. The table holds the rule itself: text without a time of deletion, or a
-- time without text gone, or a time before the comment, is refused.
SELECT matches(pg_temp.ask_as('ductus_identity', 'ana', format($$ UPDATE collaboration.comment SET %s WHERE id = {%s} RETURNING 'x' $$,
                                                              c.change, c.target)), '^23514',
  'the table refuses ' || c.what)
FROM (VALUES
  ('body = NULL', 'cv1', 'a comment without text that is not deleted'),
  ('deleted_at = now()', 'cv1', 'a deleted comment that keeps its text'),
  ('body = ''Vraćeni tekst.''', 'cv2', 'text put back on a deleted comment'),
  ('body = NULL, deleted_at = created_at - interval ''1 second''', 'cv1', 'a deletion before the comment')
) AS c (change, target, what);

-- 12. Deleted comments keep their positions; the 10000 ceiling holds (N20).
SELECT is(pg_temp.ask_as('ductus_identity', 'ana', format(
    $$ INSERT INTO collaboration.comment (thread_id, institution_id, position, author_id, author_role, body)
       VALUES (%L, {fak_a}, 9999, {ana}, 'student', 'Sintetički odgovor.') RETURNING position $$, pg_temp.id('tv'))),
  '9999', 'the thread is filled up to the position before the last');
INSERT INTO ref VALUES ('c9999', pg_temp.comment_id('tv', 9999));
SELECT is(pg_temp.del('ana', '{c9999}'), 'done', 'Ana deletes the comment at position 9999');
SELECT is(pg_temp.ask('ana', $$ SELECT collaboration.reply_comment({tv}, 'Zadnji odgovor.') IS NOT NULL $$), 'true',
  'N20: the next reply takes position 10000, not the deleted one');
SELECT is((SELECT max(position) FROM collaboration.comment WHERE thread_id = pg_temp.id('tv')), 10000, 'the reply is at 10000');
INSERT INTO ref VALUES ('c10000', pg_temp.comment_id('tv', 10000));
SELECT is(pg_temp.del('ana', '{c10000}'), 'done', 'Ana deletes the last comment too');
SELECT is(pg_temp.ask('ana', $$ SELECT collaboration.reply_comment({tv}, 'Odgovor previše.') $$), 'ZD409: conflict',
  'N20: a full thread stays full when its comments are deleted');

SELECT * FROM finish();
ROLLBACK;

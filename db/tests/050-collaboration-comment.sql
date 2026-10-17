-- B-10 / DAN-86: comments on a paragraph (docs/BACKEND.md 4.11). Attacks 1
-- to 12 of issue #177 are the acceptance criteria; every person, course and
-- text below is invented.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';
SELECT no_plan();

-- One document of Ana on Z1 (fak-a) and one of Tomo on Z3 (fak-b), with a
-- revision, a package and a segment each, as the evidence role writes them.
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.domain (id, institution_id, region) VALUES
  ('00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), 'eu-central-1'),
  ('00000000-0000-4000-8000-0000000000d2', pg_temp.id('fak_b'), 'eu-central-1');
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES
  ('project-a', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('ana')),
  ('project-b', pg_temp.id('fak_b'), pg_temp.id('z3'), pg_temp.id('tomo'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash) VALUES
  ('doc-a', pg_temp.id('fak_a'), 'project-a', pg_temp.id('ana'), repeat('a', 64)),
  ('doc-b', pg_temp.id('fak_b'), 'project-b', pg_temp.id('tomo'), repeat('c', 64));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash) VALUES
  ('doc-a', pg_temp.id('fak_a'), 0, pg_temp.id('ana'), repeat('a', 64)),
  ('doc-b', pg_temp.id('fak_b'), 0, pg_temp.id('tomo'), repeat('c', 64));
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
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;

-- Everything the evidence schema holds, as one value (attack 6).
CREATE FUNCTION pg_temp.evidence_print() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT md5(string_agg(r, '|' ORDER BY r)) FROM (
    SELECT 'd' || row_to_json(x)::text FROM evidence.document x UNION ALL
    SELECT 'r' || row_to_json(x)::text FROM evidence.document_revision x UNION ALL
    SELECT 'p' || row_to_json(x)::text FROM evidence.package x UNION ALL
    SELECT 's' || row_to_json(x)::text FROM evidence.segment x UNION ALL
    SELECT 'c' || row_to_json(x)::text FROM evidence.receipt x
  ) AS t (r)
$$;
CREATE TEMP TABLE print_before AS SELECT pg_temp.evidence_print() AS v;

INSERT INTO ref VALUES
  ('anchor', '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"prvi odlomak","prefix":"","suffix":" teksta","startHint":0,"endHint":12}'),
  ('anchor_b', '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000002","quote":"odlomak","prefix":"","suffix":"","startHint":0,"endHint":7}');

-- Catalogue: ownership, RLS and who may do what.
SELECT has_schema('collaboration');
SELECT is_empty(
  $$ SELECT relname FROM pg_class WHERE relnamespace = 'collaboration'::regnamespace AND relkind IN ('r', 'p')
      AND (relowner <> 'ductus_identity'::regrole OR NOT relrowsecurity OR NOT relforcerowsecurity) $$,
  'the identity role owns every collaboration table and RLS is forced on each');
SELECT is_empty(
  $$ SELECT c.relname || ' ' || a.grantee::regrole::text FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.relnamespace = 'collaboration'::regnamespace AND a.grantee <> c.relowner $$,
  'no role but the owner has any privilege on a collaboration table or sequence');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['comment', 'comment_thread']) AS t
  CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p
  CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence']) AS r
  WHERE has_table_privilege(r, 'collaboration.' || t, p)
), 'no runtime role reads or writes a collaboration table directly');
SELECT bag_eq(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.pronamespace = 'collaboration'::regnamespace AND has_function_privilege('ductus_app', p.oid, 'EXECUTE') $$,
  $$ VALUES ('collaboration.create_comment(text,text,jsonb)'), ('collaboration.reply_comment(uuid,text)'),
            ('collaboration.resolve_thread(uuid)'), ('collaboration.reopen_thread(uuid)'),
            ('collaboration.list_comments(text)') $$,
  'the web role executes exactly the five comment RPCs');
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.oid IN ('collaboration.create_comment(text,text,jsonb)'::regprocedure,
        'collaboration.reply_comment(uuid,text)'::regprocedure, 'collaboration.resolve_thread(uuid)'::regprocedure,
        'collaboration.reopen_thread(uuid)'::regprocedure, 'collaboration.list_comments(text)'::regprocedure)
      AND (NOT p.prosecdef OR p.proowner <> 'ductus_identity'::regrole) $$,
  'the five RPCs are SECURITY DEFINER functions of the identity role');
SELECT is((SELECT proowner::regrole::text FROM pg_proc WHERE oid = 'collaboration.document_scope(text)'::regprocedure),
  'ductus_evidence', 'the evidence role owns the one bridge to the evidence schema');
SELECT bag_eq(
  $$ SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_identity']) AS r
      WHERE has_function_privilege(r, 'collaboration.document_scope(text)', 'EXECUTE') $$,
  $$ VALUES ('ductus_identity') $$,
  'only the identity role executes document_scope');
SELECT ok(NOT has_schema_privilege('ductus_identity', 'evidence', 'USAGE'), 'the identity role still has no evidence-schema access');
SELECT ok(NOT has_schema_privilege('ductus_evidence', 'collaboration', 'USAGE')
  AND NOT has_schema_privilege('ductus_evidence', 'collaboration', 'CREATE'),
  'the evidence role keeps no right on the collaboration schema after the migration');
SELECT is(pg_get_function_arguments('collaboration.create_comment(text,text,jsonb)'::regprocedure),
  'p_document_id text, p_body text, p_anchor jsonb', 'no RPC takes an author: it comes from the session (attack 3)');
SELECT is(pg_get_function_result('collaboration.list_comments(text)'::regprocedure),
  'TABLE(thread_id uuid, comment_id uuid, comment_position integer, author_role text, is_own boolean, body text, anchor jsonb, state text, created_window timestamp with time zone)',
  'list_comments returns no person id, exact time or document content (attack 8)');

-- Creating a thread: only the teacher of the assignment's course.
INSERT INTO ref SELECT 't1', pg_temp.ask('vesna', $$ SELECT collaboration.create_comment('doc-a', 'Ovdje nedostaje izvor.', {anchor}) $$);
SELECT matches((SELECT val FROM ref WHERE name = 't1'), '^[0-9a-f-]{36}$', 'the teacher of K1 opens a thread on a document of Z1');
SELECT is(pg_temp.ask(a.name, $$ SELECT collaboration.create_comment('doc-a', 'Tekst.', {anchor}) $$), 'ZD403: forbidden',
  a.name || ' cannot open a thread on Ana''s document (attack 1)')
FROM (VALUES ('ana'), ('dora'), ('marko'), ('iva'), ('petra'), ('boris'), ('nina')) AS a (name);
SELECT is(pg_temp.ask('vesna', $$ SELECT collaboration.create_comment('doc-b', 'Tekst.', {anchor}) $$), 'ZD403: forbidden',
  'a teacher cannot open a thread on a document of another institution');
SELECT is(pg_temp.ask('vesna', $$ SELECT collaboration.create_comment('doc-nema', 'Tekst.', {anchor}) $$), 'ZD403: forbidden',
  'a missing document reads as a forbidden one (attack 12)');
SELECT matches(pg_temp.ask(t.name, $$ SELECT collaboration.create_comment('doc-a', 'Tekst.', {anchor}) $$), '^ZD401',
  'a request with session ' || t.name || ' is not signed in')
FROM (VALUES ('anon'), ('expired'), ('closed'), ('unknown')) AS t (name);
INSERT INTO ref SELECT 'tb', pg_temp.ask('petra', $$ SELECT collaboration.create_comment('doc-b', 'Komentar u drugoj ustanovi.', {anchor_b}) $$);
SELECT matches((SELECT val FROM ref WHERE name = 'tb'), '^[0-9a-f-]{36}$', 'the teacher of K3 opens a thread on Tomo''s document');

-- Who wrote it comes from the session, never from the request (attack 3).
SELECT row_eq(
  $$ SELECT institution_id, document_id, assignment_id, owner_id, created_by, state FROM collaboration.comment_thread
      WHERE id = pg_temp.id('t1') $$,
  ROW(pg_temp.id('fak_a'), 'doc-a'::text, pg_temp.id('z1'), pg_temp.id('ana'), pg_temp.id('vesna'), 'open'::text),
  'the thread takes institution, assignment and owner from the document and the author from the session');
SELECT row_eq(
  $$ SELECT position, author_id, author_role, institution_id FROM collaboration.comment WHERE thread_id = pg_temp.id('t1') $$,
  ROW(1, pg_temp.id('vesna'), 'teacher'::text, pg_temp.id('fak_a')), 'the opening comment is the teacher''s, at position 1');

-- Reading: the owner and the teacher see the same shape, nobody else anything.
SELECT is(pg_temp.ask(a.name, $$ SELECT count(*) FROM collaboration.list_comments('doc-a') $$), '1',
  a.name || ' reads the thread on Ana''s document')
FROM (VALUES ('ana'), ('vesna')) AS a (name);
SELECT is(pg_temp.ask(a.name, $$ SELECT count(*) FROM collaboration.list_comments('doc-a') $$), 'ZD403: forbidden',
  a.name || ' reads nothing on Ana''s document (attack 1)')
FROM (VALUES ('dora'), ('marko'), ('iva'), ('petra'), ('tomo'), ('boris'), ('nina')) AS a (name);
SELECT matches(pg_temp.ask('anon', $$ SELECT count(*) FROM collaboration.list_comments('doc-a') $$), '^ZD401',
  'reading without a session is not signed in');
SELECT is(pg_temp.ask('vesna', $$ SELECT count(*) FROM collaboration.list_comments('doc-nema') $$), 'ZD403: forbidden',
  'reading a missing document gives the same answer as a forbidden one (attack 12)');
SELECT is(pg_temp.ask('vesna', $$ SELECT count(*) FROM collaboration.list_comments('doc-b') $$), 'ZD403: forbidden',
  'the teacher of K1 cannot read the thread of another institution');
SELECT is(pg_temp.ask('ana', $$ SELECT format('%s|%s|%s|%s', comment_position, author_role, is_own, anchor IS NOT NULL)
    FROM collaboration.list_comments('doc-a') $$), '1|teacher|f|t', 'the student sees the teacher''s comment as not her own');
SELECT is(pg_temp.ask('vesna', $$ SELECT format('%s|%s', is_own, anchor = {anchor}) FROM collaboration.list_comments('doc-a') $$),
  't|t', 'the anchor comes back exactly as the teacher stored it');
SELECT is(pg_temp.ask('vesna', $$ SELECT extract(epoch FROM created_window)::bigint % 300 FROM collaboration.list_comments('doc-a') $$),
  '0', 'time is given only to the five-minute window');

-- Replies and the state of a thread (attack 5).
SELECT is(pg_temp.ask('vesna', $$ SELECT collaboration.reply_comment({t1}, 'Dopuna nastavnika.') IS NOT NULL $$), 'true',
  'the teacher replies to an open thread');
SELECT is((SELECT state FROM collaboration.comment_thread WHERE id = pg_temp.id('t1')), 'open', 'a teacher reply keeps a thread open');
SELECT is(pg_temp.ask('ana', $$ SELECT collaboration.reply_comment({t1}, E'Dodala sam izvor.\nHvala.') IS NOT NULL $$), 'true',
  'the student replies on her own document');
SELECT is((SELECT state FROM collaboration.comment_thread WHERE id = pg_temp.id('t1')), 'answered', 'a student reply makes it answered');
SELECT is(pg_temp.ask('ana', $$ SELECT collaboration.reply_comment({t1}, 'Još jedno pitanje.') IS NOT NULL $$), 'true',
  'the student replies again');
SELECT is((SELECT state FROM collaboration.comment_thread WHERE id = pg_temp.id('t1')), 'answered', 'a second student reply keeps it answered');
SELECT is(pg_temp.ask('vesna', $$ SELECT collaboration.reply_comment({t1}, 'Odgovor nastavnika.') IS NOT NULL $$), 'true',
  'the teacher answers the student');
SELECT is((SELECT state FROM collaboration.comment_thread WHERE id = pg_temp.id('t1')), 'open', 'a teacher reply makes an answered thread open');
SELECT results_eq(
  $$ SELECT position, author_role, author_id FROM collaboration.comment WHERE thread_id = pg_temp.id('t1') ORDER BY position $$,
  $$ VALUES (1, 'teacher'::text, pg_temp.id('vesna')), (2, 'teacher', pg_temp.id('vesna')), (3, 'student', pg_temp.id('ana')),
            (4, 'student', pg_temp.id('ana')), (5, 'teacher', pg_temp.id('vesna')) $$,
  'replies are numbered in order and carry the author of the session');
SELECT is(pg_temp.ask(a.name, $$ SELECT collaboration.reply_comment({t1}, 'Upad.') $$), 'ZD403: forbidden',
  a.name || ' cannot reply in a thread on Ana''s document')
FROM (VALUES ('dora'), ('marko'), ('iva'), ('petra'), ('tomo')) AS a (name);
SELECT is(pg_temp.ask('vesna', $$ SELECT collaboration.reply_comment({tb}, 'Upad.') $$), 'ZD403: forbidden',
  'a thread id of another institution reads as missing');
SELECT is(pg_temp.ask('vesna', $$ SELECT collaboration.reply_comment({nobody}, 'Tekst.') $$), 'ZD403: forbidden',
  'a missing thread reads as a forbidden one (attack 12)');
SELECT is(pg_temp.ask(a.name, format($$ SELECT collaboration.%s({t1}) $$, a.fn)), 'ZD403: forbidden',
  a.name || ' cannot ' || a.fn)
FROM (VALUES ('ana', 'resolve_thread'), ('ana', 'reopen_thread'), ('dora', 'resolve_thread'), ('marko', 'resolve_thread'),
             ('petra', 'resolve_thread')) AS a (name, fn);
SELECT is(pg_temp.ask('vesna', $$ SELECT collaboration.reopen_thread({t1}) $$), 'ZD409: conflict', 'an open thread cannot be reopened');
SELECT is(pg_temp.ask('vesna', $$ SELECT 'done' FROM collaboration.resolve_thread({t1}) $$), 'done', 'the teacher resolves an open thread');
SELECT is((SELECT state FROM collaboration.comment_thread WHERE id = pg_temp.id('t1')), 'resolved', 'the thread is resolved');
SELECT is(pg_temp.ask('vesna', $$ SELECT collaboration.resolve_thread({t1}) $$), 'ZD409: conflict', 'a resolved thread cannot be resolved again');
SELECT is(pg_temp.ask(a.name, $$ SELECT collaboration.reply_comment({t1}, 'Kasni odgovor.') $$), 'ZD409: conflict',
  a.name || ' cannot reply in a resolved thread')
FROM (VALUES ('vesna'), ('ana')) AS a (name);
SELECT is(pg_temp.ask('vesna', $$ SELECT 'done' FROM collaboration.reopen_thread({t1}) $$), 'done', 'the teacher reopens a resolved thread');
SELECT is((SELECT state FROM collaboration.comment_thread WHERE id = pg_temp.id('t1')), 'open', 'a reopened thread is open');
INSERT INTO ref SELECT 't2', pg_temp.ask('vesna', $$ SELECT collaboration.create_comment('doc-a', 'Druga primjedba.', {anchor}) $$);
SELECT is(pg_temp.ask('ana', $$ SELECT collaboration.reply_comment({t2}, 'Ispravljeno.') IS NOT NULL $$), 'true', 'the student answers the second thread');
SELECT is(pg_temp.ask('vesna', $$ SELECT collaboration.reopen_thread({t2}) $$), 'ZD409: conflict', 'an answered thread cannot be reopened');
SELECT is(pg_temp.ask('vesna', $$ SELECT 'done' FROM collaboration.resolve_thread({t2}) $$), 'done', 'the teacher resolves an answered thread');
SELECT is((SELECT state FROM collaboration.comment_thread WHERE id = pg_temp.id('t2')), 'resolved', 'the answered thread is resolved');
SELECT is(pg_temp.ask('ana', $$ SELECT string_agg(DISTINCT state, ',' ORDER BY state) FROM collaboration.list_comments('doc-a') $$),
  'open,resolved', 'the student sees the state of every thread');

-- Input limits (attack 9). Authorisation comes first, so a stranger learns
-- nothing from a malformed request; the error never echoes the input.
SELECT is(pg_temp.ask('vesna', format($$ SELECT collaboration.create_comment('doc-a', %L, {anchor}) $$, b.body)), 'ZD422: invalid input',
  'a comment body that is ' || b.what || ' is refused')
FROM (VALUES ('', 'empty'), ('   ', 'only blanks'), (E' \n\t ', 'only blanks and line breaks'), (repeat('a', 2001), 'over 2000 characters'),
             (repeat('a', 1048576), 'one megabyte'), (E'a\u0001b', 'a control character'), (E'a\u202Eb', 'a right-to-left override'),
             (E'a\u2066b', 'a bidirectional isolate'), (E'e\u0301', 'not NFC')
) AS b (body, what);
SELECT is(pg_temp.ask('vesna', $$ SELECT collaboration.create_comment('doc-a', NULL, {anchor}) $$), 'ZD422: invalid input', 'a missing body is refused');
SELECT is(pg_temp.ask('vesna', format($$ SELECT collaboration.create_comment('doc-a', 'Tekst.', %L::jsonb) $$, a.anchor)), 'ZD422: invalid input',
  'an anchor with ' || a.what || ' is refused')
FROM (VALUES
  ('{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"x","prefix":"","suffix":"","startHint":0,"endHint":1,"html":"<b>"}', 'an unknown field'),
  ('{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"x","prefix":"","suffix":"","startHint":0}', 'a missing field'),
  ('{"nodeId":"odlomak-1","quote":"x","prefix":"","suffix":"","startHint":0,"endHint":1}', 'a node id that is no UUID'),
  ('{"nodeId":"00000000-0000-0000-0000-000000000000","quote":"x","prefix":"","suffix":"","startHint":0,"endHint":1}', 'the nil UUID'),
  ('{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"","prefix":"","suffix":"","startHint":0,"endHint":1}', 'an empty quote'),
  ('{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"x","prefix":"","suffix":"","startHint":1,"endHint":1}', 'an empty range'),
  ('{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"x","prefix":"","suffix":"","startHint":-1,"endHint":1}', 'a negative start'),
  ('{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"x","prefix":"","suffix":"","startHint":0.5,"endHint":1}', 'a fractional start'),
  ('{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"x","prefix":"","suffix":"","startHint":"0","endHint":1}', 'a start given as text'),
  ('{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"x","prefix":"","suffix":"","startHint":0,"endHint":1000001}', 'an end past the limit'),
  ('{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"x\u202e","prefix":"","suffix":"","startHint":0,"endHint":1}', 'a right-to-left override'),
  ('{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"x","prefix":"\u0007","suffix":"","startHint":0,"endHint":1}', 'a control character'),
  ('["0f0e0d0c-0b0a-4000-8000-000000000001"]', 'the wrong shape'),
  ('null', 'a JSON null')
) AS a (anchor, what);
SELECT is(pg_temp.ask('vesna', format($$ SELECT collaboration.create_comment('doc-a', 'Tekst.', %L::jsonb) $$,
    jsonb_build_object('nodeId', '0f0e0d0c-0b0a-4000-8000-000000000001', 'quote', repeat('q', l.quote), 'prefix', repeat('p', l.ctx),
      'suffix', '', 'startHint', 0, 'endHint', 1))), 'ZD422: invalid input', 'an anchor with ' || l.what || ' is refused')
FROM (VALUES (501, 0, 'a quote over 500 characters'), (1, 65, 'a prefix over 64 characters')) AS l (quote, ctx, what);
SELECT is(pg_temp.ask('vesna', $$ SELECT collaboration.create_comment('doc-a', 'Tekst.', NULL) $$), 'ZD422: invalid input', 'a missing anchor is refused');
SELECT is(pg_temp.ask('vesna', $$ SELECT collaboration.reply_comment({t1}, '') $$), 'ZD422: invalid input', 'an empty reply is refused');
SELECT is(pg_temp.ask('marko', $$ SELECT collaboration.create_comment('doc-a', '', '[]') $$), 'ZD403: forbidden',
  'a stranger with malformed input still gets only the forbidden answer');
SELECT matches(pg_temp.ask('vesna', format($$ SELECT collaboration.create_comment('doc-a', %L, {anchor}) $$,
    repeat('ž', 1999) || E'\n')), '^[0-9a-f-]{36}$', 'a body of 2000 characters with a line break is accepted');
SELECT matches(pg_temp.ask('vesna', $$ SELECT collaboration.create_comment('doc-a', 'Rizik: sumnjivo citiranje.',
    '{"nodeId":"0F0E0D0C-0B0A-1000-A000-000000000001","quote":"a\tb","prefix":"","suffix":"","startHint":0,"endHint":3}') $$),
  '^[0-9a-f-]{36}$', 'a teacher''s own words are not filtered and an upper-case version-1 node id with a tab is a valid anchor');
-- The table constraints hold even for the owner role, not only in the RPCs.
SELECT matches(pg_temp.ask_as('ductus_identity', 'vesna', format(
    $$ INSERT INTO collaboration.comment (thread_id, institution_id, position, author_id, author_role, body)
       VALUES (%L, {fak_a}, 99, {vesna}, 'teacher', E'a\u202Eb') $$, pg_temp.id('t1'))),
  '^23514', 'the table refuses a forbidden character even from its owner');
SELECT matches(pg_temp.ask_as('ductus_identity', 'vesna',
    $$ UPDATE collaboration.comment_thread SET anchor = '{}' WHERE id = {t1} $$),
  '^23514', 'the table refuses a malformed anchor even from its owner');

-- The web role has no way to the tables (attack 4), even with a mistaken
-- grant: forced RLS without a policy for it shows and changes nothing.
SELECT matches(pg_temp.ask('vesna', $$ SELECT count(*) FROM collaboration.comment $$), '^42501', 'the web role cannot read comments directly');
SELECT matches(pg_temp.ask('vesna', format(
    $$ INSERT INTO collaboration.comment (thread_id, institution_id, position, author_id, author_role, body)
       VALUES (%L, {fak_a}, 50, {ana}, 'student', 'Lažni odgovor.') $$, pg_temp.id('t1'))),
  '^42501', 'the web role cannot write a comment under another name');
SELECT matches(pg_temp.ask('vesna', $$ UPDATE collaboration.comment_thread SET state = 'resolved' $$), '^42501',
  'the web role cannot change a thread directly');
SELECT matches(pg_temp.ask('vesna', $$ DELETE FROM collaboration.comment $$), '^42501', 'the web role cannot delete comments');
GRANT SELECT, INSERT, UPDATE, DELETE ON collaboration.comment, collaboration.comment_thread TO ductus_app;
SELECT is(pg_temp.ask('vesna', $$ SELECT (SELECT count(*) FROM collaboration.comment) + (SELECT count(*) FROM collaboration.comment_thread) $$),
  '0', 'a mistaken SELECT grant still shows the web role no comment');
SELECT matches(pg_temp.ask('vesna', format(
    $$ INSERT INTO collaboration.comment (thread_id, institution_id, position, author_id, author_role, body)
       VALUES (%L, {fak_a}, 50, {ana}, 'student', 'Lažni odgovor.') $$, pg_temp.id('t1'))),
  '^42501: new row violates row-level security policy', 'a mistaken INSERT grant still lets no web write through');
SELECT is(pg_temp.ask('vesna', $$ WITH u AS (UPDATE collaboration.comment_thread SET state = 'resolved' RETURNING 1) SELECT count(*) FROM u $$),
  '0', 'a mistaken UPDATE grant still changes no thread');
SELECT is(pg_temp.ask('vesna', $$ WITH d AS (DELETE FROM collaboration.comment RETURNING 1) SELECT count(*) FROM d $$),
  '0', 'a mistaken DELETE grant still removes no comment');
REVOKE SELECT, INSERT, UPDATE, DELETE ON collaboration.comment, collaboration.comment_thread FROM ductus_app;
SELECT matches(pg_temp.ask('vesna', $$ SELECT collaboration.document_scope('doc-a') $$), '^42501',
  'the web role cannot ask document_scope who owns a document');

-- The evidence is untouched (attack 6), and a changed document keeps its
-- comments: the client decides whether the anchor still holds (attack 7).
SELECT is(pg_temp.evidence_print(), (SELECT v FROM print_before), 'comments change no document, revision, package, segment or receipt');
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
VALUES ('doc-a', pg_temp.id('fak_a'), 1, 0, pg_temp.id('ana'), repeat('9', 64));
UPDATE evidence.document SET current_revision = 1, current_content_hash = repeat('9', 64) WHERE id = 'doc-a';
RESET ROLE;
SELECT is(pg_temp.ask('ana', $$ SELECT count(DISTINCT thread_id) FROM collaboration.list_comments('doc-a') $$), '4',
  'after the document changes every thread is still listed');

-- A teacher who leaves the course loses reading and writing at once (attack 2).
UPDATE institution.course_member SET member_to = now()
WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('vesna') AND member_to IS NULL;
SELECT is(pg_temp.ask('vesna', s.sql), 'ZD403: forbidden', 'a removed teacher can no longer ' || s.what)
FROM (VALUES
  ($$ SELECT count(*) FROM collaboration.list_comments('doc-a') $$, 'read'),
  ($$ SELECT collaboration.create_comment('doc-a', 'Tekst.', {anchor}) $$, 'open a thread'),
  ($$ SELECT collaboration.reply_comment({t1}, 'Tekst.') $$, 'reply'),
  ($$ SELECT collaboration.resolve_thread({t1}) $$, 'resolve')
) AS s (sql, what);
SELECT is(pg_temp.ask('ana', $$ SELECT count(DISTINCT thread_id) FROM collaboration.list_comments('doc-a') $$), '4',
  'the student still reads the threads of the removed teacher');

SELECT * FROM finish();
ROLLBACK;

-- DAN-294 (M10.4-P01, contract on #1091, c.6710676431; plan of attack #1700):
-- app.read_my_access_log shows the owning student who opened her work and
-- when, one row per stored 5-minute interval, reader and surface, newest
-- first, page by page. Nobody else reads it and reading writes nothing.
-- Every person, work, name and time below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
-- evidence-acceptance.inc leaves every constraint IMMEDIATE; mentorship.inc
-- writes an assignment before its first version (as in 038).
SET CONSTRAINTS institution.assignment_current_version_institution_fkey DEFERRED;
\ir fixtures/mentorship.inc
SET CONSTRAINTS institution.assignment_current_version_institution_fkey IMMEDIATE;
SELECT no_plan();

-- Ana's second work (her thesis with Marko, zm1) and Dora's work in Z1.
INSERT INTO ref VALUES
  ('e1', '00000000-0000-4000-8000-0000000000e1'), ('e2', '00000000-0000-4000-8000-0000000000e2'),
  ('e3', '00000000-0000-4000-8000-0000000000e3'), ('e4', '00000000-0000-4000-8000-0000000000e4'),
  ('e5', '00000000-0000-4000-8000-0000000000e5'), ('e6', '00000000-0000-4000-8000-0000000000e6'),
  ('m1', '00000000-0000-4000-8000-0000000000e7'), ('o1', '00000000-0000-4000-8000-0000000000e8'),
  ('d1', '00000000-0000-4000-8000-0000000000e9'), ('t1', '00000000-0000-4000-8000-0000000000ea'),
  ('n1', '00000000-0000-4000-8000-0000000000eb'), ('n2', '00000000-0000-4000-8000-0000000000df');
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES
  ('project-am', pg_temp.id('fak_a'), pg_temp.id('zm1'), pg_temp.id('ana')),
  ('project-d', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('dora'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash) VALUES
  ('doc-am', pg_temp.id('fak_a'), 'project-am', pg_temp.id('ana'), pg_temp.h('a')),
  ('doc-d', pg_temp.id('fak_a'), 'project-d', pg_temp.id('dora'), pg_temp.h('a'));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash) VALUES
  ('doc-am', pg_temp.id('fak_a'), 0, pg_temp.id('ana'), pg_temp.h('a')),
  ('doc-d', pg_temp.id('fak_a'), 0, pg_temp.id('dora'), pg_temp.h('a'));
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;

-- The log as the reads wrote it. Two rows share 12:00 so that the order of
-- equal times is by entry. o1 is a row of doc-a with another owner: the
-- owner filter must hold even against such a row. Marko has no stored name.
SET LOCAL ROLE ductus_identity;
INSERT INTO identity.person_name (user_id, institution_id, given_name, family_name) VALUES
  (pg_temp.id('vesna'), pg_temp.id('fak_a'), 'Vesna', 'Primjerić'),
  (pg_temp.id('petra'), pg_temp.id('fak_b'), 'Petra', 'Izmišljena');
INSERT INTO audit.access_log (id, institution_id, document_id, assignment_id, owner_id, reader_id, reader_role, surface, opened_at)
SELECT pg_temp.id(l.entry), pg_temp.id(l.fak), l.doc, pg_temp.id(l.assignment), pg_temp.id(l.owner), pg_temp.id(l.reader),
       'teacher', l.surface, l.at::timestamptz
FROM (VALUES
  ('e1', 'fak_a', 'doc-a', 'z1', 'ana', 'vesna', 'live_view', '2026-10-19 12:00:00+00'),
  ('e2', 'fak_a', 'doc-a', 'z1', 'ana', 'vesna', 'process_summary', '2026-10-19 12:00:00+00'),
  ('e3', 'fak_a', 'doc-a', 'z1', 'ana', 'vesna', 'live_view', '2026-10-19 12:05:00+00'),
  ('e4', 'fak_a', 'doc-a', 'z1', 'ana', 'marko', 'fast_path', '2026-10-19 12:10:00+00'),
  ('e5', 'fak_a', 'doc-a', 'z1', 'ana', 'vesna', 'replay', '2026-10-20 08:15:00+00'),
  ('m1', 'fak_a', 'doc-am', 'zm1', 'ana', 'marko', 'live_view', '2026-10-19 12:05:00+00'),
  ('o1', 'fak_a', 'doc-a', 'z1', 'dora', 'vesna', 'live_view', '2026-10-19 12:20:00+00'),
  ('d1', 'fak_a', 'doc-d', 'z1', 'dora', 'vesna', 'live_view', '2026-10-19 12:25:00+00'),
  ('t1', 'fak_b', 'doc-b', 'z3', 'tomo', 'petra', 'live_view', '2026-10-19 12:30:00+00')
) AS l (entry, fak, doc, assignment, owner, reader, surface, at);
RESET ROLE;

-- One line per row, in the function's order: entry, time (UTC), surface,
-- role, given name, family name; "-" is NULL; '' is no row.
CREATE FUNCTION pg_temp.log(p_actor text, p_args text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format($q$
    SELECT coalesce(string_agg(concat_ws(' ', coalesce(r.name, l.entry_id::text),
        to_char(l.opened_at AT TIME ZONE 'UTC', 'MM-DD HH24:MI'), l.surface, l.reader_role,
        coalesce(l.reader_given_name, '-'), coalesce(l.reader_family_name, '-')), '; ' ORDER BY l.ordinality), '')
      FROM app.read_my_access_log(%s) WITH ORDINALITY l LEFT JOIN ref r ON r.val = l.entry_id::text $q$, p_args))
$$;

-- Every page from the first to the empty one, following the cursor of the
-- last row of each; returns the entries in order, or the first error.
CREATE FUNCTION pg_temp.walk(p_actor text, p_document text, p_limit integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_at text;
  v_id text;
  v_page text;
  v_all text[] := '{}';
  v_item text;
  v_pages integer := 0;
BEGIN
  LOOP
    v_page := pg_temp.ask(p_actor, format($q$
      SELECT string_agg(coalesce(r.name, l.entry_id::text) || '|' || l.opened_at::text || '|' || l.entry_id::text,
                        ';' ORDER BY l.ordinality)
        FROM app.read_my_access_log(%L, %s, %L::timestamptz, %L::uuid) WITH ORDINALITY l
        LEFT JOIN ref r ON r.val = l.entry_id::text $q$, p_document, p_limit, v_at, v_id));
    EXIT WHEN v_page IS NULL;
    IF v_page ~ '^[0-9A-Z]{5}: ' THEN
      RETURN v_page;
    END IF;
    FOREACH v_item IN ARRAY string_to_array(v_page, ';') LOOP
      v_all := v_all || split_part(v_item, '|', 1);
      v_at := split_part(v_item, '|', 2);
      v_id := split_part(v_item, '|', 3);
    END LOOP;
    v_pages := v_pages + 1;
    IF v_pages > 20 THEN
      RETURN 'more than 20 pages';
    END IF;
  END LOOP;
  RETURN array_to_string(v_all, ' ');
END
$$;

-- Shape: the exact parameters and columns, no count and no duration;
-- STABLE, SECURITY DEFINER, empty search_path, owned by the log's owner.
SELECT is(pg_get_function_arguments('app.read_my_access_log(text, integer, timestamptz, uuid)'::regprocedure),
  'p_document_id text, p_limit integer, p_before_at timestamp with time zone, p_before_id uuid',
  'it takes the work, the page size and the two parts of the cursor, without defaults');
SELECT is(pg_get_function_result('app.read_my_access_log(text, integer, timestamptz, uuid)'::regprocedure),
  'TABLE(entry_id uuid, opened_at timestamp with time zone, surface text, reader_role text, '
  'reader_given_name text, reader_family_name text)',
  'it returns one row per stored opening, with no total of visits and no duration');
SELECT is(
  (SELECT concat_ws(' ', prosecdef, provolatile, 'search_path=""' = ANY (proconfig), pg_get_userbyid(proowner))
     FROM pg_proc WHERE oid = 'app.read_my_access_log(text, integer, timestamptz, uuid)'::regprocedure),
  't s t ductus_identity',
  'SECURITY DEFINER, STABLE, empty search_path, owned by the role that owns the log');
SELECT is(
  ARRAY(SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_identity',
                                   'ductus_evidence', 'ductus_migrator', 'ductus_test_stranger', 'public']) AS r
         WHERE has_function_privilege(r, 'app.read_my_access_log(text, integer, timestamptz, uuid)', 'EXECUTE')),
  ARRAY['ductus_app', 'ductus_identity'],
  'only the web role executes it, besides its owner; PUBLIC does not');

-- Plan 1: the owning student sees her own rows, newest first, with names.
SELECT is(pg_temp.log('ana', $$ 'doc-a', 100, NULL, NULL $$),
  'e5 10-20 08:15 replay teacher Vesna Primjerić; e4 10-19 12:10 fast_path teacher - -; '
  'e3 10-19 12:05 live_view teacher Vesna Primjerić; e2 10-19 12:00 process_summary teacher Vesna Primjerić; '
  'e1 10-19 12:00 live_view teacher Vesna Primjerić',
  'Ana sees every opening of her work, newest first, equal times by entry; a reader without a stored name shows none');
SELECT is(pg_temp.log('ana', $$ 'doc-am', 100, NULL, NULL $$), 'm1 10-19 12:05 live_view teacher - -',
  'her other work has its own rows only');
SELECT is(pg_temp.log('tomo', $$ 'doc-b', 100, NULL, NULL $$), 't1 10-19 12:30 live_view teacher Petra Izmišljena',
  'a student of another institution sees his own');
SELECT is(pg_temp.log('dora', $$ 'doc-d', 100, NULL, NULL $$), 'd1 10-19 12:25 live_view teacher Vesna Primjerić',
  'Dora sees her own work, not the row written against Ana''s');

-- Plan 2 to 4: the same answer for every work that is not the caller's,
-- whoever asks, so the answer tells nothing about whether the work exists.
SELECT is(pg_temp.log(c.actor, format('%L, 100, NULL, NULL', c.doc)), 'ZD403: forbidden', c.why)
FROM (VALUES
  ('dora', 'doc-a', 'a classmate on the same assignment is refused'),
  ('vesna', 'doc-a', 'the teacher who read the work is refused'),
  ('marko', 'doc-a', 'another teacher of the institution is refused'),
  ('marko', 'doc-am', 'the mentor of the work is refused'),
  ('iva', 'doc-a', 'the administrator is refused'),
  ('boris', 'doc-a', 'a student in no course is refused'),
  ('nina', 'doc-a', 'an unconfirmed teacher is refused'),
  ('tomo', 'doc-a', 'a student of another institution is refused'),
  ('petra', 'doc-a', 'a teacher of another institution is refused'),
  ('lea', 'doc-a', 'an administrator of another institution is refused'),
  ('ana', 'doc-b', 'the owner is refused another institution''s work'),
  ('ana', 'doc-d', 'the owner is refused a classmate''s work'),
  ('ana', 'doc-none', 'a work that does not exist is refused alike'),
  ('vesna', 'doc-none', 'and alike for a teacher')
) AS c (actor, doc, why);

-- Plan 5: malformed work identifiers are refused like a foreign work.
SELECT is(pg_temp.log('ana', format('%s, 100, NULL, NULL', c.doc)), 'ZD403: forbidden', c.why)
FROM (VALUES
  ('NULL', 'no work'), ($$''$$, 'an empty identifier'), (format('%L', repeat('a', 257)), 257 || ' characters'),
  ($$E'doc-a\n'$$, 'a control character'), ($$' doc-a'$$, 'a leading blank'), ($$'doc-a '$$, 'a trailing blank')
) AS c (doc, why);

-- Plan 6: the page size and the cursor.
SELECT is(pg_temp.log('ana', format($$ 'doc-a', %s $$, c.args)), 'ZD422: invalid input', c.why)
FROM (VALUES
  ('NULL, NULL, NULL', 'no page size'), ('0, NULL, NULL', 'a page size of 0'),
  ('-1, NULL, NULL', 'a negative page size'), ('101, NULL, NULL', 'a page size above 100'),
  ($$ 10, '2026-10-19 12:05:00+00', NULL $$, 'a cursor time without its entry'),
  ($$ 10, NULL, {e3} $$, 'a cursor entry without its time')
) AS c (args, why);
SELECT is(pg_temp.log('dora', $$ 'doc-a', 0, NULL, NULL $$), 'ZD422: invalid input',
  'a bad page size is refused before the work is looked at, so it tells nothing about the work either');
SELECT is(pg_temp.log('ana', $$ 'doc-a', 1, NULL, NULL $$), 'e5 10-20 08:15 replay teacher Vesna Primjerić',
  'a page size of 1 gives the newest row');
SELECT is(pg_temp.log('ana', $$ 'doc-a', 2, '2026-10-19 12:05:00+00', {e3} $$),
  'e2 10-19 12:00 process_summary teacher Vesna Primjerić; e1 10-19 12:00 live_view teacher Vesna Primjerić',
  'a cursor gives the rows strictly after it');
SELECT is(pg_temp.log('ana', $$ 'doc-a', 2, '2026-10-19 12:05:00+00', {e3} $$),
  'e2 10-19 12:00 process_summary teacher Vesna Primjerić; e1 10-19 12:00 live_view teacher Vesna Primjerić',
  'a page ends on an interval: the second row of 12:00 comes with the first, not on the next page');
SELECT is(pg_temp.log('ana', $$ 'doc-a', 1, '2026-10-19 12:05:00+00', {e3} $$),
  'e2 10-19 12:00 process_summary teacher Vesna Primjerić; e1 10-19 12:00 live_view teacher Vesna Primjerić',
  'so a page may hold more rows than its size, for the rest of its last interval');
SELECT is(pg_temp.log('ana', $$ 'doc-a', 2, '2026-10-19 12:00:00+00', {e2} $$), '',
  'the cursor time is the end of an interval: no row of that time comes after it');
SELECT is(pg_temp.log('ana', $$ 'doc-a', 10, '2026-10-19 12:30:00+00', {t1} $$),
  'e4 10-19 12:10 fast_path teacher - -; e3 10-19 12:05 live_view teacher Vesna Primjerić; '
  'e2 10-19 12:00 process_summary teacher Vesna Primjerić; e1 10-19 12:00 live_view teacher Vesna Primjerić',
  'a cursor taken from another work only marks a position: the rows are still Ana''s own');
SELECT is(pg_temp.walk('ana', 'doc-a', s.size), 'e5 e4 e3 e2 e1', 'walking pages of ' || s.size || ' gives every row once')
FROM unnest(ARRAY[1, 2, 3, 100]) AS s (size);

-- Plan 7: sessions and roles.
SELECT is(pg_temp.log(c.actor, $$ 'doc-a', 100, NULL, NULL $$), 'ZD401: not authenticated', c.why)
FROM (VALUES
  ('anon', 'no session is not authenticated'), ('expired', 'Ana''s expired session is not authenticated'),
  ('closed', 'Ana''s closed session is not authenticated'), ('unknown', 'an unknown session is not authenticated')
) AS c (actor, why);
SELECT is(pg_temp.log('anon', $$ NULL, 0, NULL, NULL $$), 'ZD401: not authenticated',
  'without a session nothing else is checked');
SELECT matches(pg_temp.ask_as(r, 'ana', $$ SELECT count(*)::text FROM app.read_my_access_log('doc-a', 100, NULL, NULL) $$),
  '^42501: ', r || ' gets no answer')
FROM unnest(ARRAY['ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence', 'ductus_test_stranger']) AS r;
CREATE FUNCTION pg_temp.log_with_spoofed_user_id() RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('app.user_id', pg_temp.id('ana')::text, true);
  v := pg_temp.log('dora', $q$ 'doc-a', 100, NULL, NULL $q$);
  PERFORM set_config('app.user_id', '', true);
  RETURN v;
END
$$;
SELECT is(pg_temp.log_with_spoofed_user_id(), 'ZD403: forbidden', 'a forged user-id setting cannot replace the session');

-- Plan 8: reading writes nothing, however often the student looks.
CREATE TEMP TABLE before_reads AS SELECT count(*) AS n FROM audit.access_log;
SELECT is((SELECT count(DISTINCT pg_temp.log('ana', $$ 'doc-a', 100, NULL, NULL $$)) FROM generate_series(1, 5)),
  1::bigint, 'five reads of the owner give the same answer');
SELECT is(pg_temp.log('vesna', $$ 'doc-a', 100, NULL, NULL $$), 'ZD403: forbidden', 'the teacher''s read is refused');
SELECT is((SELECT count(*) FROM audit.access_log), (SELECT n FROM before_reads),
  'reading the log, the owner''s or a refused one, adds no row');

-- Istodobnost (plan 9): a teacher opens the work between two pages. The
-- second page neither repeats a row of the first nor skips one; the new row
-- shows only on a fresh first page.
SELECT is(pg_temp.log('ana', $$ 'doc-a', 2, NULL, NULL $$),
  'e5 10-20 08:15 replay teacher Vesna Primjerić; e4 10-19 12:10 fast_path teacher - -', 'page 1 before the new opening');
SET LOCAL ROLE ductus_identity;
INSERT INTO audit.access_log (id, institution_id, document_id, assignment_id, owner_id, reader_id, reader_role, surface, opened_at)
VALUES (pg_temp.id('n1'), pg_temp.id('fak_a'), 'doc-a', pg_temp.id('z1'), pg_temp.id('ana'), pg_temp.id('vesna'),
        'teacher', 'live_view', '2026-10-21 09:00:00+00');
RESET ROLE;
SELECT is(pg_temp.log('ana', $$ 'doc-a', 2, '2026-10-19 12:10:00+00', {e4} $$),
  'e3 10-19 12:05 live_view teacher Vesna Primjerić; e2 10-19 12:00 process_summary teacher Vesna Primjerić; '
  'e1 10-19 12:00 live_view teacher Vesna Primjerić',
  'page 2 after the new opening continues where page 1 ended, to the end of the 12:00 interval');
SELECT is(pg_temp.walk('ana', 'doc-a', 2), 'n1 e5 e4 e3 e2 e1', 'a fresh walk starts with the new opening and repeats nothing');

-- Istodobnost, the same interval (QA c.6711590695): a page of 1 ends on the
-- newest interval; another opening is then written in that same interval
-- with a smaller entry. The next page must not take it: it shows only on a
-- fresh first page, which holds the whole interval.
SELECT is(pg_temp.log('ana', $$ 'doc-a', 1, NULL, NULL $$), 'n1 10-21 09:00 live_view teacher Vesna Primjerić',
  'page 1 of size 1 before the second opening in its interval');
SET LOCAL ROLE ductus_identity;
INSERT INTO audit.access_log (id, institution_id, document_id, assignment_id, owner_id, reader_id, reader_role, surface, opened_at)
VALUES (pg_temp.id('n2'), pg_temp.id('fak_a'), 'doc-a', pg_temp.id('z1'), pg_temp.id('ana'), pg_temp.id('marko'),
        'teacher', 'live_view', '2026-10-21 09:00:00+00');
RESET ROLE;
SELECT ok(pg_temp.id('n2') < pg_temp.id('n1'), 'the new opening has the same time and a smaller entry');
SELECT is(pg_temp.log('ana', $$ 'doc-a', 1, '2026-10-21 09:00:00+00', {n1} $$),
  'e5 10-20 08:15 replay teacher Vesna Primjerić',
  'the next page does not take an opening written later in the interval of the cursor');
SELECT is(pg_temp.log('ana', $$ 'doc-a', 1, NULL, NULL $$),
  'n1 10-21 09:00 live_view teacher Vesna Primjerić; n2 10-21 09:00 live_view teacher - -',
  'a fresh first page shows it, with the whole interval');
SELECT is(pg_temp.walk('ana', 'doc-a', s.size), 'n1 n2 e5 e4 e3 e2 e1',
  'walking pages of ' || s.size || ' after it gives every row once')
FROM unnest(ARRAY[1, 2, 3, 100]) AS s (size);

-- Istodobnost, two transactions across an interval boundary (QA
-- c.6711877913; the owner's clarification of #1700 point 11, #87
-- c.6711953923): a late committed opening with an older opened_at may show
-- in its place by time, in a continuation too; no row comes twice and none
-- is skipped; one newer than the cursor shows only on a fresh first page.
-- Transaction A (Vesna) runs at 10:05:00 and commits; B (Marko) began at
-- 10:04:59 and commits only after the owner has read page 1 (or 2). Both bin now() as audit.record_work_opening does. pgTAP
-- runs in one transaction, so the moment of a commit is the moment of the
-- insert; each walk runs in a subtransaction that is undone afterwards.
INSERT INTO ref VALUES ('l1', '00000000-0000-4000-8000-0000000000ec'), ('l2', '00000000-0000-4000-8000-0000000000ed');
CREATE FUNCTION pg_temp.opening(p_entry text, p_reader text, p_now timestamptz) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL ROLE ductus_identity;
  INSERT INTO audit.access_log (id, institution_id, document_id, assignment_id, owner_id, reader_id, reader_role, surface, opened_at)
  VALUES (pg_temp.id(p_entry), pg_temp.id('fak_a'), 'doc-a', pg_temp.id('z1'), pg_temp.id('ana'), pg_temp.id(p_reader),
          'teacher', 'live_view', date_bin('5 minutes', p_now, timestamptz '2000-01-01 00:00:00+00'));
  RESET ROLE;
END
$$;
-- Walks Ana's pages of p_size, with B committing after page p_after. Gives
-- the entries the walk returned, ' / ', and a fresh first page of 2 after
-- the walk; then undoes B and A, so each call starts from the same log.
CREATE FUNCTION pg_temp.walk_late(p_size integer, p_after integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_at text;
  v_id text;
  v_page text;
  v_all text[] := '{}';
  v_item text;
  v_pages integer := 0;
  v_result text;
BEGIN
  BEGIN
    PERFORM pg_temp.opening('l1', 'vesna', '2026-10-22 10:05:00+00');
    LOOP
      v_page := pg_temp.ask('ana', format($q$
        SELECT string_agg(coalesce(r.name, l.entry_id::text) || '|' || l.opened_at::text || '|' || l.entry_id::text,
                          ';' ORDER BY l.ordinality)
          FROM app.read_my_access_log('doc-a', %s, %L::timestamptz, %L::uuid) WITH ORDINALITY l
          LEFT JOIN ref r ON r.val = l.entry_id::text $q$, p_size, v_at, v_id));
      EXIT WHEN v_page IS NULL;
      IF v_page ~ '^[0-9A-Z]{5}: ' THEN
        v_all := ARRAY[v_page];
        EXIT;
      END IF;
      FOREACH v_item IN ARRAY string_to_array(v_page, ';') LOOP
        v_all := v_all || split_part(v_item, '|', 1);
        v_at := split_part(v_item, '|', 2);
        v_id := split_part(v_item, '|', 3);
      END LOOP;
      v_pages := v_pages + 1;
      IF v_pages = p_after THEN
        PERFORM pg_temp.opening('l2', 'marko', '2026-10-22 10:04:59+00');
      END IF;
      IF v_pages > 20 THEN
        v_all := ARRAY['more than 20 pages'];
        EXIT;
      END IF;
    END LOOP;
    v_result := array_to_string(v_all, ' ') || ' / ' || pg_temp.log('ana', $q$ 'doc-a', 2, NULL, NULL $q$);
    RAISE EXCEPTION USING ERRCODE = 'ZT001';
  EXCEPTION WHEN SQLSTATE 'ZT001' THEN
    RETURN v_result;
  END;
END
$$;
SELECT is(date_bin('5 minutes', timestamptz '2026-10-22 10:04:59+00', timestamptz '2000-01-01 00:00:00+00')
          || ' ' || date_bin('5 minutes', timestamptz '2026-10-22 10:05:00+00', timestamptz '2000-01-01 00:00:00+00'),
  (timestamptz '2026-10-22 10:00:00+00')::text || ' ' || (timestamptz '2026-10-22 10:05:00+00')::text,
  'B began in the interval before A''s, which is the newest');
SELECT is(pg_temp.walk_late(1, 1),
  'l1 l2 n1 n2 e5 e4 e3 e2 e1 / l1 10-22 10:05 live_view teacher Vesna Primjerić; l2 10-22 10:00 live_view teacher - -',
  'pages of 1: B''s opening, older than the cursor, comes in the continuation in its place, once; nothing repeats');
SELECT is(pg_temp.walk_late(s.size, 1),
  'l1 n1 n2 e5 e4 e3 e2 e1 / l1 10-22 10:05 live_view teacher Vesna Primjerić; l2 10-22 10:00 live_view teacher - -',
  'pages of ' || s.size || ': B''s opening is newer than the cursor, so only a fresh first page shows it; nothing repeats or is skipped')
FROM unnest(ARRAY[2, 3, 100]) AS s (size);
SELECT is(pg_temp.walk_late(1, 2),
  'l1 n1 n2 e5 e4 e3 e2 e1 / l1 10-22 10:05 live_view teacher Vesna Primjerić; l2 10-22 10:00 live_view teacher - -',
  'pages of 1, B committing after page 2: newer than the cursor, only on a fresh first page');
SELECT is(pg_temp.walk('ana', 'doc-a', s.size), 'n1 n2 e5 e4 e3 e2 e1',
  'each walk above is undone: pages of ' || s.size || ' give the log as before')
FROM unnest(ARRAY[1, 100]) AS s (size);

SELECT * FROM finish();
ROLLBACK;

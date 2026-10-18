-- B-LIVE / DAN-216: the live view (docs/BACKEND.md 4.12, step 2). The rows of
-- the pgTAP matrix in 4.12 are the acceptance criteria; every person, course
-- and text below is invented.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';
SELECT no_plan();

-- Documents of Ana and Dora on Z1 (fak-a) and of Tomo on Z3 (fak-b), as the
-- evidence role writes them.
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.domain (id, institution_id, region) VALUES
  ('00000000-0000-4000-8000-0000000000d1', pg_temp.id('fak_a'), 'eu-central-1'),
  ('00000000-0000-4000-8000-0000000000d2', pg_temp.id('fak_b'), 'eu-central-1');
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

-- Everything the evidence schema holds, as one value (4.12 point 9).
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
CREATE FUNCTION pg_temp.hex_sha(p_body text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to(p_body, 'UTF8')), 'hex') $$;
-- A read as one line, to compare student and teacher byte for byte.
CREATE FUNCTION pg_temp.read_as(p_actor text, p_document text, p_known text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    $q$ SELECT format('%%s|%%s|%%s', outcome, content_hash, body) FROM collaboration.read_live_state(%L, %L) $q$,
    p_document, p_known))
$$;
CREATE FUNCTION pg_temp.publish_as(p_actor text, p_document text, p_token text, p_body text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    $q$ SELECT format('%%s|%%s', outcome, write_token) FROM collaboration.publish_live_state(%L, %L, %L) $q$,
    p_document, p_token, p_body))
$$;
CREATE FUNCTION pg_temp.stored(p_document text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT format('%s|%s', write_token, body) FROM collaboration.live_state WHERE document_id = p_document), 'none')
$$;

INSERT INTO ref VALUES
  ('b1', '{"content":[{"type":"paragraph"}],"type":"doc"}'),
  ('b2', '{"content":[{"content":[{"text":"Prva rečenica.","type":"text"}],"type":"paragraph"}],"type":"doc"}'),
  ('b3', '{"content":[{"content":[{"text":"Druga rečenica.","type":"text"}],"type":"paragraph"}],"type":"doc"}');
CREATE FUNCTION pg_temp.val(p_name text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT val FROM ref WHERE name = p_name $$;

-- Catalogue: ownership, RLS, who may do what, and what the output holds.
SELECT row_eq(
  $$ SELECT relowner::regrole::text, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'collaboration.live_state'::regclass $$,
  ROW('ductus_identity'::text, true, true), 'the identity role owns live_state and RLS is enabled and forced');
SELECT bag_eq(
  $$ SELECT polname::text, polroles::regrole[]::text FROM pg_policy WHERE polrelid = 'collaboration.live_state'::regclass $$,
  $$ VALUES ('live_state_owner', '{ductus_identity}') $$, 'the only policy is the owner''s');
SELECT is_empty(
  $$ SELECT a.grantee::regrole::text FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid = 'collaboration.live_state'::regclass AND a.grantee <> c.relowner $$,
  'no role but the owner has any privilege on live_state');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p
  CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence', 'ductus_migrator']) AS r
  WHERE has_table_privilege(r, 'collaboration.live_state', p)
), 'no other role reads or writes live_state directly');
SELECT bag_eq(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.pronamespace = 'collaboration'::regnamespace AND has_function_privilege('ductus_app', p.oid, 'EXECUTE') $$,
  $$ VALUES ('collaboration.create_comment(text,text,jsonb)'), ('collaboration.reply_comment(uuid,text)'),
            ('collaboration.resolve_thread(uuid)'), ('collaboration.reopen_thread(uuid)'),
            ('collaboration.list_comments(text)'), ('collaboration.publish_live_state(text,uuid,text)'),
            ('collaboration.read_live_state(text,text)') $$,
  'the web role executes exactly the comment RPCs and the two live RPCs');
SELECT bag_eq(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.pronamespace = 'collaboration'::regnamespace AND has_function_privilege('ductus_retention', p.oid, 'EXECUTE') $$,
  $$ VALUES ('collaboration.delete_live_state(text,uuid)') $$,
  'the retention role executes only delete_live_state');
SELECT is_empty(
  $$ SELECT r || ' ' || p.oid::regprocedure::text FROM pg_proc p
      CROSS JOIN unnest(ARRAY['ductus_worker', 'ductus_auth', 'ductus_evidence']) AS r
      WHERE p.oid IN ('collaboration.publish_live_state(text,uuid,text)'::regprocedure,
        'collaboration.read_live_state(text,text)'::regprocedure, 'collaboration.delete_live_state(text,uuid)'::regprocedure)
        AND has_function_privilege(r, p.oid, 'EXECUTE') $$,
  'no other runtime role executes a live function');
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.oid IN ('collaboration.publish_live_state(text,uuid,text)'::regprocedure,
        'collaboration.read_live_state(text,text)'::regprocedure, 'collaboration.delete_live_state(text,uuid)'::regprocedure)
        AND (NOT p.prosecdef OR p.proowner <> 'ductus_identity'::regrole OR NOT 'search_path=""' = ANY (p.proconfig)) $$,
  'the three live functions are SECURITY DEFINER functions of the identity role with an empty search_path');
SELECT is(pg_get_function_arguments('collaboration.publish_live_state(text,uuid,text)'::regprocedure),
  'p_document_id text, p_expected_token uuid, p_body text', 'publishing takes no person or institution: they come from the session');
SELECT is(pg_get_function_result('collaboration.read_live_state(text,text)'::regprocedure),
  'TABLE(outcome text, content_hash text, body text)', 'reading returns no token, time or person id');
SELECT bag_eq(
  $$ SELECT attname::text, format_type(atttypid, atttypmod) FROM pg_attribute
      WHERE attrelid = 'collaboration.live_state'::regclass AND attnum > 0 AND NOT attisdropped $$,
  $$ VALUES ('document_id', 'text'), ('institution_id', 'uuid'), ('assignment_id', 'uuid'), ('owner_id', 'uuid'),
            ('body', 'text'), ('content_hash', 'text'), ('write_token', 'uuid') $$,
  'the table has exactly its seven columns: no time, no counter, no history');
SELECT ok(NOT has_schema_privilege('ductus_identity', 'evidence', 'USAGE'), 'the owner of the live functions has no evidence-schema access');

-- The student owner: first write, the same body again, reading.
SELECT is(pg_temp.read_as('ana', 'doc-a', NULL), 'empty||', 'before the first write the owner reads empty');
SELECT is(pg_temp.read_as('vesna', 'doc-a', NULL), 'empty||', 'before the first write the teacher reads the same empty');
INSERT INTO ref SELECT 't1', split_part(pg_temp.publish_as('ana', 'doc-a', NULL, pg_temp.val('b1')), '|', 2);
SELECT is(pg_temp.stored('doc-a'), pg_temp.val('t1') || '|' || pg_temp.val('b1'), 'the first write with no token is accepted and stored');
SELECT matches(pg_temp.val('t1'), '^[0-9a-f-]{36}$', 'the first write returns a token');
SELECT row_eq(
  $$ SELECT institution_id, assignment_id, owner_id, content_hash FROM collaboration.live_state WHERE document_id = 'doc-a' $$,
  ROW(pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('ana'), pg_temp.hex_sha(pg_temp.val('b1'))),
  'institution, assignment and owner come from the document, the hash from the database');
SELECT is(pg_temp.publish_as('ana', 'doc-a', pg_temp.val('t1'), pg_temp.val('b1')), 'unchanged|' || pg_temp.val('t1'),
  'the same body with the valid token is unchanged with the current token');
SELECT is(pg_temp.publish_as('ana', 'doc-a', '00000000-0000-4000-8000-00000000beef', pg_temp.val('b1')), 'unchanged|' || pg_temp.val('t1'),
  'the same body with a stale token is unchanged with the current token');
SELECT is(pg_temp.publish_as('ana', 'doc-a', NULL, pg_temp.val('b1')), 'unchanged|' || pg_temp.val('t1'),
  'the same body with no token is unchanged with the current token');
SELECT is(pg_temp.stored('doc-a'), pg_temp.val('t1') || '|' || pg_temp.val('b1'), 'an unchanged write keeps the token');
SELECT is(pg_temp.read_as('ana', 'doc-a', NULL), 'state|' || pg_temp.hex_sha(pg_temp.val('b1')) || '|' || pg_temp.val('b1'),
  'the owner reads the state with the same bytes');

-- A new body, stale and missing tokens.
INSERT INTO ref SELECT 't2', split_part(pg_temp.publish_as('ana', 'doc-a', pg_temp.val('t1'), pg_temp.val('b2')), '|', 2);
SELECT is(pg_temp.stored('doc-a'), pg_temp.val('t2') || '|' || pg_temp.val('b2'), 'a new body with the valid token is accepted');
SELECT isnt(pg_temp.val('t2'), pg_temp.val('t1'), 'an accepted write gets a new token');
SELECT is(pg_temp.publish_as('ana', 'doc-a', pg_temp.val('t1'), pg_temp.val('b3')), 'conflict|' || pg_temp.val('t2'),
  'a stale token is a conflict with the current token');
SELECT is(pg_temp.publish_as('ana', 'doc-a', NULL, pg_temp.val('b3')), 'conflict|' || pg_temp.val('t2'),
  'no token while a state exists is a conflict with the current token');
SELECT is(pg_temp.stored('doc-a'), pg_temp.val('t2') || '|' || pg_temp.val('b2'), 'a conflict writes nothing');

-- One reading for everyone who may read (PRODUCT 5, rule 5).
SELECT is(pg_temp.read_as('vesna', 'doc-a', NULL), pg_temp.read_as('ana', 'doc-a', NULL),
  'the teacher reads byte for byte what the student reads');
SELECT is(pg_temp.read_as('vesna', 'doc-a', NULL), 'state|' || pg_temp.hex_sha(pg_temp.val('b2')) || '|' || pg_temp.val('b2'),
  'the reading is the latest accepted state');
SELECT is(pg_temp.read_as(a.name, 'doc-a', pg_temp.hex_sha(pg_temp.val('b2'))), 'unchanged|' || pg_temp.hex_sha(pg_temp.val('b2')) || '|',
  a.name || ' with the current hash gets unchanged without a body')
FROM (VALUES ('ana'), ('vesna')) AS a (name);
SELECT is(pg_temp.read_as('vesna', 'doc-a', pg_temp.hex_sha(pg_temp.val('b1'))), pg_temp.read_as('vesna', 'doc-a', NULL),
  'an older hash gets the whole state');

-- The teacher reads and may not publish.
SELECT is(pg_temp.publish_as('vesna', 'doc-a', pg_temp.val('t2'), pg_temp.val('b3')), 'ZD403: forbidden', 'the teacher cannot publish');

-- Nobody else, with valid or malformed input; a missing document is the same.
SELECT is(pg_temp.read_as(a.name, 'doc-a', k.known), 'ZD403: forbidden',
  a.name || ' cannot read Ana''s state' || k.what)
FROM (VALUES ('dora'), ('marko'), ('iva'), ('petra'), ('tomo'), ('boris'), ('nina'), ('lea')) AS a (name)
CROSS JOIN (VALUES (NULL, ''), ('nije-hash', ', even with a malformed hash')) AS k (known, what);
SELECT is(pg_temp.publish_as(a.name, 'doc-a', k.token, k.body), 'ZD403: forbidden',
  a.name || ' cannot publish on Ana''s document' || k.what)
FROM (VALUES ('dora'), ('marko'), ('iva'), ('petra'), ('tomo'), ('boris'), ('nina'), ('lea')) AS a (name)
CROSS JOIN (VALUES (NULL, pg_temp.val('b3'), ''), (NULL, '', ', even with an empty body')) AS k (token, body, what);
SELECT is(pg_temp.read_as('ana', 'doc-nema', NULL), 'ZD403: forbidden', 'reading a missing document is forbidden');
SELECT is(pg_temp.publish_as('ana', 'doc-nema', NULL, pg_temp.val('b1')), 'ZD403: forbidden', 'publishing on a missing document is forbidden');
SELECT is(pg_temp.read_as('vesna', 'doc-b', NULL), 'ZD403: forbidden', 'a teacher cannot read a state of another institution');
SELECT matches(pg_temp.read_as(t.name, 'doc-a', NULL), '^ZD401', 'reading with session ' || t.name || ' is not signed in')
FROM (VALUES ('anon'), ('expired'), ('closed'), ('unknown')) AS t (name);
SELECT matches(pg_temp.publish_as(t.name, 'doc-a', NULL, pg_temp.val('b1')), '^ZD401', 'publishing with session ' || t.name || ' is not signed in')
FROM (VALUES ('anon'), ('expired'), ('closed'), ('unknown')) AS t (name);

-- Input of the owner: refused without echo, after authorisation.
SELECT is(pg_temp.publish_as('ana', 'doc-a', pg_temp.val('t2'), b.body), 'ZD422: invalid input', 'a body that is ' || b.what || ' is refused')
FROM (VALUES ('', 'empty'), (NULL, 'missing'), (repeat('a', 2097153), 'one byte over 2 MiB'),
             (repeat('ž', 1048577), 'over 2 MiB in bytes though not in characters')) AS b (body, what);
SELECT is(pg_temp.read_as('ana', 'doc-a', k.known), 'ZD422: invalid input', 'a known hash that is ' || k.what || ' is refused')
FROM (VALUES ('abc', 'too short'), (upper(repeat('ab', 32)), 'upper case'), (repeat('g', 64), 'not hex'),
             (repeat('a', 64) || ' ', 'followed by a blank')) AS k (known, what);
SELECT is(pg_temp.stored('doc-a'), pg_temp.val('t2') || '|' || pg_temp.val('b2'), 'refused input writes nothing');
INSERT INTO ref SELECT 't3', split_part(pg_temp.publish_as('ana', 'doc-a', pg_temp.val('t2'), repeat('ž', 1048576)), '|', 2);
SELECT is((SELECT octet_length(body) || '|' || write_token FROM collaboration.live_state WHERE document_id = 'doc-a'),
  '2097152|' || pg_temp.val('t3'), 'a body of exactly 2 MiB is accepted');

-- A token for a state that does not exist yet: conflict with no token, nothing
-- written (review of #453, finding on 4.12 point 3; narrowest reading).
SELECT is(pg_temp.publish_as('tomo', 'doc-b', '00000000-0000-4000-8000-00000000beef', pg_temp.val('b1')), 'conflict|',
  'a token without a stored state is a conflict with no current token');
SELECT is(pg_temp.stored('doc-b'), 'none', 'that conflict writes nothing');
INSERT INTO ref SELECT 'tb', split_part(pg_temp.publish_as('tomo', 'doc-b', NULL, pg_temp.val('b3')), '|', 2);
SELECT is(pg_temp.stored('doc-b'), pg_temp.val('tb') || '|' || pg_temp.val('b3'), 'the student of the other institution publishes with no token');
SELECT is(pg_temp.read_as('petra', 'doc-b', NULL), pg_temp.read_as('tomo', 'doc-b', NULL), 'his teacher reads what he reads');

-- The notice: without the current version acknowledged no publishing, reading
-- stays. Dora acknowledged only the first version of Z1.
SELECT is(pg_temp.publish_as('dora', 'doc-d', NULL, pg_temp.val('b1')), 'ZD403: forbidden',
  'an owner without the current notice acknowledged cannot publish');
SELECT is(pg_temp.read_as('dora', 'doc-d', NULL), 'empty||', 'she still reads her own state');
SELECT is(pg_temp.ask('vesna', $$ SELECT institution.publish_assignment_version({z1}, 2, 'Z1', 'Nove upute za izmišljeni zadatak.',
    'essay', now(), now() + interval '30 days', 'partially_allowed', '{proofreading}', 'extended', true) $$), '3',
  'the teacher publishes a third version of Z1');
SELECT is(pg_temp.publish_as('ana', 'doc-a', pg_temp.val('t3'), pg_temp.val('b2')), 'ZD403: forbidden',
  'after a new version of the assignment the owner cannot publish until she acknowledges it');
SELECT is(pg_temp.read_as('ana', 'doc-a', NULL), pg_temp.read_as('vesna', 'doc-a', NULL), 'reading stays allowed');
SELECT matches(pg_temp.ask('dora', $$ SELECT institution.acknowledge_notice({z1}, 3) $$), '^[0-9]{4}-', 'Dora acknowledges the third version');
SELECT matches(pg_temp.publish_as('dora', 'doc-d', NULL, pg_temp.val('b1')), '^accepted\|', 'with the current notice acknowledged she publishes');

-- Direct access to the table (4.12 point 2): refused, and with a mistaken
-- grant forced RLS still shows and changes nothing.
SELECT matches(pg_temp.ask_as(r.role, 'ana', s.sql), '^42501', r.role || ' cannot ' || s.what || ' live_state directly')
FROM (VALUES ('ductus_app'), ('ductus_worker'), ('ductus_retention')) AS r (role)
CROSS JOIN (VALUES
  ($$ SELECT count(*) FROM collaboration.live_state $$, 'read'),
  ($$ INSERT INTO collaboration.live_state VALUES ('doc-x', {fak_a}, {z1}, {ana}, 'x', '', {nobody}) $$, 'insert into'),
  ($$ UPDATE collaboration.live_state SET body = 'x' $$, 'update'),
  ($$ DELETE FROM collaboration.live_state $$, 'delete from')
) AS s (sql, what);
GRANT USAGE ON SCHEMA collaboration TO ductus_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON collaboration.live_state TO ductus_app, ductus_worker, ductus_retention;
SELECT is(pg_temp.ask_as(r.role, 'ana', $$ SELECT count(*) FROM collaboration.live_state $$), '0',
  'a mistaken SELECT grant still shows ' || r.role || ' no state')
FROM (VALUES ('ductus_app'), ('ductus_worker'), ('ductus_retention')) AS r (role);
SELECT matches(pg_temp.ask_as(r.role, 'ana', format(
    $$ INSERT INTO collaboration.live_state VALUES ('doc-x', {fak_a}, {z1}, {ana}, 'x', %L, {nobody}) $$, pg_temp.hex_sha('x'))),
  '^42501: new row violates row-level security policy', 'a mistaken INSERT grant still lets ' || r.role || ' write nothing')
FROM (VALUES ('ductus_app'), ('ductus_worker'), ('ductus_retention')) AS r (role);
SELECT is(pg_temp.ask_as(r.role, 'ana', $$ WITH u AS (UPDATE collaboration.live_state SET write_token = {nobody} RETURNING 1) SELECT count(*) FROM u $$),
  '0', 'a mistaken UPDATE grant still lets ' || r.role || ' change nothing')
FROM (VALUES ('ductus_app'), ('ductus_worker'), ('ductus_retention')) AS r (role);
SELECT is(pg_temp.ask_as(r.role, 'ana', $$ WITH d AS (DELETE FROM collaboration.live_state RETURNING 1) SELECT count(*) FROM d $$),
  '0', 'a mistaken DELETE grant still lets ' || r.role || ' remove nothing')
FROM (VALUES ('ductus_app'), ('ductus_worker'), ('ductus_retention')) AS r (role);
REVOKE SELECT, INSERT, UPDATE, DELETE ON collaboration.live_state FROM ductus_app, ductus_worker, ductus_retention;
REVOKE USAGE ON SCHEMA collaboration FROM ductus_worker;

-- The table constraints hold even for the owner role, not only in the RPCs.
SELECT matches(pg_temp.ask_as('ductus_identity', 'ana', format(
    $$ INSERT INTO collaboration.live_state VALUES ('doc-x', {fak_a}, {z1}, {ana}, %L, %L, {nobody}) $$, c.body, pg_temp.hex_sha(c.body))),
  '^23514', 'the table refuses ' || c.what || ' even from its owner')
FROM (VALUES ('', 'an empty body'), (repeat('a', 2097153), 'a body over 2 MiB')) AS c (body, what);
SELECT matches(pg_temp.ask_as('ductus_identity', 'ana',
    $$ INSERT INTO collaboration.live_state VALUES ('doc-x', {fak_a}, {z1}, {ana}, 'x', repeat('0', 64), {nobody}) $$),
  '^23514', 'the table refuses a hash that does not match the body');
SELECT matches(pg_temp.ask_as('ductus_identity', 'ana',
    $$ UPDATE collaboration.live_state SET body = 'drukčije' WHERE document_id = 'doc-a' $$),
  '^23514', 'the table refuses a body changed without its hash');
SELECT matches(pg_temp.ask_as('ductus_identity', 'ana',
    $$ INSERT INTO collaboration.live_state VALUES ('doc-x', {fak_a}, {z3}, {ana}, 'x', encode(sha256('x'), 'hex'), {nobody}) $$),
  '^23503', 'the table refuses an assignment of another institution');

-- Deleting under retention (4.12 point 2): only the retention role, only the
-- named document of the named institution.
SELECT matches(pg_temp.ask('ana', $$ SELECT collaboration.delete_live_state('doc-a', {fak_a}) $$), '^42501',
  'the web role cannot execute delete_live_state');
SELECT is(pg_temp.ask_as('ductus_retention', 'anon', $$ SELECT 'done' FROM collaboration.delete_live_state('doc-b', {fak_a}) $$), 'done',
  'deleting a document under the wrong institution runs');
SELECT isnt(pg_temp.stored('doc-b'), 'none', 'and deletes nothing');
SELECT is(pg_temp.ask_as('ductus_retention', 'anon', $$ SELECT 'done' FROM collaboration.delete_live_state('doc-a', {fak_a}) $$), 'done',
  'the retention role deletes the state of a document');
SELECT is((SELECT count(*)::integer FROM collaboration.live_state WHERE document_id = 'doc-a'), 0, 'no row is left for that document');
SELECT is((SELECT count(*)::integer FROM collaboration.live_state WHERE document_id IN ('doc-b', 'doc-d')), 2, 'the other documents keep theirs');
SELECT is(pg_temp.ask_as('ductus_retention', 'anon', $$ SELECT 'done' FROM collaboration.delete_live_state('doc-a', {fak_a}) $$), 'done',
  'deleting again without a row does nothing');
SELECT is(pg_temp.read_as('vesna', 'doc-a', NULL), 'empty||', 'after deletion the teacher reads empty');

-- The evidence is untouched (4.12 point 9).
SELECT is(pg_temp.evidence_print(), (SELECT v FROM print_before),
  'publishing, reading and deleting change no document, revision, package, segment or receipt');

-- A removed teacher or student loses access at the next call (4.12 point 8).
UPDATE institution.course_member SET member_to = now()
WHERE course_id = pg_temp.id('k3') AND user_id = pg_temp.id('petra') AND member_to IS NULL;
SELECT is(pg_temp.read_as('petra', 'doc-b', NULL), 'ZD403: forbidden', 'a teacher with a closed membership cannot read');
UPDATE institution.course_member SET member_to = now()
WHERE course_id = pg_temp.id('k3') AND user_id = pg_temp.id('tomo') AND member_to IS NULL;
SELECT is(pg_temp.read_as('tomo', 'doc-b', NULL), 'ZD403: forbidden', 'a removed student cannot read his state');
SELECT is(pg_temp.publish_as('tomo', 'doc-b', pg_temp.val('tb'), pg_temp.val('b1')), 'ZD403: forbidden', 'nor publish');

SELECT * FROM finish();
ROLLBACK;

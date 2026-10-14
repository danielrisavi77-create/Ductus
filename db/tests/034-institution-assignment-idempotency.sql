-- A repeated teacher request has one assignment, even when the first response
-- is lost; a key cannot silently name different immutable content (DAN-35).
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';

SELECT plan(14);

CREATE FUNCTION pg_temp.create_with_key(p_actor text, p_course text, p_key text, p_title text DEFAULT 'Esej o izmišljenoj temi')
RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.ask(p_actor, format(
    'SELECT institution.create_assignment(%s, %L, %L, %L, %L, %L, %L, %L, %L::text[], %L, %L)',
    p_course, p_key, p_title, 'Prvi red uputa.', 'essay', '2026-11-02 08:00+01', '2026-12-01 23:59+01',
    'partially_allowed', '{proofreading}', 'basic', false))
$f$;

SELECT is(
  pg_temp.ask('anon', $$ SELECT institution.create_assignment({k1}, '00000000-0000-4000-8000-000000000001',
    'Esej', 'Upute', 'essay', now(), now() + interval '1 day', 'partially_allowed', '{proofreading}', 'basic', false) $$),
  'ZD401: not authenticated', 'an anonymous caller cannot reserve a request key'
);
SELECT is(
  pg_temp.create_with_key('ana', '{k1}', '00000000-0000-4000-8000-000000000001'),
  'ZD403: forbidden', 'a student cannot create an assignment through the idempotent function'
);
SELECT is(
  pg_temp.ask('vesna', $$ SELECT institution.create_assignment({k1}, NULL, 'Esej', 'Upute', 'essay', now(),
    now() + interval '1 day', 'partially_allowed', '{proofreading}', 'basic', false) $$),
  'ZD422: invalid input', 'a request key is required'
);

CREATE TEMP TABLE first_request AS
SELECT pg_temp.create_with_key('vesna', '{k1}', '00000000-0000-4000-8000-000000000001') AS id;
SELECT matches((SELECT id FROM first_request), '^[0-9a-f-]{36}$', 'a teacher creates one assignment with a request key');
SELECT is(
  pg_temp.create_with_key('vesna', '{k1}', '00000000-0000-4000-8000-000000000001'),
  (SELECT id FROM first_request), 'an identical retry returns the original assignment ID'
);
SELECT is(
  pg_temp.create_with_key('vesna', '{k1}', '00000000-0000-4000-8000-000000000001', 'Drugi naslov'),
  'ZD409: conflict', 'the same key cannot silently change the title'
);
SELECT is(
  (SELECT count(*) FROM institution.assignment WHERE created_by = pg_temp.id('vesna') AND request_id = '00000000-0000-4000-8000-000000000001'),
  1::bigint, 'the original key has one assignment row'
);
SELECT is(
  (SELECT count(*) FROM institution.assignment_version v JOIN first_request f ON v.assignment_id::text = f.id),
  1::bigint, 'the assignment and immutable first version were committed together'
);

CREATE TEMP TABLE petra_request AS
SELECT pg_temp.create_with_key('petra', '{k3}', '00000000-0000-4000-8000-000000000001', 'Esej Petre') AS id;
SELECT is(
  (SELECT id FROM petra_request),
  (SELECT id::text FROM institution.assignment WHERE created_by = pg_temp.id('petra') AND request_id = '00000000-0000-4000-8000-000000000001'),
  'the same UUID key is independent for another authenticated creator'
);
SELECT is(
  (SELECT count(*) FROM institution.assignment WHERE request_id = '00000000-0000-4000-8000-000000000001'),
  2::bigint, 'the key is unique per creator, not globally'
);
SELECT is(
  pg_temp.ask('vesna', $$ SELECT institution.publish_assignment_version({z1}, 2, 'Nova verzija',
    'Prvi red uputa.', 'essay', '2026-11-02 08:00+01', '2026-12-01 23:59+01',
    'partially_allowed', '{proofreading}', 'basic', false) $$),
  '3', 'fixture publication still works alongside the overload'
);
SELECT is(
  pg_temp.create_with_key('vesna', '{k1}', '00000000-0000-4000-8000-000000000001'),
  (SELECT id FROM first_request), 'a retry still identifies the original assignment after later versions'
);
SELECT is(
  has_function_privilege('ductus_app',
    'institution.create_assignment(uuid,uuid,text,text,text,timestamptz,timestamptz,text,text[],text,boolean)', 'EXECUTE'),
  true, 'ductus_app may call the overload'
);
SELECT is(
  has_function_privilege('ductus_test_stranger',
    'institution.create_assignment(uuid,uuid,text,text,text,timestamptz,timestamptz,text,text[],text,boolean)', 'EXECUTE'),
  false, 'PUBLIC may not call the overload'
);

SELECT * FROM finish();
ROLLBACK;

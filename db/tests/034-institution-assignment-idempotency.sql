-- A repeated teacher request has one assignment, even when the first response
-- is lost; a key cannot silently name different immutable content (DAN-35).
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';

SELECT plan(29);

CREATE FUNCTION pg_temp.create_with_key(
  p_actor text, p_course text, p_key text, p_title text DEFAULT 'Esej o izmišljenoj temi',
  p_instructions text DEFAULT 'Prvi red uputa.', p_work_type text DEFAULT 'essay',
  p_opens_at text DEFAULT '2026-11-02 08:00+01', p_due_at text DEFAULT '2026-12-01 23:59+01',
  p_ai_policy text DEFAULT 'partially_allowed', p_ai_purposes text[] DEFAULT ARRAY['proofreading']::text[],
  p_evidence_profile text DEFAULT 'basic', p_import_allowed boolean DEFAULT false
)
RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.ask(p_actor, format(
    'SELECT institution.create_assignment(%s, %L::uuid, %L, %L, %L, %L::timestamptz, %L::timestamptz, %L, %L::text[], %L, %L)',
    p_course, p_key, p_title, p_instructions, p_work_type, p_opens_at, p_due_at,
    p_ai_policy, p_ai_purposes, p_evidence_profile, p_import_allowed))
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
SELECT is(
  pg_temp.create_with_key('petra', '{k1}', '00000000-0000-4000-8000-000000000042'),
  'ZD403: forbidden', 'a teacher from another tenant cannot create on this course'
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
SELECT is(pg_temp.create_with_key('vesna', '{k1}', '00000000-0000-4000-8000-000000000001', p_instructions => 'Drugi red uputa.'),
  'ZD409: conflict', 'the same key cannot silently change instructions');
SELECT is(pg_temp.create_with_key('vesna', '{k1}', '00000000-0000-4000-8000-000000000001', p_work_type => 'short_paper'),
  'ZD409: conflict', 'the same key cannot silently change work type');
SELECT is(pg_temp.create_with_key('vesna', '{k1}', '00000000-0000-4000-8000-000000000001', p_opens_at => '2026-11-03 08:00+01'),
  'ZD409: conflict', 'the same key cannot silently change opening time');
SELECT is(pg_temp.create_with_key('vesna', '{k1}', '00000000-0000-4000-8000-000000000001', p_due_at => '2026-12-02 23:59+01'),
  'ZD409: conflict', 'the same key cannot silently change due time');
SELECT is(pg_temp.create_with_key('vesna', '{k1}', '00000000-0000-4000-8000-000000000001', p_ai_purposes => ARRAY['formatting']::text[]),
  'ZD409: conflict', 'the same key cannot silently change AI purposes');
SELECT is(pg_temp.create_with_key('vesna', '{k1}', '00000000-0000-4000-8000-000000000001', p_evidence_profile => 'extended'),
  'ZD409: conflict', 'the same key cannot silently change evidence profile');
SELECT is(pg_temp.create_with_key('vesna', '{k1}', '00000000-0000-4000-8000-000000000001', p_import_allowed => true),
  'ZD409: conflict', 'the same key cannot silently change import policy');
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
  pg_temp.create_with_key('petra', '{k3}', '00000000-0000-4000-8000-000000000001', 'Esej Petre', p_ai_policy => 'encouraged'),
  'ZD409: conflict', 'the same key cannot silently change AI policy'
);
SELECT is(
  (SELECT count(*) FROM institution.assignment WHERE request_id = '00000000-0000-4000-8000-000000000001'),
  2::bigint, 'the key is unique per creator, not globally'
);
SELECT is(
  pg_temp.ask('vesna', format(
    'SELECT institution.publish_assignment_version(%L::uuid, 1, %L, %L, %L, %L::timestamptz, %L::timestamptz, %L, %L::text[], %L, %L)',
    (SELECT id FROM first_request), 'Nova verzija', 'Prvi red uputa.', 'essay', '2026-11-02 08:00+01',
    '2026-12-01 23:59+01', 'partially_allowed', ARRAY['proofreading']::text[], 'basic', false)),
  '2', 'the first request receives a later immutable version'
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

-- Refusals: role and content are checked before a key is reserved, and a
-- refused request leaves no row behind that would hold its key.
SELECT is(
  pg_temp.create_with_key('marko', '{k1}', '00000000-0000-4000-8000-000000000007'),
  'ZD403: forbidden', 'a teacher of another course cannot create on this course'
);
SELECT is(
  pg_temp.create_with_key('vesna', '{k1}', '00000000-0000-4000-8000-000000000007', p_ai_policy => 'encouraged'),
  'ZD422: invalid input', 'an AI policy wider than the course is refused'
);
SELECT is(
  pg_temp.create_with_key('vesna', '{k1}', '00000000-0000-4000-8000-000000000007', p_work_type => 'novel'),
  'ZD422: invalid input', 'an unknown work type is refused'
);
SELECT is(
  pg_temp.create_with_key('vesna', '{k1}', '00000000-0000-4000-8000-000000000007',
    p_opens_at => '2026-12-02 08:00+01', p_due_at => '2026-12-01 23:59+01'),
  'ZD422: invalid input', 'an opening time after the due time is refused'
);
SELECT is(
  (SELECT count(*) FROM institution.assignment WHERE request_id = '00000000-0000-4000-8000-000000000007'),
  0::bigint, 'refused requests reserve no key'
);
SELECT matches(
  pg_temp.create_with_key('vesna', '{k1}', '00000000-0000-4000-8000-000000000007'),
  '^[0-9a-f-]{36}$', 'a key refused for invalid content stays free for a valid request'
);

SELECT * FROM finish();
ROLLBACK;

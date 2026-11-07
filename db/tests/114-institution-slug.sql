-- app.current_institution_slug() (DAN-443, M2.12-P02; plan of attack #1689,
-- C1 to C7; contract on #1091): the slug of the session's own institution,
-- whose configuration record gives the citation style. It takes no
-- parameter, so no request can name another institution; without an open,
-- unexpired session it returns NULL. ductus_app still reads no
-- identity.institution row and learns no other institution's slug.
-- Synthetic fixtures only: every person, name and organisation is invented.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';

SELECT plan(19);

-- Every person of the fixture reads the slug of their own institution, and
-- nothing else, through the web role (C1, C2).
SELECT is_empty(
  $$ SELECT p.name FROM person p
     WHERE pg_temp.ask(p.name, 'SELECT app.current_institution_slug()') IS DISTINCT FROM p.faculty $$,
  'every person reads the slug of their own institution'
);
SELECT is(pg_temp.ask('vesna', 'SELECT app.current_institution_slug()'), 'fak-a', 'vesna (fak-a) reads fak-a');
SELECT is(pg_temp.ask('lea', 'SELECT app.current_institution_slug()'), 'fak-b', 'lea (fak-b) reads fak-b, not fak-a');
SELECT is(pg_temp.ask('tomo', 'SELECT app.current_institution_slug()'), 'fak-b', 'a student of fak-b reads fak-b');

-- No session, an expired, a closed and an unknown session: NULL, never a
-- slug of some institution (C3, C4).
SELECT is(pg_temp.ask(t, 'SELECT coalesce(app.current_institution_slug(), ''-'')'), '-',
  'session "' || t || '" reads no slug')
FROM unnest(ARRAY['anon', 'expired', 'closed', 'unknown']) AS t;

-- Person and slug in one statement agree (C5): the slug is the one of the
-- institution current_actor() names.
SELECT is_empty(
  $$ SELECT p.name FROM person p
     WHERE pg_temp.ask(p.name, 'SELECT a.institution_id::text || ''/'' || app.current_institution_slug()
                                 FROM app.current_actor() a')
           IS DISTINCT FROM p.institution_id::text || '/' || p.faculty $$,
  'current_actor() and the slug read in one statement name the same institution'
);

-- The table itself stays closed to the web role (C6).
SELECT matches(pg_temp.ask('vesna', 'SELECT count(*)::text FROM identity.institution'), '^42501:',
  'ductus_app still cannot read identity.institution');

-- Other roles: denied (C7).
SELECT matches(pg_temp.ask_as('ductus_worker', 'vesna', 'SELECT app.current_institution_slug()'), '^42501:',
  'ductus_worker may not call current_institution_slug');
SELECT matches(pg_temp.ask_as('ductus_test_stranger', 'vesna', 'SELECT app.current_institution_slug()'), '^42501:',
  'a role without grants may not call current_institution_slug');
SELECT is_empty(
  $$ SELECT r.rolname FROM (SELECT rolname::text FROM pg_roles
                            WHERE rolname LIKE 'ductus\_%'
                              AND rolname NOT IN ('ductus_app', 'ductus_identity', 'ductus_app_local')
                            UNION ALL SELECT 'public') AS r (rolname)
     WHERE has_function_privilege(r.rolname, 'app.current_institution_slug()', 'EXECUTE') $$,
  'no role but ductus_app, its local login and the owner, nor PUBLIC, may execute it'
);
SELECT ok(has_function_privilege('ductus_app', 'app.current_institution_slug()', 'EXECUTE'),
  'ductus_app may execute current_institution_slug');

-- Shape of the function.
SELECT ok(p.prosecdef, 'current_institution_slug is SECURITY DEFINER')
FROM pg_proc p WHERE p.oid = 'app.current_institution_slug()'::regprocedure;
SELECT is(pg_get_userbyid(p.proowner)::text, 'ductus_identity', 'current_institution_slug belongs to ductus_identity')
FROM pg_proc p WHERE p.oid = 'app.current_institution_slug()'::regprocedure;
SELECT is(p.proconfig, ARRAY['search_path=""'], 'current_institution_slug runs with an empty search_path')
FROM pg_proc p WHERE p.oid = 'app.current_institution_slug()'::regprocedure;
SELECT is(p.provolatile::text, 's', 'current_institution_slug is STABLE, so it cannot write')
FROM pg_proc p WHERE p.oid = 'app.current_institution_slug()'::regprocedure;
SELECT is(pg_get_function_identity_arguments('app.current_institution_slug()'::regprocedure) || '|'
          || pg_get_function_result('app.current_institution_slug()'::regprocedure), '|text',
  'current_institution_slug takes no parameter and returns one text');

SELECT * FROM finish();
ROLLBACK;

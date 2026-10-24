-- F-113 point 2 (#646): app.work_document_in_assignment answers true only for
-- the caller's own document of that assignment while the caller is a student
-- of it. Personas of institution.inc; doc-a is Ana's work on Z1 (K1, fak-a),
-- doc-b Tomo's work on Z3 (K3, fak-b).
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

-- Execution boundary: an invoker function the web role alone may call.
SELECT ok((SELECT NOT prosecdef AND provolatile = 's' AND 'search_path=""' = ANY(proconfig)
  FROM pg_proc WHERE oid = 'app.work_document_in_assignment(text,uuid)'::regprocedure),
  'the check is SECURITY INVOKER, STABLE, with an empty search_path');
SELECT ok(
  has_function_privilege('ductus_app', 'app.work_document_in_assignment(text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_test_stranger', 'app.work_document_in_assignment(text,uuid)', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = 'app.work_document_in_assignment(text,uuid)'::regprocedure
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'),
  'ductus_app may execute the check, PUBLIC may not');
SELECT is_empty(
  $$ SELECT name FROM unnest((SELECT proargnames FROM pg_proc
       WHERE oid = 'app.work_document_in_assignment(text,uuid)'::regprocedure)) AS name
      WHERE name ~ '(principal|user|institution)' $$,
  'the check takes no identity or institution argument');
SELECT matches(pg_temp.ask_as('ductus_test_stranger', 'ana',
  $$ SELECT app.work_document_in_assignment('doc-a', {z1}) $$),
  '^42501:.*$', 'an unrelated role cannot execute the check');

-- The access matrix: one true, every other caller or pairing false, never an error.
CREATE FUNCTION pg_temp.belongs(p_actor text, p_document text, p_assignment text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format('SELECT app.work_document_in_assignment(%L, %s)',
    p_document, coalesce(quote_literal(pg_temp.id(p_assignment)::text), 'NULL')))
$$;

SELECT is(pg_temp.belongs('ana', 'doc-a', 'z1'), 'true', 'the student''s own document of the assignment');
SELECT is(pg_temp.belongs('tomo', 'doc-b', 'z3'), 'true', 'the same holds in the other institution');
SELECT is(pg_temp.belongs('dora', 'doc-a', 'z1'), 'false', 'another student of the same course');
SELECT is(pg_temp.belongs('vesna', 'doc-a', 'z1'), 'false', 'the teacher of the assignment');
SELECT is(pg_temp.belongs('iva', 'doc-a', 'z1'), 'false', 'the administrator of the institution');
SELECT is(pg_temp.belongs('boris', 'doc-a', 'z1'), 'false', 'a student in no course');
SELECT is(pg_temp.belongs('tomo', 'doc-a', 'z1'), 'false', 'a person of another institution');
SELECT is(pg_temp.belongs('ana', 'doc-b', 'z3'), 'false', 'a document of another institution');
SELECT is(pg_temp.belongs('anon', 'doc-a', 'z1'), 'false', 'no session');
SELECT is(pg_temp.belongs('expired', 'doc-a', 'z1'), 'false', 'an expired session');
SELECT is(pg_temp.belongs('closed', 'doc-a', 'z1'), 'false', 'a closed session');
SELECT is(pg_temp.belongs('ana', 'doc-missing', 'z1'), 'false', 'a document that does not exist');
SELECT is(pg_temp.belongs('ana', 'doc-a', 'nobody'), 'false', 'an assignment that does not exist');
SELECT is(pg_temp.belongs('ana', 'doc-a', 'no-such-name'), 'false', 'a NULL assignment');
SELECT is(pg_temp.ask('ana', $$ SELECT app.work_document_in_assignment(NULL, {z1}) $$), 'false', 'a NULL document');

-- Ana also becomes a student of K2: her document still belongs to Z1 only.
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k2'), pg_temp.id('fak_a'), pg_temp.id('ana'), 'student');
SELECT is(pg_temp.belongs('ana', 'doc-a', 'z2'), 'false', 'the own document named with another assignment of the student');
SELECT is(pg_temp.belongs('ana', 'doc-a', 'z1'), 'true', 'a second membership changes nothing for the first');

-- Removed from K1 (member_to set): the own document no longer answers true.
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('ana') AND member_to IS NULL;
SELECT is(pg_temp.belongs('ana', 'doc-a', 'z1'), 'false', 'a student removed from the course');

SELECT * FROM finish();
ROLLBACK;

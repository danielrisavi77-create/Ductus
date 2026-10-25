-- F-113 decision B, step B2 (#711, contract c.6390760491): app.assignment_works
-- gives the teacher of an assignment the works of the students of its course,
-- and nobody else anything. Personas of institution.inc; doc-a is Ana's work
-- on Z1 (K1, fak-a), doc-b Tomo's on Z3 (K3, fak-b). Added here: doc-d,
-- Dora's work on Z1, doc-a2, Ana's work on Z2 (K2), and doc-v, a document of
-- Vesna, the teacher of K1, on Z1. Everything is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES
  ('project-d', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('dora')),
  ('project-a2', pg_temp.id('fak_a'), pg_temp.id('z2'), pg_temp.id('ana')),
  ('project-v', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('vesna'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash) VALUES
  ('doc-d', pg_temp.id('fak_a'), 'project-d', pg_temp.id('dora'), pg_temp.h('d')),
  ('doc-a2', pg_temp.id('fak_a'), 'project-a2', pg_temp.id('ana'), pg_temp.h('e')),
  ('doc-v', pg_temp.id('fak_a'), 'project-v', pg_temp.id('vesna'), pg_temp.h('f'));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash) VALUES
  ('doc-d', pg_temp.id('fak_a'), 0, pg_temp.id('dora'), pg_temp.h('d')),
  ('doc-a2', pg_temp.id('fak_a'), 0, pg_temp.id('ana'), pg_temp.h('e')),
  ('doc-v', pg_temp.id('fak_a'), 0, pg_temp.id('vesna'), pg_temp.h('f'));
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;

-- The works as "name/document" in the function's own order, or "none". The
-- ids are turned into names here, outside the web role.
CREATE FUNCTION pg_temp.works(p_actor text, p_assignment text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_result text;
  r record;
BEGIN
  v_result := pg_temp.ask(p_actor, format(
    $q$ SELECT coalesce(string_agg(w.student_id::text || '/' || w.document_id, ' ' ORDER BY w.n), 'none')
          FROM app.assignment_works(%s) WITH ORDINALITY AS w (student_id, document_id, n) $q$,
    coalesce(quote_literal(pg_temp.id(p_assignment)::text), 'NULL')));
  FOR r IN SELECT name, id FROM person LOOP
    v_result := replace(v_result, r.id::text, r.name);
  END LOOP;
  RETURN v_result;
END
$$;

-- Catalogue: two owners, the web role reaches only the outer function.
SELECT is(
  (SELECT format('%s %s %s %s', pg_get_userbyid(proowner), prosecdef::text, provolatile, ('search_path=""' = ANY(proconfig))::text)
     FROM pg_proc WHERE oid = 'app.assignment_works(uuid)'::regprocedure),
  'ductus_evidence true s true', 'the list is the evidence role''s, SECURITY DEFINER, STABLE, empty search_path');
SELECT is(
  (SELECT format('%s %s %s %s', pg_get_userbyid(proowner), prosecdef::text, provolatile, ('search_path=""' = ANY(proconfig))::text)
     FROM pg_proc WHERE oid = 'app.teacher_assignment_students(uuid)'::regprocedure),
  'ductus_identity true s true', 'the student helper is the identity role''s, SECURITY DEFINER, STABLE, empty search_path');
SELECT bag_eq(
  $$ SELECT r || ' ' || f FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth',
                                            'ductus_identity', 'ductus_evidence', 'ductus_test_stranger']) AS r
     CROSS JOIN unnest(ARRAY['app.assignment_works(uuid)', 'app.teacher_assignment_students(uuid)']) AS f
     WHERE has_function_privilege(r, f, 'EXECUTE')
       -- Each owner may execute its own function; no other grant is allowed.
       AND (r, f) NOT IN (('ductus_evidence', 'app.assignment_works(uuid)'),
                          ('ductus_identity', 'app.teacher_assignment_students(uuid)')) $$,
  $$ VALUES ('ductus_app app.assignment_works(uuid)'), ('ductus_evidence app.teacher_assignment_students(uuid)') $$,
  'the web role executes the list, only the evidence role the helper');
SELECT is(pg_get_function_result('app.assignment_works(uuid)'::regprocedure),
  'TABLE(student_id uuid, document_id text)', 'the list returns a student and a document, nothing else');
SELECT is((SELECT proargnames[1:pronargs]::text FROM pg_proc WHERE oid = 'app.assignment_works(uuid)'::regprocedure),
  '{p_assignment_id}', 'the list takes only the assignment: no identity or institution argument');
SELECT matches(pg_temp.ask('vesna', $$ SELECT count(*) FROM app.teacher_assignment_students({z1}) $$),
  '^42501:.*$', 'the web role cannot call the helper');
SELECT matches(pg_temp.ask_as('ductus_test_stranger', 'vesna', $$ SELECT count(*) FROM app.assignment_works({z1}) $$),
  '^42501:.*$', 'an unrelated role cannot call the list');

-- The access matrix.
SELECT is(pg_temp.works('vesna', 'z1'), 'ana/doc-a dora/doc-d',
  'the teacher of the course: the works of its students on that assignment, not a teacher''s own document');
SELECT is(pg_temp.works('petra', 'z3'), 'tomo/doc-b', 'the same holds in the other institution');
SELECT is(pg_temp.works('marko', 'z2'), 'none', 'a teacher of the course where no student has a membership gets nothing');
SELECT is(pg_temp.works('marko', 'z1'), 'none', 'a teacher of another course of the same institution');
SELECT is(pg_temp.works('petra', 'z1'), 'none', 'a teacher of another institution');
SELECT is(pg_temp.works('vesna', 'z3'), 'none', 'the teacher asking for another institution''s assignment');
SELECT is(pg_temp.works('ana', 'z1'), 'none', 'a student of the course, the own work included');
SELECT is(pg_temp.works('dora', 'z1'), 'none', 'another student of the course');
SELECT is(pg_temp.works('iva', 'z1'), 'none', 'the administrator of the institution');
SELECT is(pg_temp.works('boris', 'z1'), 'none', 'a student in no course');
SELECT is(pg_temp.works('tomo', 'z1'), 'none', 'a student of another institution');
SELECT is(pg_temp.works('vesna', 'nobody'), 'none', 'an assignment that does not exist');
SELECT is(pg_temp.works('vesna', 'no-such-name'), 'none', 'a NULL assignment');
SELECT matches(pg_temp.works('anon', 'z1'), '^ZD401:', 'no session');
SELECT matches(pg_temp.works('expired', 'z1'), '^ZD401:', 'an expired session');
SELECT matches(pg_temp.works('closed', 'z1'), '^ZD401:', 'a closed session');
SELECT matches(pg_temp.works('unknown', 'z1'), '^ZD401:', 'an unknown token');

-- Nina holds an open teacher membership of K1 but no confirmed teacher role.
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('nina'), 'teacher');
SELECT is(pg_temp.works('nina', 'z1'), 'none', 'a teacher membership without a confirmed teacher role');

-- Ana joins K2: only then is her Z2 work Marko's to list, and it never shows on Z1.
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k2'), pg_temp.id('fak_a'), pg_temp.id('ana'), 'student');
SELECT is(pg_temp.works('marko', 'z2'), 'ana/doc-a2', 'a student who joined the course is listed with that assignment''s work');
SELECT is(pg_temp.works('vesna', 'z1'), 'ana/doc-a dora/doc-d', 'a work of another assignment is not on the list');

-- Dora leaves K1: her work leaves the list.
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('dora') AND member_to IS NULL;
SELECT is(pg_temp.works('vesna', 'z1'), 'ana/doc-a', 'a student whose membership ended is not listed');

-- Vesna's own membership ends: she lists nothing.
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('vesna') AND member_to IS NULL;
SELECT is(pg_temp.works('vesna', 'z1'), 'none', 'a teacher whose membership ended');

-- Reading wrote nothing.
SELECT is((SELECT count(*)::integer FROM audit.access_log), 0, 'listing the works opens no work');

SELECT * FROM finish();
ROLLBACK;

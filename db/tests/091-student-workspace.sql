-- DAN-309 (M2.3-P01, contract on #1091, c.6569706023): app.student_workspace
-- lists the assignments of the caller's open student memberships with only
-- their own work and submission. Attacks 1-8 of the contract, in order. Every
-- person, course, document and hash below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

-- One line per row, by assignment name: assignment, course, year, title,
-- version, acknowledged, document, server revision, submitted revision,
-- after deadline. "-" is NULL; an empty string is no row at all.
CREATE FUNCTION pg_temp.ws(p_actor text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, $q$
    SELECT coalesce(string_agg(concat_ws('|', coalesce(r.name, w.assignment_id::text), w.course_name, w.academic_year,
        w.title, w.current_version, w.acknowledged::text, coalesce(w.document_id, '-'),
        coalesce(w.server_revision::text, '-'), coalesce(w.submitted_revision::text, '-'),
        coalesce(w.after_deadline::text, '-')), ';' ORDER BY r.name, w.document_id), '')
      FROM app.student_workspace() w LEFT JOIN ref r ON r.val = w.assignment_id::text $q$)
$$;

-- 8. Shape: no parameter, the exact columns, STABLE, SECURITY INVOKER, empty
-- search_path, owned by the evidence role.
SELECT is(pg_get_function_arguments('app.student_workspace()'::regprocedure), '', 'it takes no parameter');
SELECT is(pg_get_function_result('app.student_workspace()'::regprocedure),
  'TABLE(assignment_id uuid, course_id uuid, course_name text, academic_year text, title text, '
  'opens_at timestamp with time zone, due_at timestamp with time zone, current_version integer, '
  'acknowledged boolean, document_id text, server_revision bigint, submitted_revision bigint, '
  'submitted_at timestamp with time zone, after_deadline boolean)',
  'it returns exactly the contract''s columns');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'app.student_workspace()'::regprocedure), false,
  'it runs with the caller''s rights, so RLS stays a second barrier');
SELECT is((SELECT provolatile::text FROM pg_proc WHERE oid = 'app.student_workspace()'::regprocedure), 's',
  'it is STABLE');
SELECT ok((SELECT 'search_path=""' = ANY (proconfig) FROM pg_proc WHERE oid = 'app.student_workspace()'::regprocedure),
  'with an empty search_path');
SELECT is((SELECT pg_get_userbyid(proowner)::text FROM pg_proc WHERE oid = 'app.student_workspace()'::regprocedure),
  'ductus_evidence', 'the evidence role owns it');

-- 5. Who may call it, and without a session.
SELECT is(
  ARRAY(SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_identity',
                                   'ductus_evidence', 'ductus_migrator', 'ductus_test_stranger']) AS r
         WHERE has_function_privilege(r, 'app.student_workspace()', 'EXECUTE')),
  ARRAY['ductus_app', 'ductus_evidence'],
  'of the roles only ductus_app executes it, besides its owner, and PUBLIC does not');
SELECT matches(pg_temp.ask_as('ductus_worker', 'ana', 'SELECT count(*)::text FROM app.student_workspace()'),
  '^42501: ', 'the worker gets no answer');
SELECT matches(pg_temp.ask_as('ductus_test_stranger', 'ana', 'SELECT count(*)::text FROM app.student_workspace()'),
  '^42501: ', 'a role outside the Ductus roles gets no answer');
SELECT is(pg_temp.ask('anon', 'SELECT count(*)::text FROM app.student_workspace()'), 'ZD401: not authenticated',
  'no session is not authenticated');
SELECT is(pg_temp.ask('expired', 'SELECT count(*)::text FROM app.student_workspace()'), 'ZD401: not authenticated',
  'Ana''s expired session is not authenticated');
SELECT is(pg_temp.ask('closed', 'SELECT count(*)::text FROM app.student_workspace()'), 'ZD401: not authenticated',
  'Ana''s closed session is not authenticated');
SELECT is(pg_temp.ask('unknown', 'SELECT count(*)::text FROM app.student_workspace()'), 'ZD401: not authenticated',
  'an unknown session is not authenticated');

-- 7. Before anything: Ana has an empty work, Dora none; the second version
-- of Z1 is acknowledged by Ana alone.
SELECT is(pg_temp.ws('ana'), 'z1|K1|2026/2027|Z1|2|true|doc-a|0|-|-',
  'Ana sees Z1 of K1 with her own work at revision 0, nothing submitted');
SELECT is(pg_temp.ask('ana', $$ SELECT (w.course_id = {k1} AND w.opens_at = v.opens_at AND w.due_at = v.due_at
      AND w.submitted_at IS NULL)::text
    FROM app.student_workspace() w JOIN institution.assignment_version v ON v.assignment_id = w.assignment_id
     AND v.version_no = w.current_version $$),
  'true', 'the course, the times of the current version and no submission time');

-- 1. A classmate on the same assignment sees her own row, not Ana's work.
SELECT is(pg_temp.ws('dora'), 'z1|K1|2026/2027|Z1|2|false|-|-|-|-',
  'Dora sees Z1 without a work and with the new version not acknowledged');

-- 2. Another institution: each sees only their own.
SELECT is(pg_temp.ws('tomo'), 'z3|K3|2026/2027|Z3|1|true|doc-b|0|-|-', 'Tomo sees only Z3 and his own work');
SELECT is(pg_temp.ws('petra'), '', 'the teacher of another institution gets no row');
SELECT is(pg_temp.ws('lea'), '', 'the administrator of another institution gets no row');

-- 4. A teacher, an administrator and a student without a course get nothing.
SELECT is(pg_temp.ws('vesna'), '', 'the teacher of K1 gets no row and no student''s work');
SELECT is(pg_temp.ws('marko'), '', 'the teacher of K2 gets no row');
SELECT is(pg_temp.ws('iva'), '', 'the administrator gets no row');
SELECT is(pg_temp.ws('boris'), '', 'a student in no course gets no row');

-- A forged user-id setting does not replace the session.
CREATE FUNCTION pg_temp.ws_with_spoofed_user_id() RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('app.user_id', pg_temp.id('ana')::text, true);
  v := pg_temp.ws('dora');
  PERFORM set_config('app.user_id', '', true);
  RETURN v;
END
$$;
SELECT is(pg_temp.ws_with_spoofed_user_id(), 'z1|K1|2026/2027|Z1|2|false|-|-|-|-',
  'a forged user-id setting cannot replace the session');

-- 7. A recorded submission: Ana commits revision 1 and submits it.
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64),
  repeat('b', 64)), 'reserved', 'fixture: Ana commits revision 1');
SELECT is(pg_temp.ws('ana'), 'z1|K1|2026/2027|Z1|2|true|doc-a|1|-|-', 'a committed revision is not a submission');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a', 1) $$), 'requested',
  'fixture: Ana requests revision 1');
SELECT is(pg_temp.ws('ana'), 'z1|K1|2026/2027|Z1|2|true|doc-a|1|-|-', 'a request alone is not a submission');
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.record_submission(%L::uuid, %L)',
  (SELECT id::text FROM evidence.submission_request WHERE document_id = 'doc-a'), pg_temp.h('d'))), 'recorded',
  'fixture: the submission of revision 1 is recorded');
SELECT is(pg_temp.ws('ana'), 'z1|K1|2026/2027|Z1|2|true|doc-a|1|1|false',
  'Ana sees her submitted revision, on time');
SELECT is(pg_temp.ask('ana', 'SELECT submitted_at::text FROM app.student_workspace()'),
  (SELECT requested_at::text FROM evidence.submission WHERE principal_id = pg_temp.id('ana')),
  'the submission time is the recorded requested time');
SELECT is(pg_temp.ws('dora'), 'z1|K1|2026/2027|Z1|2|false|-|-|-|-', 'Dora still sees nothing of Ana''s submission');
SELECT is(pg_temp.ws('vesna'), '', 'nor does the teacher here');

-- 6. Ana joins K2 as well: Z2 is listed without her Z1 work beside it.
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (pg_temp.id('k2'), pg_temp.id('fak_a'), pg_temp.id('ana'), 'student');
SELECT is(pg_temp.ws('ana'), 'z1|K1|2026/2027|Z1|2|true|doc-a|1|1|false;z2|K2|2026/2027|Z2|1|false|-|-|-|-',
  'the work of another assignment of the same student does not join Z2');
SELECT is(pg_temp.ws('marko'), '', 'the teacher of K2 still gets no row');

-- 3. A closed membership: the course leaves the list.
UPDATE institution.course_member SET member_to = now()
 WHERE user_id = pg_temp.id('ana') AND course_id = pg_temp.id('k2');
SELECT is(pg_temp.ws('ana'), 'z1|K1|2026/2027|Z1|2|true|doc-a|1|1|false', 'a closed membership hides Z2 again');
UPDATE institution.course_member SET member_to = now()
 WHERE user_id = pg_temp.id('dora') AND course_id = pg_temp.id('k1');
SELECT is(pg_temp.ws('dora'), '', 'Dora, whose K1 membership is closed, gets no row');

-- A second document in one project gives two rows for one assignment; the
-- reader takes that as unavailable, never as a choice (contract, QA risk).
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash)
VALUES ('doc-a2', pg_temp.id('fak_a'), 'project-a', pg_temp.id('ana'), pg_temp.h('e'));
RESET ROLE;
SELECT is(pg_temp.ws('ana'), 'z1|K1|2026/2027|Z1|2|true|doc-a|1|1|false;z1|K1|2026/2027|Z1|2|true|doc-a2|0|1|false',
  'two documents in one project give two rows for Z1');

SELECT * FROM finish();
ROLLBACK;

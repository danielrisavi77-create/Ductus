-- DAN-386, M2.10-P01 (contract on #1091, c.6720558678; orchestrator decision
-- c.6720126406): the language of the work, hr or en, on the assignment and,
-- as an override, on one work. Kept apart from the language of the interface
-- (D-70), which nothing here reads. Personas of institution.inc and
-- mentorship.inc; every person, work and text is invented.
--
--   Vesna teaches K1 (Z1, at version 2), whose students are Ana and Dora;
--   Marko teaches K2 and mentors Ana (zm1); Petra and Tomo are of fak-b.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
\ir fixtures/mentorship.inc
SELECT no_plan();

-- 1. The functions, the column and the table.
SELECT is(
  (SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || pg_get_function_result(p.oid)
          || ' ' || p.provolatile::text || CASE WHEN p.prosecdef THEN ' definer' ELSE '' END
          || CASE WHEN has_function_privilege('ductus_app', p.oid, 'EXECUTE') THEN ' app' ELSE '' END, ' | ' ORDER BY p.proname)
   FROM pg_proc p
   WHERE p.pronamespace = 'institution'::regnamespace AND p.proname LIKE '%work\_language%'),
  'assignment_version_work_language() trigger v definer'
  ' | is_work_language(p_language text) boolean i'
  ' | set_assignment_work_language(p_assignment_id uuid, p_expected_version integer, p_work_language text) integer v definer app'
  ' | set_work_language(p_assignment_id uuid, p_student_id uuid, p_work_language text) text v definer app'
  ' | work_language(p_assignment_id uuid, p_student_id uuid) text s definer app',
  'three calls for ductus_app; the set and the trigger are not callable by it'
);
SELECT is(
  (SELECT p.proowner::regrole::text || ' ' || p.prosecdef::text || ' ' || p.provolatile::text
          || ' ' || array_to_string(p.proconfig, ',')
          || ' ' || string_agg(r.rolname, ',' ORDER BY r.rolname)
   FROM pg_proc p CROSS JOIN pg_roles r
   WHERE p.oid = 'app.work_submission_requested(uuid, uuid)'::regprocedure
     AND r.rolname LIKE 'ductus\_%' AND NOT r.rolcanlogin
     AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
   GROUP BY p.proowner, p.prosecdef, p.provolatile, p.proconfig),
  'ductus_evidence true s search_path="" ductus_evidence,ductus_identity',
  'work_submission_requested belongs to ductus_evidence and only ductus_identity may call it'
);
SELECT ok(NOT has_function_privilege('public', 'app.work_submission_requested(uuid, uuid)', 'EXECUTE'),
  'PUBLIC may not call work_submission_requested');
SELECT is(
  (SELECT p.proowner::regrole::text || ' ' || p.prosecdef::text || ' ' || p.provolatile::text
          || ' ' || has_function_privilege('ductus_app', p.oid, 'EXECUTE')::text
          || ' ' || has_function_privilege('public', p.oid, 'EXECUTE')::text
   FROM pg_proc p WHERE p.oid = 'institution.lock_assignment_teacher(uuid)'::regprocedure),
  'ductus_identity false v false false',
  'lock_assignment_teacher is an invoker helper of the owner role that no client may call'
);
SELECT is(
  (SELECT p.proowner::regrole::text || ' ' || p.prosecdef::text || ' ' || p.provolatile::text
          || ' ' || has_function_privilege('ductus_app', p.oid, 'EXECUTE')::text
          || ' ' || has_function_privilege('public', p.oid, 'EXECUTE')::text
   FROM pg_proc p WHERE p.oid = 'institution.lock_assignment_student(uuid, uuid)'::regprocedure),
  'ductus_identity false v false false',
  'lock_assignment_student is an invoker helper of the owner role that no client may call'
);
SELECT is(
  (SELECT a.attnotnull::text || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), 'no default')
   FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'institution.assignment_version'::regclass AND a.attname = 'work_language'),
  'true no default',
  'the language of a version is NOT NULL and has no default; the trigger fills it'
);
SELECT is(
  (SELECT string_agg(v.work_language, ',' ORDER BY v.work_language) FROM (SELECT DISTINCT work_language FROM institution.assignment_version) v),
  'hr',
  'every version written without a language is Croatian'
);
SELECT ok(
  (SELECT c.relrowsecurity AND c.relforcerowsecurity AND c.relowner = 'ductus_identity'::regrole
   FROM pg_class c WHERE c.oid = 'institution.work_language_override'::regclass),
  'work_language_override has ENABLE and FORCE ROW LEVEL SECURITY and belongs to ductus_identity'
);
SELECT is(
  (SELECT string_agg(s.v, ',' ORDER BY s.v) FROM unnest(ARRAY['hr', 'en', 'de', 'HR', ' hr', 'hr ', '', NULL]) AS s (v)
   WHERE institution.is_work_language(s.v)),
  'en,hr',
  'the set is closed: hr and en, nothing else, no case or space folding'
);

-- 2. The access matrix of the new table: role by operation, as migrated.
CREATE FUNCTION pg_temp.probe(p_role text, p_op text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_result text;
BEGIN
  v_result := pg_temp.ask_as(p_role, 'anon', CASE p_op
    WHEN 'SELECT' THEN 'SELECT ''rows='' || count(*) FROM institution.work_language_override'
    WHEN 'INSERT' THEN 'WITH x AS (INSERT INTO institution.work_language_override DEFAULT VALUES RETURNING 1) SELECT ''rows='' || count(*) FROM x'
    WHEN 'UPDATE' THEN 'WITH x AS (UPDATE institution.work_language_override SET work_language = ''en'' RETURNING 1) SELECT ''rows='' || count(*) FROM x'
    WHEN 'DELETE' THEN 'WITH x AS (DELETE FROM institution.work_language_override RETURNING 1) SELECT ''rows='' || count(*) FROM x'
  END);
  RETURN CASE
    WHEN v_result LIKE '42501: permission denied for schema %' THEN 'no schema privilege'
    WHEN v_result LIKE '42501: permission denied for table %' THEN 'no table privilege'
    ELSE v_result
  END;
END
$$;
SELECT is(pg_temp.probe(r.role, o.op), r.expect[o.n], format('%s: %s on work_language_override', r.role, o.op))
FROM (VALUES
  ('ductus_app', ARRAY['rows=0', 'no table privilege', 'no table privilege', 'no table privilege']),
  ('ductus_evidence', ARRAY['no schema privilege', 'no schema privilege', 'no schema privilege', 'no schema privilege']),
  ('ductus_migrator', ARRAY['no table privilege', 'no table privilege', 'no table privilege', 'no table privilege']),
  ('ductus_worker', ARRAY['no schema privilege', 'no schema privilege', 'no schema privilege', 'no schema privilege']),
  ('ductus_test_stranger', ARRAY['no schema privilege', 'no schema privilege', 'no schema privilege', 'no schema privilege'])
) AS r (role, expect)
CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) WITH ORDINALITY AS o (op, n);
-- The owner role holds every privilege; only the functions act as it. Its
-- INSERT without values is refused by the table itself, not by a grant.
SELECT ok(has_table_privilege('ductus_identity', 'institution.work_language_override', o.op),
  format('ductus_identity (owner): %s on work_language_override', o.op))
FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS o (op);
SELECT is(pg_temp.ask_as('ductus_identity', 'anon', 'SELECT count(*) FROM institution.work_language_override'), '0',
  'ductus_identity reads through the owner policy');

-- 3. The classes of input, one row each: who, what, and what comes back.
-- Rows run in order; a row that writes is followed by rows that read.
CREATE TEMP TABLE step (n integer PRIMARY KEY, class text, actor text, sql text, expect text);
CREATE FUNCTION pg_temp.state() RETURNS text
LANGUAGE sql AS $$
  SELECT concat_ws(' | ',
    'z1 v' || (SELECT current_version FROM institution.assignment WHERE id = pg_temp.id('z1'))
      || ' ' || (SELECT string_agg(version_no || '=' || work_language, ',' ORDER BY version_no)
                 FROM institution.assignment_version WHERE assignment_id = pg_temp.id('z1')),
    'overrides ' || coalesce((
      SELECT string_agg(a.name || '.' || p.name || '=' || o.work_language, ',' ORDER BY a.name, p.name)
      FROM institution.work_language_override o
      JOIN ref a ON a.val = o.assignment_id::text JOIN person p ON p.id = o.student_id), '-'))
$$;

INSERT INTO step VALUES
  -- 1. An unknown language: ZD422 and nothing written.
  (101, '1', 'vesna', $$ SELECT institution.set_work_language({z1}, {ana}, 'de') $$, 'ZD422: invalid input'),
  (102, '1', 'vesna', $$ SELECT institution.set_work_language({z1}, {ana}, 'HR') $$, 'ZD422: invalid input'),
  (103, '1', 'vesna', $$ SELECT institution.set_work_language({z1}, {ana}, ' hr') $$, 'ZD422: invalid input'),
  (104, '1', 'vesna', $$ SELECT institution.set_assignment_work_language({z1}, 2, 'de')::text $$, 'ZD422: invalid input'),
  (105, '1', 'vesna', $$ SELECT institution.set_assignment_work_language({z1}, 2, 'HR')::text $$, 'ZD422: invalid input'),
  (106, '1', 'vesna', $$ SELECT institution.set_assignment_work_language({z1}, 2, ' hr')::text $$, 'ZD422: invalid input'),
  -- 2. Empty: '' is refused; NULL on the assignment is refused, NULL on the work removes the override.
  (201, '2', 'vesna', $$ SELECT institution.set_work_language({z1}, {ana}, '') $$, 'ZD422: invalid input'),
  (202, '2', 'vesna', $$ SELECT institution.set_assignment_work_language({z1}, 2, '')::text $$, 'ZD422: invalid input'),
  (203, '2', 'vesna', $$ SELECT institution.set_assignment_work_language({z1}, 2, NULL)::text $$, 'ZD422: invalid input'),
  (204, '2', 'db', $$ SELECT pg_temp.state() $$, 'z1 v2 1=hr,2=hr | overrides -'),
  (205, '2', 'vesna', $$ SELECT institution.set_work_language({z1}, {ana}, 'en') $$, 'en'),
  (206, '2', 'vesna', $$ SELECT institution.set_work_language({z1}, {ana}, 'en') $$, 'en'),
  (207, '2', 'db', $$ SELECT pg_temp.state() $$, 'z1 v2 1=hr,2=hr | overrides z1.ana=en'),
  (208, '2', 'vesna', $$ SELECT institution.set_work_language({z1}, {ana}, NULL) $$, 'hr'),
  (209, '2', 'vesna', $$ SELECT institution.set_work_language({z1}, {ana}, NULL) $$, 'hr'),
  (210, '2', 'db', $$ SELECT pg_temp.state() $$, 'z1 v2 1=hr,2=hr | overrides -'),
  (211, '2', 'vesna', $$ SELECT institution.set_work_language({z1}, {ana}, 'en') $$, 'en'),
  (212, '2', 'marko', $$ SELECT institution.set_work_language({zm1}, {ana}, 'en') $$, 'en'),
  -- Reading the language of a work: the student and a teacher of the work, nobody else.
  (220, 'read', 'ana', $$ SELECT institution.work_language({z1}, {ana}) $$, 'en'),
  (221, 'read', 'vesna', $$ SELECT institution.work_language({z1}, {ana}) $$, 'en'),
  (222, 'read', 'dora', $$ SELECT institution.work_language({z1}, {dora}) $$, 'hr'),
  (223, 'read', 'dora', $$ SELECT coalesce(institution.work_language({z1}, {ana}), 'null') $$, 'null'),
  (224, 'read', 'marko', $$ SELECT coalesce(institution.work_language({z1}, {ana}), 'null') $$, 'null'),
  (225, 'read', 'marko', $$ SELECT institution.work_language({zm1}, {ana}) $$, 'en'),
  (226, 'read', 'ana', $$ SELECT institution.work_language({zm1}, {ana}) $$, 'en'),
  (227, 'read', 'vesna', $$ SELECT coalesce(institution.work_language({zm1}, {ana}), 'null') $$, 'null'),
  (228, 'read', 'boris', $$ SELECT coalesce(institution.work_language({z1}, {ana}), 'null') $$, 'null'),
  (229, 'read', 'anon', $$ SELECT coalesce(institution.work_language({z1}, {ana}), 'null') $$, 'null'),
  (230, 'read', 'expired', $$ SELECT coalesce(institution.work_language({z1}, {ana}), 'null') $$, 'null'),
  (231, 'read', 'vesna', $$ SELECT coalesce(institution.work_language({z1}, NULL), 'null') $$, 'null'),
  (232, 'read', 'vesna', $$ SELECT coalesce(institution.work_language({nobody}, {ana}), 'null') $$, 'null'),
  -- RLS: the rows each session reads in the table.
  (240, 'rls', 'ana', $$ SELECT count(*)::text FROM institution.work_language_override $$, '2'),
  (241, 'rls', 'vesna', $$ SELECT count(*)::text FROM institution.work_language_override $$, '1'),
  (242, 'rls', 'marko', $$ SELECT count(*)::text FROM institution.work_language_override $$, '1'),
  (243, 'rls', 'dora', $$ SELECT count(*)::text FROM institution.work_language_override $$, '0'),
  (244, 'rls', 'boris', $$ SELECT count(*)::text FROM institution.work_language_override $$, '0'),
  (245, 'rls', 'iva', $$ SELECT count(*)::text FROM institution.work_language_override $$, '0'),
  (246, 'rls', 'petra', $$ SELECT count(*)::text FROM institution.work_language_override $$, '0'),
  (247, 'rls', 'tomo', $$ SELECT count(*)::text FROM institution.work_language_override $$, '0'),
  (248, 'rls', 'anon', $$ SELECT count(*)::text FROM institution.work_language_override $$, '0'),
  (249, 'rls', 'ana', $$ SELECT count(*)::text FROM institution.work_language_override WHERE student_id <> {ana} $$, '0'),
  -- 4. A student changes nothing: their own work, another's, or the assignment.
  (401, '4', 'ana', $$ SELECT institution.set_work_language({z1}, {ana}, 'hr') $$, 'ZD403: forbidden'),
  (402, '4', 'ana', $$ SELECT institution.set_work_language({z1}, {dora}, 'en') $$, 'ZD403: forbidden'),
  (403, '4', 'ana', $$ SELECT institution.set_assignment_work_language({z1}, 2, 'en')::text $$, 'ZD403: forbidden'),
  (404, '4', 'ana', $$ SELECT institution.set_work_language({zm1}, {ana}, 'hr') $$, 'ZD403: forbidden'),
  (405, '4', 'dora', $$ SELECT institution.set_work_language({z1}, {dora}, NULL) $$, 'ZD403: forbidden'),
  -- Nor a teacher of another course, an unconfirmed teacher, a mentor on a course
  -- work, a course teacher on a mentorship, or a mentorship's assignment as a whole.
  (406, '4', 'marko', $$ SELECT institution.set_work_language({z1}, {ana}, 'hr') $$, 'ZD403: forbidden'),
  (407, '4', 'marko', $$ SELECT institution.set_assignment_work_language({z1}, 2, 'en')::text $$, 'ZD403: forbidden'),
  (408, '4', 'vesna', $$ SELECT institution.set_work_language({zm1}, {ana}, 'hr') $$, 'ZD403: forbidden'),
  (409, '4', 'marko', $$ SELECT institution.set_assignment_work_language({zm1}, 1, 'en')::text $$, 'ZD403: forbidden'),
  (410, '4', 'nina', $$ SELECT institution.set_work_language({zm3}, {boris}, 'en') $$, 'ZD403: forbidden'),
  (411, '4', 'vesna', $$ SELECT institution.set_work_language({z1}, {boris}, 'en') $$, 'ZD403: forbidden'),
  (412, '4', 'vesna', $$ SELECT institution.set_work_language({z1}, {vesna}, 'en') $$, 'ZD403: forbidden'),
  (413, '4', 'anon', $$ SELECT institution.set_work_language({z1}, {ana}, 'hr') $$, 'ZD401: not authenticated'),
  (414, '4', 'anon', $$ SELECT institution.set_assignment_work_language({z1}, 2, 'en')::text $$, 'ZD401: not authenticated'),
  -- 5. Another institution: refused, and nothing to read.
  (501, '5', 'petra', $$ SELECT institution.set_work_language({z1}, {ana}, 'hr') $$, 'ZD403: forbidden'),
  (502, '5', 'petra', $$ SELECT institution.set_assignment_work_language({z1}, 2, 'en')::text $$, 'ZD403: forbidden'),
  (503, '5', 'vesna', $$ SELECT institution.set_work_language({z3}, {tomo}, 'en') $$, 'ZD403: forbidden'),
  (504, '5', 'vesna', $$ SELECT institution.set_work_language({z1}, {tomo}, 'en') $$, 'ZD403: forbidden'),
  (505, '5', 'vesna', $$ SELECT institution.set_assignment_work_language({z3}, 1, 'en')::text $$, 'ZD403: forbidden'),
  (506, '5', 'petra', $$ SELECT coalesce(institution.work_language({z1}, {ana}), 'null') $$, 'null'),
  (507, '5', 'tomo', $$ SELECT coalesce(institution.work_language({z1}, {ana}), 'null') $$, 'null'),
  (508, '5', 'vesna', $$ SELECT coalesce(institution.work_language({z3}, {tomo}), 'null') $$, 'null'),
  (509, '5', 'tomo', $$ SELECT institution.work_language({z3}, {tomo}) $$, 'hr'),
  (510, '5', 'db', $$ SELECT pg_temp.state() $$, 'z1 v2 1=hr,2=hr | overrides z1.ana=en,zm1.ana=en'),
  -- The assignment, before any submission: a stale version is refused, the
  -- same language writes nothing, a new one writes a version with the same
  -- content; publish_assignment_version keeps the language.
  (601, '6', 'vesna', $$ SELECT institution.set_assignment_work_language({z1}, 1, 'en')::text $$, 'ZD409: conflict'),
  (602, '6', 'vesna', $$ SELECT institution.set_assignment_work_language({z1}, 2, 'hr')::text $$, '2'),
  (603, '6', 'db', $$ SELECT pg_temp.state() $$, 'z1 v2 1=hr,2=hr | overrides z1.ana=en,zm1.ana=en'),
  (604, '6', 'vesna', $$ SELECT institution.set_assignment_work_language({z1}, 2, 'en')::text $$, '3'),
  (605, '6', 'db', $$ SELECT pg_temp.state() $$, 'z1 v3 1=hr,2=hr,3=en | overrides z1.ana=en,zm1.ana=en'),
  (606, '6', 'db', $$ SELECT (SELECT count(*) FROM (
                          SELECT title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
                                 evidence_profile, import_allowed, word_min, word_max
                            FROM institution.assignment_version
                           WHERE assignment_id = pg_temp.id('z1') AND version_no IN (2, 3)
                           GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11) g)::text
                          || ' ' || (SELECT created_by = pg_temp.id('vesna') FROM institution.assignment_version
                                      WHERE assignment_id = pg_temp.id('z1') AND version_no = 3)::text $$,
   '1 true'),
  (607, '6', 'dora', $$ SELECT institution.work_language({z1}, {dora}) $$, 'en'),
  (608, '6', 'vesna', $$ SELECT institution.publish_assignment_version({z1}, 3, 'Z1', 'Nove izmišljene upute.', 'essay',
                            now(), now() + interval '30 days', 'partially_allowed', '{proofreading}', 'extended', true,
                            NULL, NULL)::text $$, '4'),
  (609, '6', 'db', $$ SELECT pg_temp.state() $$, 'z1 v4 1=hr,2=hr,3=en,4=en | overrides z1.ana=en,zm1.ana=en'),
  (610, '6', 'vesna', $$ SELECT institution.set_work_language({z1}, {dora}, 'hr') $$, 'hr');

CREATE FUNCTION pg_temp.run(p_from integer, p_to integer) RETURNS SETOF text
LANGUAGE plpgsql AS $$
DECLARE
  s record;
BEGIN
  FOR s IN SELECT * FROM step WHERE n BETWEEN p_from AND p_to ORDER BY n LOOP
    -- 'db' reads the stored state as the session (super)user, without a session
    -- token; the role is not named, it differs between local and CI.
    RETURN NEXT is(pg_temp.ask_as(CASE s.actor WHEN 'db' THEN session_user::text ELSE 'ductus_app' END,
                                  CASE s.actor WHEN 'db' THEN 'anon' ELSE s.actor END, s.sql),
                   s.expect, format('%s (class %s, %s): %s', s.n, s.class, s.actor, btrim(regexp_replace(s.sql, '\s+', ' ', 'g'))));
  END LOOP;
END
$$;
SELECT * FROM pg_temp.run(100, 699);

-- 3 and 6 after a submission. Dora requests one on Z1 at version 4; the
-- owner role writes it, as request_submission would.
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id)
VALUES ('project-dora-z1', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('dora'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash)
VALUES ('doc-dora-z1', pg_temp.id('fak_a'), 'project-dora-z1', pg_temp.id('dora'), repeat('a', 64));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
VALUES ('doc-dora-z1', pg_temp.id('fak_a'), 0, NULL, pg_temp.id('dora'), repeat('a', 64)),
       ('doc-dora-z1', pg_temp.id('fak_a'), 1, 0, pg_temp.id('dora'), repeat('b', 64));
INSERT INTO evidence.submission_request (institution_id, assignment_id, assignment_version, project_id, document_id,
                                         principal_id, revision, content_hash, requested_at)
VALUES (pg_temp.id('fak_a'), pg_temp.id('z1'), 4, 'project-dora-z1', 'doc-dora-z1', pg_temp.id('dora'), 1,
        repeat('b', 64), now());
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;

INSERT INTO step VALUES
  -- 3. Dora's work after her request: no change, and her override stays.
  (701, '3', 'vesna', $$ SELECT institution.set_work_language({z1}, {dora}, 'en') $$, 'ZD409: conflict'),
  (702, '3', 'vesna', $$ SELECT institution.set_work_language({z1}, {dora}, NULL) $$, 'ZD409: conflict'),
  (703, '3', 'vesna', $$ SELECT institution.set_work_language({z1}, {dora}, 'de') $$, 'ZD422: invalid input'),
  (704, '3', 'dora', $$ SELECT institution.work_language({z1}, {dora}) $$, 'hr'),
  -- Ana has requested nothing, so her work still changes.
  (705, '3', 'vesna', $$ SELECT institution.set_work_language({z1}, {ana}, 'hr') $$, 'hr'),
  (706, '3', 'db', $$ SELECT pg_temp.state() $$, 'z1 v4 1=hr,2=hr,3=en,4=en | overrides z1.ana=hr,z1.dora=hr,zm1.ana=en'),
  -- 6. The assignment after the first request: no change of language; the
  -- same language is still no change, and a stale version still a conflict.
  (801, '6', 'vesna', $$ SELECT institution.set_assignment_work_language({z1}, 4, 'hr')::text $$, 'ZD409: conflict'),
  (802, '6', 'vesna', $$ SELECT institution.set_assignment_work_language({z1}, 4, 'en')::text $$, '4'),
  (803, '6', 'vesna', $$ SELECT institution.set_assignment_work_language({z1}, 3, 'hr')::text $$, 'ZD409: conflict'),
  (804, '6', 'db', $$ SELECT pg_temp.state() $$, 'z1 v4 1=hr,2=hr,3=en,4=en | overrides z1.ana=hr,z1.dora=hr,zm1.ana=en'),
  -- The trigger refuses a version that changes the language, whoever writes
  -- it in a session; one written without a language inherits it.
  (805, '6', 'vesna', $$ SELECT pg_temp.write_version(5, 'hr') $$, 'ZD409: conflict'),
  (806, '6', 'vesna', $$ SELECT pg_temp.write_version(5, NULL) $$, 'en'),
  (807, '6', 'vesna', $$ SELECT pg_temp.write_version(6, 'en') $$, 'en');

-- A version as the owner role writes it, with Vesna's session set: the path
-- of publish_assignment_version without its checks, to reach the trigger.
CREATE FUNCTION pg_temp.write_version(p_version integer, p_language text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_result text;
BEGIN
  SET LOCAL ROLE ductus_identity;
  INSERT INTO institution.assignment_version (
    assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
    evidence_profile, import_allowed, work_language, created_by
  ) VALUES (pg_temp.id('z1'), p_version, 'Z1', 'Izmišljene upute.', 'essay', now(), now() + interval '30 days',
            'partially_allowed', '{proofreading}', 'extended', true, p_language, pg_temp.id('vesna'))
  RETURNING work_language INTO v_result;
  RESET ROLE;
  RETURN v_result;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.write_version(integer, text) TO ductus_app;
GRANT ductus_identity TO ductus_app;
SELECT * FROM pg_temp.run(700, 899);
REVOKE ductus_identity FROM ductus_app;

INSERT INTO step VALUES
  -- 4. Iva revokes Vesna's teacher role: from then on Vesna changes neither
  -- the assignment nor a work, and nothing is written.
  (901, '4', 'iva', $$ SELECT institution.revoke_teacher_role({vesna})::text $$, 'true'),
  (902, '4', 'vesna', $$ SELECT institution.set_work_language({z1}, {ana}, 'en') $$, 'ZD403: forbidden'),
  (903, '4', 'vesna', $$ SELECT institution.set_work_language({z1}, {ana}, NULL) $$, 'ZD403: forbidden'),
  (904, '4', 'vesna', $$ SELECT institution.set_assignment_work_language({z1}, 4, 'hr')::text $$, 'ZD403: forbidden'),
  (905, '4', 'db', $$ SELECT pg_temp.state() $$, 'z1 v4 1=hr,2=hr,3=en,4=en,5=en,6=en | overrides z1.ana=hr,z1.dora=hr,zm1.ana=en');
SELECT * FROM pg_temp.run(900, 999);

SELECT * FROM finish();
ROLLBACK;

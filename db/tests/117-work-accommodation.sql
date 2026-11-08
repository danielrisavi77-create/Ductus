-- DAN-380, M2.9-P01 (contract on #1091, c.6722796115; D-50): a student marks
-- an approved accommodation on their own work; a teacher or mentor of the work
-- (a teacher of the student's seminar group included) sees that it is marked,
-- never why. Personas of institution.inc and
-- mentorship.inc; every person and work is invented.
--
--   Vesna teaches K1 (Z1), whose students are Ana and Dora; Marko teaches K2
--   and mentors Ana (zm1); Vesna's mentorship of Dora (zm2) has ended; Nina,
--   unconfirmed, mentors Boris (zm3); Petra and Tomo are of fak-b (K3, Z3).
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
\ir fixtures/mentorship.inc
SELECT no_plan();

-- 1. The table holds a mark and nothing else, and the calls take no text.
SELECT is(
  (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END,
                     ', ' ORDER BY a.attnum)
   FROM pg_attribute a WHERE a.attrelid = 'institution.work_accommodation'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
  'institution_id uuid not null, assignment_id uuid not null, student_id uuid not null, marked_at timestamp with time zone not null',
  'work_accommodation has no column for a kind, a reason, a note or a diagnosis'
);
SELECT is(
  (SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || pg_get_function_result(p.oid)
          || ' ' || p.provolatile::text || CASE WHEN p.prosecdef THEN ' definer' ELSE '' END
          || ' ' || array_to_string(p.proconfig, ',')
          || CASE WHEN has_function_privilege('ductus_app', p.oid, 'EXECUTE') THEN ' app' ELSE '' END
          || CASE WHEN has_function_privilege('public', p.oid, 'EXECUTE') THEN ' public' ELSE '' END, ' | ' ORDER BY p.proname)
   FROM pg_proc p
   WHERE p.proname LIKE '%work\_accommodation%'),
  'set_work_accommodation(p_assignment_id uuid, p_marked boolean) boolean v definer search_path="" app'
  ' | work_accommodation(p_assignment_id uuid, p_student_id uuid) boolean s definer search_path="" app',
  'two calls for ductus_app, both of uuid and boolean only, and PUBLIC calls neither'
);
SELECT ok(
  (SELECT c.relrowsecurity AND c.relforcerowsecurity AND c.relowner = 'ductus_identity'::regrole
   FROM pg_class c WHERE c.oid = 'institution.work_accommodation'::regclass),
  'work_accommodation has ENABLE and FORCE ROW LEVEL SECURITY and belongs to ductus_identity'
);
SELECT is(
  (SELECT string_agg(t.tgname, ',') FROM pg_trigger t WHERE t.tgrelid = 'institution.work_accommodation'::regclass AND NOT t.tgisinternal),
  NULL,
  'no trigger writes about the mark elsewhere'
);

-- 2. The access matrix of the new table: role by operation, as migrated.
CREATE FUNCTION pg_temp.probe(p_role text, p_op text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_result text;
BEGIN
  v_result := pg_temp.ask_as(p_role, 'anon', CASE p_op
    WHEN 'SELECT' THEN 'SELECT ''rows='' || count(*) FROM institution.work_accommodation'
    WHEN 'INSERT' THEN 'WITH x AS (INSERT INTO institution.work_accommodation DEFAULT VALUES RETURNING 1) SELECT ''rows='' || count(*) FROM x'
    WHEN 'UPDATE' THEN 'WITH x AS (UPDATE institution.work_accommodation SET marked_at = now() RETURNING 1) SELECT ''rows='' || count(*) FROM x'
    WHEN 'DELETE' THEN 'WITH x AS (DELETE FROM institution.work_accommodation RETURNING 1) SELECT ''rows='' || count(*) FROM x'
  END);
  RETURN CASE
    WHEN v_result LIKE '42501: permission denied for schema %' THEN 'no schema privilege'
    WHEN v_result LIKE '42501: permission denied for table %' THEN 'no table privilege'
    ELSE v_result
  END;
END
$$;
SELECT is(pg_temp.probe(r.role, o.op), r.expect[o.n], format('%s: %s on work_accommodation', r.role, o.op))
FROM (VALUES
  ('ductus_app', ARRAY['rows=0', 'no table privilege', 'no table privilege', 'no table privilege']),
  ('ductus_evidence', ARRAY['no schema privilege', 'no schema privilege', 'no schema privilege', 'no schema privilege']),
  ('ductus_migrator', ARRAY['no table privilege', 'no table privilege', 'no table privilege', 'no table privilege']),
  ('ductus_worker', ARRAY['no schema privilege', 'no schema privilege', 'no schema privilege', 'no schema privilege']),
  ('ductus_test_stranger', ARRAY['no schema privilege', 'no schema privilege', 'no schema privilege', 'no schema privilege'])
) AS r (role, expect)
CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) WITH ORDINALITY AS o (op, n);
SELECT ok(has_table_privilege('ductus_identity', 'institution.work_accommodation', o.op),
  format('ductus_identity (owner): %s on work_accommodation', o.op))
FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS o (op);
SELECT is(pg_temp.ask_as('ductus_identity', 'anon', 'SELECT count(*) FROM institution.work_accommodation'), '0',
  'ductus_identity reads through the owner policy');

-- 3. The classes of input, one row each: who, what, and what comes back.
-- Rows run in order; a row that writes is followed by rows that read.
CREATE TEMP TABLE step (n integer PRIMARY KEY, class text, actor text, sql text, expect text);
CREATE FUNCTION pg_temp.state() RETURNS text
LANGUAGE sql AS $$
  SELECT 'marks ' || coalesce((
    SELECT string_agg(a.name || '.' || p.name, ',' ORDER BY a.name, p.name)
    FROM institution.work_accommodation w
    JOIN ref a ON a.val = w.assignment_id::text JOIN person p ON p.id = w.student_id), '-')
$$;
CREATE TEMP TABLE seen (name text PRIMARY KEY, at timestamptz);

INSERT INTO step VALUES
  -- 1, 3. Ana marks her work on Z1; the same value again changes nothing.
  (101, '1', 'ana', $$ SELECT institution.set_work_accommodation({z1}, true)::text $$, 'true'),
  (102, '1', 'db', $$ SELECT pg_temp.state() $$, 'marks z1.ana'),
  (103, '3', 'db', $$ INSERT INTO seen SELECT 'ana', marked_at FROM institution.work_accommodation
                       WHERE assignment_id = pg_temp.id('z1') AND student_id = pg_temp.id('ana') RETURNING 'kept' $$, 'kept'),
  (104, '3', 'db', $$ UPDATE institution.work_accommodation SET marked_at = marked_at - interval '1 hour' RETURNING 'moved' $$, 'moved'),
  (105, '3', 'ana', $$ SELECT institution.set_work_accommodation({z1}, true)::text $$, 'true'),
  (106, '3', 'db', $$ SELECT (marked_at = (SELECT at FROM seen WHERE name = 'ana') - interval '1 hour')::text
                       FROM institution.work_accommodation
                       WHERE assignment_id = pg_temp.id('z1') AND student_id = pg_temp.id('ana') $$, 'true'),
  -- 2, 4. Unmark removes the row; unmarking again is no change.
  (201, '2', 'ana', $$ SELECT institution.set_work_accommodation({z1}, false)::text $$, 'false'),
  (202, '2', 'db', $$ SELECT pg_temp.state() $$, 'marks -'),
  (203, '4', 'ana', $$ SELECT institution.set_work_accommodation({z1}, false)::text $$, 'false'),
  (204, '4', 'db', $$ SELECT pg_temp.state() $$, 'marks -'),
  (205, '1', 'ana', $$ SELECT institution.set_work_accommodation({z1}, true)::text $$, 'true'),
  (206, '1', 'ana', $$ SELECT institution.set_work_accommodation({zm1}, true)::text $$, 'true'),
  (207, '1', 'tomo', $$ SELECT institution.set_work_accommodation({z3}, true)::text $$, 'true'),
  -- 5. No value: ZD422, nothing written.
  (501, '5', 'dora', $$ SELECT institution.set_work_accommodation({z1}, NULL)::text $$, 'ZD422: invalid input'),
  -- 6. No assignment, or one that does not exist: ZD403.
  (601, '6', 'dora', $$ SELECT institution.set_work_accommodation(NULL, true)::text $$, 'ZD403: forbidden'),
  (602, '6', 'dora', $$ SELECT institution.set_work_accommodation({nobody}, true)::text $$, 'ZD403: forbidden'),
  -- 7. A student who is not a student of the assignment, or whose mentorship ended.
  (701, '7', 'dora', $$ SELECT institution.set_work_accommodation({z2}, true)::text $$, 'ZD403: forbidden'),
  (702, '7', 'dora', $$ SELECT institution.set_work_accommodation({zm2}, true)::text $$, 'ZD403: forbidden'),
  (703, '7', 'boris', $$ SELECT institution.set_work_accommodation({z1}, true)::text $$, 'ZD403: forbidden'),
  -- 8. A teacher or mentor marks nothing, on any work.
  (801, '8', 'vesna', $$ SELECT institution.set_work_accommodation({z1}, true)::text $$, 'ZD403: forbidden'),
  (802, '8', 'marko', $$ SELECT institution.set_work_accommodation({zm1}, false)::text $$, 'ZD403: forbidden'),
  (803, '8', 'nina', $$ SELECT institution.set_work_accommodation({zm3}, true)::text $$, 'ZD403: forbidden'),
  (804, '8', 'iva', $$ SELECT institution.set_work_accommodation({z1}, true)::text $$, 'ZD403: forbidden'),
  -- 9. Another institution: refused.
  (901, '9', 'tomo', $$ SELECT institution.set_work_accommodation({z1}, true)::text $$, 'ZD403: forbidden'),
  (902, '9', 'ana', $$ SELECT institution.set_work_accommodation({z3}, true)::text $$, 'ZD403: forbidden'),
  -- 10. No session.
  (1001, '10', 'anon', $$ SELECT institution.set_work_accommodation({z1}, true)::text $$, 'ZD401: not authenticated'),
  (1002, '10', 'expired', $$ SELECT institution.set_work_accommodation({z1}, false)::text $$, 'ZD401: not authenticated'),
  (1003, '10', 'db', $$ SELECT pg_temp.state() $$, 'marks z1.ana,z3.tomo,zm1.ana'),
  -- 12. Reading the mark: the student and a teacher or mentor of the work see
  -- true or false; anyone else, null.
  (1201, '12', 'ana', $$ SELECT institution.work_accommodation({z1}, {ana})::text $$, 'true'),
  (1202, '12', 'vesna', $$ SELECT institution.work_accommodation({z1}, {ana})::text $$, 'true'),
  (1203, '12', 'vesna', $$ SELECT institution.work_accommodation({z1}, {dora})::text $$, 'false'),
  (1204, '12', 'dora', $$ SELECT institution.work_accommodation({z1}, {dora})::text $$, 'false'),
  (1205, '12', 'marko', $$ SELECT institution.work_accommodation({zm1}, {ana})::text $$, 'true'),
  (1206, '12', 'ana', $$ SELECT institution.work_accommodation({zm1}, {ana})::text $$, 'true'),
  (1207, '12', 'dora', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'null'),
  (1208, '12', 'marko', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'null'),
  (1209, '12', 'vesna', $$ SELECT coalesce(institution.work_accommodation({zm1}, {ana})::text, 'null') $$, 'null'),
  (1210, '12', 'boris', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'null'),
  (1211, '12', 'iva', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'null'),
  (1212, '12', 'nina', $$ SELECT coalesce(institution.work_accommodation({zm3}, {boris})::text, 'null') $$, 'null'),
  (1213, '12', 'vesna', $$ SELECT coalesce(institution.work_accommodation({z1}, {vesna})::text, 'null') $$, 'null'),
  (1214, '12', 'vesna', $$ SELECT coalesce(institution.work_accommodation({z1}, {boris})::text, 'null') $$, 'null'),
  (1215, '12', 'vesna', $$ SELECT coalesce(institution.work_accommodation({z1}, NULL)::text, 'null') $$, 'null'),
  (1216, '12', 'vesna', $$ SELECT coalesce(institution.work_accommodation({nobody}, {ana})::text, 'null') $$, 'null'),
  (1217, '12', 'anon', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'null'),
  (1218, '12', 'expired', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'null'),
  -- 9. Another institution reads nothing, and is read by nobody here.
  (1219, '9', 'petra', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'null'),
  (1220, '9', 'tomo', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'null'),
  (1221, '9', 'vesna', $$ SELECT coalesce(institution.work_accommodation({z3}, {tomo})::text, 'null') $$, 'null'),
  (1222, '9', 'petra', $$ SELECT institution.work_accommodation({z3}, {tomo})::text $$, 'true'),
  -- RLS: the rows each session reads in the table.
  (1240, 'rls', 'ana', $$ SELECT count(*)::text FROM institution.work_accommodation $$, '2'),
  (1241, 'rls', 'vesna', $$ SELECT count(*)::text FROM institution.work_accommodation $$, '1'),
  (1242, 'rls', 'marko', $$ SELECT count(*)::text FROM institution.work_accommodation $$, '1'),
  (1243, 'rls', 'dora', $$ SELECT count(*)::text FROM institution.work_accommodation $$, '0'),
  (1244, 'rls', 'boris', $$ SELECT count(*)::text FROM institution.work_accommodation $$, '0'),
  (1245, 'rls', 'nina', $$ SELECT count(*)::text FROM institution.work_accommodation $$, '0'),
  (1246, 'rls', 'iva', $$ SELECT count(*)::text FROM institution.work_accommodation $$, '0'),
  (1247, 'rls', 'petra', $$ SELECT count(*)::text FROM institution.work_accommodation $$, '1'),
  (1248, 'rls', 'tomo', $$ SELECT count(*)::text FROM institution.work_accommodation $$, '1'),
  (1249, 'rls', 'anon', $$ SELECT count(*)::text FROM institution.work_accommodation $$, '0'),
  (1250, 'rls', 'ana', $$ SELECT count(*)::text FROM institution.work_accommodation WHERE student_id <> {ana} $$, '0'),
  (1251, 'rls', 'vesna', $$ SELECT count(*)::text FROM institution.work_accommodation WHERE assignment_id <> {z1} $$, '0');

CREATE FUNCTION pg_temp.run(p_from integer, p_to integer) RETURNS SETOF text
LANGUAGE plpgsql AS $$
DECLARE
  s record;
BEGIN
  FOR s IN SELECT * FROM step WHERE n BETWEEN p_from AND p_to ORDER BY n LOOP
    -- 'db' reads and moves the stored state as the session (super)user,
    -- without a session token; the role is not named, it differs between
    -- local and CI.
    RETURN NEXT is(pg_temp.ask_as(CASE s.actor WHEN 'db' THEN session_user::text ELSE 'ductus_app' END,
                                  CASE s.actor WHEN 'db' THEN 'anon' ELSE s.actor END, s.sql),
                   s.expect, format('%s (class %s, %s): %s', s.n, s.class, s.actor, btrim(regexp_replace(s.sql, '\s+', ' ', 'g'))));
  END LOOP;
END
$$;
SELECT * FROM pg_temp.run(100, 1299);

-- 11. After a submission request. Dora requests one on Z1; the owner role
-- writes it, as request_submission would. Ana has requested nothing.
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id)
VALUES ('project-dora-z1', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('dora')),
       ('project-ana-zm1', pg_temp.id('fak_a'), pg_temp.id('zm1'), pg_temp.id('ana'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash)
VALUES ('doc-dora-z1', pg_temp.id('fak_a'), 'project-dora-z1', pg_temp.id('dora'), repeat('a', 64)),
       ('doc-ana-zm1', pg_temp.id('fak_a'), 'project-ana-zm1', pg_temp.id('ana'), repeat('c', 64));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
VALUES ('doc-dora-z1', pg_temp.id('fak_a'), 0, NULL, pg_temp.id('dora'), repeat('a', 64)),
       ('doc-dora-z1', pg_temp.id('fak_a'), 1, 0, pg_temp.id('dora'), repeat('b', 64)),
       ('doc-ana-zm1', pg_temp.id('fak_a'), 0, NULL, pg_temp.id('ana'), repeat('c', 64)),
       ('doc-ana-zm1', pg_temp.id('fak_a'), 1, 0, pg_temp.id('ana'), repeat('d', 64));
INSERT INTO evidence.submission_request (institution_id, assignment_id, assignment_version, project_id, document_id,
                                         principal_id, revision, content_hash, requested_at)
VALUES (pg_temp.id('fak_a'), pg_temp.id('z1'), 2, 'project-dora-z1', 'doc-dora-z1', pg_temp.id('dora'), 1,
        repeat('b', 64), now()),
       (pg_temp.id('fak_a'), pg_temp.id('zm1'), 1, 'project-ana-zm1', 'doc-ana-zm1', pg_temp.id('ana'), 1,
        repeat('d', 64), now());
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;

INSERT INTO step VALUES
  -- 11. Neither mark nor unmark once requested; the input check comes first.
  (1301, '11', 'dora', $$ SELECT institution.set_work_accommodation({z1}, true)::text $$, 'ZD409: conflict'),
  (1302, '11', 'dora', $$ SELECT institution.set_work_accommodation({z1}, false)::text $$, 'ZD409: conflict'),
  (1303, '11', 'ana', $$ SELECT institution.set_work_accommodation({zm1}, false)::text $$, 'ZD409: conflict'),
  (1304, '11', 'ana', $$ SELECT institution.set_work_accommodation({zm1}, true)::text $$, 'ZD409: conflict'),
  (1305, '11', 'dora', $$ SELECT institution.set_work_accommodation({z1}, NULL)::text $$, 'ZD422: invalid input'),
  -- Ana's request on zm1 leaves her work on Z1 open.
  (1306, '11', 'ana', $$ SELECT institution.set_work_accommodation({z1}, false)::text $$, 'false'),
  (1307, '11', 'db', $$ SELECT pg_temp.state() $$, 'marks z3.tomo,zm1.ana'),
  -- Dora's mark on Z1 from before her request; her teacher and she read it directly.
  (1308, '7', 'db', $$ INSERT INTO institution.work_accommodation (institution_id, assignment_id, student_id)
                        SELECT a.institution_id, a.id, {dora} FROM institution.assignment a WHERE a.id = {z1}
                        RETURNING 'marked' $$, 'marked'),
  (1309, '7', 'vesna', $$ SELECT count(*)::text FROM institution.work_accommodation WHERE student_id = {dora} $$, '1'),
  (1310, '7', 'dora', $$ SELECT count(*)::text FROM institution.work_accommodation $$, '1'),
  -- Vesna removes Dora from K1: Dora is no longer a student of Z1.
  (1401, '7', 'vesna', $$ SELECT institution.remove_student({k1}, {dora})::text $$, 'true'),
  (1402, '7', 'dora', $$ SELECT institution.set_work_accommodation({z1}, false)::text $$, 'ZD403: forbidden'),
  (1403, '7', 'vesna', $$ SELECT coalesce(institution.work_accommodation({z1}, {dora})::text, 'null') $$, 'null'),
  (1404, '7', 'db', $$ SELECT pg_temp.state() $$, 'marks z1.dora,z3.tomo,zm1.ana'),
  -- The row stays, and a direct read sees no more than the reader: nobody.
  (1405, '7', 'vesna', $$ SELECT count(*)::text FROM institution.work_accommodation WHERE student_id = {dora} $$, '0'),
  (1406, '7', 'dora', $$ SELECT count(*)::text FROM institution.work_accommodation $$, '0'),
  (1407, '7', 'dora', $$ SELECT coalesce(institution.work_accommodation({z1}, {dora})::text, 'null') $$, 'null'),
  -- A co-mentor with a grant on the work (work_grant) does not see the mark.
  (1501, 'grant', 'marko', $$ SELECT (institution.grant_work_access({zm1}, {ana}, {vesna}, 'committee', '{read_text}',
                                         NULL, now() + interval '30 days') IS NOT NULL)::text $$, 'true'),
  (1502, 'grant', 'vesna', $$ SELECT coalesce(institution.work_accommodation({zm1}, {ana})::text, 'null') $$, 'null'),
  (1503, 'grant', 'vesna', $$ SELECT count(*)::text FROM institution.work_accommodation WHERE assignment_id = {zm1} $$, '0');
SELECT * FROM pg_temp.run(1300, 1599);

-- 12. A teacher of the student's seminar group reads the mark like a course
-- teacher, and loses it with the group place. Marko teaches K2 only and is no
-- member of K1; Vesna opens G1 on K1 and puts him and Ana into it.
INSERT INTO step VALUES
  (1601, '12', 'ana', $$ SELECT institution.set_work_accommodation({z1}, true)::text $$, 'true'),
  (1602, '12', 'marko', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'null'),
  (1603, '12', 'marko', $$ SELECT count(*)::text FROM institution.work_accommodation WHERE assignment_id = {z1} $$, '0');
SELECT * FROM pg_temp.run(1600, 1609);
INSERT INTO ref VALUES ('g1', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa 1') $$));
INSERT INTO step VALUES
  (1610, '12', 'vesna', $$ SELECT 'ok' FROM institution.assign_group_teacher({g1}, {marko}) $$, 'ok'),
  (1611, '12', 'marko', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'null'),
  (1612, '12', 'vesna', $$ SELECT 'ok' FROM institution.assign_group_student({g1}, {ana}) $$, 'ok'),
  (1613, '12', 'marko', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'true'),
  (1614, '12', 'marko', $$ SELECT count(*)::text FROM institution.work_accommodation WHERE assignment_id = {z1} $$, '1'),
  -- Not of his group: Dora's row on Z1 stays hidden, and he writes nothing.
  (1615, '12', 'marko', $$ SELECT coalesce(institution.work_accommodation({z1}, {dora})::text, 'null') $$, 'null'),
  (1616, '12', 'marko', $$ SELECT institution.set_work_accommodation({z1}, true)::text $$, 'ZD403: forbidden'),
  (1617, '12', 'ana', $$ SELECT institution.set_work_accommodation({z1}, false)::text $$, 'false'),
  (1618, '12', 'marko', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'false'),
  (1619, '12', 'ana', $$ SELECT institution.set_work_accommodation({z1}, true)::text $$, 'true'),
  -- Vesna ends Marko's place in G1: the mark is again none of his business.
  (1620, '12', 'vesna', $$ SELECT 'ok' FROM institution.end_group_assignment({g1}, {marko}) $$, 'ok'),
  (1621, '12', 'marko', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'null'),
  (1622, '12', 'marko', $$ SELECT count(*)::text FROM institution.work_accommodation WHERE assignment_id = {z1} $$, '0'),
  (1623, '12', 'db', $$ SELECT pg_temp.state() $$, 'marks z1.ana,z1.dora,z3.tomo,zm1.ana');
SELECT * FROM pg_temp.run(1610, 1699);

-- A teacher of another group of the same course is no teacher of the
-- student's group; Ana's place in a group ends with her as a member, and
-- Marko's with his teacher role.
INSERT INTO ref VALUES ('g2', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa 2') $$));
INSERT INTO step VALUES
  (1701, '12', 'vesna', $$ SELECT 'ok' FROM institution.assign_group_teacher({g2}, {marko}) $$, 'ok'),
  (1702, '12', 'marko', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'null'),
  (1703, '12', 'marko', $$ SELECT count(*)::text FROM institution.work_accommodation WHERE assignment_id = {z1} $$, '0'),
  (1704, '12', 'vesna', $$ SELECT 'ok' FROM institution.end_group_assignment({g1}, {ana}) $$, 'ok'),
  (1705, '12', 'vesna', $$ SELECT 'ok' FROM institution.assign_group_student({g2}, {ana}) $$, 'ok'),
  (1706, '12', 'marko', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'true'),
  (1707, '12', 'vesna', $$ SELECT 'ok' FROM institution.end_group_assignment({g2}, {ana}) $$, 'ok'),
  (1708, '12', 'marko', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'null'),
  (1709, '12', 'marko', $$ SELECT count(*)::text FROM institution.work_accommodation WHERE assignment_id = {z1} $$, '0'),
  (1710, '12', 'vesna', $$ SELECT 'ok' FROM institution.assign_group_student({g2}, {ana}) $$, 'ok'),
  (1711, '12', 'marko', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'true'),
  (1712, '12', 'iva', $$ SELECT institution.revoke_teacher_role({marko})::text $$, 'true'),
  (1713, '12', 'marko', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'null'),
  (1714, '12', 'marko', $$ SELECT count(*)::text FROM institution.work_accommodation WHERE assignment_id = {z1} $$, '0'),
  (1715, '12', 'db', $$ SELECT pg_temp.state() $$, 'marks z1.ana,z1.dora,z3.tomo,zm1.ana');
SELECT * FROM pg_temp.run(1700, 1799);

-- 13. A group teacher who is a member of her own group gets nothing for her own
-- work through the group branch: there she is the student, never the teacher.
-- Iva confirms Nina; Vesna makes her the teacher of G1, moves Ana there from
-- G2, and once Nina has enrolled in K1 with its code, makes her a student of
-- G1 as well.
INSERT INTO step VALUES
  (1801, '13', 'db', $$ INSERT INTO identity.teacher_eligibility (user_id, institution_id)
                        VALUES (pg_temp.id('nina'), pg_temp.id('fak_a')) RETURNING 'ok' $$, 'ok'),
  (1802, '13', 'iva', $$ SELECT 'ok' FROM institution.confirm_teacher_role({nina}) $$, 'ok'),
  (1803, '13', 'vesna', $$ SELECT 'ok' FROM institution.assign_group_teacher({g1}, {nina}) $$, 'ok'),
  (1804, '13', 'vesna', $$ SELECT 'ok' FROM institution.end_group_assignment({g2}, {ana}) $$, 'ok'),
  (1805, '13', 'vesna', $$ SELECT 'ok' FROM institution.assign_group_student({g1}, {ana}) $$, 'ok'),
  (1806, '13', 'nina', $$ SELECT (e::text = '(enrolled,' || {k1} || ')')::text FROM institution.enroll_with_code('KOD-K1-TEST') e $$, 'true'),
  (1807, '13', 'vesna', $$ SELECT 'ok' FROM institution.assign_group_student({g1}, {nina}) $$, 'ok'),
  -- Nina is a student of K1, so Ana's mark reaches her only as the group's
  -- teacher; Dora is of no group of hers.
  (1808, '13', 'nina', $$ SELECT coalesce(institution.work_accommodation({z1}, {ana})::text, 'null') $$, 'true'),
  (1809, '13', 'nina', $$ SELECT coalesce(institution.work_accommodation({z1}, {dora})::text, 'null') $$, 'null'),
  (1810, '13', 'nina', $$ SELECT institution.set_work_accommodation({z1}, true)::text $$, 'true'),
  (1811, '13', 'nina', $$ SELECT coalesce(institution.work_accommodation({z1}, {nina})::text, 'null') $$, 'true'),
  (1812, '13', 'nina', $$ SELECT count(*)::text FROM institution.work_accommodation WHERE assignment_id = {z1} $$, '2');
SELECT * FROM pg_temp.run(1800, 1819);
-- Her own value above is the student's answer. The group branch, asked as the
-- reader asks it (as its owner role, with her session), gives her Ana's work
-- and not her own.
SELECT is(pg_temp.ask_as('ductus_identity', 'nina',
            $$ SELECT institution.actor_group_work({z1}, {nina})::text || ',' || institution.actor_group_work({z1}, {ana})::text $$),
          'false,true', '1820 (class 13, nina): the group branch answers for Ana''s work, not for her own');
INSERT INTO step VALUES
  (1821, '13', 'nina', $$ SELECT institution.set_work_accommodation({z1}, false)::text $$, 'false'),
  (1822, '13', 'nina', $$ SELECT coalesce(institution.work_accommodation({z1}, {nina})::text, 'null') $$, 'false'),
  (1823, '13', 'db', $$ SELECT pg_temp.state() $$, 'marks z1.ana,z1.dora,z3.tomo,zm1.ana');
SELECT * FROM pg_temp.run(1821, 1899);

SELECT * FROM finish();
ROLLBACK;

-- DAN-505, M2.Q (plan-m2 T149; contract on #1091, c.6587091759): one access
-- matrix of M2 over seven actors - student, teacher, mentor, co-mentor,
-- committee member, administrator and a user of another institution - with
-- no session and a closed one as controls. Every cell is an actor, an action
-- and a target that is the actor's own, someone else's at the same
-- institution, or another institution's. The group scope of M2.5 (#1372)
-- adds Goran's decisions on the work Ana started in his group (section 3);
-- the rows he sees are unchanged, because course_read is.
-- Personas of institution.inc and mentorship.inc; Ema, Goran and Hana are
-- invented teachers of fak-a, as in 102.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
\ir fixtures/mentorship.inc
SELECT no_plan();

INSERT INTO person
SELECT p.name, ('00000000-0000-4000-8000-0000000001' || p.n)::uuid, pg_temp.id('fak_a'), 'fak-a'
FROM (VALUES ('ema', '11'), ('goran', '13'), ('hana', '14')) AS p (name, n);
INSERT INTO tok VALUES ('ema', repeat('K', 43)), ('goran', repeat('M', 43)), ('hana', repeat('N', 43));
INSERT INTO ref SELECT name, id::text FROM person WHERE name IN ('ema', 'goran', 'hana');
INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
SELECT id, institution_id, 'https://issuer.test', 'sub-' || name, name || '@fak-a.example'
FROM person WHERE name IN ('ema', 'goran', 'hana');
INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
SELECT sha256(convert_to(t.token, 'UTF8')), p.id, p.institution_id, now() + interval '1 hour'
FROM person p JOIN tok t USING (name) WHERE p.name IN ('ema', 'goran', 'hana');
INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_by, confirmed_at)
SELECT p.institution_id, p.id, 'teacher', pg_temp.id('iva'), now()
FROM person p WHERE p.name IN ('ema', 'goran', 'hana');

-- One work per (student, assignment), as in 098.
CREATE TEMP TABLE work (id text PRIMARY KEY, faculty text, assignment text, owner text);
INSERT INTO work VALUES
  ('doc-ana-z1', 'fak_a', 'z1', 'ana'), ('doc-dora-z1', 'fak_a', 'z1', 'dora'),
  ('doc-ana-zm1', 'fak_a', 'zm1', 'ana'), ('doc-dora-zm2', 'fak_a', 'zm2', 'dora'),
  ('doc-tomo-z3', 'fak_b', 'z3', 'tomo');
GRANT SELECT ON work TO PUBLIC;
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id)
SELECT 'project-' || w.id, pg_temp.id(w.faculty), pg_temp.id(w.assignment), pg_temp.id(w.owner) FROM work w;
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash)
SELECT w.id, pg_temp.id(w.faculty), 'project-' || w.id, pg_temp.id(w.owner), repeat('a', 64) FROM work w;
INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash)
SELECT w.id, pg_temp.id(w.faculty), 0, pg_temp.id(w.owner), repeat('a', 64) FROM work w;
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;

-- 1. The M2 state, made through the RPCs: Vesna holds K1 and gives it group
-- GA with Goran as its teacher and Ana as its student; Petra does the same
-- for K3 with GB and Tomo. Marko, Ana's mentor, grants Ema (co-mentor) read
-- and comment and Hana (committee) read on Ana's thesis.
INSERT INTO ref VALUES
  ('ga', pg_temp.ask('vesna', $$ SELECT institution.create_seminar_group({k1}, 'Grupa A') $$)),
  ('gb', pg_temp.ask('petra', $$ SELECT institution.create_seminar_group({k3}, 'Grupa B') $$)),
  ('g_ema', pg_temp.ask('marko', $$ SELECT institution.grant_work_access({zm1}, {ana}, {ema}, 'co_mentor', '{read_text,comment}', NULL, now() + interval '30 days') $$)),
  ('g_hana', pg_temp.ask('marko', $$ SELECT institution.grant_work_access({zm1}, {ana}, {hana}, 'committee', '{read_text}', NULL, now() + interval '30 days') $$));
SELECT is(
  (SELECT string_agg(s.actor || ' ' || pg_temp.ask(s.actor, s.call), ' | ' ORDER BY s.n)
   FROM (VALUES
     (1, 'vesna', $$ SELECT 'ok' FROM institution.set_course_holder({k1}, {vesna}) $$),
     (2, 'vesna', $$ SELECT 'ok' FROM institution.assign_group_teacher({ga}, {goran}) $$),
     (3, 'vesna', $$ SELECT 'ok' FROM institution.assign_group_student({ga}, {ana}) $$),
     (4, 'petra', $$ SELECT 'ok' FROM institution.set_course_holder({k3}, {petra}) $$),
     (5, 'petra', $$ SELECT 'ok' FROM institution.assign_group_student({gb}, {tomo}) $$)
   ) AS s (n, actor, call)),
  'vesna ok | vesna ok | vesna ok | petra ok | petra ok',
  'the teaching teams of K1 and K3 are set through the RPCs'
);
SELECT is_empty(
  $$ SELECT name || ': ' || val FROM ref WHERE name IN ('ga', 'gb', 'g_ema', 'g_hana') AND val !~ '^[0-9a-f-]{36}$' $$,
  'both groups and both grants were made through the RPCs'
);

-- The actors of the matrix, with the controls.
CREATE TEMP TABLE actor (name text PRIMARY KEY, kind text NOT NULL);
INSERT INTO actor VALUES
  ('ana', 'student'), ('vesna', 'teacher'), ('marko', 'mentor'), ('ema', 'co-mentor'), ('hana', 'committee'),
  ('goran', 'group teacher'), ('iva', 'administrator'), ('petra', 'teacher of fak-b'), ('tomo', 'student of fak-b'), ('lea', 'administrator of fak-b'),
  ('anon', 'no session'), ('closed', 'closed session');

-- 2. Rows seen through ductus_app, every one of the 14 readable tables of
-- the institution schema. Each row gets a label of names and the
-- institution it belongs to; the institution of a code and of a version is
-- that of its course and its assignment.
CREATE TEMP TABLE row_inst AS
  SELECT id, institution_id FROM institution.course
  UNION ALL SELECT id, institution_id FROM institution.assignment;
CREATE FUNCTION pg_temp.nm(p_id uuid) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT coalesce((SELECT min(name) FROM pg_temp.ref WHERE val = p_id::text), '?') $$;
CREATE FUNCTION pg_temp.inst(p_id uuid) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT institution_id FROM pg_temp.row_inst WHERE id = p_id $$;
GRANT SELECT ON row_inst TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.nm(uuid), pg_temp.inst(uuid) TO PUBLIC;
CREATE TEMP TABLE seen (actor text, tbl text, label text, inst uuid);
INSERT INTO seen
SELECT a.name, r.tbl, r.label, r.inst
FROM actor a
CROSS JOIN LATERAL jsonb_to_recordset(pg_temp.ask(a.name, $q$
  SELECT coalesce(jsonb_agg(jsonb_build_object('tbl', t, 'label', l, 'inst', i)), '[]') FROM (
    SELECT 'settings' t, pg_temp.nm(institution_id) l, institution_id i FROM institution.institution_settings
    UNION ALL SELECT 'role', pg_temp.nm(user_id) || '=' || role || CASE WHEN revoked_at IS NULL THEN '' ELSE '~' END, institution_id FROM institution.institution_role
    UNION ALL SELECT 'course', pg_temp.nm(id), institution_id FROM institution.course
    UNION ALL SELECT 'code', pg_temp.nm(course_id), pg_temp.inst(course_id) FROM institution.course_enrollment_code
    UNION ALL SELECT 'member', pg_temp.nm(course_id) || '/' || pg_temp.nm(user_id), institution_id FROM institution.course_member
    UNION ALL SELECT 'assignment', pg_temp.nm(id), institution_id FROM institution.assignment
    UNION ALL SELECT 'version', pg_temp.nm(assignment_id) || '.' || version_no, pg_temp.inst(assignment_id) FROM institution.assignment_version
    UNION ALL SELECT 'ack', pg_temp.nm(assignment_id) || '.' || version_no || '/' || pg_temp.nm(student_id), institution_id FROM institution.notice_acknowledgment
    UNION ALL SELECT 'mentorship', pg_temp.nm(id), institution_id FROM institution.mentorship
    UNION ALL SELECT 'holder', pg_temp.nm(course_id) || '/' || pg_temp.nm(user_id), institution_id FROM institution.course_holder
    UNION ALL SELECT 'group', pg_temp.nm(id), institution_id FROM institution.seminar_group
    UNION ALL SELECT 'group_teacher', pg_temp.nm(group_id) || '/' || pg_temp.nm(user_id), institution_id FROM institution.seminar_group_teacher
    UNION ALL SELECT 'group_member', pg_temp.nm(group_id) || '/' || pg_temp.nm(user_id), institution_id FROM institution.seminar_group_member
    UNION ALL SELECT 'grant', pg_temp.nm(id), institution_id FROM institution.work_grant
  ) s $q$)::jsonb) AS r (tbl text, label text, inst uuid);

SELECT is_empty(
  $$ SELECT s.actor || ' ' || s.tbl || ' ' || s.label FROM seen s JOIN person p ON p.name = s.actor
     WHERE s.inst IS DISTINCT FROM p.institution_id $$,
  'other institution: no actor sees a row of an institution that is not their own'
);
SELECT is_empty(
  $$ SELECT actor || ' ' || tbl || ' ' || label FROM seen WHERE label LIKE '%?%' $$,
  'every row seen is a row of the fixture'
);
CREATE FUNCTION pg_temp.sees(p_actor text) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(tbl || ': ' || labels, ' | ' ORDER BY tbl), '-')
  FROM (SELECT tbl, string_agg(label, ' ' ORDER BY label) AS labels FROM seen WHERE actor = p_actor GROUP BY tbl) t
$$;
SELECT is(pg_temp.sees(v.actor), v.expected, v.actor || ' (' || (SELECT kind FROM actor WHERE name = v.actor) || '): ' || v.note)
FROM (VALUES
  ('ana', 'ack: z1.1/ana z1.2/ana zm1.1/ana | assignment: z1 zm1 | course: k1 | grant: g_ema g_hana | group_member: ga/ana | member: k1/ana k1/vesna | mentorship: ms1 | version: z1.1 z1.2 zm1.1',
   'own course, thesis, acknowledgments, group membership and both grants on her work; not Dora, no code, no holder, no group'),
  ('vesna', 'ack: z1.1/ana z1.1/dora z1.2/ana | assignment: z1 | code: k1 k1 | course: k1 | group: ga | group_member: ga/ana | group_teacher: ga/goran | holder: k1/vesna | member: k1/ana k1/dora k1/vesna | version: z1.1 z1.2',
   'all of K1 and its team; not her ended mentorship ms2, not K2, not Ana''s thesis or its grants'),
  ('marko', 'ack: zm1.1/ana | assignment: z2 zm1 | code: k2 | course: k2 | grant: g_ema g_hana | member: k2/marko | mentorship: ms1 | version: z2.1 zm1.1',
   'own course K2 and the thesis he mentors with its grants; nothing of K1'),
  ('ema', 'grant: g_ema',
   'only her own grant: no course, assignment or mentorship'),
  ('hana', 'grant: g_hana',
   'only her own grant, not Ema''s on the same work'),
  ('goran', 'group_teacher: ga/goran',
   'T053 until M2.5: only his own place as group teacher, not the group, the course or its students'),
  ('iva', 'role: ema=teacher goran=teacher hana=teacher iva=admin marko=teacher nina=teacher vesna=teacher | settings: fak_a',
   'roles and settings of the own institution, no course, mentorship, group or grant'),
  ('petra', 'ack: z3.1/tomo | assignment: z3 | code: k3 | course: k3 | group: gb | group_member: gb/tomo | holder: k3/petra | member: k3/petra k3/tomo | version: z3.1',
   'only K3 and its team'),
  ('tomo', 'ack: z3.1/tomo | assignment: z3 | course: k3 | group_member: gb/tomo | member: k3/petra k3/tomo | version: z3.1',
   'only his own part of K3'),
  ('lea', 'role: lea=admin petra=teacher | settings: fak_b',
   'roles and settings of fak-b only'),
  ('anon', '-', 'no session sees nothing'),
  ('closed', '-', 'a closed session sees nothing')
) AS v (actor, expected, note);


-- 3. The decisions over every actor, action and work: can() for the five
-- actions of the editor and grant_can() for the two of a grant. What is
-- allowed is listed; every other cell must be false.
CREATE TEMP TABLE decision (fn text, action text);
INSERT INTO decision VALUES
  ('can', 'read'), ('can', 'comment'), ('can', 'write'), ('can', 'propose'), ('can', 'open_fast_path'),
  ('grant_can', 'read_text'), ('grant_can', 'comment');
CREATE TEMP TABLE cell (actor text, fn text, action text, doc text, says text);
INSERT INTO cell
SELECT a.name, d.fn, d.action, w.id,
       pg_temp.ask(a.name, format('SELECT institution.%I(%L, %L)::text', d.fn, d.action, w.id))
FROM actor a CROSS JOIN decision d CROSS JOIN work w;
SELECT is((SELECT count(*)::integer FROM cell), 12 * 7 * 5, 'every actor, action and work was asked');
SELECT is_empty(
  $$ SELECT actor || ' ' || fn || ' ' || action || ' ' || doc || ': ' || coalesce(says, 'null')
     FROM cell WHERE says IS DISTINCT FROM 'true' AND says IS DISTINCT FROM 'false' $$,
  'every answer is true or false, none is an error'
);
SELECT bag_eq(
  $$ SELECT actor || ' ' || fn || ' ' || action || ' ' || doc FROM cell WHERE says = 'true' $$,
  $$ VALUES
    -- student: reads and writes her own works, nothing else (one writer)
    ('ana can read doc-ana-z1'), ('ana can write doc-ana-z1'), ('ana can read doc-ana-zm1'), ('ana can write doc-ana-zm1'),
    -- teacher of K1: the works of K1, never writes (D-34)
    ('vesna can read doc-ana-z1'), ('vesna can comment doc-ana-z1'), ('vesna can propose doc-ana-z1'), ('vesna can open_fast_path doc-ana-z1'),
    ('vesna can read doc-dora-z1'), ('vesna can comment doc-dora-z1'), ('vesna can propose doc-dora-z1'), ('vesna can open_fast_path doc-dora-z1'),
    -- group teacher of ga (M2.5, #1372): Ana's work in his group, as a teacher, never writes; not Dora's (no place)
    ('goran can read doc-ana-z1'), ('goran can comment doc-ana-z1'), ('goran can propose doc-ana-z1'), ('goran can open_fast_path doc-ana-z1'),
    -- mentor: the thesis he mentors, nothing of K1
    ('marko can read doc-ana-zm1'), ('marko can comment doc-ana-zm1'), ('marko can propose doc-ana-zm1'), ('marko can open_fast_path doc-ana-zm1'),
    -- co-mentor and committee member: only the granted actions of grant_can(), no can() (D-205 t. 3)
    ('ema grant_can read_text doc-ana-zm1'), ('ema grant_can comment doc-ana-zm1'), ('hana grant_can read_text doc-ana-zm1'),
    -- another institution: only its own work
    ('petra can read doc-tomo-z3'), ('petra can comment doc-tomo-z3'), ('petra can propose doc-tomo-z3'), ('petra can open_fast_path doc-tomo-z3'),
    ('tomo can read doc-tomo-z3'), ('tomo can write doc-tomo-z3') $$,
  'exactly the listed cells are allowed, every other one is refused'
);
SELECT is(
  (SELECT string_agg(a.name, ' ' ORDER BY a.name) FROM actor a
   WHERE NOT EXISTS (SELECT 1 FROM cell c WHERE c.actor = a.name AND c.says = 'true')),
  'anon closed iva lea',
  'no session, a closed one and both administrators decide nothing on any work'
);

-- 4. The role readers over every actor and every assignment and mentorship:
-- own, someone else's at the same institution, another institution's.
CREATE TEMP TABLE role_cell (actor text, target text, says text);
INSERT INTO role_cell
SELECT a.name, t.name, coalesce(pg_temp.ask(a.name, format('SELECT institution.%s(%L)', t.fn, pg_temp.id(t.name))), '-')
FROM actor a
CROSS JOIN (VALUES ('actor_assignment_role', 'z1'), ('actor_assignment_role', 'z2'), ('actor_assignment_role', 'z3'),
                   ('actor_assignment_role', 'zm1'), ('actor_assignment_role', 'zm2'),
                   ('actor_course_role', 'k1'), ('actor_course_role', 'k3'),
                   ('actor_mentorship_role', 'ms1'), ('actor_mentorship_role', 'ms2')) AS t (fn, name);
SELECT bag_eq(
  $$ SELECT actor || ' ' || target || ' ' || says FROM role_cell WHERE says <> '-' $$,
  $$ VALUES ('ana k1 student'), ('ana z1 student'), ('ana zm1 student'), ('ana ms1 student'),
            ('vesna k1 teacher'), ('vesna z1 teacher'), ('marko z2 teacher'), ('marko zm1 teacher'), ('marko ms1 teacher'),
            ('petra k3 teacher'), ('petra z3 teacher'), ('tomo k3 student'), ('tomo z3 student') $$,
  'exactly the listed actors hold a role in an assignment, course or mentorship; every other cell is none'
);

-- An ended mentorship (Vesna's ms2), a grant (Ema, Hana) and a group place
-- (Goran) give no role.

-- 5. Istodobnost, in one transaction: a grant that ends between two reads,
-- a revocation and a role taken away between two reads. Each decision is
-- taken at its own statement, nothing is cached. Across connections: the
-- integration test work-grant-race (pgTAP has one connection).
INSERT INTO ref VALUES ('g_goran', pg_temp.ask('marko',
  $$ SELECT institution.grant_work_access({zm1}, {ana}, {goran}, 'co_mentor', '{read_text}', NULL, clock_timestamp() + interval '80 milliseconds') $$));
SELECT is(pg_temp.ask('goran', $$ SELECT institution.grant_can('read_text', 'doc-ana-zm1')::text $$), 'true', 'Goran reads within his 80 ms');
SELECT pg_sleep(0.1);
SELECT is(pg_temp.ask('goran', $$ SELECT institution.grant_can('read_text', 'doc-ana-zm1')::text $$), 'false',
  'the grant ended between two reads: the second read is false');
SELECT is(pg_temp.ask('marko', $$ SELECT institution.revoke_work_access({g_hana})::text $$), 'true', 'Marko revokes Hana''s grant');
SELECT is(pg_temp.ask('hana', $$ SELECT institution.grant_can('read_text', 'doc-ana-zm1')::text $$), 'false',
  'revoked between two reads: the committee member reads nothing');
SELECT is(pg_temp.ask('iva', $$ SELECT 'ok' FROM institution.revoke_teacher_role({ema}) $$), 'ok', 'Iva revokes Ema''s teacher role');
SELECT is(pg_temp.ask('ema', $$ SELECT institution.grant_can('comment', 'doc-ana-zm1')::text $$), 'false',
  'role taken away between two reads: the co-mentor comments no more, though the grant is not revoked');

-- 6. The M2 RPCs that change state, by actor and target, in order.
SELECT is(regexp_replace(pg_temp.ask(v.actor, v.call), ':.*$', ''), v.expect, format('%s %s: %s', v.actor, v.what, v.expect))
FROM (VALUES
  ('anon', $$ SELECT 'ok' FROM institution.set_course_holder({k1}, {vesna}) $$, 'ZD401', 'holder of K1 without a session'),
  ('ana', $$ SELECT 'ok' FROM institution.set_course_holder({k1}, {ana}) $$, 'ZD403', 'holder of her own course'),
  ('marko', $$ SELECT 'ok' FROM institution.set_course_holder({k1}, {marko}) $$, 'ZD403', 'holder of a course of someone else'),
  ('goran', $$ SELECT 'ok' FROM institution.set_course_holder({k1}, {goran}) $$, 'ZD403', 'holder of the course of his group'),
  ('hana', $$ SELECT 'ok' FROM institution.set_course_holder({k1}, {hana}) $$, 'ZD403', 'holder of a course of someone else'),
  ('iva', $$ SELECT 'ok' FROM institution.set_course_holder({k1}, {vesna}) $$, 'ZD403', 'holder of a course of her institution'),
  ('petra', $$ SELECT 'ok' FROM institution.set_course_holder({k1}, {petra}) $$, 'ZD403', 'holder of a course of another institution'),
  ('vesna', $$ SELECT 'ok' FROM institution.set_course_holder({k3}, {vesna}) $$, 'ZD403', 'holder of a course of another institution'),
  ('vesna', $$ SELECT 'ok' FROM institution.create_seminar_group({k1}, 'Grupa C') $$, 'ok', 'a group in her own course'),
  ('marko', $$ SELECT 'ok' FROM institution.create_seminar_group({k1}, 'Grupa D') $$, 'ZD403', 'a group in a course of someone else'),
  ('goran', $$ SELECT 'ok' FROM institution.create_seminar_group({k1}, 'Grupa D') $$, 'ZD403', 'a group in the course of his group'),
  ('iva', $$ SELECT 'ok' FROM institution.create_seminar_group({k1}, 'Grupa D') $$, 'ZD403', 'a group as administrator'),
  ('petra', $$ SELECT 'ok' FROM institution.create_seminar_group({k1}, 'Grupa D') $$, 'ZD403', 'a group in a course of another institution'),
  ('vesna', $$ SELECT 'ok' FROM institution.create_seminar_group({k3}, 'Grupa D') $$, 'ZD403', 'a group in a course of another institution'),
  ('vesna', $$ SELECT 'ok' FROM institution.assign_group_student({ga}, {dora}) $$, 'ok', 'a student of her course into her group'),
  ('goran', $$ SELECT 'ok' FROM institution.assign_group_student({ga}, {dora}) $$, 'ZD403', 'a student into his own group'),
  ('ana', $$ SELECT 'ok' FROM institution.assign_group_student({ga}, {dora}) $$, 'ZD403', 'a student into her own group'),
  ('vesna', $$ SELECT 'ok' FROM institution.assign_group_student({ga}, {tomo}) $$, 'ZD422', 'a student of another institution into her group'),
  ('vesna', $$ SELECT 'ok' FROM institution.assign_group_student({gb}, {tomo}) $$, 'ZD403', 'a student into a group of another institution'),
  ('petra', $$ SELECT 'ok' FROM institution.assign_group_teacher({ga}, {petra}) $$, 'ZD403', 'herself into a group of another institution'),
  ('vesna', $$ SELECT 'ok' FROM institution.assign_group_teacher({ga}, {petra}) $$, 'ZD422', 'a teacher of another institution into her group'),
  ('vesna', $$ SELECT 'ok' FROM institution.end_group_assignment({gb}, {tomo}) $$, 'ZD403', 'ends a place in a group of another institution'),
  ('marko', $$ SELECT 'ok' FROM institution.end_group_assignment({ga}, {ana}) $$, 'ZD403', 'ends a place in a group of someone else'),
  ('vesna', $$ SELECT 'ok' FROM institution.end_group_assignment({ga}, {dora}) $$, 'ok', 'ends a place in her own group'),
  ('anon', $$ SELECT institution.grant_work_access({zm1}, {ana}, {vesna}, 'committee', '{read_text}', NULL, now() + interval '1 day')::text $$, 'ZD401', 'a grant without a session'),
  ('ana', $$ SELECT institution.grant_work_access({zm1}, {ana}, {vesna}, 'committee', '{read_text}', NULL, now() + interval '1 day')::text $$, 'ZD403', 'a grant on her own work'),
  ('vesna', $$ SELECT institution.grant_work_access({zm1}, {ana}, {vesna}, 'committee', '{read_text}', NULL, now() + interval '1 day')::text $$, 'ZD403', 'a grant on a thesis of someone else'),
  ('ema', $$ SELECT institution.grant_work_access({zm1}, {ana}, {vesna}, 'committee', '{read_text}', NULL, now() + interval '1 day')::text $$, 'ZD403', 'a grant further, as co-mentor'),
  ('hana', $$ SELECT institution.grant_work_access({zm1}, {ana}, {vesna}, 'committee', '{read_text}', NULL, now() + interval '1 day')::text $$, 'ZD403', 'a grant further, as committee member'),
  ('iva', $$ SELECT institution.grant_work_access({zm1}, {ana}, {vesna}, 'committee', '{read_text}', NULL, now() + interval '1 day')::text $$, 'ZD403', 'a grant as administrator'),
  ('vesna', $$ SELECT 'ok' FROM institution.grant_work_access({z1}, {ana}, {hana}, 'committee', '{read_text}', NULL, now() + interval '1 day') $$, 'ok', 'a grant on a work of her own course'),
  ('petra', $$ SELECT institution.grant_work_access({zm1}, {ana}, {vesna}, 'committee', '{read_text}', NULL, now() + interval '1 day')::text $$, 'ZD403', 'a grant on a work of another institution'),
  ('petra', $$ SELECT institution.grant_work_access({z3}, {tomo}, {vesna}, 'committee', '{read_text}', NULL, now() + interval '1 day')::text $$, 'ZD422', 'a grant to a teacher of another institution'),
  ('ana', $$ SELECT institution.revoke_work_access({g_ema})::text $$, 'ZD403', 'revokes a grant on her own work'),
  ('ema', $$ SELECT institution.revoke_work_access({g_ema})::text $$, 'ZD403', 'revokes her own grant'),
  ('vesna', $$ SELECT institution.revoke_work_access({g_ema})::text $$, 'ZD403', 'revokes a grant on a thesis of someone else'),
  ('petra', $$ SELECT institution.revoke_work_access({g_ema})::text $$, 'ZD403', 'revokes a grant of another institution'),
  ('marko', $$ SELECT institution.revoke_work_access({g_ema})::text $$, 'true', 'revokes a grant he gave')
) AS v (actor, call, expect, what);

SELECT * FROM finish();
ROLLBACK;

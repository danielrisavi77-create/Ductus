-- DAN-379, M2.8-P01 (contract on #1091, c.6584625903): a co-mentor and a
-- member of a committee get a grant per work and per action, limited in time,
-- and nothing by default (D-205 t. 3). institution.grant_can(action, work)
-- is the decision; this table walks every class of input over every actor,
-- action and work, before and after changes of state. Personas of
-- institution.inc and mentorship.inc; Ema, Filip, Goran and Hana are four
-- more invented teachers of fak-a.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
\ir fixtures/mentorship.inc
SELECT no_plan();

INSERT INTO person
SELECT p.name, ('00000000-0000-4000-8000-0000000001' || p.n)::uuid, pg_temp.id('fak_a'), 'fak-a'
FROM (VALUES ('ema', '11'), ('filip', '12'), ('goran', '13'), ('hana', '14')) AS p (name, n);
INSERT INTO tok VALUES ('ema', repeat('K', 43)), ('filip', repeat('L', 43)), ('goran', repeat('M', 43)), ('hana', repeat('N', 43));
INSERT INTO ref SELECT name, id::text FROM person WHERE name IN ('ema', 'filip', 'goran', 'hana');
INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
SELECT id, institution_id, 'https://issuer.test', 'sub-' || name, name || '@fak-a.example'
FROM person WHERE name IN ('ema', 'filip', 'goran', 'hana');
INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
SELECT sha256(convert_to(t.token, 'UTF8')), p.id, p.institution_id, now() + interval '1 hour'
FROM person p JOIN tok t USING (name) WHERE p.name IN ('ema', 'filip', 'goran', 'hana');
INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_by, confirmed_at)
SELECT p.institution_id, p.id, 'teacher', pg_temp.id('iva'), now()
FROM person p WHERE p.name IN ('ema', 'filip', 'goran', 'hana');

-- One work per (student, assignment), as in 098.
CREATE TEMP TABLE work (id text PRIMARY KEY, faculty text, assignment text, owner text);
INSERT INTO work VALUES
  ('doc-ana-z1', 'fak_a', 'z1', 'ana'), ('doc-dora-z1', 'fak_a', 'z1', 'dora'),
  ('doc-ana-zm1', 'fak_a', 'zm1', 'ana'), ('doc-tomo-z3', 'fak_b', 'z3', 'tomo');
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
INSERT INTO work VALUES ('doc-nobody', NULL, NULL, NULL);

CREATE TEMP TABLE action (name text PRIMARY KEY);
INSERT INTO action VALUES ('read_text'), ('comment');

-- 1. The functions and the table.
SELECT is(
  (SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || pg_get_function_result(p.oid)
          || ' ' || p.provolatile::text || CASE WHEN p.prosecdef THEN ' definer' ELSE '' END
          || CASE WHEN has_function_privilege('ductus_app', p.oid, 'EXECUTE') THEN ' app' ELSE '' END, ' | ' ORDER BY p.proname)
   FROM pg_proc p
   WHERE p.pronamespace = 'institution'::regnamespace
     AND p.proname IN ('grant_can', 'grant_work_access', 'revoke_work_access', 'work_relation', 'is_grant_action_set')),
  'grant_can(p_action text, p_document_id text) boolean s definer app'
  ' | grant_work_access(p_assignment_id uuid, p_student_id uuid, p_grantee_id uuid, p_kind text, p_actions text[], p_valid_from timestamp with time zone, p_valid_to timestamp with time zone) uuid v definer app'
  ' | is_grant_action_set(p_actions text[]) boolean i'
  ' | revoke_work_access(p_grant_id uuid) boolean v definer app'
  ' | work_relation(p_user_id uuid, p_assignment_id uuid) text s',
  'grant_can() takes the action and the work, never the actor; the helpers are not callable by ductus_app'
);
SELECT ok(
  (SELECT c.relrowsecurity AND c.relforcerowsecurity AND c.relowner = 'ductus_identity'::regrole
   FROM pg_class c WHERE c.oid = 'institution.work_grant'::regclass),
  'work_grant has ENABLE and FORCE ROW LEVEL SECURITY and belongs to ductus_identity'
);

-- 2. The grants, one class of input each. Vesna teaches K1 (Z1), Marko
-- mentors Ana (zm1). Each grantee holds one grant, so a cell reads as its
-- class: Marko an active read on Ana's Z1 (granted by Vesna); Vesna an active
-- read and comment on Ana's zm1 (granted by Marko); Hana an active read and
-- comment on Ana's Z1; Filip one that starts tomorrow; Goran one that is
-- revoked below; Ema one that ended yesterday (written by the owner role,
-- since grant_work_access refuses an end in the past).
INSERT INTO ref VALUES
  ('g_marko', pg_temp.ask('vesna', $$ SELECT institution.grant_work_access({z1}, {ana}, {marko}, 'co_mentor', '{read_text}', NULL, now() + interval '1 day') $$)),
  ('g_vesna', pg_temp.ask('marko', $$ SELECT institution.grant_work_access({zm1}, {ana}, {vesna}, 'committee', '{read_text,comment}', NULL, now() + interval '30 days') $$)),
  ('g_hana', pg_temp.ask('vesna', $$ SELECT institution.grant_work_access({z1}, {ana}, {hana}, 'committee', '{comment,read_text}', NULL, now() + interval '1 day') $$)),
  ('g_filip', pg_temp.ask('vesna', $$ SELECT institution.grant_work_access({z1}, {ana}, {filip}, 'co_mentor', '{read_text,comment}', now() + interval '1 day', now() + interval '2 days') $$)),
  ('g_goran', pg_temp.ask('vesna', $$ SELECT institution.grant_work_access({z1}, {ana}, {goran}, 'co_mentor', '{read_text,comment}', NULL, now() + interval '1 day') $$));
SELECT is_empty(
  $$ SELECT name || ': ' || val FROM ref WHERE name LIKE 'g\_%' AND val !~ '^[0-9a-f-]{36}$' $$,
  'every grant of the table was made through grant_work_access'
);
SET LOCAL ROLE ductus_identity;
INSERT INTO institution.work_grant (institution_id, assignment_id, student_id, grantee_id, kind, actions, valid_from, valid_to, granted_by)
VALUES (pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('ana'), pg_temp.id('ema'), 'co_mentor', '{read_text,comment}',
        now() - interval '2 days', now() - interval '1 day', pg_temp.id('vesna'));
RESET ROLE;
SELECT is(pg_temp.ask('vesna', $$ SELECT institution.revoke_work_access({g_goran})::text $$), 'true', 'Vesna revokes Goran''s grant');
SELECT is(pg_temp.ask('vesna', $$ SELECT institution.revoke_work_access({g_goran})::text $$), 'false', 'a second revocation changes nothing');

-- 3. The table: every actor (fourteen people, an expired, a closed and an
-- unknown session and no cookie) by every action by every work, in rounds.
-- What is allowed is listed; every other cell must be false.
CREATE TEMP TABLE cell (round text, actor text, action text, doc text, says text);
CREATE TEMP TABLE allowed (round text, actor text, action text, doc text);
CREATE FUNCTION pg_temp.round(p_round text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO cell
  SELECT p_round, t.name, a.name, w.id,
         pg_temp.ask(t.name, format('SELECT institution.grant_can(%L, %L)::text', a.name, w.id))
  FROM tok t CROSS JOIN action a CROSS JOIN work w
$$;
CREATE FUNCTION pg_temp.check_round(p_round text) RETURNS SETOF text
LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEXT is((SELECT count(*)::integer FROM cell WHERE round = p_round), 18 * 2 * 5,
    p_round || ': every actor, action and work was asked');
  RETURN NEXT is_empty(format($q$
    SELECT actor || ' ' || action || ' ' || doc || ': ' || coalesce(says, 'null')
    FROM cell WHERE round = %L AND says IS DISTINCT FROM 'true' AND says IS DISTINCT FROM 'false'
  $q$, p_round), p_round || ': every answer is true or false, none is an error');
  RETURN NEXT bag_eq(
    format($q$ SELECT actor || ' ' || action || ' ' || doc FROM cell WHERE round = %L AND says = 'true' $q$, p_round),
    format($q$ SELECT actor || ' ' || action || ' ' || doc FROM allowed WHERE round = %L $q$, p_round),
    p_round || ': exactly the listed cells are allowed, every other one is refused');
END
$$;
CREATE FUNCTION pg_temp.says(p_round text, p_actor text, p_action text, p_doc text) RETURNS text
LANGUAGE sql AS $$
  SELECT says FROM cell WHERE round = p_round AND actor = p_actor AND action = p_action AND doc = p_doc
$$;

INSERT INTO allowed VALUES
  ('base', 'marko', 'read_text', 'doc-ana-z1'),
  ('base', 'vesna', 'read_text', 'doc-ana-zm1'), ('base', 'vesna', 'comment', 'doc-ana-zm1'),
  ('base', 'hana', 'read_text', 'doc-ana-z1'), ('base', 'hana', 'comment', 'doc-ana-z1');
SELECT pg_temp.round('base');
SELECT * FROM pg_temp.check_round('base');
-- The classes of the contract, as rows of the table.
SELECT is(pg_temp.says('base', 'marko', 'read_text', 'doc-ana-z1'), 'true', 'active grant, action in it: Marko reads the text of Ana''s Z1');
SELECT is(pg_temp.says('base', 'ema', 'read_text', 'doc-ana-z1'), 'false', 'expired grant: Ema reads nothing');
SELECT is(pg_temp.says('base', 'filip', 'read_text', 'doc-ana-z1'), 'false', 'grant with a future start: Filip reads nothing yet');
SELECT is(pg_temp.says('base', 'goran', 'read_text', 'doc-ana-z1'), 'false', 'revoked grant: Goran reads nothing');
SELECT is(pg_temp.says('base', 'marko', 'comment', 'doc-ana-z1'), 'false', 'action outside the grant: Marko does not comment');
SELECT is(pg_temp.says('base', 'marko', 'read_text', 'doc-dora-z1'), 'false', 'another work of the same assignment: not Dora''s');
SELECT is(pg_temp.says('base', 'hana', 'read_text', 'doc-ana-zm1'), 'false', 'another work of the same student: not Ana''s thesis');
SELECT is(pg_temp.says('base', 'vesna', 'read_text', 'doc-ana-z1'), 'false', 'a role without a grant: the teacher of K1 gets nothing from grant_can()');
SELECT is(pg_temp.says('base', 'iva', 'read_text', 'doc-ana-z1'), 'false', 'a role without a grant: the administrator');
SELECT is(pg_temp.says('base', 'ana', 'read_text', 'doc-ana-z1'), 'false', 'a role without a grant: the student herself');
SELECT is(pg_temp.says('base', 'petra', 'read_text', 'doc-ana-z1'), 'false', 'a role without a grant: a teacher of another institution');
SELECT is(pg_temp.says('base', 'marko', 'read_text', 'doc-tomo-z3'), 'false', 'a work of another institution');
SELECT is(pg_temp.says('base', 'anon', 'read_text', 'doc-ana-z1'), 'false', 'no session');
SELECT is(pg_temp.says('base', 'marko', 'read_text', 'doc-nobody'), 'false', 'a work that does not exist');

-- 4. Changes of state. Iva revokes Hana's teacher role: her grant stops.
-- Then Iva revokes Vesna's: Marko's grant, which Vesna gave, stops, and so
-- does Vesna's own on zm1.
SELECT is(pg_temp.ask('iva', $$ SELECT 'ok' FROM institution.revoke_teacher_role({hana}) $$), 'ok', 'Iva revokes Hana''s teacher role');
INSERT INTO allowed SELECT 'grantee-role', actor, action, doc FROM allowed WHERE round = 'base' AND actor <> 'hana';
SELECT pg_temp.round('grantee-role');
SELECT * FROM pg_temp.check_round('grantee-role');
SELECT is(pg_temp.ask('iva', $$ SELECT 'ok' FROM institution.revoke_teacher_role({vesna}) $$), 'ok', 'Iva revokes Vesna''s teacher role');
SELECT pg_temp.round('granter-role');
SELECT * FROM pg_temp.check_round('granter-role');
SELECT is(pg_temp.says('granter-role', 'marko', 'read_text', 'doc-ana-z1'), 'false', 'a grant ends when its granter no longer teaches the work');
SELECT is(pg_temp.says('granter-role', 'vesna', 'comment', 'doc-ana-zm1'), 'false', 'a grant ends when its grantee is no longer a teacher');

-- 5. Istodobnost: expiry and revocation between two reads of the same
-- transaction. The decision is taken at the time of each statement, so
-- neither is cached. (Revocation from another connection: the integration
-- test work-grant-race.)
INSERT INTO ref VALUES ('g_ema', pg_temp.ask('marko',
  $$ SELECT institution.grant_work_access({zm1}, {ana}, {ema}, 'co_mentor', '{read_text}', NULL, clock_timestamp() + interval '80 milliseconds') $$));
SELECT is(pg_temp.ask('ema', $$ SELECT institution.grant_can('read_text', 'doc-ana-zm1')::text $$), 'true', 'Ema reads within her 80 ms');
SELECT pg_sleep(0.1);
SELECT is(pg_temp.ask('ema', $$ SELECT institution.grant_can('read_text', 'doc-ana-zm1')::text $$), 'false',
  'the next statement after the end reads false, in the same transaction');
INSERT INTO ref VALUES ('g_filip2', pg_temp.ask('marko',
  $$ SELECT institution.grant_work_access({zm1}, {ana}, {filip}, 'committee', '{comment}', NULL, now() + interval '1 day') $$));
SELECT is(pg_temp.ask('filip', $$ SELECT institution.grant_can('comment', 'doc-ana-zm1')::text $$), 'true', 'Filip comments on Ana''s thesis');
SELECT is(pg_temp.ask('marko', $$ SELECT institution.revoke_work_access({g_filip2})::text $$), 'true', 'Marko revokes it');
SELECT is(pg_temp.ask('filip', $$ SELECT institution.grant_can('comment', 'doc-ana-zm1')::text $$), 'false', 'the next read is false');

-- 6. Input of grant_can().
SELECT matches(pg_temp.ask('marko', $$ SELECT institution.grant_can('read', 'doc-ana-z1')::text $$), '^ZD422: ',
  'the actions of can() are not actions of a grant: refused, not read as no');
SELECT matches(pg_temp.ask('marko', $$ SELECT institution.grant_can('write', 'doc-ana-z1')::text $$), '^ZD422: ', 'write is never granted');
SELECT matches(pg_temp.ask('anon', $$ SELECT institution.grant_can('Read_text', 'doc-ana-z1')::text $$), '^ZD422: ', 'matched exactly, also without a session');
SELECT matches(pg_temp.ask('marko', $$ SELECT institution.grant_can(NULL, 'doc-ana-z1')::text $$), '^ZD422: ', 'a null action is refused');
SELECT is(pg_temp.ask('ema', $$ SELECT institution.grant_can('read_text', NULL)::text $$), 'false', 'a null work is not readable');

-- 7. grant_work_access refuses, one row per class.
SELECT is(
  regexp_replace(pg_temp.ask(v.actor, format('SELECT institution.grant_work_access(%s)', v.args)), ':.*$', ''), v.expect,
  format('grant refused: %s', v.what)
)
FROM (VALUES
  ('anon', '{z1}, {ana}, {ema}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD401', 'no session'),
  ('dora', '{z1}, {ana}, {ema}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD403', 'a student'),
  ('iva', '{z1}, {ana}, {ema}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD403', 'the administrator'),
  ('ema', '{z1}, {ana}, {goran}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD403', 'a teacher who does not teach the work'),
  ('marko', '{z1}, {ana}, {ema}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD403', 'a teacher of another course'),
  ('ema', '{zm1}, {ana}, {goran}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD403', 'a grantee does not grant further'),
  ('nina', '{zm3}, {boris}, {ema}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD403', 'a mentor whose teacher role nobody confirmed'),
  ('vesna', '{zm2}, {dora}, {ema}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD403', 'an ended mentorship (and a revoked role)'),
  ('petra', '{z1}, {ana}, {ema}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD403', 'a teacher of another institution'),
  ('marko', '{nobody}, {ana}, {ema}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD403', 'an assignment that does not exist'),
  ('marko', '{zm1}, {boris}, {ema}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD422', 'a student who is not the student of the work'),
  ('marko', '{zm1}, {tomo}, {ema}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD422', 'a student of another institution'),
  ('marko', '{zm1}, {ana}, {nina}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD422', 'a grantee whose teacher role nobody confirmed'),
  ('marko', '{zm1}, {ana}, {hana}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD422', 'a grantee whose teacher role was revoked'),
  ('marko', '{zm1}, {ana}, {iva}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD422', 'a grantee who is only an administrator'),
  ('marko', '{zm1}, {ana}, {petra}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD422', 'a grantee of another institution'),
  ('marko', '{zm1}, {ana}, {ana}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD422', 'the student as the grantee'),
  ('marko', '{zm1}, {ana}, {marko}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD422', 'the granter as the grantee'),
  ('marko', '{zm1}, {ana}, NULL, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD422', 'no grantee'),
  ('marko', '{zm1}, {ana}, {ema}, ''reviewer'', ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD422', 'an unknown kind'),
  ('marko', '{zm1}, {ana}, {ema}, NULL, ''{read_text}'', NULL, now() + interval ''1 day''', 'ZD422', 'no kind'),
  ('marko', '{zm1}, {ana}, {ema}, ''co_mentor'', ''{}'', NULL, now() + interval ''1 day''', 'ZD422', 'no action: there is no default set'),
  ('marko', '{zm1}, {ana}, {ema}, ''co_mentor'', NULL, NULL, now() + interval ''1 day''', 'ZD422', 'a null set of actions'),
  ('marko', '{zm1}, {ana}, {ema}, ''co_mentor'', ''{read}'', NULL, now() + interval ''1 day''', 'ZD422', 'read of can(), which opens the replay'),
  ('marko', '{zm1}, {ana}, {ema}, ''co_mentor'', ''{write}'', NULL, now() + interval ''1 day''', 'ZD422', 'write'),
  ('marko', '{zm1}, {ana}, {ema}, ''co_mentor'', ''{propose}'', NULL, now() + interval ''1 day''', 'ZD422', 'propose'),
  ('marko', '{zm1}, {ana}, {ema}, ''co_mentor'', ''{open_fast_path}'', NULL, now() + interval ''1 day''', 'ZD422', 'open_fast_path'),
  ('marko', '{zm1}, {ana}, {ema}, ''co_mentor'', ''{read_text,read_text}'', NULL, now() + interval ''1 day''', 'ZD422', 'a repeated action'),
  ('marko', '{zm1}, {ana}, {ema}, ''co_mentor'', ARRAY[''read_text'', NULL], NULL, now() + interval ''1 day''', 'ZD422', 'a null action in the set'),
  ('marko', '{zm1}, {ana}, {ema}, ''co_mentor'', ''{{read_text}}'', NULL, now() + interval ''1 day''', 'ZD422', 'a set of two dimensions'),
  ('marko', '{zm1}, {ana}, {ema}, ''co_mentor'', ''[2:2]={read_text}'', NULL, now() + interval ''1 day''', 'ZD422', 'a set that does not start at 1'),
  ('marko', '{zm1}, {ana}, {ema}, ''co_mentor'', ''{read_text}'', NULL, NULL', 'ZD422', 'no end'),
  ('marko', '{zm1}, {ana}, {ema}, ''co_mentor'', ''{read_text}'', NULL, ''infinity''', 'ZD422', 'an endless grant'),
  ('marko', '{zm1}, {ana}, {ema}, ''co_mentor'', ''{read_text}'', ''-infinity'', now() + interval ''1 day''', 'ZD422', 'a start of minus infinity'),
  ('marko', '{zm1}, {ana}, {ema}, ''co_mentor'', ''{read_text}'', NULL, now() - interval ''1 second''', 'ZD422', 'an end in the past'),
  ('marko', '{zm1}, {ana}, {ema}, ''co_mentor'', ''{read_text}'', now() + interval ''2 days'', now() + interval ''1 day''', 'ZD422', 'an end before the start'),
  ('marko', '{zm1}, {ana}, {ema}, ''co_mentor'', ''{read_text}'', now() + interval ''1 day'', now() + interval ''1 day''', 'ZD422', 'an end equal to the start'),
  ('marko', '{zm1}, {ana}, {ema}, ''co_mentor'', ''{read_text}'', NULL, now() + interval ''367 days''', 'ZD422', 'longer than 366 days')
) AS v (actor, args, expect, what);
INSERT INTO ref VALUES ('g_goran_past', pg_temp.ask('marko', $$
  SELECT institution.grant_work_access({zm1}, {ana}, {goran}, 'co_mentor', '{read_text}',
                                       now() - interval '10 days', now() + interval '1 day') $$));
SELECT is(
  pg_temp.ask('marko', $$ SELECT (g.valid_from >= now())::text FROM institution.work_grant g WHERE g.id = {g_goran_past} $$),
  'true', 'a start in the past is taken as the time of the grant: no grant reaches back');

-- 8. revoke_work_access refuses.
SELECT is(regexp_replace(pg_temp.ask(v.actor, format('SELECT institution.revoke_work_access(%s)::text', v.grant_ref)), ':.*$', ''), v.expect,
  format('revocation refused: %s', v.what))
FROM (VALUES
  ('anon', '{g_vesna}', 'ZD401', 'no session'),
  ('ana', '{g_vesna}', 'ZD403', 'the student of the work'),
  ('vesna', '{g_vesna}', 'ZD403', 'the grantee'),
  ('iva', '{g_vesna}', 'ZD403', 'the administrator'),
  ('ema', '{g_vesna}', 'ZD403', 'a teacher who does not teach the work'),
  ('petra', '{g_vesna}', 'ZD403', 'a teacher of another institution'),
  ('marko', '{nobody}', 'ZD403', 'a grant that does not exist'),
  ('marko', 'NULL', 'ZD403', 'a null grant')
) AS v (actor, grant_ref, expect, what);

-- 9. Who reads the grants (RLS): the grantee, the student of the work and a
-- teacher of the work, all of one institution. Ana sees every grant on her
-- works, the ended and revoked ones too (rule 5).
CREATE FUNCTION pg_temp.grants_seen(p_actor text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, $q$
    SELECT coalesce(string_agg(p.name || '@' || a.name, ' ' ORDER BY p.name, a.name), '-')
    FROM institution.work_grant g
    JOIN pg_temp.person p ON p.id = g.grantee_id
    JOIN pg_temp.ref a ON a.val = g.assignment_id::text AND a.name IN ('z1', 'zm1')
  $q$)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.grants_seen(text) TO PUBLIC;
SELECT is(pg_temp.grants_seen('ana'),
  'ema@z1 ema@zm1 filip@z1 filip@zm1 goran@z1 goran@zm1 hana@z1 marko@z1 vesna@zm1',
  'Ana sees every grant on her works, ended and revoked ones too');
SELECT is(pg_temp.grants_seen('marko'), 'ema@zm1 filip@zm1 goran@zm1 marko@z1 vesna@zm1',
  'Marko sees his own grant and every grant on the thesis he mentors');
SELECT is(pg_temp.grants_seen('hana'), 'hana@z1', 'Hana sees her own grant');
SELECT is(pg_temp.grants_seen('vesna'), 'vesna@zm1', 'Vesna, with her role revoked, sees only her own grant');
SELECT is(pg_temp.grants_seen('dora'), '-', 'Dora sees no grant on Ana''s works');
SELECT is(pg_temp.grants_seen('iva'), '-', 'the administrator sees no grant');
SELECT is(pg_temp.grants_seen('petra'), '-', 'a teacher of another institution sees no grant');
SELECT is(pg_temp.grants_seen('anon'), '-', 'no session sees no grant');

-- 10. The client never writes a grant directly.
SELECT is(pg_temp.ask('marko', v.statement), '42501: permission denied for table work_grant', format('ductus_app may not %s', v.what))
FROM (VALUES
  ('insert', $$ INSERT INTO institution.work_grant (institution_id, assignment_id, student_id, grantee_id, kind, actions, valid_from, valid_to, granted_by)
                VALUES ({fak_a}, {zm1}, {ana}, {ema}, 'co_mentor', '{read_text}', now(), now() + interval '1 day', {marko}) RETURNING 'x' $$),
  ('update', $$ UPDATE institution.work_grant SET valid_to = now() + interval '300 days' RETURNING 'x' $$),
  ('delete', $$ DELETE FROM institution.work_grant RETURNING 'x' $$)
) AS v (what, statement);

-- 11. The table refuses what the function would, even for the owner role.
SELECT is(
  regexp_replace(pg_temp.ask_as('ductus_identity', 'anon', format($q$
    INSERT INTO institution.work_grant (institution_id, assignment_id, student_id, grantee_id, kind, actions, valid_from, valid_to, granted_by)
    VALUES ({fak_a}, {zm1}, {ana}, %s, 'co_mentor', %s, %s, %s, {marko}) RETURNING 'inserted' $q$, v.grantee, v.actions, v.valid_from, v.valid_to)), ':.*$', ''),
  '23514', format('the table refuses %s', v.what)
)
FROM (VALUES
  ('{ema}', '''{}''', 'now()', 'now() + interval ''1 day''', 'an empty set'),
  ('{ema}', '''{write}''', 'now()', 'now() + interval ''1 day''', 'write'),
  ('{ema}', '''{comment,comment}''', 'now()', 'now() + interval ''1 day''', 'a repeated action'),
  ('{ema}', '''{read_text}''', 'now()', 'now()', 'an empty interval'),
  ('{ema}', '''{read_text}''', 'now()', '''infinity''', 'an endless grant'),
  ('{ema}', '''{read_text}''', 'now()', 'now() + interval ''367 days''', 'longer than 366 days'),
  ('{ana}', '''{read_text}''', 'now()', 'now() + interval ''1 day''', 'the student as the grantee'),
  ('{marko}', '''{read_text}''', 'now()', 'now() + interval ''1 day''', 'the granter as the grantee')
) AS v (grantee, actions, valid_from, valid_to, what);

SELECT * FROM finish();
ROLLBACK;

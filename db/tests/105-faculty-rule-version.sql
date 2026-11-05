-- DAN-315, M2.12-P01a (D-175; plan of attack #1505, contract on #1091): the
-- faculty rule of a kind of work is a chain of published versions that never
-- change. Sections follow the plan: A immutability, B who may publish and
-- read, D every class of input (each also checks that nothing was written),
-- E4/E5 retries and atomicity, F the projection. E1 (two administrators at
-- once) and the revocation race are in
-- tests/integration/faculty-rule-version-race.integration.test.ts, F1 and F2
-- in faculty-rule-version-migration.integration.test.ts.
--
-- Personas of institution.inc and three more invented ones of fak-a: Ines, a
-- second confirmed administrator; Rita, an administrator whose role is
-- revoked below; Una, an administrator nobody has confirmed.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/institution.inc
SELECT no_plan();

INSERT INTO person VALUES
  ('ines', '00000000-0000-4000-8000-000000000121', pg_temp.id('fak_a'), 'fak-a'),
  ('rita', '00000000-0000-4000-8000-000000000122', pg_temp.id('fak_a'), 'fak-a'),
  ('una', '00000000-0000-4000-8000-000000000123', pg_temp.id('fak_a'), 'fak-a');
INSERT INTO tok VALUES ('ines', repeat('L', 43)), ('rita', repeat('M', 43)), ('una', repeat('N', 43));
INSERT INTO ref SELECT name, id::text FROM person WHERE name IN ('ines', 'rita', 'una');
INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
SELECT id, institution_id, 'https://issuer.test', 'sub-' || name, name || '@fak-a.example'
FROM person WHERE name IN ('ines', 'rita', 'una');
INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
SELECT sha256(convert_to(t.token, 'UTF8')), p.id, p.institution_id, now() + interval '1 hour'
FROM person p JOIN tok t USING (name) WHERE p.name IN ('ines', 'rita', 'una');
-- DAN-525: the operator appoints Ines and Rita on invented requests; Una's
-- administrator row stays pending.
DO $$
BEGIN
  PERFORM institution.appoint_institution_admin(pg_temp.id(n), 'Zahtjev ' || n || '/2026') FROM unnest(ARRAY['ines', 'rita']) AS n;
END
$$;
INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_by, confirmed_at)
VALUES (pg_temp.id('fak_a'), pg_temp.id('una'), 'admin', NULL, NULL);

-- Counted over the two test faculties only, so rows of a seeded database do
-- not matter.
CREATE FUNCTION pg_temp.versions() RETURNS bigint
LANGUAGE sql AS $$
  SELECT count(*) FROM institution.faculty_rule_version
  WHERE institution_id IN (pg_temp.id('fak_a'), pg_temp.id('fak_b')) $$;
CREATE FUNCTION pg_temp.events() RETURNS bigint
LANGUAGE sql AS $$
  SELECT count(*) FROM audit.faculty_rule_event
  WHERE institution_id IN (pg_temp.id('fak_a'), pg_temp.id('fak_b')) $$;
CREATE FUNCTION pg_temp.rules() RETURNS bigint
LANGUAGE sql AS $$
  SELECT count(*) FROM institution.faculty_work_rule
  WHERE institution_id IN (pg_temp.id('fak_a'), pg_temp.id('fak_b')) $$;
CREATE FUNCTION pg_temp.written() RETURNS text
LANGUAGE sql AS $$ SELECT format('%s/%s/%s', pg_temp.versions(), pg_temp.events(), pg_temp.rules()) $$;
-- One call of the function with its six arguments written out as SQL.
CREATE FUNCTION pg_temp.publish(p_actor text, p_args text) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.ask(p_actor, 'SELECT institution.publish_faculty_rule_version(' || p_args || ')') $$;

-- 1. The catalogue. A parameter or column for anything still undecided
-- (thresholds, retention, providers, an effective date, an institution or an
-- author named by the caller) changes one of these lists.
SELECT is(
  (SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || pg_get_function_result(p.oid)
          || CASE WHEN p.prosecdef THEN ' definer' ELSE '' END
          || CASE WHEN has_function_privilege('ductus_app', p.oid, 'EXECUTE') THEN ' app' ELSE '' END, ' | ' ORDER BY p.proname)
   FROM pg_proc p
   WHERE p.pronamespace = 'institution'::regnamespace
     AND p.proname IN ('publish_faculty_rule_version', 'refuse_rule_version_change', 'check_rule_version_event')),
  'check_rule_version_event() trigger definer'
  ' | publish_faculty_rule_version(p_work_type text, p_expected_version integer, p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_import_allowed boolean) integer definer app'
  ' | refuse_rule_version_change() trigger',
  'one publishing function with the four decided fields, the work type and the expected version; the triggers are not callable'
);
SELECT columns_are('institution', 'faculty_rule_version', ARRAY[
  'institution_id', 'work_type', 'version_no', 'ai_policy', 'ai_purposes', 'evidence_profile', 'import_allowed',
  'origin', 'published_by', 'published_at'
], 'a version holds only the fields faculty_work_rule holds today, plus who and when');
SELECT columns_are('audit', 'faculty_rule_event', ARRAY[
  'id', 'institution_id', 'work_type', 'version_no', 'kind', 'actor_id', 'occurred_at'
], 'faculty_rule_event has exactly the listed columns');
SELECT bag_eq(
  $$ SELECT c.oid::regclass::text || ' ' || c.relowner::regrole::text || ' ' || c.relrowsecurity || ' ' || c.relforcerowsecurity
     FROM pg_class c WHERE c.oid IN ('institution.faculty_rule_version'::regclass, 'audit.faculty_rule_event'::regclass) $$,
  ARRAY['institution.faculty_rule_version ductus_identity true true', 'audit.faculty_rule_event ductus_identity true true'],
  'the identity role owns both tables and RLS is enabled and forced on both');
SELECT col_is_pk('institution', 'faculty_rule_version', ARRAY['institution_id', 'work_type', 'version_no'],
  'one version number per institution and kind of work');
SELECT col_is_unique('audit', 'faculty_rule_event', ARRAY['institution_id', 'work_type', 'version_no', 'kind'],
  'one event per version and kind');
SELECT fk_ok('audit', 'faculty_rule_event', ARRAY['institution_id', 'work_type', 'version_no', 'actor_id'],
             'institution', 'faculty_rule_version', ARRAY['institution_id', 'work_type', 'version_no', 'published_by'],
             'an event is bound to its version and to the one who published it');
SELECT bag_eq(
  $$ SELECT tgname::text FROM pg_trigger WHERE tgrelid = 'audit.faculty_rule_event'::regclass AND NOT tgisinternal $$,
  $$ VALUES ('faculty_rule_event_append_only'), ('faculty_rule_event_no_truncate') $$, 'faculty_rule_event is append-only');
SELECT bag_eq(
  $$ SELECT polname::text, polroles::regrole[]::text FROM pg_policy WHERE polrelid = 'audit.faculty_rule_event'::regclass $$,
  $$ VALUES ('faculty_rule_event_owner', '{ductus_identity}') $$, 'the only policy on faculty_rule_event is the owner''s');
SELECT is_empty(
  $$ SELECT r || ' ' || p FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p
     CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence',
                             'ductus_migrator', 'public']) AS r
     WHERE has_table_privilege(r, 'audit.faculty_rule_event', p) $$,
  'the access matrix of faculty_rule_event: no application role, not the migrator and not public reads, writes or empties it (A7)');
SELECT bag_eq(
  $$ SELECT r || ' ' || p FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p
     CROSS JOIN unnest(ARRAY['ductus_app', 'ductus_worker', 'ductus_retention', 'ductus_auth', 'ductus_evidence',
                             'ductus_migrator', 'public']) AS r
     WHERE has_table_privilege(r, 'institution.faculty_rule_version', p) $$,
  ARRAY['ductus_app SELECT'],
  'the access matrix of faculty_rule_version: ductus_app only reads it, no other role touches it (A2)');
-- A3: the publishing function is the only code that writes a version or its
-- event, and no function changes or removes either.
SELECT bag_eq(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
     WHERE p.prosrc ~* 'insert\s+into\s+(institution\.)?faculty_rule_version|insert\s+into\s+(audit\.)?faculty_rule_event' $$,
  ARRAY['institution.publish_faculty_rule_version(text,integer,text,text[],text,boolean)'],
  'only publish_faculty_rule_version inserts a version or its event');
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
     WHERE p.prosrc ~* '(update|delete\s+from|truncate)\s+(table\s+)?(only\s+)?(institution\.|audit\.)?(faculty_rule_version|faculty_rule_event)\M' $$,
  'no function updates, deletes or truncates a version or its event');

-- 2. Publishing. Iva publishes three versions of the essay rule; the third
-- has the content of the first and is still a new version (A5).
SELECT is(pg_temp.publish('iva', $$'essay', 0, 'partially_allowed', '{proofreading,formatting}', 'extended', true$$), '1',
  'Iva publishes version 1 of the essay rule from expected version 0');
SELECT row_eq(
  $$ SELECT version_no, ai_policy, ai_purposes, evidence_profile, import_allowed, origin, published_by, published_at
     FROM institution.faculty_rule_version WHERE institution_id = pg_temp.id('fak_a') AND work_type = 'essay' $$,
  ROW(1, 'partially_allowed'::text, '{proofreading,formatting}'::text[], 'extended'::text, true, 'administrator'::text,
      pg_temp.id('iva'), now()),
  'version 1 holds the content, Iva as its author and the database time (A8)');
SELECT row_eq(
  $$ SELECT e.version_no, e.kind, e.actor_id, e.occurred_at = v.published_at
     FROM audit.faculty_rule_event e JOIN institution.faculty_rule_version v USING (institution_id, work_type, version_no)
     WHERE e.institution_id = pg_temp.id('fak_a') AND e.work_type = 'essay' $$,
  ROW(1, 'published'::text, pg_temp.id('iva'), true),
  'its audit row names the version, Iva and the same moment');
SELECT is(pg_temp.publish('iva', $$'essay', 1, 'encouraged', '{translation}', 'basic', false$$), '2',
  'Iva publishes version 2 from expected version 1');
SELECT is(pg_temp.publish('iva', $$'essay', 2, 'partially_allowed', '{proofreading,formatting}', 'extended', true$$), '3',
  'publishing the content of version 1 again makes version 3, not a return to 1 (A5)');
SELECT bag_eq(
  $$ SELECT version_no, ai_policy, ai_purposes::text FROM institution.faculty_rule_version
     WHERE institution_id = pg_temp.id('fak_a') AND work_type = 'essay' $$,
  $$ VALUES (1, 'partially_allowed', '{proofreading,formatting}'), (2, 'encouraged', '{translation}'),
            (3, 'partially_allowed', '{proofreading,formatting}') $$,
  'all three versions are kept as published');
SELECT is(pg_temp.written(), '3/3/1', 'three versions, three audit rows, one projected rule');
-- F: faculty_work_rule follows the latest version.
SELECT row_eq(
  $$ SELECT ai_policy, ai_purposes, evidence_profile, import_allowed, updated_at FROM institution.faculty_work_rule
     WHERE institution_id = pg_temp.id('fak_a') AND work_type = 'essay' $$,
  ROW('partially_allowed'::text, '{proofreading,formatting}'::text[], 'extended'::text, true, now()),
  'faculty_work_rule holds the content of the latest version');

-- 3. A1: nobody changes a published version, not the owner role and not a
-- superuser; A2: ductus_app holds no privilege to try.
CREATE TEMP TABLE before_change AS
SELECT * FROM institution.faculty_rule_version WHERE institution_id = pg_temp.id('fak_a');
SELECT throws_ok($$ UPDATE institution.faculty_rule_version SET ai_policy = 'prohibited', ai_purposes = '{}'
                    WHERE institution_id = pg_temp.id('fak_a') AND version_no = 1 $$,
  'ZD403', 'published rule version is immutable', 'a superuser cannot update a version');
SELECT throws_ok($$ UPDATE institution.faculty_rule_version SET published_at = now() - interval '1 day'
                    WHERE institution_id = pg_temp.id('fak_a') $$,
  'ZD403', 'published rule version is immutable', 'a superuser cannot backdate a version');
SELECT throws_ok($$ DELETE FROM institution.faculty_rule_version WHERE institution_id = pg_temp.id('fak_a') AND version_no = 3 $$,
  'ZD403', 'published rule version is immutable', 'a superuser cannot delete a version');
-- Flush the deferred has-event checks first, so TRUNCATE meets the immutability trigger
-- and not PostgreSQL's pending-trigger-events refusal. They run as the web role,
-- as at the commit of a call from the application: the check must read the
-- audit table that ductus_app cannot (an error here fails the whole file).
SET LOCAL ROLE ductus_app;
SET CONSTRAINTS institution.faculty_rule_version_has_event IMMEDIATE;
RESET ROLE;
SELECT pass('E5: the has-event check of the published versions passes as the web role');
SELECT throws_ok($$ TRUNCATE institution.faculty_rule_version, audit.faculty_rule_event $$,
  'ZD403', NULL, 'a superuser cannot truncate the versions and their events');
SELECT throws_ok($$ UPDATE audit.faculty_rule_event SET actor_id = pg_temp.id('ines') WHERE institution_id = pg_temp.id('fak_a') $$,
  'ZD403', 'append-only row', 'a superuser cannot rewrite an audit row');
SELECT throws_ok($$ DELETE FROM audit.faculty_rule_event WHERE institution_id = pg_temp.id('fak_a') $$,
  'ZD403', 'append-only row', 'a superuser cannot delete an audit row');
SELECT is(pg_temp.ask_as('ductus_identity', 'iva', $$ WITH u AS (UPDATE institution.faculty_rule_version SET import_allowed = false
                                                   WHERE institution_id = {fak_a} RETURNING 1) SELECT count(*) FROM u $$),
  'ZD403: published rule version is immutable', 'the owner role cannot update a version');
SELECT is(pg_temp.ask_as('ductus_identity', 'iva', $$ WITH d AS (DELETE FROM institution.faculty_rule_version
                                                   WHERE institution_id = {fak_a} RETURNING 1) SELECT count(*) FROM d $$),
  'ZD403: published rule version is immutable', 'the owner role cannot delete a version');
SELECT is(pg_temp.ask_as('ductus_identity', 'iva', 'TRUNCATE institution.faculty_rule_version CASCADE'),
  'ZD403: published rule version is immutable', 'the owner role cannot truncate the versions');
SET CONSTRAINTS institution.faculty_rule_version_has_event DEFERRED;
CREATE TEMP TABLE app_write (n int PRIMARY KEY, sql text NOT NULL);
INSERT INTO app_write VALUES
  (1, $$ WITH u AS (UPDATE institution.faculty_rule_version SET import_allowed = false RETURNING 1) SELECT count(*) FROM u $$),
  (2, $$ WITH d AS (DELETE FROM institution.faculty_rule_version RETURNING 1) SELECT count(*) FROM d $$),
  (3, $$ WITH i AS (INSERT INTO institution.faculty_rule_version (institution_id, work_type, version_no, ai_policy, ai_purposes,
                      evidence_profile, import_allowed, origin, published_by)
                    VALUES ({fak_a}, 'essay', 4, 'prohibited', '{}', 'basic', false, 'administrator', {iva}) RETURNING 1)
        SELECT count(*) FROM i $$),
  (4, 'TRUNCATE institution.faculty_rule_version'),
  (5, $$ WITH i AS (INSERT INTO audit.faculty_rule_event (institution_id, work_type, version_no, kind, actor_id, occurred_at)
                    VALUES ({fak_a}, 'essay', 3, 'published', {iva}, now()) RETURNING 1) SELECT count(*) FROM i $$),
  (6, 'SELECT count(*) FROM audit.faculty_rule_event');
SELECT matches(pg_temp.ask('iva', sql), '^42501: permission denied',
  format('ductus_app as the administrator: statement %s is refused for lack of a privilege (A2, A7)', n))
FROM app_write ORDER BY n;
SELECT bag_eq($$ SELECT * FROM institution.faculty_rule_version WHERE institution_id = pg_temp.id('fak_a') $$,
              $$ SELECT * FROM before_change $$, 'every version of fak-a is exactly as it was published');
SELECT is(pg_temp.written(), '3/3/1', 'and nothing was added or removed');

-- 4. B4 and B1: only an administrator reads, and only the own institution.
SELECT is(pg_temp.publish('lea', $$'essay', 0, 'prohibited', '{}', 'basic', false$$), '1',
  'Lea of fak-b publishes version 1 of her own essay rule, whatever fak-a has');
SELECT is(
  (SELECT institution_id FROM institution.faculty_rule_version WHERE published_by = pg_temp.id('lea')),
  pg_temp.id('fak_b'), 'the institution of the version is Lea''s, from her session');
CREATE TEMP TABLE reader (n int PRIMARY KEY, actor text, expected text, note text);
INSERT INTO reader VALUES
  (1, 'iva', '3', 'administrator of fak-a: the three versions of fak-a'),
  (2, 'ines', '3', 'the other administrator of fak-a'),
  (3, 'lea', '1', 'administrator of fak-b: only the version of fak-b'),
  (4, 'una', '0', 'administrator nobody confirmed'),
  (5, 'vesna', '0', 'teacher'),
  (6, 'nina', '0', 'teacher nobody confirmed'),
  (7, 'ana', '0', 'student'),
  (8, 'boris', '0', 'student in no course'),
  (9, 'petra', '0', 'teacher of fak-b'),
  (10, 'tomo', '0', 'student of fak-b'),
  (11, 'expired', '0', 'expired session'),
  (12, 'closed', '0', 'closed session'),
  (13, 'unknown', '0', 'unknown session'),
  (14, 'anon', '0', 'no session');
SELECT is(pg_temp.ask(actor, $$ SELECT count(*) FROM institution.faculty_rule_version
                                WHERE institution_id IN ({fak_a}, {fak_b}) $$), expected,
          format('B4 %s: %s reads %s versions', n, note, expected))
FROM reader ORDER BY n;

-- 5. B2: one publication per actor who may not publish, each with valid
-- input; the refusal comes before any check of the input (case 13).
CREATE TEMP TABLE actor_case (n int PRIMARY KEY, actor text, args text, expected text, note text);
INSERT INTO actor_case VALUES
  (1, 'anon', $$'essay', 3, 'prohibited', '{}', 'basic', false$$, 'ZD401: not authenticated', 'no session'),
  (2, 'unknown', $$'essay', 3, 'prohibited', '{}', 'basic', false$$, 'ZD401: not authenticated', 'unknown session'),
  (3, 'expired', $$'essay', 3, 'prohibited', '{}', 'basic', false$$, 'ZD401: not authenticated', 'expired session'),
  (4, 'closed', $$'essay', 3, 'prohibited', '{}', 'basic', false$$, 'ZD401: not authenticated', 'closed session'),
  (5, 'vesna', $$'essay', 3, 'prohibited', '{}', 'basic', false$$, 'ZD403: forbidden', 'teacher'),
  (6, 'nina', $$'essay', 3, 'prohibited', '{}', 'basic', false$$, 'ZD403: forbidden', 'teacher nobody confirmed'),
  (7, 'ana', $$'essay', 3, 'prohibited', '{}', 'basic', false$$, 'ZD403: forbidden', 'student'),
  (8, 'boris', $$'essay', 3, 'prohibited', '{}', 'basic', false$$, 'ZD403: forbidden', 'student in no course'),
  (9, 'una', $$'essay', 3, 'prohibited', '{}', 'basic', false$$, 'ZD403: forbidden', 'administrator nobody confirmed'),
  (10, 'petra', $$'essay', 1, 'prohibited', '{}', 'basic', false$$, 'ZD403: forbidden', 'teacher of fak-b'),
  (11, 'tomo', $$'essay', 1, 'prohibited', '{}', 'basic', false$$, 'ZD403: forbidden', 'student of fak-b'),
  (12, 'vesna', $$'essay', 0, 'prohibited', '{}', 'basic', false$$, 'ZD403: forbidden', 'teacher, expecting no version'),
  (13, 'vesna', $$NULL, NULL, NULL, NULL, NULL, NULL$$, 'ZD403: forbidden', 'teacher with invalid input: no hint about the input');
CREATE TEMP TABLE actor_result AS
SELECT n, note, expected, pg_temp.publish(actor, args) AS result, pg_temp.written() AS after FROM actor_case;
SELECT is(result, expected, format('B2 %s: %s', n, note)) FROM actor_result ORDER BY n;
SELECT is(after, '4/4/2', format('B2 %s: nothing written', n)) FROM actor_result ORDER BY n;

-- 6. B3: Rita publishes as administrator, then loses the role. Her version
-- stays; she publishes nothing more.
SELECT is(pg_temp.publish('rita', $$'seminar_paper', 0, 'encouraged', '{literature_search}', 'basic', true$$), '1',
  'Rita publishes version 1 of the seminar paper rule while she is an administrator');
UPDATE institution.institution_role SET revoked_at = now()
WHERE user_id = pg_temp.id('rita') AND role = 'admin';
SELECT is(pg_temp.publish('rita', $$'seminar_paper', 1, 'prohibited', '{}', 'basic', true$$), 'ZD403: forbidden',
  'after the revocation Rita cannot publish version 2');
SELECT is(pg_temp.ask('rita', $$ SELECT count(*) FROM institution.faculty_rule_version WHERE institution_id = {fak_a} $$), '0',
  'and no longer reads the versions');
SELECT row_eq(
  $$ SELECT version_no, published_by, origin FROM institution.faculty_rule_version
     WHERE institution_id = pg_temp.id('fak_a') AND work_type = 'seminar_paper' $$,
  ROW(1, pg_temp.id('rita'), 'administrator'::text), 'her version 1 stays, with her as its author');
SELECT is(pg_temp.publish('ines', $$'seminar_paper', 1, 'prohibited', '{}', 'basic', true$$), '2',
  'another administrator continues from her version');

-- 7. D: every class of input, as Iva on the bachelor thesis rule, which has
-- no version yet. Each refusal writes nothing.
CREATE TEMP TABLE input_case (n int PRIMARY KEY, args text, expected text, note text);
INSERT INTO input_case VALUES
  (1, $$NULL, 0, 'prohibited', '{}', 'basic', false$$, 'ZD422: invalid input', 'work type null'),
  (2, $$'', 0, 'prohibited', '{}', 'basic', false$$, 'ZD422: invalid input', 'work type empty'),
  (3, $$'thesis', 0, 'prohibited', '{}', 'basic', false$$, 'ZD422: invalid input', 'work type unknown'),
  (4, $$'Bachelor_thesis', 0, 'prohibited', '{}', 'basic', false$$, 'ZD422: invalid input', 'work type in another case'),
  (5, $$'bachelor_thesis ', 0, 'prohibited', '{}', 'basic', false$$, 'ZD422: invalid input', 'work type with a space'),
  (6, $$'bachelor_thesis', NULL, 'prohibited', '{}', 'basic', false$$, 'ZD422: invalid input', 'expected version null'),
  (7, $$'bachelor_thesis', -1, 'prohibited', '{}', 'basic', false$$, 'ZD422: invalid input', 'expected version negative'),
  (8, $$'bachelor_thesis', -2147483648, 'prohibited', '{}', 'basic', false$$, 'ZD422: invalid input', 'expected version at the lower bound'),
  (9, $$'bachelor_thesis', 0, NULL, '{}', 'basic', false$$, 'ZD422: invalid input', 'AI policy null'),
  (10, $$'bachelor_thesis', 0, '', '{}', 'basic', false$$, 'ZD422: invalid input', 'AI policy empty'),
  (11, $$'bachelor_thesis', 0, 'allowed', '{}', 'basic', false$$, 'ZD422: invalid input', 'AI policy unknown'),
  (12, $$'bachelor_thesis', 0, 'PROHIBITED', '{}', 'basic', false$$, 'ZD422: invalid input', 'AI policy in another case'),
  (13, $$'bachelor_thesis', 0, 'prohibited', NULL, 'basic', false$$, 'ZD422: invalid input', 'purposes null'),
  (14, $$'bachelor_thesis', 0, 'encouraged', '{{formatting}}', 'basic', false$$, 'ZD422: invalid input', 'purposes of two dimensions'),
  (15, $$'bachelor_thesis', 0, 'encouraged', '[0:0]={formatting}', 'basic', false$$, 'ZD422: invalid input', 'purposes not starting at 1'),
  (16, $$'bachelor_thesis', 0, 'encouraged', '{formatting,proofreading,literature_search,transcription,translation,formatting}', 'basic', false$$,
   'ZD422: invalid input', 'six purposes'),
  (17, $$'bachelor_thesis', 0, 'encouraged', '{formatting,NULL}', 'basic', false$$, 'ZD422: invalid input', 'a null purpose'),
  (18, $$'bachelor_thesis', 0, 'encouraged', '{writing}', 'basic', false$$, 'ZD422: invalid input', 'an unknown purpose'),
  (19, $$'bachelor_thesis', 0, 'encouraged', '{Formatting}', 'basic', false$$, 'ZD422: invalid input', 'a purpose in another case'),
  (20, $$'bachelor_thesis', 0, 'encouraged', '{formatting,formatting}', 'basic', false$$, 'ZD422: invalid input', 'a purpose twice'),
  (21, $$'bachelor_thesis', 0, 'prohibited', '{formatting}', 'basic', false$$, 'ZD422: invalid input', 'purposes with a prohibition'),
  (22, $$'bachelor_thesis', 0, 'prohibited', '{}', NULL, false$$, 'ZD422: invalid input', 'evidence profile null'),
  (23, $$'bachelor_thesis', 0, 'prohibited', '{}', 'full', false$$, 'ZD422: invalid input', 'evidence profile unknown'),
  (24, $$'bachelor_thesis', 0, 'prohibited', '{}', 'Basic', false$$, 'ZD422: invalid input', 'evidence profile in another case'),
  (25, $$'bachelor_thesis', 0, 'prohibited', '{}', 'basic', NULL$$, 'ZD422: invalid input', 'import null'),
  -- Undecided fields: no parameter takes them, so a call naming one fails.
  (26, $$'bachelor_thesis', 0, 'prohibited', '{}', 'basic', false, 0.8$$, '42883', 'a seventh argument (a threshold)'),
  (27, $$p_work_type => 'bachelor_thesis', p_expected_version => 0, p_ai_policy => 'prohibited', p_ai_purposes => '{}',
         p_evidence_profile => 'basic', p_import_allowed => false, p_retention => interval '1 year'$$, '42883', 'a retention period'),
  (28, $$p_work_type => 'bachelor_thesis', p_expected_version => 0, p_ai_policy => 'prohibited', p_ai_purposes => '{}',
         p_evidence_profile => 'basic', p_import_allowed => false, p_provider => 'any'$$, '42883', 'an AI provider'),
  (29, $$p_work_type => 'bachelor_thesis', p_expected_version => 0, p_ai_policy => 'prohibited', p_ai_purposes => '{}',
         p_evidence_profile => 'basic', p_import_allowed => false, p_effective_from => now() + interval '1 day'$$,
   '42883', 'a future effective date'),
  (30, $$p_work_type => 'bachelor_thesis', p_expected_version => 0, p_ai_policy => 'prohibited', p_ai_purposes => '{}',
         p_evidence_profile => 'basic', p_import_allowed => false, p_institution_id => '00000000-0000-4000-8000-00000000000b'$$,
   '42883', 'an institution named by the caller'),
  (31, $$p_work_type => 'bachelor_thesis', p_expected_version => 0, p_ai_policy => 'prohibited', p_ai_purposes => '{}',
         p_evidence_profile => 'basic', p_import_allowed => false, p_published_at => now() - interval '1 day'$$,
   '42883', 'a time named by the caller'),
  (32, $$'bachelor_thesis', 1, 'prohibited', '{}', 'basic', false$$, 'ZD409: conflict', 'expected version 1 when there is none'),
  (33, $$'bachelor_thesis', 2147483647, 'prohibited', '{}', 'basic', false$$, 'ZD409: conflict', 'expected version at the upper bound');
CREATE TEMP TABLE input_result AS
SELECT n, note, expected, pg_temp.publish('iva', args) AS result, pg_temp.written() AS after FROM input_case;
SELECT is(CASE WHEN expected ~ ':' THEN result ELSE split_part(result, ':', 1) END, expected, format('D %s: %s', n, note))
FROM input_result ORDER BY n;
SELECT is(after, '6/6/3', format('D %s: nothing written', n)) FROM input_result ORDER BY n;
SELECT is(pg_temp.publish('iva', $$'bachelor_thesis', 0, 'prohibited', '{}', 'basic', false$$), '1',
  'the same call with valid input publishes version 1');
SELECT is(pg_temp.publish('iva', $$'master_thesis', 0, 'encouraged', '{formatting,proofreading,literature_search,transcription,translation}', 'extended', true$$),
  '1', 'all five purposes are accepted');

-- 8. CAS and E4: the expected version decides; a retry of the same call
-- returns the same number and writes nothing.
SELECT is(pg_temp.publish('iva', $$'bachelor_thesis', 0, 'prohibited', '{}', 'basic', false$$), '1',
  'E4: Iva repeats her call after a lost answer: the same number');
SELECT is(pg_temp.written(), '8/8/5', 'E4: the retry wrote nothing');
SELECT is(pg_temp.publish('iva', $$'bachelor_thesis', 0, 'prohibited', '{}', 'basic', true$$), 'ZD409: conflict',
  'E4: the same expected version with other content is a conflict');
SELECT is(pg_temp.publish('ines', $$'bachelor_thesis', 0, 'prohibited', '{}', 'basic', false$$), 'ZD409: conflict',
  'E4: another administrator with the same content and a stale expected version gets a conflict');
SELECT is(pg_temp.publish('iva', $$'bachelor_thesis', 1, 'encouraged', '{formatting}', 'basic', false$$), '2',
  'Iva publishes version 2');
SELECT is(pg_temp.publish('iva', $$'bachelor_thesis', 0, 'prohibited', '{}', 'basic', false$$), 'ZD409: conflict',
  'a retry two versions behind is a conflict, not a return of version 1');
SELECT is(pg_temp.publish('iva', $$'bachelor_thesis', 1, 'prohibited', '{}', 'basic', false$$), 'ZD409: conflict',
  'a stale expected version with new content is a conflict');
SELECT is(pg_temp.publish('iva', $$'bachelor_thesis', 3, 'prohibited', '{}', 'basic', false$$), 'ZD409: conflict',
  'an expected version from the future is a conflict');
SELECT is(pg_temp.written(), '9/9/5', 'the refused calls wrote nothing');

-- F1: a version converted from an existing rule has no author in the
-- application, so no call counts as its retry.
INSERT INTO institution.faculty_rule_version
  (institution_id, work_type, version_no, ai_policy, ai_purposes, evidence_profile, import_allowed, origin, published_by, published_at)
VALUES (pg_temp.id('fak_a'), 'doctoral_thesis', 1, 'prohibited', '{}', 'basic', false, 'operator', NULL, now() - interval '30 days');
SELECT is(pg_temp.publish('iva', $$'doctoral_thesis', 0, 'prohibited', '{}', 'basic', false$$), 'ZD409: conflict',
  'expected 0 over a converted version 1 is a conflict, even with its content');
SELECT is(pg_temp.publish('iva', $$'doctoral_thesis', 1, 'partially_allowed', '{proofreading}', 'basic', false$$), '2',
  'an administrator continues from the converted version');
SELECT throws_ok($$ INSERT INTO institution.faculty_rule_version
  (institution_id, work_type, version_no, ai_policy, ai_purposes, evidence_profile, import_allowed, origin, published_by)
  VALUES (pg_temp.id('fak_a'), 'short_paper', 1, 'prohibited', '{}', 'basic', false, 'operator', pg_temp.id('iva')) $$,
  '23514', NULL, 'a converted version names no author');
SELECT throws_ok($$ INSERT INTO institution.faculty_rule_version
  (institution_id, work_type, version_no, ai_policy, ai_purposes, evidence_profile, import_allowed, origin, published_by)
  VALUES (pg_temp.id('fak_a'), 'short_paper', 1, 'prohibited', '{}', 'basic', false, 'administrator', pg_temp.id('lea')) $$,
  '23503', NULL, 'the author of a version belongs to its institution');

-- 9. E5: the version and its audit row commit together or not at all.
CREATE FUNCTION pg_temp.fail_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit write failed' USING ERRCODE = 'XX001'; END $$;
CREATE TRIGGER fail_event BEFORE INSERT ON audit.faculty_rule_event FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_event();
SELECT is(pg_temp.publish('iva', $$'short_paper', 0, 'prohibited', '{}', 'basic', false$$), 'XX001: audit write failed',
  'E5: when the audit row cannot be written the call fails');
DROP TRIGGER fail_event ON audit.faculty_rule_event;
SELECT is(pg_temp.written(), '11/10/6', 'E5: and leaves no version, no event and no projection');
CREATE FUNCTION pg_temp.version_without_event() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO institution.faculty_rule_version
    (institution_id, work_type, version_no, ai_policy, ai_purposes, evidence_profile, import_allowed, origin, published_by)
  VALUES (pg_temp.id('fak_a'), 'short_paper', 1, 'prohibited', '{}', 'basic', false, 'administrator', pg_temp.id('iva'));
  SET CONSTRAINTS institution.faculty_rule_version_has_event IMMEDIATE;
END $$;
SELECT throws_ok('SELECT pg_temp.version_without_event()', 'ZD409', 'rule version without audit row',
  'E5: a version of an administrator without its audit row does not commit');
SET CONSTRAINTS institution.faculty_rule_version_has_event DEFERRED;
SELECT throws_ok($$ INSERT INTO audit.faculty_rule_event (institution_id, work_type, version_no, kind, actor_id, occurred_at)
                    VALUES (pg_temp.id('fak_a'), 'short_paper', 1, 'published', pg_temp.id('iva'), now()) $$,
  '23503', NULL, 'E5: no audit row without its version');
SELECT throws_ok($$ INSERT INTO audit.faculty_rule_event (institution_id, work_type, version_no, kind, actor_id, occurred_at)
                    VALUES (pg_temp.id('fak_a'), 'essay', 3, 'retracted', pg_temp.id('iva'), now()) $$,
  '23514', NULL, 'E5: no audit row of another kind');
SELECT throws_ok($$ INSERT INTO audit.faculty_rule_event (institution_id, work_type, version_no, kind, actor_id, occurred_at)
                    VALUES (pg_temp.id('fak_a'), 'doctoral_thesis', 1, 'published', pg_temp.id('iva'), now()) $$,
  '23503', NULL, 'E5: an audit row cannot name an author the version does not have');

-- 10. B5: a change of the institution's AAI home organisation closes its
-- sessions, so an administrator publishes nothing with the old one.
UPDATE identity.institution SET aai_home_org = 'fak-a.example' WHERE id = pg_temp.id('fak_a');
SELECT is(pg_temp.publish('iva', $$'short_paper', 0, 'prohibited', '{}', 'basic', false$$), '1',
  'B5: with the first home organisation set, Iva still publishes');
UPDATE identity.institution SET aai_home_org = 'fak-a2.example' WHERE id = pg_temp.id('fak_a');
SELECT is(pg_temp.publish('iva', $$'short_paper', 1, 'prohibited', '{}', 'basic', false$$), 'ZD401: not authenticated',
  'B5: after the home organisation changes, her session no longer publishes');
SELECT is(pg_temp.written(), '12/11/7', 'B5: nothing written after the change');

SELECT * FROM finish();
ROLLBACK;

-- The institution key on assignments and acknowledgments (B-8 prerequisite;
-- owner decision of 11 Oct 2026, issue #87; supplement to the plan of attack
-- on tables, items U1, U4, U7, U8, U11 and the catalogue guard), and through
-- assignment versions, enrollment codes and signing keys (DAN-442, D-199,
-- plan of attack #1432, items A1 to A5, B1 to B4, E1 to E3).
-- Synthetic fixtures only (fixtures/institution.inc): fak-a holds K1 with Z1,
-- fak-b holds K3 with Z3.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';

SELECT plan(60);

-- Every schema of the application; pgTAP lives in public. The pg-boss queue
-- (DAN-517) is the package's own schema, installed verbatim: its jobs carry
-- identifiers only (D-74), no institution, and its foreign keys cascade by the
-- package's design. 106 pins that schema.
CREATE TEMP VIEW app_class AS
SELECT c.oid, n.nspname || '.' || c.relname AS name
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p') AND n.nspname NOT LIKE 'pg\_%' AND n.nspname NOT IN ('information_schema', 'public', 'pgboss');
CREATE FUNCTION pg_temp.has_key(p_rel oid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = p_rel AND attname = 'institution_id' AND NOT attisdropped)
$$;

-- 1. The column itself (U11): set, without a default anybody could lean on.
SELECT col_not_null('institution', t, 'institution_id', t || '.institution_id is NOT NULL')
FROM unnest(ARRAY['assignment', 'notice_acknowledgment', 'assignment_version', 'course_enrollment_code']) AS t;
SELECT col_hasnt_default('institution', t, 'institution_id', t || '.institution_id has no default')
FROM unnest(ARRAY['assignment', 'notice_acknowledgment', 'assignment_version', 'course_enrollment_code']) AS t;
SELECT is_empty(
  $$ SELECT k.name FROM app_class k JOIN pg_attribute a ON a.attrelid = k.oid
     WHERE a.attname = 'institution_id' AND a.atthasdef $$,
  'no institution_id column of the application has a default'
);
SELECT col_is_unique('institution', 'assignment', ARRAY['id', 'institution_id'],
                     'assignment is unique on (id, institution_id), so its children can carry the key');
SELECT col_is_unique('institution', 'assignment_version', ARRAY['assignment_id', 'version_no', 'institution_id'],
                     'a version is unique with its institution, so a request, a submission and an acknowledgment name both');
SELECT col_is_unique('institution', 'course_enrollment_code', ARRAY['id', 'institution_id'],
                     'an enrollment code is unique with its institution, so its audit event names both');
SELECT col_is_unique('evidence', 'signing_key', ARRAY['key_id', 'institution_id'],
                     'a signing key is unique with its institution, so a receipt issuance names both');

-- 2. The catalogue guard. A new table without the key, a foreign key that
-- leaves the institution out or a cascade changes one of these, so it cannot
-- arrive without a row here. The three tables listed carry no key: the
-- institution itself; the record of enrollment attempts, which counts
-- the attempts of one person and is read only by the function that limits
-- them (DAN-442 left it so, PR description); and the record of used logout
-- tokens, which belongs to an issuer, not an institution, and is read only
-- by identity.backchannel_logout (DAN-474).
SELECT bag_eq(
  $$ SELECT name FROM app_class WHERE NOT pg_temp.has_key(oid) $$,
  ARRAY['identity.institution', 'institution.enrollment_attempt', 'identity.logout_token_jti'],
  'every application table carries institution_id, but for the three listed'
);
SELECT is_empty(
  $$ SELECT f.conrelid::regclass || ' ' || f.conname
     FROM pg_constraint f JOIN app_class k ON k.oid = f.conrelid
     WHERE f.contype = 'f' AND pg_temp.has_key(f.conrelid)
       AND (f.confrelid = 'identity.user_account'::regclass
            OR EXISTS (SELECT 1 FROM pg_constraint u
                       WHERE u.conrelid = f.confrelid AND u.contype IN ('p', 'u')
                         AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
                              WHERE a.attrelid = u.conrelid AND a.attnum = ANY (u.conkey)) = ARRAY['id', 'institution_id']))
       AND NOT EXISTS (SELECT 1 FROM unnest(f.conkey, f.confkey) AS p (src, dst)
                       JOIN pg_attribute s ON s.attrelid = f.conrelid AND s.attnum = p.src
                       JOIN pg_attribute d ON d.attrelid = f.confrelid AND d.attnum = p.dst
                       WHERE s.attname = 'institution_id' AND d.attname = 'institution_id') $$,
  'every foreign key from a keyed table to user_account or to a keyed parent includes institution_id'
);
-- A5: wider than the one above, whatever the parent's unique key: every
-- foreign key of the application to a table that carries the institution
-- pairs institution_id with institution_id. The one exception has no
-- institution of its own to pair; when it gets one, this fails until the
-- exception goes.
SELECT bag_eq(
  $$ SELECT f.conrelid::regclass || ' ' || f.conname
     FROM pg_constraint f JOIN app_class k ON k.oid = f.conrelid
     WHERE f.contype = 'f' AND pg_temp.has_key(f.confrelid)
       AND NOT EXISTS (SELECT 1 FROM unnest(f.conkey, f.confkey) AS p (src, dst)
                       JOIN pg_attribute s ON s.attrelid = f.conrelid AND s.attnum = p.src
                       JOIN pg_attribute d ON d.attrelid = f.confrelid AND d.attnum = p.dst
                       WHERE s.attname = 'institution_id' AND d.attname = 'institution_id') $$,
  ARRAY['institution.enrollment_attempt enrollment_attempt_user_id_fkey'],
  'every foreign key to a table that carries institution_id includes it, but for the one listed'
);
SELECT is_empty(
  $$ SELECT f.conrelid::regclass || ' ' || f.conname
     FROM pg_constraint f JOIN app_class k ON k.oid = f.conrelid
     WHERE f.contype = 'f' AND (f.confdeltype <> 'a' OR f.confupdtype <> 'a') $$,
  'no foreign key of the application cascades, nulls or defaults on delete or update'
);
-- U1: no function takes the institution from its caller.
SELECT is_empty(
  $$ SELECT p.proname || '(' || a.name || ')'
     FROM pg_proc p CROSS JOIN LATERAL unnest(p.proargnames) WITH ORDINALITY AS a (name, n)
     WHERE p.pronamespace IN ('institution'::regnamespace, 'identity'::regnamespace, 'app'::regnamespace)
       AND a.name ILIKE '%institution%' AND coalesce(p.proargmodes[a.n], 'i') IN ('i', 'b', 'v') $$,
  'no function of the application has an institution among its input parameters'
);

-- 3. The functions write the key from the session. Each call runs in a
-- statement of its own, so the check that follows sees its row.
CREATE TEMP TABLE called (name text PRIMARY KEY, result text);
INSERT INTO called VALUES
  ('create', pg_temp.ask('vesna', $$ SELECT institution.create_assignment({k1}, 'Ključ ustanove', 'Upute.',
    'essay', '2026-11-02 08:00+01', '2026-12-01 23:59+01', 'prohibited', '{}', 'basic', false, NULL, NULL) $$));
INSERT INTO called VALUES ('acknowledge', pg_temp.ask('dora', 'SELECT institution.acknowledge_notice({z1}, 2, 1)'));
INSERT INTO called VALUES
  ('code', pg_temp.ask('vesna', $$ SELECT institution.create_enrollment_code({k1}, now() + interval '7 days') $$));
SELECT is(
  (SELECT a.institution_id::text FROM institution.assignment a JOIN called c ON c.name = 'create' AND c.result = a.id::text),
  pg_temp.id('fak_a')::text,
  'create_assignment stores the institution of the session, which is the course''s'
);
SELECT is(
  (SELECT n.institution_id::text FROM institution.notice_acknowledgment n
    WHERE n.student_id = pg_temp.id('dora') AND n.assignment_id = pg_temp.id('z1') AND n.version_no = 2),
  pg_temp.id('fak_a')::text,
  'acknowledge_notice stores the institution of the session, which is the assignment''s'
);
-- B4: the functions that write versions and codes name no institution; the
-- row takes the one of its parent.
SELECT is(
  (SELECT v.institution_id::text FROM institution.assignment_version v
     JOIN called c ON c.name = 'create' AND c.result = v.assignment_id::text),
  pg_temp.id('fak_a')::text,
  'the first version of a created assignment carries the institution of its assignment'
);
SELECT is(
  (SELECT e.institution_id::text FROM institution.course_enrollment_code e
    WHERE e.course_id = pg_temp.id('k1') AND e.active),
  pg_temp.id('fak_a')::text,
  'a new enrollment code carries the institution of its course'
);

-- 4. U4: a row that mixes institutions fails on the foreign key, even when
-- written straight into the table by its owner, past every function.
SELECT alike(
  pg_temp.ask_as('ductus_identity', 'anon', format('WITH x AS (%s RETURNING 1) SELECT count(*) FROM x', v.statement)),
  '23503: %"' || v.constraint_name || '"%',
  'owner cannot write ' || v.what
)
FROM (VALUES
  (1, 'an assignment of fak-a in a course of fak-b', 'assignment_course_institution_fkey',
   $$ INSERT INTO institution.assignment (course_id, institution_id, created_by) VALUES ({k3}, {fak_a}, {vesna}) $$),
  (2, 'an assignment of fak-a created by a teacher of fak-b', 'assignment_created_by_institution_fkey',
   $$ INSERT INTO institution.assignment (course_id, institution_id, created_by) VALUES ({k1}, {fak_a}, {petra}) $$),
  (3, 'an acknowledgment of fak-a for an assignment of fak-b', 'notice_acknowledgment_assignment_institution_fkey',
   $$ INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
      VALUES ({z3}, 1, {ana}, {fak_a}) $$),
  (4, 'an acknowledgment of fak-a by a student of fak-b', 'notice_acknowledgment_student_institution_fkey',
   $$ INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
      VALUES ({z1}, 2, {tomo}, {fak_a}) $$),
  -- B1 to B3: a version or a code given an institution other than its
  -- parent's keeps it, and the foreign key refuses it.
  (5, 'a version of fak-a of an assignment of fak-b', 'assignment_version_assignment_institution_fkey',
   $$ INSERT INTO institution.assignment_version (
        assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
        evidence_profile, import_allowed, created_by, institution_id)
      VALUES ({z3}, 2, 'Z3', 'Upute.', 'essay', now(), now() + interval '30 days', 'prohibited', '{}', 'basic',
              false, {vesna}, {fak_a}) $$),
  (6, 'a version of fak-a written by a teacher of fak-b', 'assignment_version_created_by_institution_fkey',
   $$ INSERT INTO institution.assignment_version (
        assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
        evidence_profile, import_allowed, created_by)
      VALUES ({z1}, 3, 'Z1', 'Upute.', 'essay', now(), now() + interval '30 days', 'prohibited', '{}', 'basic',
              false, {petra}) $$),
  (7, 'an enrollment code of fak-a for a course of fak-b', 'course_enrollment_code_course_institution_fkey',
   $$ INSERT INTO institution.course_enrollment_code (course_id, code_hash, valid_until, active, created_by, institution_id)
      VALUES ({k3}, sha256('KOD-B2'::bytea), now() + interval '1 day', false, {vesna}, {fak_a}) $$),
  (8, 'an enrollment code of fak-a made by a teacher of fak-b', 'course_enrollment_code_created_by_institution_fkey',
   $$ INSERT INTO institution.course_enrollment_code (course_id, code_hash, valid_until, active, created_by)
      VALUES ({k1}, sha256('KOD-B3'::bytea), now() + interval '1 day', false, {petra}) $$)
) AS v (n, what, constraint_name, statement)
ORDER BY v.n;

-- 5. U7: a person with rows cannot be moved to another institution. Eva and
-- Emil exist only here, with nothing else that holds them: Emil created an
-- assignment, Eva acknowledged one. Nor can a parent with keyed children:
-- K9 holds only an enrollment code, Z7 only its version (DAN-442, B5).
INSERT INTO ref VALUES ('eva', '00000000-0000-4000-8000-000000000111'), ('emil', '00000000-0000-4000-8000-000000000112'),
                       ('z9', '00000000-0000-4000-8000-0000000000a9'), ('z7', '00000000-0000-4000-8000-0000000000a7'),
                       ('k9', '00000000-0000-4000-8000-0000000000c9');
INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
SELECT pg_temp.id(p.name), pg_temp.id('fak_a'), 'https://issuer.test', 'sub-' || p.name, p.name || '@a.example'
FROM unnest(ARRAY['eva', 'emil']) AS p (name);
INSERT INTO institution.assignment (id, course_id, institution_id, created_by)
VALUES (pg_temp.id('z9'), pg_temp.id('k1'), pg_temp.id('fak_a'), pg_temp.id('emil'));
INSERT INTO institution.assignment_version (
  assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
  evidence_profile, import_allowed, created_by
)
VALUES (pg_temp.id('z9'), 1, 'Z9', 'Upute za izmišljeni zadatak.', 'essay', now(), now() + interval '30 days',
        'prohibited', '{}', 'basic', false, pg_temp.id('emil'));
INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
VALUES (pg_temp.id('z9'), 1, pg_temp.id('eva'), pg_temp.id('fak_a'));
SELECT alike(
  pg_temp.ask_as('ductus_identity', 'anon', format(
    'WITH x AS (UPDATE identity.user_account SET institution_id = {fak_b} WHERE id = {%s} RETURNING 1) SELECT count(*) FROM x',
    v.person)),
  '23503: %"' || v.constraint_name || '"%',
  format('%s cannot be moved to fak-b while %s', v.person, v.what)
)
FROM (VALUES
  (1, 'emil', 'an assignment names him as its author', 'assignment_created_by_institution_fkey'),
  (2, 'eva', 'her acknowledgment exists', 'notice_acknowledgment_student_institution_fkey')
) AS v (n, person, what, constraint_name)
ORDER BY v.n;
INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
VALUES (pg_temp.id('k9'), pg_temp.id('fak_a'), 'K9', '2026/2027', 'prohibited', pg_temp.id('vesna'));
INSERT INTO institution.course_enrollment_code (course_id, code_hash, valid_until, created_by)
VALUES (pg_temp.id('k9'), sha256('KOD-K9'::bytea), now() + interval '1 day', pg_temp.id('vesna'));
INSERT INTO institution.assignment (id, course_id, institution_id, created_by)
VALUES (pg_temp.id('z7'), pg_temp.id('k2'), pg_temp.id('fak_a'), pg_temp.id('marko'));
INSERT INTO institution.assignment_version (
  assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
  evidence_profile, import_allowed, created_by
)
VALUES (pg_temp.id('z7'), 1, 'Z7', 'Upute za izmišljeni zadatak.', 'essay', now(), now() + interval '30 days',
        'prohibited', '{}', 'basic', false, pg_temp.id('marko'));
SELECT alike(
  pg_temp.ask_as('ductus_identity', 'anon', format('WITH x AS (%s RETURNING 1) SELECT count(*) FROM x', v.statement)),
  '23503: %"' || v.constraint_name || '"%',
  format('%s cannot be moved to fak-b while %s', v.parent, v.what)
)
FROM (VALUES
  (1, 'K9', 'its enrollment code exists', 'course_enrollment_code_course_institution_fkey',
   'UPDATE institution.course SET institution_id = {fak_b}, created_by = {petra} WHERE id = {k9}'),
  (2, 'Z7', 'its version exists', 'assignment_version_assignment_institution_fkey',
   'UPDATE institution.assignment SET institution_id = {fak_b}, course_id = {k3}, created_by = {petra} WHERE id = {z7}')
) AS v (n, parent, what, constraint_name, statement)
ORDER BY v.n;

-- 6. U8: an institution with data cannot be removed; nothing cascades.
SELECT alike(
  pg_temp.ask_as('ductus_identity', 'anon',
    'WITH x AS (DELETE FROM identity.institution WHERE id = {fak_a} RETURNING 1) SELECT count(*) FROM x'),
  '23503: %', 'removing an institution with data fails on a foreign key'
);

-- 7. Personas of the other institution (U2, U9): by id they read nothing,
-- and every write across the border is refused as if nothing existed.
SELECT is(
  pg_temp.ask(v.actor, format('SELECT count(*) FROM institution.%I WHERE %I = {%s}', t.tbl, t.col, t.assignment)), '0',
  format('%s (%s) reads no %s of %s', v.actor, v.who, t.tbl, t.assignment)
)
FROM (VALUES
  (1, 'petra', 'teacher of fak-b'), (2, 'tomo', 'student of fak-b'), (3, 'lea', 'administrator of fak-b'),
  (4, 'vesna', 'teacher of fak-a'), (5, 'ana', 'student of fak-a'), (6, 'iva', 'administrator of fak-a')
) AS v (n, actor, who)
CROSS JOIN LATERAL (SELECT CASE WHEN v.n <= 3 THEN 'z1' ELSE 'z3' END) AS z (assignment)
CROSS JOIN LATERAL (VALUES (1, 'assignment', 'id', z.assignment), (2, 'notice_acknowledgment', 'assignment_id', z.assignment))
  AS t (m, tbl, col, assignment)
ORDER BY v.n, t.m;
SELECT is(pg_temp.ask(v.actor, v.call), 'ZD403: forbidden', v.actor || ' cannot ' || v.what)
FROM (VALUES
  (1, 'tomo', 'acknowledge the notice of an assignment of fak-a', 'SELECT institution.acknowledge_notice({z1}, 2, 1)'),
  (2, 'petra', 'publish a version of an assignment of fak-a',
   $$ SELECT institution.publish_assignment_version({z1}, 2, 'Naslov', 'Upute.', 'essay', '2026-11-02 08:00+01',
      '2026-12-01 23:59+01', 'prohibited', '{}', 'basic', false, NULL, NULL) $$),
  (3, 'petra', 'create an assignment in a course of fak-a',
   $$ SELECT institution.create_assignment({k1}, 'Naslov', 'Upute.', 'essay', '2026-11-02 08:00+01',
      '2026-12-01 23:59+01', 'prohibited', '{}', 'basic', false, NULL, NULL) $$)
) AS v (n, actor, what, call)
ORDER BY v.n;

-- 8. The policies check the institution on the row itself, not only through
-- the course or the assignment. With the foreign keys that keep a row in the
-- institution of its parent dropped (inside this transaction only), a row
-- keyed to fak-b under a parent of fak-a stays hidden from the fak-a people
-- the parent alone would show it to. Last, as it takes those keys away. The
-- deferred checks of earlier rows run first, as ALTER TABLE needs; Z8 never
-- gets the version its pointer names, which only the rollback spares.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
ALTER TABLE institution.assignment DROP CONSTRAINT assignment_course_institution_fkey;
ALTER TABLE institution.notice_acknowledgment
  DROP CONSTRAINT notice_acknowledgment_assignment_institution_fkey,
  DROP CONSTRAINT notice_acknowledgment_student_institution_fkey;
-- B6: without the key to the assignment, the key to its version alone still
-- keeps an acknowledgment in the version's institution (DAN-442).
SELECT alike(
  pg_temp.ask_as('ductus_identity', 'anon', $$ WITH x AS (
    INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
    VALUES ({z3}, 1, {ana}, {fak_a}) RETURNING 1) SELECT count(*) FROM x $$),
  '23503: %"notice_acknowledgment_version_institution_fkey"%',
  'the version''s key alone refuses an acknowledgment of fak-a for a version of fak-b'
);
-- B7, B8: the same for a submission request and a submission. Every other
-- foreign key of the two tables is dropped, so the key to the version is the
-- only one left to refuse a row of fak-a that names version 1 of Z3 (fak-b);
-- the submission names that version's own deadline (DAN-442, K-a). B10 does
-- the same for a receipt issuance of fak-a signed with a key of fak-b (K-e).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS rel, conname FROM pg_constraint
           WHERE contype = 'f'
             AND conrelid IN ('evidence.submission_request'::regclass, 'evidence.submission'::regclass,
                              'evidence.submission_receipt_issuance'::regclass, 'evidence.signing_key'::regclass)
             AND conname NOT IN ('submission_request_version_institution_fkey', 'submission_version_institution_fkey',
                                 'submission_receipt_issuance_key_institution_fkey')
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.rel, r.conname);
  END LOOP;
END
$$;
INSERT INTO evidence.signing_key (key_id, key_version, evidence_domain_id, institution_id, purpose, algorithm,
                                  key_base64url, valid_from)
VALUES ('kljuc-b10', '1', gen_random_uuid(), pg_temp.id('fak_b'), 'receipt', 'Ed25519',
        'MCowBQYDK2VwAyEA' || repeat('B', 42) || 'A', date_trunc('minute', now()));
SELECT alike(
  pg_temp.ask_as('ductus_evidence', 'anon', v.statement),
  '23503: %"' || v.constraint_name || '"%',
  format('the version''s key alone refuses %s of fak-a for a version of fak-b', v.what)
)
FROM (VALUES
  (1, 'a submission request', 'submission_request_version_institution_fkey', $$ WITH x AS (
     INSERT INTO evidence.submission_request (institution_id, assignment_id, assignment_version, project_id, document_id,
                                              principal_id, revision, content_hash, requested_at)
     VALUES ({fak_a}, {z3}, 1, 'projekt-b7', 'dokument-b7', {ana}, 1, repeat('a', 64), now()) RETURNING 1)
     SELECT count(*) FROM x $$),
  (2, 'a submission', 'submission_version_institution_fkey', format($$ WITH x AS (
     INSERT INTO evidence.submission (submission_request_id, institution_id, principal_id, assignment_id,
                                      assignment_version, revision, artifact_hash, requested_at, due_at, recorded_at)
     VALUES (gen_random_uuid(), {fak_a}, {ana}, {z3}, 1, 1, repeat('b', 64), now(), %L, now()) RETURNING 1)
     SELECT count(*) FROM x $$,
     (SELECT due_at FROM institution.assignment_version WHERE assignment_id = pg_temp.id('z3') AND version_no = 1))),
  (3, 'a receipt issuance', 'submission_receipt_issuance_key_institution_fkey', $$ WITH x AS (
     INSERT INTO evidence.submission_receipt_issuance (submission_id, institution_id, principal_id, key_id, key_version,
                                                      signed_at, receipt_payload, payload_digest_sha256)
     VALUES (gen_random_uuid(), {fak_a}, {ana}, 'kljuc-b10', '1', now(), '{}', encode(sha256('{}'::bytea), 'hex'))
     RETURNING 1) SELECT count(*) FROM x $$)
) AS v (n, what, constraint_name, statement)
ORDER BY v.n;
-- B9: with the key from a version to its assignment dropped, Z7 moves to
-- fak-b over its version of fak-a; the pointer to its current version, which
-- carries the key, refuses the move when its deferred check runs (K-f).
ALTER TABLE institution.assignment_version DROP CONSTRAINT assignment_version_assignment_institution_fkey;
SELECT is(
  pg_temp.ask_as('ductus_identity', 'anon', $$ WITH x AS (
    UPDATE institution.assignment SET institution_id = {fak_b}, course_id = {k3}, created_by = {petra}
    WHERE id = {z7} RETURNING 1) SELECT count(*) FROM x $$),
  '1',
  'Z7 moves to fak-b while the check of its current version waits for the end of the transaction'
);
SELECT alike(
  pg_temp.ask_as('ductus_identity', 'anon', 'SET CONSTRAINTS institution.assignment_current_version_institution_fkey IMMEDIATE'),
  '23503: %"assignment_current_version_institution_fkey"%',
  'the current version of fak-a refuses its assignment moved to fak-b'
);
ALTER TABLE institution.notice_acknowledgment DROP CONSTRAINT notice_acknowledgment_version_institution_fkey;
INSERT INTO ref VALUES ('z8', '00000000-0000-4000-8000-0000000000a8');
INSERT INTO institution.assignment (id, course_id, institution_id, created_by)
VALUES (pg_temp.id('z8'), pg_temp.id('k1'), pg_temp.id('fak_b'), pg_temp.id('petra'));
INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
VALUES (pg_temp.id('z9'), 1, pg_temp.id('dora'), pg_temp.id('fak_b'));
SELECT is(pg_temp.ask(v.actor, v.query), '0', format('%s (%s) does not see %s', v.actor, v.who, v.what))
FROM (VALUES
  (1, 'vesna', 'teacher of K1', 'an assignment of K1 keyed to fak-b',
   'SELECT count(*) FROM institution.assignment WHERE id = {z8}'),
  (2, 'ana', 'student of K1', 'an assignment of K1 keyed to fak-b',
   'SELECT count(*) FROM institution.assignment WHERE id = {z8}'),
  (3, 'vesna', 'teacher of Z9', 'an acknowledgment of Z9 keyed to fak-b',
   'SELECT count(*) FROM institution.notice_acknowledgment WHERE assignment_id = {z9} AND student_id = {dora}'),
  (4, 'dora', 'its student', 'her own acknowledgment of Z9 keyed to fak-b',
   'SELECT count(*) FROM institution.notice_acknowledgment WHERE assignment_id = {z9} AND student_id = {dora}')
) AS v (n, actor, who, what, query)
ORDER BY v.n;

SELECT * FROM finish();
ROLLBACK;

-- B-12 step 3 / DAN-87: the submission (plan of attack #385, owner decisions
-- P5, P6 and P8). Every person, document and hash below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

-- Ana commits revision 1 (hash d...d) and requests it through the RPC; Tomo
-- commits revision 1 of his document. Dora and Boris (not a student of K1)
-- get their own documents with a committed revision 1 and requests written by
-- the owner with chosen times.
SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'reserved', 'fixture: Ana commits revision 1');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a', 1) $$), 'requested',
  'fixture: Ana requests revision 1');
SELECT is(pg_temp.call('tomo','pkg-b','request-b1',
    pg_temp.descriptor(p_package=>'pkg-b',p_document=>'doc-b',p_segment=>'segment-b-1'),0,repeat('c',64),repeat('d',64),repeat('b',64)),
  'reserved', 'fixture: Tomo commits revision 1');
-- Z3 gets a version 2 and Z1 a version 3, both already past their deadline,
-- so the deadline tests below use real database times.
SET LOCAL ROLE ductus_identity;
INSERT INTO institution.assignment_version (
  assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
  evidence_profile, import_allowed, created_by
) VALUES
  (pg_temp.id('z3'), 2, 'Z3', 'Upute za izmišljeni zadatak.', 'essay', now() - interval '2 days',
   now() - interval '1 day', 'encouraged', '{translation}', 'basic', true, pg_temp.id('petra')),
  (pg_temp.id('z1'), 3, 'Z1', 'Upute za izmišljeni zadatak.', 'essay', now() - interval '2 days',
   now() - interval '1 day', 'partially_allowed', '{proofreading}', 'extended', true, pg_temp.id('vesna'));
UPDATE institution.assignment SET current_version = 2 WHERE id = pg_temp.id('z3');
UPDATE institution.assignment SET current_version = 3 WHERE id = pg_temp.id('z1');
RESET ROLE;
SELECT v1.due_at AS z1_v3_due, v3.due_at AS z3_v2_due
  FROM institution.assignment_version v1, institution.assignment_version v3
 WHERE v1.assignment_id = pg_temp.id('z1') AND v1.version_no = 3
   AND v3.assignment_id = pg_temp.id('z3') AND v3.version_no = 2 \gset
-- The deadline of Boris's version, for the forgeries run as the evidence role.
INSERT INTO ref SELECT 'z1_v2_due', due_at::text FROM institution.assignment_version
 WHERE assignment_id = pg_temp.id('z1') AND version_no = 2;
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES
  ('project-d', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('dora')),
  ('project-o', pg_temp.id('fak_a'), pg_temp.id('z1'), pg_temp.id('boris'));
INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_revision, current_content_hash) VALUES
  ('doc-d', pg_temp.id('fak_a'), 'project-d', pg_temp.id('dora'), 1, repeat('e',64)),
  ('doc-o', pg_temp.id('fak_a'), 'project-o', pg_temp.id('boris'), 1, repeat('e',64));
INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash) VALUES
  ('doc-d', pg_temp.id('fak_a'), 0, NULL, pg_temp.id('dora'), repeat('a',64)),
  ('doc-d', pg_temp.id('fak_a'), 1, 0, pg_temp.id('dora'), repeat('e',64)),
  ('doc-o', pg_temp.id('fak_a'), 0, NULL, pg_temp.id('boris'), repeat('a',64)),
  ('doc-o', pg_temp.id('fak_a'), 1, 0, pg_temp.id('boris'), repeat('e',64));
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS evidence.evidence_document_current_revision_fkey DEFERRED;
-- P6: Tomo exactly at the deadline of Z3 version 2, Dora one microsecond
-- after the deadline of Z1 version 3 (the versions they requested).
INSERT INTO evidence.submission_request (
  institution_id, assignment_id, assignment_version, project_id, document_id, principal_id, revision,
  content_hash, requested_at
)
VALUES
  (pg_temp.id('fak_b'), pg_temp.id('z3'), 2, 'project-b', 'doc-b', pg_temp.id('tomo'), 1, repeat('d',64),
   :'z3_v2_due'::timestamptz),
  (pg_temp.id('fak_a'), pg_temp.id('z1'), 3, 'project-d', 'doc-d', pg_temp.id('dora'), 1, repeat('e',64),
   :'z1_v3_due'::timestamptz + interval '1 microsecond'),
  (pg_temp.id('fak_a'), pg_temp.id('z1'), 2, 'project-o', 'doc-o', pg_temp.id('boris'), 1, repeat('e',64), now());
RESET ROLE;

CREATE FUNCTION pg_temp.req(p_student text) RETURNS text LANGUAGE sql AS $$
  SELECT id::text FROM evidence.submission_request WHERE principal_id = pg_temp.id(p_student)
$$;
CREATE FUNCTION pg_temp.record(p_actor text, p_request text, p_hash text, p_column text DEFAULT 'outcome')
RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format('SELECT %I::text FROM app.record_submission(%s, %s)',
    p_column, coalesce(quote_literal(p_request) || '::uuid', 'NULL'), coalesce(quote_literal(p_hash), 'NULL')))
$$;

-- Shape of the entrypoint: owner, definer, search_path, grants, no identity
-- or time argument (F1, A1).
SELECT is((SELECT r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.oid = 'app.record_submission(uuid,text)'::regprocedure),
  'ductus_evidence', 'the submission RPC is owned by the NOLOGIN evidence role');
SELECT ok((SELECT prosecdef AND 'search_path=""' = ANY(proconfig)
  FROM pg_proc WHERE oid = 'app.record_submission(uuid,text)'::regprocedure),
  'the submission RPC is SECURITY DEFINER with an empty search_path');
SELECT ok(
  has_function_privilege('ductus_app', 'app.record_submission(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_worker', 'app.record_submission(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_retention', 'app.record_submission(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_auth', 'app.record_submission(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_test_stranger', 'app.record_submission(uuid,text)', 'EXECUTE'),
  'only ductus_app executes the submission RPC');
SELECT is((SELECT proargnames[1:pronargs]::text FROM pg_proc
  WHERE oid = 'app.record_submission(uuid,text)'::regprocedure),
  '{p_submission_request_id,p_artifact_hash}', 'the RPC takes only the request and the hash: no identity, institution or time');

-- The deadline lookup the evidence role uses: owned by the identity role,
-- executable only by the evidence role, scoped to the caller's institution.
SELECT ok((SELECT r.rolname = 'ductus_identity' AND p.prosecdef AND 'search_path=""' = ANY(p.proconfig)
  FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.oid = 'app.assignment_version_due(uuid,integer)'::regprocedure),
  'the deadline lookup is an identity-owned SECURITY DEFINER function with an empty search_path');
SELECT ok(
  has_function_privilege('ductus_evidence', 'app.assignment_version_due(uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_app', 'app.assignment_version_due(uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_worker', 'app.assignment_version_due(uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_test_stranger', 'app.assignment_version_due(uuid,integer)', 'EXECUTE'),
  'only the evidence role executes the deadline lookup');
SELECT is(pg_temp.ask_as('ductus_evidence', 'tomo', $$ SELECT app.assignment_version_due({z1}, 2)::text $$), NULL,
  'the deadline lookup answers nothing for an assignment of another institution');
SELECT is(pg_temp.ask_as('ductus_evidence', 'ana', $$ SELECT app.assignment_version_due({z1}, 2)::text $$),
  (SELECT val FROM ref WHERE name = 'z1_v2_due'), 'the deadline lookup gives the version''s deadline in the own institution');

-- Table: tenant key, RLS, owner, derived lateness, no DML for the web role (F5).
SELECT col_not_null('evidence', 'submission', 'institution_id', 'the submission requires institution_id');
SELECT col_hasnt_default('evidence', 'submission', 'institution_id', 'the submission has no tenant default');
SELECT col_hasnt_default('evidence', 'submission', 'recorded_at', 'recorded_at has no default the caller could lean on');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'evidence.submission'::regclass),
  'the submission table enables and forces RLS');
SELECT is((SELECT attgenerated::text FROM pg_attribute
  WHERE attrelid = 'evidence.submission'::regclass AND attname = 'after_deadline'), 's',
  'the lateness flag is computed from the stored time and deadline, never written');
SELECT set_eq(
  $$ SELECT r || ':' || p
       FROM unnest(ARRAY['ductus_app','ductus_migrator','ductus_identity','ductus_auth','ductus_worker',
                         'ductus_retention','ductus_test_stranger']) AS r
       CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p
      WHERE has_table_privilege(r, 'evidence.submission', p) $$,
  ARRAY['ductus_app:SELECT'],
  'every service role: only ductus_app may SELECT, none may write');
SELECT is_empty(
  $$ SELECT r || ':' || p
       FROM unnest(ARRAY['ductus_app','ductus_migrator','ductus_identity','ductus_auth','ductus_worker',
                         'ductus_retention']) AS r
       CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS p
      WHERE has_any_column_privilege(r, 'evidence.submission', p)
        AND NOT has_table_privilege(r, 'evidence.submission', p) $$,
  'no service role holds a column-level privilege beyond its table privilege');
SELECT ok(NOT has_table_privilege('ductus_identity', 'evidence.submission_request', 'REFERENCES'),
  'the temporary REFERENCES grant on requests is gone');
SELECT set_eq(
  $$ SELECT policyname || ':' || cmd || ':' || array_to_string(roles, ',') FROM pg_policies
      WHERE schemaname = 'evidence' AND tablename = 'submission' $$,
  ARRAY['evidence_submission_owner:ALL:ductus_evidence', 'evidence_submission_read:SELECT:ductus_app'],
  'the only policies are the owner policy and the web role read policy');
SELECT matches(pg_temp.ask('ana', format($$ INSERT INTO evidence.submission
     (submission_request_id,institution_id,principal_id,assignment_id,assignment_version,revision,artifact_hash,
      requested_at,due_at,recorded_at)
     SELECT id,institution_id,principal_id,assignment_id,assignment_version,revision,content_hash,requested_at,
            now() + interval '30 days',now() FROM evidence.submission_request WHERE id = %L RETURNING 1 $$,
     pg_temp.req('ana'))),
  '^42501:', 'a student cannot write a submission');
-- Defence in depth: with an INSERT grant the row-level policy still refuses.
GRANT INSERT ON evidence.submission TO ductus_app;
SELECT matches(pg_temp.ask('ana', format($$ INSERT INTO evidence.submission
     (submission_request_id,institution_id,principal_id,assignment_id,assignment_version,revision,artifact_hash,
      requested_at,due_at,recorded_at)
     SELECT id,institution_id,principal_id,assignment_id,assignment_version,revision,content_hash,requested_at,
            now() + interval '30 days',now() FROM evidence.submission_request WHERE id = %L RETURNING 1 $$,
     pg_temp.req('ana'))),
  '^42501: new row violates row-level security policy', 'even with a grant, RLS refuses a direct write by the web role');
REVOKE INSERT ON evidence.submission FROM ductus_app;

-- Who may record (F1 to F4): one answer for every refusal.
SELECT is(pg_temp.record('anon', pg_temp.req('ana'), repeat('d',64)), 'unauthorized', 'an anonymous session is refused');
SELECT is(pg_temp.record('expired', pg_temp.req('ana'), repeat('d',64)), 'unauthorized', 'an expired session is refused');
SELECT is(pg_temp.record('tomo', pg_temp.req('ana'), repeat('d',64)), 'unauthorized',
  'a student of another institution cannot complete the request');
SELECT is(pg_temp.record('dora', pg_temp.req('ana'), repeat('d',64)), 'unauthorized',
  'a classmate cannot complete another student''s request');
SELECT is(pg_temp.record('vesna', pg_temp.req('ana'), repeat('d',64)), 'unauthorized', 'the teacher cannot submit for the student');
SELECT is(pg_temp.record('iva', pg_temp.req('ana'), repeat('d',64)), 'unauthorized', 'the administrator cannot submit for the student');
SELECT is(pg_temp.record('ana', '00000000-0000-4000-8000-0000000000ff', repeat('d',64)), 'unauthorized',
  'a missing request gets the same answer as a foreign one');
SELECT is(pg_temp.record('boris', pg_temp.req('boris'), repeat('e',64)), 'unauthorized',
  'a student who is not an active student of the assignment cannot complete the own request');
SELECT is(pg_temp.record('ana', NULL, repeat('d',64)), 'invalid', 'a missing request id is invalid');
SELECT is(pg_temp.record('ana', pg_temp.req('ana'), NULL), 'invalid', 'a missing hash is invalid');
SELECT is(pg_temp.record('ana', pg_temp.req('ana'), repeat('D',64)), 'invalid', 'an upper-case hash is invalid');
SELECT is(pg_temp.record('ana', pg_temp.req('ana'), repeat('d',63)), 'invalid', 'a short hash is invalid');
CREATE FUNCTION pg_temp.record_with_spoofed_user_id() RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('app.user_id', pg_temp.id('ana')::text, true);
  v := pg_temp.record('tomo', pg_temp.req('ana'), repeat('d',64));
  PERFORM set_config('app.user_id', '', true);
  RETURN v;
END
$$;
SELECT is(pg_temp.record_with_spoofed_user_id(), 'unauthorized', 'a forged user-id setting cannot replace the session');

-- A reconstruction that does not give the requested revision's hash records
-- nothing (D-11, B2).
SELECT is(pg_temp.record('ana', pg_temp.req('ana'), repeat('f',64)), 'artifact_mismatch',
  'a hash other than the requested revision''s is not recorded');
SELECT is((SELECT count(*)::text FROM evidence.submission), '0', 'refusals write nothing');

-- The submission (A7, B8, E1): every field from the request, the deadline of
-- the requested version, the database clock for recorded_at.
SELECT is(pg_temp.ask('ana', format($$ SELECT concat_ws(' ', outcome, submission_id IS NOT NULL, after_deadline)
    FROM app.record_submission(%L, %L) $$, pg_temp.req('ana'), repeat('d',64))),
  'recorded t f', 'a matching reconstruction is recorded on time');
SELECT is((SELECT concat_ws(' ', s.institution_id = r.institution_id, s.principal_id = pg_temp.id('ana'),
    s.assignment_id = pg_temp.id('z1'), s.assignment_version, s.revision, s.artifact_hash = repeat('d',64),
    s.requested_at = r.requested_at, s.due_at = v.due_at, s.recorded_at >= s.requested_at)
  FROM evidence.submission s
  JOIN evidence.submission_request r ON r.id = s.submission_request_id
  JOIN institution.assignment_version v ON v.assignment_id = s.assignment_id AND v.version_no = s.assignment_version
  WHERE s.principal_id = pg_temp.id('ana')),
  't t t 2 1 t t t t', 'the submission carries the request, its time and the deadline of its version');

-- Repeats (A6, P5, P8): the same row, the same time, nothing new; a later
-- mismatch is never answered as the earlier success.
SELECT is(pg_temp.record('ana', pg_temp.req('ana'), repeat('d',64)), 'existing', 'a repeat returns the earlier submission');
SELECT is(pg_temp.record('ana', pg_temp.req('ana'), repeat('d',64), 'submission_id'),
  (SELECT id::text FROM evidence.submission WHERE principal_id = pg_temp.id('ana')), 'the repeat names the same submission');
SELECT is(pg_temp.record('ana', pg_temp.req('ana'), repeat('d',64), 'requested_at'),
  (SELECT requested_at::text FROM evidence.submission_request WHERE principal_id = pg_temp.id('ana')),
  'the repeat keeps the original requested_at');
SELECT is(pg_temp.record('ana', pg_temp.req('ana'), repeat('f',64)), 'artifact_mismatch',
  'a mismatch after the submission is still a mismatch');
SELECT is((SELECT count(*)::text FROM evidence.submission WHERE principal_id = pg_temp.id('ana')), '1',
  'one submission per student and assignment');

-- P6: exactly at the deadline is on time, one microsecond after is late. A
-- later version with a later deadline does not move Dora's deadline.
SET LOCAL ROLE ductus_identity;
INSERT INTO institution.assignment_version (
  assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
  evidence_profile, import_allowed, created_by
) VALUES (pg_temp.id('z1'), 4, 'Z1', 'Upute za izmišljeni zadatak.', 'essay', now(),
  now() + interval '60 days', 'partially_allowed', '{proofreading}', 'extended', true, pg_temp.id('vesna'));
UPDATE institution.assignment SET current_version = 4 WHERE id = pg_temp.id('z1');
RESET ROLE;
SELECT is(pg_temp.ask('tomo', format($$ SELECT concat_ws(' ', outcome, after_deadline, requested_at = due_at)
    FROM app.record_submission(%L, %L) $$, pg_temp.req('tomo'), repeat('d',64))),
  'recorded f t', 'a request exactly at the deadline is on time');
SELECT is(pg_temp.ask('dora', format($$ SELECT concat_ws(' ', outcome, after_deadline, requested_at - due_at)
    FROM app.record_submission(%L, %L) $$, pg_temp.req('dora'), repeat('e',64))),
  'recorded t 00:00:00.000001', 'a request one microsecond after the deadline of its version is late');
SELECT is((SELECT after_deadline::text FROM evidence.submission WHERE principal_id = pg_temp.id('dora')), 'true',
  'the stored flag agrees with the answer');

-- Reading (F2, F3, F7): the student sees the own submission only; the
-- teacher's view comes with the signed receipt.
SELECT is(pg_temp.ask('ana', 'SELECT count(*) FROM evidence.submission'), '1', 'the student reads the own submission');
SELECT is(pg_temp.ask('ana', $$ SELECT count(*) FROM evidence.submission WHERE principal_id <> {ana} $$), '0',
  'the student reads no classmate''s submission');
SELECT is(pg_temp.ask('tomo', 'SELECT count(*) FROM evidence.submission'), '1',
  'the second-institution student reads only the own submission');
SELECT is(pg_temp.ask('boris', 'SELECT count(*) FROM evidence.submission'), '0', 'a student without a submission reads nothing');
SELECT is(pg_temp.ask('vesna', 'SELECT count(*) FROM evidence.submission'), '0',
  'the teacher reads no submission before the receipt step');
SELECT is(pg_temp.ask('petra', 'SELECT count(*) FROM evidence.submission'), '0',
  'the teacher of another institution reads nothing');
SELECT is(pg_temp.ask('iva', 'SELECT count(*) FROM evidence.submission'), '0', 'the administrator reads nothing');
SELECT is(pg_temp.ask('anon', 'SELECT count(*) FROM evidence.submission'), '0', 'an anonymous session reads nothing');

-- Append-only (B5, F5): nobody rewrites the time, deadline or flag.
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon',
  $$ UPDATE evidence.submission SET due_at = due_at + interval '1 day' RETURNING 1 $$),
  '^ZD403:', 'the owner cannot move the deadline');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon',
  $$ UPDATE evidence.submission SET after_deadline = false RETURNING 1 $$),
  '^428C9:', 'the lateness flag cannot be written at all');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ DELETE FROM evidence.submission RETURNING 1 $$),
  '^ZD403:', 'the owner cannot delete a submission');
SELECT matches(pg_temp.ask_as('ductus_evidence', 'anon', $$ TRUNCATE evidence.submission $$),
  '^ZD403:', 'the owner cannot truncate submissions');

-- Composite keys (F6, D-103): no field can drift from the request it completes.
CREATE FUNCTION pg_temp.forge(p_change text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask_as('ductus_evidence', 'anon', format($f$
    INSERT INTO evidence.submission
      (submission_request_id,institution_id,principal_id,assignment_id,assignment_version,revision,artifact_hash,
       requested_at,due_at,recorded_at)
    SELECT f.* FROM (
      SELECT r.id, r.institution_id, r.principal_id, r.assignment_id, r.assignment_version, r.revision,
             r.content_hash AS artifact_hash, r.requested_at, {z1_v2_due}::timestamptz AS due_at,
             pg_catalog.clock_timestamp() AS recorded_at
        FROM evidence.submission_request r
       WHERE r.principal_id = {boris}) AS f0
    CROSS JOIN LATERAL (SELECT %s) AS f RETURNING 1 $f$, p_change))
$$;
SELECT is(pg_temp.forge($$ f0.id, f0.institution_id, f0.principal_id, f0.assignment_id, f0.assignment_version,
    f0.revision, f0.artifact_hash, f0.requested_at, f0.due_at, f0.recorded_at $$), '1',
  'control: the unchanged row is accepted by the keys (the RPC refuses Boris, the table does not judge membership)');
SELECT matches(pg_temp.forge($$ f0.id, {fak_b}::uuid, f0.principal_id, f0.assignment_id, f0.assignment_version,
    f0.revision, f0.artifact_hash, f0.requested_at, f0.due_at, f0.recorded_at $$),
  '^23505:', 'a second submission for the same request is refused by the table');
-- The control row is rolled back by the savepoint below, so each forgery is
-- refused by its key alone.
CREATE FUNCTION pg_temp.forge_alone(p_change text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  BEGIN
    ALTER TABLE evidence.submission DISABLE TRIGGER evidence_submission_immutable;
    DELETE FROM evidence.submission WHERE principal_id = pg_temp.id('boris');
    ALTER TABLE evidence.submission ENABLE TRIGGER evidence_submission_immutable;
    v := pg_temp.forge(p_change);
    RAISE EXCEPTION USING ERRCODE = 'ZT001', MESSAGE = coalesce(v, 'null');
  EXCEPTION WHEN SQLSTATE 'ZT001' THEN
    RETURN SQLERRM;
  END;
END
$$;
SELECT matches(pg_temp.forge_alone($$ f0.id, {fak_b}::uuid, f0.principal_id, f0.assignment_id, f0.assignment_version,
    f0.revision, f0.artifact_hash, f0.requested_at, f0.due_at, f0.recorded_at $$),
  '^23503:', 'a submission cannot pair a request with another institution');
SELECT matches(pg_temp.forge_alone($$ f0.id, f0.institution_id, f0.principal_id, f0.assignment_id, f0.assignment_version,
    0::bigint, repeat('a',64), f0.requested_at, f0.due_at, f0.recorded_at $$),
  '^23503:', 'a submission cannot name another revision than the request');
SELECT matches(pg_temp.forge_alone($$ f0.id, f0.institution_id, f0.principal_id, f0.assignment_id, f0.assignment_version,
    f0.revision, repeat('f',64), f0.requested_at, f0.due_at, f0.recorded_at $$),
  '^23503:', 'the artifact hash cannot differ from the requested revision''s hash');
SELECT matches(pg_temp.forge_alone($$ f0.id, f0.institution_id, f0.principal_id, f0.assignment_id, f0.assignment_version,
    f0.revision, f0.artifact_hash, f0.requested_at - interval '1 hour', f0.due_at, f0.recorded_at $$),
  '^23503:', 'a submission cannot carry an earlier time than its request');
SELECT matches(pg_temp.forge_alone($$ f0.id, f0.institution_id, f0.principal_id, f0.assignment_id, f0.assignment_version,
    f0.revision, f0.artifact_hash, f0.requested_at, f0.due_at + interval '1 day', f0.recorded_at $$),
  '^23503:', 'a submission cannot carry another deadline than its version''s');
SELECT matches(pg_temp.forge_alone($$ f0.id, f0.institution_id, f0.principal_id, f0.assignment_id, 3,
    f0.revision, f0.artifact_hash, f0.requested_at, f0.due_at, f0.recorded_at $$),
  '^23503:', 'a submission cannot move to another assignment version');
SELECT matches(pg_temp.forge_alone($$ f0.id, f0.institution_id, f0.principal_id, f0.assignment_id, f0.assignment_version,
    f0.revision, f0.artifact_hash, f0.requested_at, f0.due_at, f0.requested_at - interval '1 second' $$),
  '^23514:', 'a submission is never recorded before it was requested');

SELECT * FROM finish();
ROLLBACK;

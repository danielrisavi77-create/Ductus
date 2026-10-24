-- K-3b2 / DAN-88 (#635): the invented course, assignment and enrolment of the
-- local demo (docs/PLAN-DEMO.md K-3). Local compose stack only, after
-- `pnpm db:seed`; `pnpm demo:up` runs it through db/local/demo-k3.mjs, and
-- `pnpm demo:prepare` (CI) does not, because the E2E tests start from an
-- unconfirmed teacher. Never a migration, never production.
--
-- Every row comes from the function the application calls, under the session
-- of an invented account, as withActor does: the login role, then
-- app.session_token for this transaction only. The identity is never a
-- parameter. The only direct write is the operator grant of
-- provision-demo-teacher.sql (K-3a), the same statement.
--
-- No evidence and no receipt is written (#635, PLAN-DEMO 5 cut 1): no editor
-- on main captures segments yet, and segments made up here would carry a real
-- signature over writing nobody did. The two histories stay the prepared
-- example of RecordLimits.
--
-- A rerun adds no K-3 row: create_course and create_assignment (fixed request
-- key, same content) return the existing ids, a code is made only for a
-- student who is not a member, and acknowledge_notice repeats nothing. Each
-- run leaves three closed sessions, as three sign-ins and sign-outs would.
-- One DO block is one transaction: a failed step leaves nothing behind.

DO $guard$
BEGIN
  IF pg_catalog.inet_server_addr() IS NOT NULL
     OR pg_catalog.current_database() <> 'ductus'
     OR session_user <> 'ductus' THEN
    RAISE EXCEPTION 'K-3 demo data is local compose only';
  END IF;
END
$guard$;

DO $k3$
DECLARE
  -- infra/fake-oidc/accounts.mjs: the provider's issuer, accounts and home organisation.
  c_issuer constant text := 'http://localhost:8090';
  c_home_org constant text := 'demo.ductus.test';
  c_subjects constant text[] := ARRAY['demo-teacher', 'demo-student', 'demo-student-2'];
  -- The idempotency key of the teacher's one create request; a rerun repeats it.
  c_request constant uuid := 'c3b20000-0000-4000-8000-000000000001';
  c_course constant text := 'Lokalne javne politike (izmišljeni kolegij)';
  c_title constant text := 'Seminarski rad: gradske knjižnice kao javni prostor';
  c_instructions constant text :=
    'Opiši kako gradske knjižnice mogu služiti kao javni prostor za susret građana. '
    || 'Osloni se na najmanje tri izvora i citiraj ih prema uputama fakulteta.' || E'\n\n'
    || 'Kolegij, zadatak i tekst su izmišljeni i služe samo za demo.';
  v_tokens text[] := ARRAY[]::text[];
  v_users uuid[] := ARRAY[]::uuid[];
  v_subject text;
  v_course uuid;
  v_assignment uuid;
  v_version integer;
  v_code text;
  v_outcome text;
  i integer;
BEGIN
  -- 1. Sign-in: the function the login callback calls after the OIDC check,
  -- with the callback's role. The account is created on the first call. A
  -- token has the cookie's format and never leaves this transaction.
  SET LOCAL ROLE ductus_auth_local;
  FOREACH v_subject IN ARRAY c_subjects LOOP
    v_tokens := v_tokens || rtrim(translate(encode(
      sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())), 'base64'), '+/', '-_'), '=');
    PERFORM identity.open_session(c_issuer, v_subject, v_subject || '@' || c_home_org, c_home_org,
                                  sha256(convert_to(v_tokens[cardinality(v_tokens)], 'UTF8')));
  END LOOP;
  RESET ROLE;

  FOREACH v_subject IN ARRAY c_subjects LOOP
    v_users := v_users || (
      SELECT u.id FROM identity.user_account u JOIN identity.institution n ON n.id = u.institution_id
       WHERE u.oidc_issuer = c_issuer AND u.oidc_subject = v_subject
         AND u.hr_edu_person_unique_id = v_subject || '@' || c_home_org AND n.slug = 'demo-fakultet');
  END LOOP;
  IF array_position(v_users, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'K-3 demo accounts are not in demo-fakultet';
  END IF;

  -- 2. The operator grant of provision-demo-teacher.sql, unchanged.
  INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_by, confirmed_at)
  SELECT u.institution_id, u.id, 'teacher', NULL, now() FROM identity.user_account u WHERE u.id = v_users[1]
  ON CONFLICT (institution_id, user_id, role) WHERE revoked_at IS NULL DO NOTHING;

  -- 3. The teacher's requests, through ductus_app and RLS from here on.
  SET LOCAL ROLE ductus_app_local;
  PERFORM set_config('app.session_token', v_tokens[1], true);
  IF NOT institution.actor_has_role('teacher') THEN
    RAISE EXCEPTION 'K-3 demo teacher role is not confirmed';
  END IF;
  v_course := institution.create_course(c_course, '2026/2027', 'partially_allowed');
  -- As the teacher form sends it (src/components/teacher/assignment-create.ts).
  v_assignment := institution.create_assignment(
    v_course, c_request, c_title, c_instructions, 'seminar_paper',
    '2026-10-19 08:00:00+02', '2026-12-14 23:59:00+01', 'partially_allowed',
    ARRAY['proofreading', 'literature_search'], 'basic', false, 1500, 2500);

  -- 4. Enrolment by code, only for a student who is not a member yet; the
  -- code is cancelled again, so none is left open that nobody has seen.
  IF (SELECT count(*) FROM institution.course_member m
       WHERE m.course_id = v_course AND m.role = 'student' AND m.member_to IS NULL
         AND m.user_id = ANY (v_users[2:3])) < 2 THEN
    v_code := institution.create_enrollment_code(v_course, now() + interval '10 minutes');
    FOR i IN 2..3 LOOP
      PERFORM set_config('app.session_token', v_tokens[i], true);
      SELECT e.outcome INTO v_outcome FROM institution.enroll_with_code(v_code) e;
      IF v_outcome IS DISTINCT FROM 'enrolled' THEN
        RAISE EXCEPTION 'K-3 demo student % was not enrolled', i - 1;
      END IF;
    END LOOP;
    PERFORM set_config('app.session_token', v_tokens[1], true);
    PERFORM institution.revoke_enrollment_code(v_course);
  END IF;

  -- 5. Each student confirms the notice of the current version (PRODUCT 5 rule 6).
  FOR i IN 2..3 LOOP
    PERFORM set_config('app.session_token', v_tokens[i], true);
    SELECT a.current_version INTO STRICT v_version FROM institution.assignment a WHERE a.id = v_assignment;
    PERFORM institution.acknowledge_notice(v_assignment, v_version);
  END LOOP;

  -- 6. Sign-out of all three sessions.
  FOR i IN 1..3 LOOP
    PERFORM set_config('app.session_token', v_tokens[i], true);
    IF NOT identity.close_current_session() THEN
      RAISE EXCEPTION 'K-3 demo session % did not close', i;
    END IF;
  END LOOP;
  PERFORM set_config('app.session_token', '', true);
  RESET ROLE;
END
$k3$;

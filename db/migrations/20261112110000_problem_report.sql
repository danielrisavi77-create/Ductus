-- migrate:up
-- DAN-431, M11.10-P01 (contract on #1836, c.6788234570): a student or a
-- teacher reports a problem; the report is their own description and a closed
-- technical context, and the answer is a reference to quote (D-69).
--
-- No column can hold the text of a work, a paragraph, a title or a journal
-- entry, not even indirectly: every context column is a member of a fixed set
-- or a pattern without room for words, and the description is the only free
-- text (src/domain/support/problem-report.ts holds the same limits). Who sent
-- it comes from the session, never from an argument.
--
-- Nobody but the owner reads or writes the table: ductus_app only calls
-- identity.submit_problem_report(), which returns the reference and nothing
-- else. Reading the reports for support is a later step with its own grant.
--
-- At most five reports per account in a sliding hour. The count runs after a
-- lock on the caller's user_account row, under READ COMMITTED, so two reports
-- at once are put in a row and the second counts the first
-- (tests/integration/problem-report-rate-limit.integration.test.ts). No other
-- lock is taken first, and no session path locks user_account (see
-- 20261109200000_session_limit.sql), so there is no lock order to invert.
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE TABLE identity.problem_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE CHECK (reference ~ '^PR-[0-9A-F]{10}$'),
  institution_id uuid NOT NULL,
  user_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('technical', 'account', 'course')),
  description text NOT NULL CHECK (
    char_length(description) BETWEEN 1 AND 1000
    -- C0 but tab and newline, DEL, C1, and the bidi embeddings and isolates.
    AND description !~ '[\u0001-\u0008\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]'
    -- Something besides White_Space and zero width.
    AND description ~ '[^\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]'
  ),
  route text CHECK (route IN (
    '/', '/nastavnik', '/nastavnik/brz-put', '/nastavnik/kolegiji', '/nastavnik/mentorstva',
    '/nastavnik/rad/[id]', '/nastavnik/rad/[id]/reprodukcija', '/nastavnik/zadatak/[assignmentId]/uredi',
    '/nastavnik/zadatak/novi', '/prijava', '/rad', '/rad/[assignmentId]/predaja',
    '/rad/[assignmentId]/reprodukcija', '/upis', '/upis/kolegij/[courseId]',
    '/ustanova', '/ustanova/kolegiji', '/ustanova/korisnici', '/ustanova/pravila',
    '/zadaci', '/zadaci/kolegiji', '/zadaci/radovi', '/zadatak/[id]'
  )),
  app_version text NOT NULL CHECK (app_version ~ '^(?:(?:0|[1-9][0-9]{0,3})\.(?:0|[1-9][0-9]{0,3})\.(?:0|[1-9][0-9]{0,3})(?:\+[0-9a-f]{7,40})?|[0-9a-f]{7,40})$'),
  browser_family text NOT NULL CHECK (browser_family IN ('chromium', 'firefox', 'safari', 'other')),
  browser_major integer CHECK (browser_major BETWEEN 0 AND 999),
  sync_state text CHECK (sync_state IN (
    'EDITING', 'SAVING_LOCAL', 'LOCAL_DURABLE', 'SYNCING', 'SYNCED', 'CONFLICT', 'ERROR', 'RECOVERY_REQUIRED'
  )),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (user_id, institution_id) REFERENCES identity.user_account (id, institution_id)
);
CREATE INDEX problem_report_user_created ON identity.problem_report (user_id, created_at);

ALTER TABLE identity.problem_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.problem_report FORCE ROW LEVEL SECURITY;
CREATE POLICY problem_report_owner ON identity.problem_report TO ductus_identity
  USING (true) WITH CHECK (true);

-- The caller's report; returns its reference. ZD401 without a live session,
-- ZD422 for a value outside its class, ZD429 at the hourly limit.
CREATE FUNCTION identity.submit_problem_report(
  p_category text,
  p_description text,
  p_route text,
  p_app_version text,
  p_browser_family text,
  p_browser_major integer,
  p_sync_state text
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_institution uuid;
  v_reference text;
  v_attempt integer;
BEGIN
  SELECT a.user_id, a.institution_id INTO v_user, v_institution FROM app.current_actor() a;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  -- The count below must see what a report that held the lock has committed.
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE = 'ZD500';
  END IF;
  PERFORM 1 FROM identity.user_account u WHERE u.id = v_user FOR NO KEY UPDATE;
  IF (SELECT pg_catalog.count(*) FROM identity.problem_report r
      WHERE r.user_id = v_user AND r.created_at > pg_catalog.statement_timestamp() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'too many reports' USING ERRCODE = 'ZD429';
  END IF;
  -- 40 random bits; a reference already taken is drawn again.
  FOR v_attempt IN 1..5 LOOP
    v_reference := 'PR-' || pg_catalog.upper(pg_catalog.substr(
      pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 10));
    BEGIN
      INSERT INTO identity.problem_report (reference, institution_id, user_id, category, description, route,
                                           app_version, browser_family, browser_major, sync_state)
      VALUES (v_reference, v_institution, v_user, p_category, p_description, p_route,
              p_app_version, p_browser_family, p_browser_major, p_sync_state);
      RETURN v_reference;
    EXCEPTION
      WHEN unique_violation THEN
        NULL;
      WHEN check_violation OR not_null_violation OR string_data_right_truncation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
    END;
  END LOOP;
  RAISE EXCEPTION 'no free reference' USING ERRCODE = 'ZD503';
END
$$;

REVOKE ALL ON FUNCTION identity.submit_problem_report(text, text, text, text, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.submit_problem_report(text, text, text, text, text, integer, text) TO ductus_app;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION identity.submit_problem_report(text, text, text, text, text, integer, text);
DROP TABLE identity.problem_report;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

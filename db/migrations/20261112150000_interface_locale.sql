-- migrate:up
-- DAN-427, M11.5-P02 (contract on #1836, c.6820446364): a person's interface
-- language (D-70, F-06), the language of the screen they read. It is not the
-- language a work is written in (work_language, a value of the work) and it
-- changes nothing on identity.user_account or what AAI@EduHr sent (D-09).
--
-- One row per account, written only by identity.set_interface_locale() for
-- the caller of the session and read only by identity.interface_locale().
-- The set is the set of interface catalogues (src/lib/i18n/locale.ts,
-- INTERFACE_LOCALES); tests/unit/interface-locale-routes.test.ts holds the two
-- together. No row means the default (Croatian).
--
-- Two calls of one person at once meet on the primary key: INSERT ... ON
-- CONFLICT DO UPDATE waits for the other and then updates its row, so there is
-- never a second row or a unique_violation, and the last to commit wins
-- (tests/integration/interface-locale-concurrency.integration.test.ts).
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE TABLE identity.user_preference (
  user_id uuid PRIMARY KEY,
  institution_id uuid NOT NULL,
  interface_locale text NOT NULL CHECK (interface_locale IN ('hr', 'en')),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (user_id, institution_id) REFERENCES identity.user_account (id, institution_id)
);

ALTER TABLE identity.user_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.user_preference FORCE ROW LEVEL SECURITY;
CREATE POLICY user_preference_owner ON identity.user_preference TO ductus_identity
  USING (true) WITH CHECK (true);

-- Sets the caller's interface language and returns it. ZD401 without a live
-- session, ZD422 for a value outside the set.
CREATE FUNCTION identity.set_interface_locale(p_locale text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_institution uuid;
  v_locale text;
BEGIN
  SELECT a.user_id, a.institution_id INTO v_user, v_institution FROM app.current_actor() a;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  BEGIN
    INSERT INTO identity.user_preference AS p (user_id, institution_id, interface_locale)
    VALUES (v_user, v_institution, p_locale)
    ON CONFLICT (user_id) DO UPDATE
      SET interface_locale = EXCLUDED.interface_locale, updated_at = pg_catalog.statement_timestamp()
    RETURNING p.interface_locale INTO v_locale;
  EXCEPTION
    WHEN check_violation OR not_null_violation THEN
      RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END;
  RETURN v_locale;
END
$$;

-- The caller's interface language, or NULL when they have not chosen one.
-- ZD401 without a live session.
CREATE FUNCTION identity.interface_locale() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid;
BEGIN
  SELECT a.user_id INTO v_user FROM app.current_actor() a;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  RETURN (SELECT p.interface_locale FROM identity.user_preference p WHERE p.user_id = v_user);
END
$$;

REVOKE ALL ON FUNCTION identity.set_interface_locale(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.interface_locale() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.set_interface_locale(text) TO ductus_app;
GRANT EXECUTE ON FUNCTION identity.interface_locale() TO ductus_app;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION identity.interface_locale();
DROP FUNCTION identity.set_interface_locale(text);
DROP TABLE identity.user_preference;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

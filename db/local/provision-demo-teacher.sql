-- K-3 / DAN-88 — explicit operator bootstrap for ONE invented teacher.
-- Run only after signing in as "Demo nastavnik" with the fake OIDC provider.
-- This is NOT a migration, production path, identity mapping, HTTP endpoint,
-- or rule that promotes the OIDC "employee" affiliation to a teacher.
-- The local operator uses the compose superuser over the container socket.
\set ON_ERROR_STOP on
SELECT (
    pg_catalog.inet_server_addr() IS NULL
    AND pg_catalog.current_database() = 'ductus'
    AND session_user = 'ductus'
) AS trusted_local_operator \gset
\if :trusted_local_operator
\else
  DO $$ BEGIN RAISE EXCEPTION 'demo teacher bootstrap is local compose only'; END $$;
\endif

BEGIN;
DO $bootstrap$
DECLARE
  teacher record;
BEGIN
  -- Never accept an arbitrary user, institution or OIDC issuer as input.
  SELECT u.id AS user_id, u.institution_id
    INTO STRICT teacher
    FROM identity.user_account u
    JOIN identity.institution i ON i.id = u.institution_id
   WHERE u.hr_edu_person_unique_id = 'demo-teacher@demo.ductus.test'
     AND u.oidc_subject = 'demo-teacher'
     AND u.oidc_issuer = 'http://localhost:8090'
     AND i.slug = 'demo-fakultet'
     AND i.aai_home_org = 'demo.ductus.test';

  -- Operator bootstrap for synthetic local identity only. NULL confirmed_by
  -- records a local operator grant, never a human faculty administrator.
  -- The normal product flow requires institution.confirm_teacher_role.
  INSERT INTO institution.institution_role
    (institution_id, user_id, role, confirmed_by, confirmed_at)
  VALUES (teacher.institution_id, teacher.user_id, 'teacher', NULL, now())
  ON CONFLICT (institution_id, user_id, role) WHERE revoked_at IS NULL
  DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM institution.institution_role r
     WHERE r.user_id = teacher.user_id
       AND r.institution_id = teacher.institution_id
       AND r.role = 'teacher' AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'synthetic teacher role was not confirmed';
  END IF;
END
$bootstrap$;
COMMIT;

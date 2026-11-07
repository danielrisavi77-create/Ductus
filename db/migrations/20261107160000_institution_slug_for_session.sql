-- M2.12-P02 (DAN-443), plan #1689 C1 to C7: the slug of the session's own
-- institution, so the server picks that institution's configuration record
-- (citation style) with the institution taken from the session, never from
-- the request. ductus_app cannot read identity.institution; this function
-- returns one slug and nothing else, derived from app.current_actor(): no
-- parameter, NULL without an open, unexpired session. The caller reads it
-- in the same statement as current_actor(), so person and slug come from
-- one snapshot.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_identity;

SET LOCAL ROLE ductus_identity;
CREATE FUNCTION app.current_institution_slug() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT i.slug
    FROM app.current_actor() a
    JOIN identity.institution i ON i.id = a.institution_id
$$;
REVOKE ALL ON FUNCTION app.current_institution_slug() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_institution_slug() TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 8).
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app TO ductus_identity;
SET LOCAL ROLE ductus_identity;
DROP FUNCTION app.current_institution_slug();
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity;

-- F-113 point 2 (#646): does this document belong to this assignment, for the
-- caller? The web role asks it before it names an assignment's course and
-- instructions next to a document. True only for the caller's own document
-- whose work is that assignment, while the caller is a student of it; false
-- in every other case, with no error that tells the cases apart. Identity
-- comes from current_actor(), never from an argument.
--
-- SECURITY INVOKER on purpose: it reads evidence.document and evidence.project
-- under the web role's existing RLS (own rows of the own institution) and so
-- needs no right the caller does not already have. The explicit principal and
-- institution conditions repeat those policies inside the function.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_identity;

SET LOCAL ROLE ductus_identity;
CREATE FUNCTION app.work_document_in_assignment(p_document_id text, p_assignment_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  -- PL/pgSQL, so the names resolve when the caller runs it, with the caller's
  -- rights; the creating role needs no access to institution or evidence.
  RETURN coalesce(
    institution.actor_assignment_role(p_assignment_id) = 'student'
    AND EXISTS (
      SELECT 1
        FROM evidence.document d
        JOIN evidence.project p
          ON p.id = d.project_id AND p.institution_id = d.institution_id AND p.principal_id = d.principal_id
       WHERE d.id = p_document_id
         AND p.assignment_id = p_assignment_id
         AND d.principal_id = (SELECT app.current_user_id())
         AND d.institution_id = (SELECT app.current_institution_id())
    ),
    false);
END
$$;
REVOKE ALL ON FUNCTION app.work_document_in_assignment(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.work_document_in_assignment(text, uuid) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app TO ductus_identity;
SET LOCAL ROLE ductus_identity;
DROP FUNCTION app.work_document_in_assignment(text, uuid);
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity;

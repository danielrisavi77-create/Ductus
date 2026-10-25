-- DAN-289 O2 (contract on #756, c.6397770372): whether the caller's work for
-- an assignment is submitted, so that the open route can tell a reloaded
-- client before it sends anything. True exactly when the caller has a row in
-- evidence.submission for that assignment in the caller's institution; false
-- otherwise, also without a session, for another assignment, after a request
-- alone and for NULL. Identity and institution come from current_actor(); the
-- answer carries nothing else about the submission. Writes nothing.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;
CREATE FUNCTION app.work_submitted(p_assignment_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM app.current_actor() a
      JOIN evidence.submission s
        ON s.principal_id = a.user_id AND s.institution_id = a.institution_id
     WHERE s.assignment_id = p_assignment_id
  )
$$;
REVOKE ALL ON FUNCTION app.work_submitted(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.work_submitted(uuid) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.work_submitted(uuid);
RESET ROLE;

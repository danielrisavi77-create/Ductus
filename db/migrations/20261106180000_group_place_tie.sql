-- migrate:up
-- DAN-351, #1629 (BLOK on #1091, c.6688868433; go-ahead c.6689061806): a place in a seminar group
-- could start in the very microsecond in which another transaction started a
-- work, and the new teacher of the group then reached it. now() is the start
-- of the transaction in microseconds, so the transaction of
-- institution.assign_group_teacher or assign_group_student can begin in the
-- microsecond in which a work commits from another transaction; the work's
-- start then equals now(), "v_last > now()" is false and the place starts at
-- that very start, which institution.actor_group_work counts as reached
-- (20261104100000). The latest start read by both functions now counts such a
-- work of another transaction one microsecond later, so the place starts
-- after it. A work of this very transaction (its row's xmin is the
-- transaction's own id) stays equal, as before. A work written in a
-- subtransaction of this one counts as another transaction's: the place then
-- starts later, never earlier. Same signature, owner and grant; the two
-- assign functions are not changed.
SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT USAGE, CREATE ON SCHEMA collaboration TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;
CREATE OR REPLACE FUNCTION collaboration.works_started_last(p_institution_id uuid, p_assignment_ids uuid[], p_student_ids uuid[])
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT max(CASE WHEN p.created_at = now()
                   AND p.xmin IS DISTINCT FROM pg_catalog.pg_current_xact_id_if_assigned()::xid
                  THEN p.created_at + interval '1 microsecond'
                  ELSE p.created_at END)
    FROM evidence.project p
   WHERE p.institution_id = p_institution_id AND p.assignment_id = ANY (p_assignment_ids)
     AND p.principal_id = ANY (p_student_ids)
$$;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE USAGE, CREATE ON SCHEMA collaboration FROM ductus_evidence;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
-- The definition of 20261104100000.
SET LOCAL ROLE ductus_migrator;
GRANT USAGE, CREATE ON SCHEMA collaboration TO ductus_evidence;
SET LOCAL ROLE ductus_evidence;
CREATE OR REPLACE FUNCTION collaboration.works_started_last(p_institution_id uuid, p_assignment_ids uuid[], p_student_ids uuid[])
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT max(p.created_at) FROM evidence.project p
   WHERE p.institution_id = p_institution_id AND p.assignment_id = ANY (p_assignment_ids)
     AND p.principal_id = ANY (p_student_ids)
$$;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE USAGE, CREATE ON SCHEMA collaboration FROM ductus_evidence;

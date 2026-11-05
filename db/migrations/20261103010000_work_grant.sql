-- migrate:up
-- DAN-379, M2.8-P01 (contract on #1091, c.6584625903): a co-mentor and a
-- committee member get access to one work through a grant that is limited in
-- time, per work and per action, and denied by default (D-205 t.3, O4; roles
-- D-204 t.5).
--
-- A grant names one work: the work of one student on one assignment. It lets
-- one grantee do the listed actions between valid_from and valid_to:
--   read_text  read the text of the work
--   comment    comment on the work
-- Nothing else. A grant never gives the replay or the process view (D-238),
-- never write or propose, and never lets the grantee grant further. That is
-- why grant_can() is its own decision and can() is not changed.
--
-- Who grants: a teacher of the work (a teacher member of the course, or the
-- mentor of an open mentorship, with a confirmed and unrevoked teacher role of
-- the institution, the same relation as can()). Who receives: a holder of a
-- confirmed and unrevoked teacher role of the same institution, other than
-- the granter and the student. Who revokes: the granter, or any teacher of
-- the work.
--
-- A grant is live only while all of these hold, checked on every call:
--   - it is not revoked and the statement time is in [valid_from, valid_to);
--   - the grantee still holds the confirmed teacher role;
--   - the granter is still a teacher of the work.
-- So a revoked role, an ended mentorship or a revoked grant closes access at
-- the next statement, without a job and without touching the grant row.
--
-- The client never writes the table: it reads its own rows through RLS and
-- changes them only through grant_work_access() and revoke_work_access().
-- No UI yet; U-1 decides that before M6.12.
SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- The set of actions of a grant: one-dimensional, starting at 1, one or two
-- distinct known actions, no null. Used by the table check and by the RPC.
CREATE FUNCTION institution.is_grant_action_set(p_actions text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT coalesce(
    pg_catalog.array_ndims(p_actions) = 1
    AND pg_catalog.array_lower(p_actions, 1) = 1
    AND pg_catalog.cardinality(p_actions) BETWEEN 1 AND 2
    AND pg_catalog.array_position(p_actions, NULL) IS NULL
    AND p_actions OPERATOR(pg_catalog.<@) ARRAY['read_text', 'comment']::text[]
    AND pg_catalog.cardinality(p_actions) = (SELECT count(DISTINCT x) FROM pg_catalog.unnest(p_actions) x),
    false)
$$;

-- The relation of a user to an assignment: 'teacher', 'student' or null,
-- within the institution of the assignment (U1: no function takes the
-- institution from its caller). A teacher also holds the confirmed and
-- unrevoked teacher role of that institution (D-204). Not callable by the app.
CREATE FUNCTION institution.work_relation(p_user_id uuid, p_assignment_id uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE
           WHEN r.relation = 'teacher' AND NOT EXISTS (
             SELECT 1 FROM institution.institution_role ir
             WHERE ir.user_id = p_user_id AND ir.institution_id = r.institution_id
               AND ir.role = 'teacher' AND ir.confirmed_at IS NOT NULL AND ir.revoked_at IS NULL)
             THEN NULL
           ELSE r.relation
         END
  FROM (
    SELECT a.institution_id,
           CASE
             WHEN a.course_id IS NOT NULL THEN (
               SELECT m.role FROM institution.course_member m
               WHERE m.course_id = a.course_id AND m.institution_id = a.institution_id
                 AND m.user_id = p_user_id AND m.member_to IS NULL)
             ELSE (
               SELECT CASE WHEN ms.mentor_id = p_user_id THEN 'teacher'
                           WHEN ms.student_id = p_user_id THEN 'student' END
               FROM institution.mentorship ms
               WHERE ms.id = a.mentorship_id AND ms.institution_id = a.institution_id
                 AND ms.ended_at IS NULL)
           END AS relation
    FROM institution.assignment a
    WHERE a.id = p_assignment_id
  ) r
$$;

CREATE TABLE institution.work_grant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  student_id uuid NOT NULL,
  grantee_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('co_mentor', 'committee')),
  actions text[] NOT NULL CHECK (institution.is_grant_action_set(actions)),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz NOT NULL,
  granted_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  revoked_at timestamptz,
  revoked_by uuid,
  CONSTRAINT work_grant_finite CHECK (isfinite(valid_from) AND isfinite(valid_to)),
  CONSTRAINT work_grant_interval CHECK (valid_to > valid_from AND valid_to - valid_from <= interval '366 days'),
  CONSTRAINT work_grant_grantee CHECK (grantee_id <> student_id AND grantee_id <> granted_by),
  CONSTRAINT work_grant_revoked CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment (id, institution_id),
  FOREIGN KEY (student_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (grantee_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (granted_by, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (revoked_by, institution_id) REFERENCES identity.user_account (id, institution_id)
);

-- squawk-ignore require-concurrent-index-creation
CREATE INDEX work_grant_grantee_idx ON institution.work_grant (grantee_id, assignment_id, student_id);
-- squawk-ignore require-concurrent-index-creation
CREATE INDEX work_grant_work_idx ON institution.work_grant (assignment_id, student_id);

ALTER TABLE institution.work_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution.work_grant FORCE ROW LEVEL SECURITY;
CREATE POLICY work_grant_owner ON institution.work_grant TO ductus_identity
  USING (true) WITH CHECK (true);
-- The grantee, the student of the work and a teacher of the work see a grant.
CREATE POLICY work_grant_read ON institution.work_grant FOR SELECT TO ductus_app
  USING (
    institution_id = (SELECT app.current_institution_id())
    AND (grantee_id = (SELECT app.current_user_id())
         OR student_id = (SELECT app.current_user_id())
         OR institution.actor_assignment_role(assignment_id) = 'teacher')
  );

CREATE FUNCTION institution.grant_work_access(
  p_assignment_id uuid,
  p_student_id uuid,
  p_grantee_id uuid,
  p_kind text,
  p_actions text[],
  p_valid_from timestamptz,
  p_valid_to timestamptz
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_from timestamptz;
  v_id uuid;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();

  IF institution.work_relation(actor.user_id, p_assignment_id)
       IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'ZD403';
  END IF;

  IF p_valid_from IS NOT NULL AND NOT isfinite(p_valid_from) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  -- A start in the past is the start of the call: a grant never reaches back.
  v_from := greatest(coalesce(p_valid_from, statement_timestamp()), statement_timestamp());

  IF p_kind IS NULL OR p_kind NOT IN ('co_mentor', 'committee')
     OR NOT institution.is_grant_action_set(p_actions)
     OR p_valid_to IS NULL OR NOT isfinite(p_valid_to)
     OR p_valid_to <= v_from
     OR p_valid_to - v_from > interval '366 days'
     OR institution.work_relation(p_student_id, p_assignment_id)
          IS DISTINCT FROM 'student'
     OR p_grantee_id IS NULL
     OR p_grantee_id = p_student_id
     OR p_grantee_id = actor.user_id
     OR NOT EXISTS (
       SELECT 1 FROM institution.institution_role r
       WHERE r.user_id = p_grantee_id AND r.institution_id = actor.institution_id
         AND r.role = 'teacher' AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL)
  THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;

  INSERT INTO institution.work_grant
    (institution_id, assignment_id, student_id, grantee_id, kind, actions, valid_from, valid_to, granted_by)
  VALUES
    (actor.institution_id, p_assignment_id, p_student_id, p_grantee_id, p_kind, p_actions, v_from, p_valid_to, actor.user_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- True when this call revoked the grant, false when it was already revoked.
CREATE FUNCTION institution.revoke_work_access(p_grant_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  g record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();

  SELECT w.assignment_id, w.granted_by, w.revoked_at INTO g
  FROM institution.work_grant w
  WHERE w.id = p_grant_id AND w.institution_id = actor.institution_id
  FOR UPDATE;
  IF NOT FOUND
     OR (g.granted_by <> actor.user_id
         AND institution.work_relation(actor.user_id, g.assignment_id)
               IS DISTINCT FROM 'teacher') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'ZD403';
  END IF;

  IF g.revoked_at IS NOT NULL THEN
    RETURN false;
  END IF;

  UPDATE institution.work_grant
  SET revoked_at = statement_timestamp(), revoked_by = actor.user_id
  WHERE id = p_grant_id;
  RETURN true;
END
$$;

-- May the actor do the action on the work through a live grant. Unknown or
-- null action: ZD422, as in can(). Everything else that is not allowed is
-- false.
CREATE FUNCTION institution.grant_can(p_action text, p_document_id text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_institution uuid;
  v_scope record;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('read_text', 'comment') THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;

  SELECT a.user_id, a.institution_id INTO v_user, v_institution FROM app.current_actor() a;
  IF v_user IS NULL OR p_document_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT s.institution_id, s.assignment_id, s.principal_id INTO v_scope
  FROM collaboration.document_scope(p_document_id) s;
  IF v_scope.institution_id IS DISTINCT FROM v_institution THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM institution.institution_role r
    WHERE r.user_id = v_user AND r.institution_id = v_institution AND r.role = 'teacher'
      AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
  ) AND EXISTS (
    SELECT 1 FROM institution.work_grant g
    WHERE g.institution_id = v_institution
      AND g.grantee_id = v_user
      AND g.assignment_id = v_scope.assignment_id
      AND g.student_id = v_scope.principal_id
      AND g.revoked_at IS NULL
      AND statement_timestamp() >= g.valid_from
      AND statement_timestamp() < g.valid_to
      AND p_action = ANY (g.actions)
      AND institution.work_relation(g.granted_by, g.assignment_id) = 'teacher'
  );
END
$$;

REVOKE ALL ON FUNCTION institution.is_grant_action_set(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION institution.work_relation(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION institution.grant_work_access(uuid, uuid, uuid, text, text[], timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION institution.revoke_work_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION institution.grant_can(text, text) FROM PUBLIC;
GRANT SELECT ON institution.work_grant TO ductus_app;
GRANT EXECUTE ON FUNCTION institution.grant_work_access(uuid, uuid, uuid, text, text[], timestamptz, timestamptz) TO ductus_app;
GRANT EXECUTE ON FUNCTION institution.revoke_work_access(uuid) TO ductus_app;
GRANT EXECUTE ON FUNCTION institution.grant_can(text, text) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION institution.grant_can(text, text);
DROP FUNCTION institution.revoke_work_access(uuid);
DROP FUNCTION institution.grant_work_access(uuid, uuid, uuid, text, text[], timestamptz, timestamptz);
DROP TABLE institution.work_grant;
DROP FUNCTION institution.work_relation(uuid, uuid);
DROP FUNCTION institution.is_grant_action_set(text[]);

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:up
-- A retried assignment-creation request must not create a second assignment
-- when the client loses the first response (docs/BACKEND.md 6, idempotency).
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

ALTER TABLE institution.assignment ADD COLUMN request_id uuid;
CREATE UNIQUE INDEX assignment_created_by_request_id_idx
  ON institution.assignment (created_by, request_id)
  WHERE request_id IS NOT NULL;

CREATE FUNCTION institution.create_assignment(
  p_course_id uuid, p_request_id uuid, p_title text, p_instructions text, p_work_type text,
  p_opens_at timestamptz, p_due_at timestamptz, p_ai_policy text, p_ai_purposes text[],
  p_evidence_profile text, p_import_allowed boolean
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_assignment uuid;
  existing record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF p_request_id IS NULL
     OR NOT institution.is_assignment_content(p_title, p_instructions, p_work_type, p_opens_at, p_due_at,
                                              p_ai_policy, p_ai_purposes, p_evidence_profile, p_import_allowed)
     OR institution.ai_policy_rank(p_ai_policy)
        > (SELECT institution.ai_policy_rank(c.ai_policy) FROM institution.course c WHERE c.id = p_course_id) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;

  INSERT INTO institution.assignment (course_id, institution_id, created_by, request_id)
  VALUES (p_course_id, actor.institution_id, actor.user_id, p_request_id)
  ON CONFLICT (created_by, request_id) WHERE request_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_assignment;

  IF v_assignment IS NOT NULL THEN
    INSERT INTO institution.assignment_version (
      assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
      ai_purposes, evidence_profile, import_allowed, created_by
    )
    VALUES (v_assignment, 1, p_title, p_instructions, p_work_type, p_opens_at, p_due_at, p_ai_policy,
            p_ai_purposes, p_evidence_profile, p_import_allowed, actor.user_id);
    RETURN v_assignment;
  END IF;

  -- A key belongs to one creator. Replays return the original assignment only
  -- when every field of its immutable first version and its course match.
  SELECT a.id, a.course_id, v.title, v.instructions, v.work_type, v.opens_at, v.due_at,
         v.ai_policy, v.ai_purposes, v.evidence_profile, v.import_allowed
    INTO existing
    FROM institution.assignment a
    JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = 1
   WHERE a.created_by = actor.user_id AND a.request_id = p_request_id;
  IF existing.id IS NULL
     OR existing.course_id IS DISTINCT FROM p_course_id
     OR existing.title IS DISTINCT FROM p_title
     OR existing.instructions IS DISTINCT FROM p_instructions
     OR existing.work_type IS DISTINCT FROM p_work_type
     OR existing.opens_at IS DISTINCT FROM p_opens_at
     OR existing.due_at IS DISTINCT FROM p_due_at
     OR existing.ai_policy IS DISTINCT FROM p_ai_policy
     OR existing.ai_purposes IS DISTINCT FROM p_ai_purposes
     OR existing.evidence_profile IS DISTINCT FROM p_evidence_profile
     OR existing.import_allowed IS DISTINCT FROM p_import_allowed THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  RETURN existing.id;
END
$$;

REVOKE ALL ON FUNCTION institution.create_assignment(
  uuid, uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.create_assignment(
  uuid, uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean
) TO ductus_app;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_identity;
DROP FUNCTION institution.create_assignment(
  uuid, uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean
);
DROP INDEX institution.assignment_created_by_request_id_idx;
ALTER TABLE institution.assignment DROP COLUMN request_id;
SET LOCAL ROLE ductus_migrator;

-- DAN-229: an optional word range on every assignment version (owner
-- decision of 20 Oct 2026, the range is part of the assignment for the demo).
-- word_min and word_max are each null or an integer from 1 to 1 000 000;
-- when both are set, word_min <= word_max. The version stays immutable. The
-- range is part of the content a create retry must repeat (D-74, #360), and a
-- new version may set any range: rule 14 narrows the AI rule, not the range.
-- All three functions take the range as two last parameters without a
-- default (null is "no range"), and the old signatures are gone, so no call
-- writes a version without stating its range.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- The table and both functions decide through this one rule.
CREATE FUNCTION institution.is_word_range(p_word_min integer, p_word_max integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT (p_word_min IS NULL OR p_word_min BETWEEN 1 AND 1000000)
     AND (p_word_max IS NULL OR p_word_max BETWEEN 1 AND 1000000)
     AND (p_word_min IS NULL OR p_word_max IS NULL OR p_word_min <= p_word_max)
$$;
REVOKE ALL ON FUNCTION institution.is_word_range(integer, integer) FROM PUBLIC;

-- Adding nullable columns rewrites no row, so the immutability triggers do not fire.
ALTER TABLE institution.assignment_version
  ADD COLUMN word_min integer,
  ADD COLUMN word_max integer,
  ADD CONSTRAINT assignment_version_word_range_check CHECK (institution.is_word_range(word_min, word_max));

DROP FUNCTION institution.create_assignment(uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean);
DROP FUNCTION institution.create_assignment(uuid, uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean);
DROP FUNCTION institution.publish_assignment_version(
  uuid, integer, text, text, text, timestamptz, timestamptz, text, text[], text, boolean
);

-- As 20261011100000, with the range.
CREATE FUNCTION institution.create_assignment(
  p_course_id uuid, p_title text, p_instructions text, p_work_type text, p_opens_at timestamptz,
  p_due_at timestamptz, p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_import_allowed boolean,
  p_word_min integer, p_word_max integer
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_assignment uuid;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- Checked here, before the table constraint, whose error quotes the row.
  IF NOT institution.is_assignment_content(p_title, p_instructions, p_work_type, p_opens_at, p_due_at,
                                           p_ai_policy, p_ai_purposes, p_evidence_profile, p_import_allowed)
     OR NOT institution.is_word_range(p_word_min, p_word_max)
     OR institution.ai_policy_rank(p_ai_policy)
        > (SELECT institution.ai_policy_rank(c.ai_policy) FROM institution.course c WHERE c.id = p_course_id) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  INSERT INTO institution.assignment (course_id, institution_id, created_by)
  VALUES (p_course_id, actor.institution_id, actor.user_id)
  RETURNING id INTO v_assignment;
  INSERT INTO institution.assignment_version (
    assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
    ai_purposes, evidence_profile, import_allowed, word_min, word_max, created_by
  )
  VALUES (v_assignment, 1, p_title, p_instructions, p_work_type, p_opens_at, p_due_at, p_ai_policy,
          p_ai_purposes, p_evidence_profile, p_import_allowed, p_word_min, p_word_max, actor.user_id);
  RETURN v_assignment;
END
$$;

-- As 20261014110000, with the range, which a replay must repeat too.
CREATE FUNCTION institution.create_assignment(
  p_course_id uuid, p_request_id uuid, p_title text, p_instructions text, p_work_type text,
  p_opens_at timestamptz, p_due_at timestamptz, p_ai_policy text, p_ai_purposes text[],
  p_evidence_profile text, p_import_allowed boolean,
  p_word_min integer, p_word_max integer
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
     OR NOT institution.is_word_range(p_word_min, p_word_max)
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
      ai_purposes, evidence_profile, import_allowed, word_min, word_max, created_by
    )
    VALUES (v_assignment, 1, p_title, p_instructions, p_work_type, p_opens_at, p_due_at, p_ai_policy,
            p_ai_purposes, p_evidence_profile, p_import_allowed, p_word_min, p_word_max, actor.user_id);
    RETURN v_assignment;
  END IF;

  -- A key belongs to one creator. Replays return the original assignment only
  -- when every field of its immutable first version and its course match.
  SELECT a.id, a.course_id, v.title, v.instructions, v.work_type, v.opens_at, v.due_at,
         v.ai_policy, v.ai_purposes, v.evidence_profile, v.import_allowed, v.word_min, v.word_max
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
     OR existing.import_allowed IS DISTINCT FROM p_import_allowed
     OR existing.word_min IS DISTINCT FROM p_word_min
     OR existing.word_max IS DISTINCT FROM p_word_max THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  RETURN existing.id;
END
$$;

-- As 20261010200000, with the range of the new version.
CREATE FUNCTION institution.publish_assignment_version(
  p_assignment_id uuid, p_expected_version integer, p_title text, p_instructions text, p_work_type text,
  p_opens_at timestamptz, p_due_at timestamptz, p_ai_policy text, p_ai_purposes text[],
  p_evidence_profile text, p_import_allowed boolean,
  p_word_min integer, p_word_max integer
) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  cur record;
  v_current integer;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_assignment_role(p_assignment_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF NOT institution.is_assignment_content(p_title, p_instructions, p_work_type, p_opens_at, p_due_at,
                                           p_ai_policy, p_ai_purposes, p_evidence_profile, p_import_allowed)
     OR NOT institution.is_word_range(p_word_min, p_word_max) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  -- Two teachers at once: the second waits here, then fails the comparison.
  SELECT a.current_version INTO v_current FROM institution.assignment a WHERE a.id = p_assignment_id FOR UPDATE;
  IF v_current IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  SELECT v.* INTO cur FROM institution.assignment_version v
   WHERE v.assignment_id = p_assignment_id AND v.version_no = v_current;
  IF institution.ai_policy_rank(p_ai_policy) > institution.ai_policy_rank(cur.ai_policy)
     OR NOT p_ai_purposes <@ cur.ai_purposes
     OR (p_evidence_profile = 'extended' AND cur.evidence_profile = 'basic')
     OR (p_import_allowed AND NOT cur.import_allowed) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  INSERT INTO institution.assignment_version (
    assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
    ai_purposes, evidence_profile, import_allowed, word_min, word_max, created_by
  )
  VALUES (p_assignment_id, v_current + 1, p_title, p_instructions, p_work_type, p_opens_at, p_due_at, p_ai_policy,
          p_ai_purposes, p_evidence_profile, p_import_allowed, p_word_min, p_word_max, actor.user_id);
  UPDATE institution.assignment a SET current_version = v_current + 1 WHERE a.id = p_assignment_id;
  RETURN v_current + 1;
END
$$;

REVOKE ALL ON FUNCTION
  institution.create_assignment(uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean, integer, integer),
  institution.create_assignment(uuid, uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean, integer, integer),
  institution.publish_assignment_version(uuid, integer, text, text, text, timestamptz, timestamptz, text, text[], text, boolean, integer, integer)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  institution.create_assignment(uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean, integer, integer),
  institution.create_assignment(uuid, uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean, integer, integer),
  institution.publish_assignment_version(uuid, integer, text, text, text, timestamptz, timestamptz, text, text[], text, boolean, integer, integer)
TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;
DROP FUNCTION institution.create_assignment(uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean, integer, integer);
DROP FUNCTION institution.create_assignment(uuid, uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean, integer, integer);
DROP FUNCTION institution.publish_assignment_version(uuid, integer, text, text, text, timestamptz, timestamptz, text, text[], text, boolean, integer, integer);
CREATE FUNCTION institution.create_assignment(
  p_course_id uuid, p_title text, p_instructions text, p_work_type text, p_opens_at timestamptz,
  p_due_at timestamptz, p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_import_allowed boolean
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_assignment uuid;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF NOT institution.is_assignment_content(p_title, p_instructions, p_work_type, p_opens_at, p_due_at,
                                           p_ai_policy, p_ai_purposes, p_evidence_profile, p_import_allowed)
     OR institution.ai_policy_rank(p_ai_policy)
        > (SELECT institution.ai_policy_rank(c.ai_policy) FROM institution.course c WHERE c.id = p_course_id) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  INSERT INTO institution.assignment (course_id, institution_id, created_by)
  VALUES (p_course_id, actor.institution_id, actor.user_id)
  RETURNING id INTO v_assignment;
  INSERT INTO institution.assignment_version (
    assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
    ai_purposes, evidence_profile, import_allowed, created_by
  )
  VALUES (v_assignment, 1, p_title, p_instructions, p_work_type, p_opens_at, p_due_at, p_ai_policy,
          p_ai_purposes, p_evidence_profile, p_import_allowed, actor.user_id);
  RETURN v_assignment;
END
$$;
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
CREATE FUNCTION institution.publish_assignment_version(
  p_assignment_id uuid, p_expected_version integer, p_title text, p_instructions text, p_work_type text,
  p_opens_at timestamptz, p_due_at timestamptz, p_ai_policy text, p_ai_purposes text[],
  p_evidence_profile text, p_import_allowed boolean
) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  cur record;
  v_current integer;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_assignment_role(p_assignment_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF NOT institution.is_assignment_content(p_title, p_instructions, p_work_type, p_opens_at, p_due_at,
                                           p_ai_policy, p_ai_purposes, p_evidence_profile, p_import_allowed) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  SELECT a.current_version INTO v_current FROM institution.assignment a WHERE a.id = p_assignment_id FOR UPDATE;
  IF v_current IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  SELECT v.* INTO cur FROM institution.assignment_version v
   WHERE v.assignment_id = p_assignment_id AND v.version_no = v_current;
  IF institution.ai_policy_rank(p_ai_policy) > institution.ai_policy_rank(cur.ai_policy)
     OR NOT p_ai_purposes <@ cur.ai_purposes
     OR (p_evidence_profile = 'extended' AND cur.evidence_profile = 'basic')
     OR (p_import_allowed AND NOT cur.import_allowed) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  INSERT INTO institution.assignment_version (
    assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
    ai_purposes, evidence_profile, import_allowed, created_by
  )
  VALUES (p_assignment_id, v_current + 1, p_title, p_instructions, p_work_type, p_opens_at, p_due_at, p_ai_policy,
          p_ai_purposes, p_evidence_profile, p_import_allowed, actor.user_id);
  UPDATE institution.assignment a SET current_version = v_current + 1 WHERE a.id = p_assignment_id;
  RETURN v_current + 1;
END
$$;
REVOKE ALL ON FUNCTION
  institution.create_assignment(uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean),
  institution.create_assignment(uuid, uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean),
  institution.publish_assignment_version(uuid, integer, text, text, text, timestamptz, timestamptz, text, text[], text, boolean)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  institution.create_assignment(uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean),
  institution.create_assignment(uuid, uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean),
  institution.publish_assignment_version(uuid, integer, text, text, text, timestamptz, timestamptz, text, text[], text, boolean)
TO ductus_app;
-- Versions written with a range cannot be rewritten (immutable); the columns go with their values.
ALTER TABLE institution.assignment_version DROP CONSTRAINT assignment_version_word_range_check,
  DROP COLUMN word_min, DROP COLUMN word_max;
DROP FUNCTION institution.is_word_range(integer, integer);
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

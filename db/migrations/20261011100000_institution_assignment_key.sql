-- migrate:up
-- The institution key on assignments and acknowledgments (B-8 prerequisite;
-- owner decision of 11 Oct 2026, issue #87). Both tables existed without
-- institution_id; this changes them in place. No real data exists yet, so the
-- backfill only meets local and test rows.
--
-- The rules of the key, for these tables and every later one in B-8:
-- institution_id is NOT NULL and has no default; a row takes it from its
-- parent row or from the session, never from a parameter; every foreign key
-- to a parent that carries the institution, and to user_account, includes
-- it, so a row can never join a parent or a person of another institution;
-- no foreign key cascades.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- Assignment: the institution of its course.
ALTER TABLE institution.assignment ADD COLUMN institution_id uuid;
UPDATE institution.assignment a SET institution_id = c.institution_id
  FROM institution.course c WHERE c.id = a.course_id;
ALTER TABLE institution.assignment ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE institution.assignment
  ADD CONSTRAINT assignment_id_institution_key UNIQUE (id, institution_id),
  DROP CONSTRAINT assignment_course_id_fkey,
  ADD CONSTRAINT assignment_course_institution_fkey
    FOREIGN KEY (course_id, institution_id) REFERENCES institution.course (id, institution_id),
  DROP CONSTRAINT assignment_created_by_fkey,
  ADD CONSTRAINT assignment_created_by_institution_fkey
    FOREIGN KEY (created_by, institution_id) REFERENCES identity.user_account (id, institution_id);

-- Acknowledgment: the institution of its assignment, which is the student's.
ALTER TABLE institution.notice_acknowledgment ADD COLUMN institution_id uuid;
UPDATE institution.notice_acknowledgment n SET institution_id = a.institution_id
  FROM institution.assignment a WHERE a.id = n.assignment_id;
ALTER TABLE institution.notice_acknowledgment ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE institution.notice_acknowledgment
  ADD CONSTRAINT notice_acknowledgment_assignment_institution_fkey
    FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment (id, institution_id),
  DROP CONSTRAINT notice_acknowledgment_student_id_fkey,
  ADD CONSTRAINT notice_acknowledgment_student_institution_fkey
    FOREIGN KEY (student_id, institution_id) REFERENCES identity.user_account (id, institution_id);

-- The policies check the institution of the session on the row itself, before
-- any part in the course is looked up.
ALTER POLICY assignment_read ON institution.assignment
  USING (institution_id = (SELECT app.current_institution_id())
         AND institution.actor_course_role(course_id) IS NOT NULL);
ALTER POLICY notice_acknowledgment_read ON institution.notice_acknowledgment
  USING (
    institution_id = (SELECT app.current_institution_id())
    AND (institution.actor_assignment_role(assignment_id) = 'teacher'
         OR (student_id = (SELECT app.current_user_id())
             AND institution.actor_assignment_role(assignment_id) = 'student'))
  );

-- Unchanged but for the institution, which comes from the session: the
-- course was just checked to be the caller's, and the foreign key refuses any
-- other.
CREATE OR REPLACE FUNCTION institution.create_assignment(
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
  -- Checked here, before the table constraint, whose error quotes the row.
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

-- Unchanged but for the institution, which comes from the session, as the
-- student does; the foreign keys refuse an assignment of another one.
CREATE OR REPLACE FUNCTION institution.acknowledge_notice(p_assignment_id uuid, p_version_no integer) RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_current integer;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_assignment_role(p_assignment_id) IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  SELECT a.current_version INTO v_current FROM institution.assignment a WHERE a.id = p_assignment_id FOR SHARE;
  IF v_current IS DISTINCT FROM p_version_no THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
  VALUES (p_assignment_id, v_current, actor.user_id, actor.institution_id)
  ON CONFLICT (assignment_id, version_no, student_id) DO NOTHING;
  RETURN (SELECT n.acknowledged_at FROM institution.notice_acknowledgment n
           WHERE n.assignment_id = p_assignment_id AND n.version_no = v_current AND n.student_id = actor.user_id);
END
$$;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;
CREATE OR REPLACE FUNCTION institution.acknowledge_notice(p_assignment_id uuid, p_version_no integer) RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_current integer;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_assignment_role(p_assignment_id) IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  SELECT a.current_version INTO v_current FROM institution.assignment a WHERE a.id = p_assignment_id FOR SHARE;
  IF v_current IS DISTINCT FROM p_version_no THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id)
  VALUES (p_assignment_id, v_current, actor.user_id)
  ON CONFLICT (assignment_id, version_no, student_id) DO NOTHING;
  RETURN (SELECT n.acknowledged_at FROM institution.notice_acknowledgment n
           WHERE n.assignment_id = p_assignment_id AND n.version_no = v_current AND n.student_id = actor.user_id);
END
$$;
CREATE OR REPLACE FUNCTION institution.create_assignment(
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
  -- Checked here, before the table constraint, whose error quotes the row.
  IF NOT institution.is_assignment_content(p_title, p_instructions, p_work_type, p_opens_at, p_due_at,
                                           p_ai_policy, p_ai_purposes, p_evidence_profile, p_import_allowed)
     OR institution.ai_policy_rank(p_ai_policy)
        > (SELECT institution.ai_policy_rank(c.ai_policy) FROM institution.course c WHERE c.id = p_course_id) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  INSERT INTO institution.assignment (course_id, created_by) VALUES (p_course_id, actor.user_id)
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
ALTER POLICY notice_acknowledgment_read ON institution.notice_acknowledgment
  USING (
    institution.actor_assignment_role(assignment_id) = 'teacher'
    OR (student_id = (SELECT app.current_user_id()) AND institution.actor_assignment_role(assignment_id) = 'student')
  );
ALTER POLICY assignment_read ON institution.assignment
  USING (institution.actor_course_role(course_id) IS NOT NULL);
ALTER TABLE institution.notice_acknowledgment
  DROP CONSTRAINT notice_acknowledgment_student_institution_fkey,
  ADD CONSTRAINT notice_acknowledgment_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES identity.user_account (id),
  DROP CONSTRAINT notice_acknowledgment_assignment_institution_fkey,
  DROP COLUMN institution_id;
ALTER TABLE institution.assignment
  DROP CONSTRAINT assignment_created_by_institution_fkey,
  ADD CONSTRAINT assignment_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES identity.user_account (id),
  DROP CONSTRAINT assignment_course_institution_fkey,
  ADD CONSTRAINT assignment_course_id_fkey
    FOREIGN KEY (course_id) REFERENCES institution.course (id),
  DROP CONSTRAINT assignment_id_institution_key,
  DROP COLUMN institution_id;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

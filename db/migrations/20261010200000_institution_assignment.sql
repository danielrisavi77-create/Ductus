-- migrate:up
-- Institution module for the demo, part 2 (B-7; docs/ARCHITECTURE.md 3):
-- assignment, its immutable versions and the student's acknowledgment of the
-- notice of a version. Rules as in part 1: ductus_app only reads, through
-- RLS; every change goes through a SECURITY DEFINER function that takes the
-- caller from app.current_actor(); errors carry no input (ZD401, ZD403,
-- ZD409 the version named is not the current one, ZD422).
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- From narrowest to widest (D-52).
CREATE FUNCTION institution.ai_policy_rank(p_ai_policy text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT array_position(ARRAY['prohibited', 'partially_allowed', 'encouraged'], p_ai_policy) $$;

-- The content of a version; the table and both functions decide through this
-- one rule. Instructions may have lines and tabs, no other control and no
-- bidirectional override. The purposes are the closed list of D-80.
CREATE FUNCTION institution.is_assignment_content(
  p_title text, p_instructions text, p_work_type text, p_opens_at timestamptz, p_due_at timestamptz,
  p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_import_allowed boolean
) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT coalesce(
    institution.is_plain_label(p_title)
    AND length(p_instructions) <= 20000
    AND p_instructions !~ '[\x0001-\x0008\x000B\x000C\x000E-\x001F\x007F-\x009F\x202A-\x202E\x2066-\x2069]'
    AND p_work_type IN ('short_paper', 'essay', 'seminar_paper', 'bachelor_thesis', 'master_thesis',
                        'specialist_thesis', 'doctoral_thesis')
    AND isfinite(p_opens_at) AND isfinite(p_due_at) AND p_opens_at < p_due_at
    AND institution.ai_policy_rank(p_ai_policy) IS NOT NULL
    AND p_ai_purposes <@ ARRAY['formatting', 'proofreading', 'literature_search', 'transcription', 'translation']
    AND cardinality(p_ai_purposes) <= 5 AND coalesce(array_ndims(p_ai_purposes), 1) = 1
    AND (p_ai_policy <> 'prohibited' OR cardinality(p_ai_purposes) = 0)
    AND p_evidence_profile IN ('basic', 'extended')
    AND p_import_allowed IS NOT NULL,
    false)
$$;

CREATE TABLE institution.assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES institution.course (id),
  current_version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES identity.user_account (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assignment_course_idx ON institution.assignment (course_id);

CREATE TABLE institution.assignment_version (
  assignment_id uuid NOT NULL REFERENCES institution.assignment (id),
  version_no integer NOT NULL CHECK (version_no >= 1),
  title text NOT NULL,
  instructions text NOT NULL,
  work_type text NOT NULL,
  opens_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  ai_policy text NOT NULL,
  ai_purposes text[] NOT NULL,
  evidence_profile text NOT NULL,
  import_allowed boolean NOT NULL,
  created_by uuid NOT NULL REFERENCES identity.user_account (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, version_no),
  CHECK (institution.is_assignment_content(title, instructions, work_type, opens_at, due_at, ai_policy,
                                           ai_purposes, evidence_profile, import_allowed))
);
-- Checked at commit: an assignment and its first version arrive in one
-- transaction, and the pointer never names a version that does not exist.
ALTER TABLE institution.assignment ADD CONSTRAINT assignment_current_version_fkey
  FOREIGN KEY (id, current_version) REFERENCES institution.assignment_version (assignment_id, version_no)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE institution.notice_acknowledgment (
  assignment_id uuid NOT NULL,
  version_no integer NOT NULL,
  student_id uuid NOT NULL REFERENCES identity.user_account (id),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, version_no, student_id),
  FOREIGN KEY (assignment_id, version_no) REFERENCES institution.assignment_version (assignment_id, version_no)
);
CREATE INDEX notice_acknowledgment_student_idx ON institution.notice_acknowledgment (student_id);

-- A version is a record of what students were told: once written, nobody
-- changes or removes it, the owner role and its functions included.
CREATE FUNCTION institution.refuse_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'assignment version is immutable' USING ERRCODE = 'ZD403';
END
$$;
CREATE TRIGGER assignment_version_immutable BEFORE UPDATE OR DELETE ON institution.assignment_version
  FOR EACH ROW EXECUTE FUNCTION institution.refuse_change();
CREATE TRIGGER assignment_version_no_truncate BEFORE TRUNCATE ON institution.assignment_version
  FOR EACH STATEMENT EXECUTE FUNCTION institution.refuse_change();

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assignment', 'assignment_version', 'notice_acknowledgment'] LOOP
    EXECUTE format('ALTER TABLE institution.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE institution.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON institution.%I TO ductus_identity USING (true) WITH CHECK (true)', t || '_owner', t
    );
  END LOOP;
END
$$;

-- The caller's part in the course of an assignment: 'teacher', 'student' or
-- null, also for an assignment that does not exist.
CREATE FUNCTION institution.actor_assignment_role(p_assignment_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT institution.actor_course_role(a.course_id) FROM institution.assignment a WHERE a.id = p_assignment_id
$$;

CREATE POLICY assignment_read ON institution.assignment FOR SELECT TO ductus_app
  USING (institution.actor_course_role(course_id) IS NOT NULL);
CREATE POLICY assignment_version_read ON institution.assignment_version FOR SELECT TO ductus_app
  USING (institution.actor_assignment_role(assignment_id) IS NOT NULL);
-- The teacher of the assignment reads every acknowledgment, a student of the
-- course only the own ones, the administrator none.
CREATE POLICY notice_acknowledgment_read ON institution.notice_acknowledgment FOR SELECT TO ductus_app
  USING (
    institution.actor_assignment_role(assignment_id) = 'teacher'
    OR (student_id = (SELECT app.current_user_id()) AND institution.actor_assignment_role(assignment_id) = 'student')
  );

-- A teacher of the course creates an assignment with its first version, in
-- one transaction. Its AI rule may not be wider than the course's (D-52).
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

-- A teacher of the course replaces the current version with a new one and
-- gets its number. The caller names the version the change was made from;
-- when another is current by then, nothing is written (ZD409). The new
-- version may narrow the AI rule, the purposes, the evidence profile and the
-- import, never widen them (docs/PRODUCT.md 5, rule 14).
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
    ai_purposes, evidence_profile, import_allowed, created_by
  )
  VALUES (p_assignment_id, v_current + 1, p_title, p_instructions, p_work_type, p_opens_at, p_due_at, p_ai_policy,
          p_ai_purposes, p_evidence_profile, p_import_allowed, actor.user_id);
  UPDATE institution.assignment a SET current_version = v_current + 1 WHERE a.id = p_assignment_id;
  RETURN v_current + 1;
END
$$;

-- A student of the course confirms having read the notice of the version on
-- screen and gets the time of the confirmation; repeating it changes nothing.
-- Only the current version can be confirmed. The row lock keeps it current
-- until commit, so a version published meanwhile is never confirmed unseen.
CREATE FUNCTION institution.acknowledge_notice(p_assignment_id uuid, p_version_no integer) RETURNS timestamptz
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

-- Has the caller, as a student of the course, confirmed the version that is
-- current now? False for an older version and for everyone else (for B-8).
CREATE FUNCTION institution.has_acknowledged_current(p_assignment_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.current_actor() c
    JOIN institution.notice_acknowledgment n ON n.student_id = c.user_id
    JOIN institution.assignment a ON a.id = n.assignment_id AND a.current_version = n.version_no
    WHERE a.id = p_assignment_id AND institution.actor_course_role(a.course_id) = 'student'
  )
$$;

GRANT SELECT ON institution.assignment, institution.assignment_version, institution.notice_acknowledgment
TO ductus_app;
GRANT EXECUTE ON FUNCTION
  institution.actor_assignment_role(uuid),
  institution.create_assignment(uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean),
  institution.publish_assignment_version(uuid, integer, text, text, text, timestamptz, timestamptz, text, text[], text, boolean),
  institution.acknowledge_notice(uuid, integer),
  institution.has_acknowledged_current(uuid)
TO ductus_app;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_identity;
DROP FUNCTION institution.has_acknowledged_current(uuid);
DROP FUNCTION institution.acknowledge_notice(uuid, integer);
DROP FUNCTION institution.publish_assignment_version(uuid, integer, text, text, text, timestamptz, timestamptz, text, text[], text, boolean);
DROP FUNCTION institution.create_assignment(uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean);
ALTER TABLE institution.assignment DROP CONSTRAINT assignment_current_version_fkey;
DROP TABLE institution.notice_acknowledgment, institution.assignment_version, institution.assignment;
DROP FUNCTION institution.actor_assignment_role(uuid);
DROP FUNCTION institution.refuse_change();
DROP FUNCTION institution.is_assignment_content(text, text, text, timestamptz, timestamptz, text, text[], text, boolean);
DROP FUNCTION institution.ai_policy_rank(text);
SET LOCAL ROLE ductus_migrator;

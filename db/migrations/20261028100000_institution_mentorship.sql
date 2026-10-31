-- migrate:up
-- DAN-349, part 1 of 4 (#916): the mentorship of a final or higher thesis
-- (D-33), which opens its work to the mentor and the student without any
-- course. Owner decisions of 26 Oct 2026 (DAN-349): until after the demo a
-- mentorship exists only as a row the operator's provisioning writes, so no
-- function here creates, changes or ends one; the rule of the work is the
-- faculty's rule for its work type, which the mentor may only narrow.
--
-- Contract of #916, variant A: the rules of a mentorship are an ordinary
-- assignment that belongs to the mentorship instead of a course. Its versions
-- are the notice the student acknowledges, and evidence.project, the
-- submission chain and the signed receipt keep their assignment_id as they
-- are. What decides access to such an assignment is the mentorship, never a
-- course: institution.actor_assignment_role gains a second branch and keeps
-- the course branch as it was. A mentor holds the one role of D-154 and is
-- answered 'teacher', so no CHECK of a reader or author role changes.
--
-- Errors carry no input, as in the rest of the schema: ZD403 not allowed
-- (also for what does not exist), ZD422 invalid input, ZD503 the faculty has
-- no rule for the work type.
SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- The faculty's rule for a work type (D-117, D-175). Until the administrator
-- has a screen for it only the operator writes it, and no role but the owner
-- reads it; the functions read it for the work they decide on.
CREATE TABLE institution.faculty_work_rule (
  institution_id uuid NOT NULL REFERENCES identity.institution (id),
  work_type text NOT NULL CHECK (work_type IN ('short_paper', 'essay', 'seminar_paper', 'bachelor_thesis',
                                               'master_thesis', 'specialist_thesis', 'doctoral_thesis')),
  ai_policy text NOT NULL CHECK (institution.ai_policy_rank(ai_policy) IS NOT NULL),
  ai_purposes text[] NOT NULL
    CHECK (ai_purposes <@ ARRAY['formatting', 'proofreading', 'literature_search', 'transcription', 'translation']
           AND cardinality(ai_purposes) <= 5 AND coalesce(array_ndims(ai_purposes), 1) = 1),
  evidence_profile text NOT NULL CHECK (evidence_profile IN ('basic', 'extended')),
  import_allowed boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id, work_type),
  CHECK (ai_policy <> 'prohibited' OR cardinality(ai_purposes) = 0)
);

-- A mentorship is in force while ended_at is null; ending it keeps the row.
-- confirmed_by is null when the operator wrote the row; who confirms one
-- later is decided after the demo. Every foreign key carries the institution,
-- so a mentor and a student are always of the mentorship's institution.
CREATE TABLE institution.mentorship (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  mentor_id uuid NOT NULL,
  student_id uuid NOT NULL,
  work_type text NOT NULL
    CHECK (work_type IN ('bachelor_thesis', 'master_thesis', 'specialist_thesis', 'doctoral_thesis')),
  confirmed_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  UNIQUE (id, institution_id),
  FOREIGN KEY (mentor_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (student_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (confirmed_by, institution_id) REFERENCES identity.user_account (id, institution_id),
  CHECK (mentor_id <> student_id),
  CHECK (ended_at >= started_at)
);
-- One open work of a kind per student.
CREATE UNIQUE INDEX mentorship_open_idx
  ON institution.mentorship (institution_id, student_id, work_type) WHERE ended_at IS NULL;
CREATE INDEX mentorship_mentor_open_idx ON institution.mentorship (mentor_id) WHERE ended_at IS NULL;
CREATE INDEX mentorship_student_idx ON institution.mentorship (student_id);

-- An assignment belongs to a course or to a mentorship, never both. Every
-- existing row has its course, so the check holds for all of them; dropping
-- NOT NULL and adding a nullable column rewrite no row.
ALTER TABLE institution.assignment
  ALTER COLUMN course_id DROP NOT NULL,
  ADD COLUMN mentorship_id uuid,
  ADD CONSTRAINT assignment_mentorship_institution_fkey
    FOREIGN KEY (mentorship_id, institution_id) REFERENCES institution.mentorship (id, institution_id),
  ADD CONSTRAINT assignment_course_or_mentorship_check
    CHECK (num_nonnulls(course_id, mentorship_id) = 1) NOT VALID;
ALTER TABLE institution.assignment VALIDATE CONSTRAINT assignment_course_or_mentorship_check;
-- One assignment, so one line of versions, per mentorship.
CREATE UNIQUE INDEX assignment_mentorship_idx
  ON institution.assignment (mentorship_id) WHERE mentorship_id IS NOT NULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['faculty_work_rule', 'mentorship'] LOOP
    EXECUTE format('ALTER TABLE institution.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE institution.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON institution.%I TO ductus_identity USING (true) WITH CHECK (true)', t || '_owner', t
    );
  END LOOP;
END
$$;

-- The student reads the own mentorships, ended ones included. The mentor
-- reads the open ones only, and only with the teacher role confirmed and not
-- revoked: a role alone opens nothing, and nor does a mentorship without it.
-- The administrator reads none until it is decided who assigns them.
CREATE POLICY mentorship_read ON institution.mentorship FOR SELECT TO ductus_app
  USING (
    institution_id = (SELECT app.current_institution_id())
    AND (student_id = (SELECT app.current_user_id())
         OR (mentor_id = (SELECT app.current_user_id()) AND ended_at IS NULL
             AND (SELECT institution.actor_has_role('teacher'))))
  );

-- The caller's part in a mentorship: 'teacher' for its mentor with the
-- teacher role confirmed and not revoked, 'student' for its student, null
-- for everyone else, for an ended mentorship and for one that does not exist.
CREATE FUNCTION institution.actor_mentorship_role(p_mentorship_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE
           WHEN m.mentor_id = a.user_id AND institution.actor_has_role('teacher') THEN 'teacher'
           WHEN m.student_id = a.user_id THEN 'student'
         END
  FROM app.current_actor() a
  JOIN institution.mentorship m ON m.institution_id = a.institution_id
  WHERE m.id = p_mentorship_id AND m.ended_at IS NULL
$$;

-- The caller's part in an assignment: through its course as before, or
-- through its mentorship. Every policy and function that decides through this
-- one gains the mentorship with it.
CREATE OR REPLACE FUNCTION institution.actor_assignment_role(p_assignment_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE
           WHEN a.course_id IS NOT NULL THEN institution.actor_course_role(a.course_id)
           ELSE institution.actor_mentorship_role(a.mentorship_id)
         END
  FROM institution.assignment a
  WHERE a.id = p_assignment_id
$$;

-- As 20261011100000, deciding through the assignment rather than its course,
-- which a mentorship's assignment does not have.
ALTER POLICY assignment_read ON institution.assignment
  USING (institution_id = (SELECT app.current_institution_id())
         AND institution.actor_assignment_role(id) IS NOT NULL);

-- As 20261010200000, deciding through the assignment rather than its course.
CREATE OR REPLACE FUNCTION institution.has_acknowledged_current(p_assignment_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.current_actor() c
    JOIN institution.notice_acknowledgment n ON n.student_id = c.user_id
    JOIN institution.assignment a ON a.id = n.assignment_id AND a.current_version = n.version_no
    WHERE a.id = p_assignment_id AND institution.actor_assignment_role(a.id) = 'student'
  )
$$;

-- As 20261022090000, and a mentorship's assignment gets no new version here:
-- the mentor's narrowing has no screen yet (#916). The answer is the one for
-- an assignment the caller has no part in.
CREATE OR REPLACE FUNCTION institution.publish_assignment_version(
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
  IF institution.actor_assignment_role(p_assignment_id) IS DISTINCT FROM 'teacher'
     OR EXISTS (SELECT 1 FROM institution.assignment a WHERE a.id = p_assignment_id AND a.mentorship_id IS NOT NULL) THEN
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
     OR (p_import_allowed AND NOT cur.import_allowed)
     -- Rule 14: a bound may be dropped or relaxed, never added or tightened.
     OR (p_word_min IS NOT NULL AND (cur.word_min IS NULL OR p_word_min > cur.word_min))
     OR (p_word_max IS NOT NULL AND (cur.word_max IS NULL OR p_word_max < cur.word_max)) THEN
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

-- A version of a mentorship's assignment is the rule of that work: of the
-- mentorship's work type and never wider than the faculty's rule for it, so
-- the mentor may only narrow it. Without that rule nothing is written. It
-- runs as the owner, so what the inserting role may read does not decide it;
-- a course's assignment passes untouched.
CREATE FUNCTION institution.check_mentorship_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_work record;
  v_rule record;
BEGIN
  SELECT m.institution_id, m.work_type INTO v_work
    FROM institution.assignment a
    JOIN institution.mentorship m ON m.id = a.mentorship_id AND m.institution_id = a.institution_id
   WHERE a.id = NEW.assignment_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  SELECT r.ai_policy, r.ai_purposes, r.evidence_profile, r.import_allowed INTO v_rule
    FROM institution.faculty_work_rule r
   WHERE r.institution_id = v_work.institution_id AND r.work_type = v_work.work_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not set up' USING ERRCODE = 'ZD503';
  END IF;
  IF NOT coalesce(
       NEW.work_type = v_work.work_type
       AND institution.ai_policy_rank(NEW.ai_policy) <= institution.ai_policy_rank(v_rule.ai_policy)
       AND NEW.ai_purposes <@ v_rule.ai_purposes
       AND (NEW.evidence_profile = 'basic' OR v_rule.evidence_profile = 'extended')
       AND (NOT NEW.import_allowed OR v_rule.import_allowed),
       false) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER assignment_version_mentorship_rule BEFORE INSERT ON institution.assignment_version
  FOR EACH ROW EXECUTE FUNCTION institution.check_mentorship_version();

REVOKE ALL ON FUNCTION institution.actor_mentorship_role(uuid), institution.check_mentorship_version() FROM PUBLIC;
GRANT SELECT ON institution.mentorship TO ductus_app;
GRANT EXECUTE ON FUNCTION institution.actor_mentorship_role(uuid) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
-- Fails while a mentorship's assignment exists, as course_id must be set again.
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP TRIGGER assignment_version_mentorship_rule ON institution.assignment_version;
DROP FUNCTION institution.check_mentorship_version();

CREATE OR REPLACE FUNCTION institution.publish_assignment_version(
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
     OR (p_import_allowed AND NOT cur.import_allowed)
     -- Rule 14: a bound may be dropped or relaxed, never added or tightened.
     OR (p_word_min IS NOT NULL AND (cur.word_min IS NULL OR p_word_min > cur.word_min))
     OR (p_word_max IS NOT NULL AND (cur.word_max IS NULL OR p_word_max < cur.word_max)) THEN
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

CREATE OR REPLACE FUNCTION institution.has_acknowledged_current(p_assignment_id uuid) RETURNS boolean
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

ALTER POLICY assignment_read ON institution.assignment
  USING (institution_id = (SELECT app.current_institution_id())
         AND institution.actor_course_role(course_id) IS NOT NULL);

CREATE OR REPLACE FUNCTION institution.actor_assignment_role(p_assignment_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT institution.actor_course_role(a.course_id) FROM institution.assignment a WHERE a.id = p_assignment_id
$$;

DROP FUNCTION institution.actor_mentorship_role(uuid);

DROP INDEX institution.assignment_mentorship_idx;
ALTER TABLE institution.assignment
  DROP CONSTRAINT assignment_course_or_mentorship_check,
  DROP CONSTRAINT assignment_mentorship_institution_fkey,
  DROP COLUMN mentorship_id,
  ALTER COLUMN course_id SET NOT NULL;

DROP TABLE institution.mentorship, institution.faculty_work_rule;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

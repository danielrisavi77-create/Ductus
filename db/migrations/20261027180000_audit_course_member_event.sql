-- DAN-338 (F-141 t. 2; owner decision of 26 Oct 2026 on #87, comment
-- 6410226064, t. 2; contract on #747, comment 6410308090): removing a student
-- and letting a removed student back each leave one append-only audit row with
-- the teacher from the session, the membership row it changed, the course,
-- the student and the database time, written in the same statement as the
-- change. The membership keeps removed_by as before. Input, access rule,
-- locking and return of both functions are unchanged.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA audit TO ductus_identity;
GRANT CREATE ON SCHEMA institution TO ductus_identity;

SET LOCAL ROLE ductus_identity;

-- One row per membership and kind: a membership ends by removal at most once
-- and its return is allowed at most once. A later membership of the same
-- student is a new row of institution.course_member, so it gets its own rows.
CREATE TABLE audit.course_member_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  course_id uuid NOT NULL,
  membership_id uuid NOT NULL REFERENCES institution.course_member (id),
  student_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('removed', 'return_allowed')),
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (membership_id, kind),
  FOREIGN KEY (course_id, institution_id) REFERENCES institution.course (id, institution_id),
  FOREIGN KEY (student_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (actor_id, institution_id) REFERENCES identity.user_account (id, institution_id)
);
CREATE INDEX course_member_event_course_idx ON audit.course_member_event (course_id, occurred_at);

CREATE TRIGGER course_member_event_append_only BEFORE UPDATE OR DELETE ON audit.course_member_event
  FOR EACH ROW EXECUTE FUNCTION audit.reject_change();
CREATE TRIGGER course_member_event_no_truncate BEFORE TRUNCATE ON audit.course_member_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_change();

-- As access_log and enrollment_code_event: forced RLS with only the owner's
-- policy and no privilege for any other role. Rows are written only from
-- inside the two functions below, which the owner role owns.
ALTER TABLE audit.course_member_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.course_member_event FORCE ROW LEVEL SECURITY;
CREATE POLICY course_member_event_owner ON audit.course_member_event TO ductus_identity USING (true) WITH CHECK (true);

-- As 20261010190000, and the membership it ends is written as 'removed'.
CREATE OR REPLACE FUNCTION institution.remove_student(p_course_id uuid, p_student_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_written integer;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('institution.enroll_with_code:' || p_student_id, 0));
  WITH ended AS (
    UPDATE institution.course_member m
       SET member_to = greatest(now(), m.member_from), removed_by = actor.user_id
     WHERE m.course_id = p_course_id AND m.user_id = p_student_id AND m.role = 'student' AND m.member_to IS NULL
    RETURNING m.id, m.course_id, m.user_id
  )
  INSERT INTO audit.course_member_event (institution_id, course_id, membership_id, student_id, kind, actor_id, occurred_at)
  SELECT actor.institution_id, ended.course_id, ended.id, ended.user_id, 'removed', actor.user_id, now() FROM ended;
  GET DIAGNOSTICS v_written = ROW_COUNT;
  RETURN v_written > 0;
END
$$;

-- As 20261010190000, and the membership whose return it allows is written as
-- 'return_allowed'.
CREATE OR REPLACE FUNCTION institution.allow_student_return(p_course_id uuid, p_student_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_written integer;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  WITH allowed AS (
    UPDATE institution.course_member m SET return_allowed_at = now()
     WHERE m.course_id = p_course_id AND m.user_id = p_student_id
       AND m.removed_by IS NOT NULL AND m.return_allowed_at IS NULL
    RETURNING m.id, m.course_id, m.user_id
  )
  INSERT INTO audit.course_member_event (institution_id, course_id, membership_id, student_id, kind, actor_id, occurred_at)
  SELECT actor.institution_id, allowed.course_id, allowed.id, allowed.user_id, 'return_allowed', actor.user_id, now() FROM allowed;
  GET DIAGNOSTICS v_written = ROW_COUNT;
  RETURN v_written > 0;
END
$$;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA audit FROM ductus_identity;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;
CREATE OR REPLACE FUNCTION institution.remove_student(p_course_id uuid, p_student_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('institution.enroll_with_code:' || p_student_id, 0));
  UPDATE institution.course_member m
     SET member_to = greatest(now(), m.member_from), removed_by = actor.user_id
   WHERE m.course_id = p_course_id AND m.user_id = p_student_id AND m.role = 'student' AND m.member_to IS NULL;
  RETURN FOUND;
END
$$;
CREATE OR REPLACE FUNCTION institution.allow_student_return(p_course_id uuid, p_student_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  UPDATE institution.course_member m SET return_allowed_at = now()
   WHERE m.course_id = p_course_id AND m.user_id = p_student_id
     AND m.removed_by IS NOT NULL AND m.return_allowed_at IS NULL;
  RETURN FOUND;
END
$$;
DROP TABLE audit.course_member_event;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

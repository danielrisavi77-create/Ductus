-- DAN-351, M2.7-P04a (contract on #1836, c.6789848494; D-265 Q19): the holder
-- of a course is handed over only by an administrator of the course's
-- institution. The handover ends the previous holder, opens the new one,
-- leaves one append-only trail row and tells the course's open students that
-- the holder changed, without a name or any content, all in one transaction.
-- A course teacher may still name the first holder; changing an existing one
-- is refused. Nothing here opens a work: the new holder must already be an
-- open, confirmed teacher of the course (P04b handles a holder from outside).
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA audit TO ductus_identity;
GRANT CREATE ON SCHEMA institution TO ductus_identity;

SET LOCAL ROLE ductus_identity;

-- One row per handover. from_holder_id is NULL when the course had no holder.
CREATE TABLE audit.course_handover (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  course_id uuid NOT NULL,
  from_holder_id uuid,
  to_holder_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  CHECK (from_holder_id IS DISTINCT FROM to_holder_id),
  CHECK (actor_id <> to_holder_id),
  FOREIGN KEY (course_id, institution_id) REFERENCES institution.course (id, institution_id),
  FOREIGN KEY (from_holder_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (to_holder_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (actor_id, institution_id) REFERENCES identity.user_account (id, institution_id)
);
CREATE INDEX course_handover_course_idx ON audit.course_handover (course_id, occurred_at);

CREATE TRIGGER course_handover_append_only BEFORE UPDATE OR DELETE ON audit.course_handover
  FOR EACH ROW EXECUTE FUNCTION audit.reject_change();
CREATE TRIGGER course_handover_no_truncate BEFORE TRUNCATE ON audit.course_handover
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_change();

-- As teacher_role_event: forced RLS with only the owner's policy and no
-- privilege for any other role. Rows are written only by hand_over_course.
ALTER TABLE audit.course_handover ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.course_handover FORCE ROW LEVEL SECURITY;
CREATE POLICY course_handover_owner ON audit.course_handover TO ductus_identity USING (true) WITH CHECK (true);

-- The closed list of kinds grows by course_handover, keyed by the handover.
-- Every existing row still holds; each CHECK is replaced by a wider one (the
-- drop is deliberate) and validated in this migration's one transaction.
-- squawk-ignore ban-drop-constraint
ALTER TABLE institution.notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE institution.notification ADD CONSTRAINT notification_kind_check
  CHECK (kind IN ('comment_posted', 'assignment_version', 'submission_recorded', 'course_handover')) NOT VALID;
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE institution.notification VALIDATE CONSTRAINT notification_kind_check;
-- squawk-ignore ban-drop-constraint
ALTER TABLE institution.notification DROP CONSTRAINT notification_check;
ALTER TABLE institution.notification ADD CONSTRAINT notification_check CHECK (
  event_key ~ '^(comment_posted|assignment_version|submission_recorded|course_handover):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:[1-9][0-9]{0,9})?$'
  AND event_key LIKE kind || ':%'
  AND (kind = 'assignment_version') = (event_key ~ ':[1-9][0-9]{0,9}$')
) NOT VALID;
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE institution.notification VALIDATE CONSTRAINT notification_check;

-- Hands the course over to p_holder_id. Only an administrator of the course's
-- institution, never to themselves (as confirm_teacher_role). The new holder
-- is an open, confirmed teacher of the course. Returns the trail row, or NULL
-- when p_holder_id already holds the course (then nothing is written).
CREATE FUNCTION institution.hand_over_course(p_course_id uuid, p_holder_id uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_from uuid;
  v_ended timestamptz;
  v_handover uuid;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  -- The administrator role row FOR SHARE until the end, taken before the
  -- course: a revocation waits for this transaction, and one that committed
  -- first, even while this call waited for the row, leaves no row to find.
  PERFORM 1 FROM institution.institution_role r
   WHERE r.institution_id = actor.institution_id AND r.user_id = actor.user_id AND r.role = 'admin'
     AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
   FOR SHARE OF r;
  IF NOT FOUND OR p_holder_id IS NOT DISTINCT FROM actor.user_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- Two handovers, or a handover and a first naming, of the same course wait
  -- for each other here; course_holder_open_idx is the last barrier.
  PERFORM 1 FROM institution.course c
   WHERE c.id = p_course_id AND c.institution_id = actor.institution_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF NOT institution.is_confirmed_teacher(p_holder_id, p_course_id) OR NOT EXISTS (
       SELECT 1 FROM institution.course_member m
       WHERE m.course_id = p_course_id AND m.user_id = p_holder_id AND m.role = 'teacher' AND m.member_to IS NULL
     ) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  SELECT h.user_id INTO v_from FROM institution.course_holder h
   WHERE h.course_id = p_course_id AND h.valid_to IS NULL;
  IF v_from = p_holder_id THEN
    RETURN NULL;
  END IF;
  UPDATE institution.course_holder h SET valid_to = greatest(now(), h.valid_from)
   WHERE h.course_id = p_course_id AND h.valid_to IS NULL
  RETURNING h.valid_to INTO v_ended;
  INSERT INTO institution.course_holder (course_id, institution_id, user_id, assigned_by, valid_from)
  VALUES (p_course_id, actor.institution_id, p_holder_id, actor.user_id, greatest(now(), v_ended));
  INSERT INTO audit.course_handover (institution_id, course_id, from_holder_id, to_holder_id, actor_id, occurred_at)
  VALUES (actor.institution_id, p_course_id, v_from, p_holder_id, actor.user_id, now())
  RETURNING id INTO v_handover;
  INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
  SELECT m.institution_id, m.user_id, 'course_handover', 'course_handover:' || v_handover::text, p_course_id
  FROM institution.course_member m
  WHERE m.course_id = p_course_id AND m.role = 'student' AND m.member_to IS NULL
  ON CONFLICT (recipient_id, event_key) DO NOTHING;
  RETURN v_handover;
END
$$;

-- A course teacher names the first holder only. The same holder again changes
-- nothing; another holder while one is open is a handover and is refused.
CREATE OR REPLACE FUNCTION institution.set_course_holder(p_course_id uuid, p_holder_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_open uuid;
BEGIN
  SELECT * INTO actor FROM institution.require_course_teacher(p_course_id);
  IF NOT institution.is_confirmed_teacher(p_holder_id, p_course_id) OR NOT EXISTS (
       SELECT 1 FROM institution.course_member m
       WHERE m.course_id = p_course_id AND m.user_id = p_holder_id AND m.role = 'teacher' AND m.member_to IS NULL
     ) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  -- Waits for a handover of the same course, then sees its holder.
  PERFORM 1 FROM institution.course c WHERE c.id = p_course_id FOR NO KEY UPDATE;
  SELECT h.user_id INTO v_open FROM institution.course_holder h
   WHERE h.course_id = p_course_id AND h.valid_to IS NULL;
  IF v_open = p_holder_id THEN
    RETURN;
  END IF;
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  INSERT INTO institution.course_holder (course_id, institution_id, user_id, assigned_by, valid_from)
  SELECT p_course_id, actor.institution_id, p_holder_id, actor.user_id, greatest(now(), max(h.valid_to))
  FROM institution.course_holder h WHERE h.course_id = p_course_id;
END
$$;

REVOKE ALL ON FUNCTION institution.hand_over_course(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.hand_over_course(uuid, uuid) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA audit FROM ductus_identity;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only; staging and production only go forward (docs/BACKEND.md §6).
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA audit TO ductus_identity;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;
CREATE OR REPLACE FUNCTION institution.set_course_holder(p_course_id uuid, p_holder_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_ended timestamptz;
BEGIN
  SELECT * INTO actor FROM institution.require_course_teacher(p_course_id);
  IF NOT institution.is_confirmed_teacher(p_holder_id, p_course_id) OR NOT EXISTS (
       SELECT 1 FROM institution.course_member m
       WHERE m.course_id = p_course_id AND m.user_id = p_holder_id AND m.role = 'teacher' AND m.member_to IS NULL
     ) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  -- Two replacements of the same course wait for each other here.
  PERFORM 1 FROM institution.course c WHERE c.id = p_course_id FOR NO KEY UPDATE;
  IF EXISTS (SELECT 1 FROM institution.course_holder h
             WHERE h.course_id = p_course_id AND h.user_id = p_holder_id AND h.valid_to IS NULL) THEN
    RETURN;
  END IF;
  UPDATE institution.course_holder h SET valid_to = greatest(now(), h.valid_from)
   WHERE h.course_id = p_course_id AND h.valid_to IS NULL
  RETURNING h.valid_to INTO v_ended;
  INSERT INTO institution.course_holder (course_id, institution_id, user_id, assigned_by, valid_from)
  VALUES (p_course_id, actor.institution_id, p_holder_id, actor.user_id, greatest(now(), v_ended));
END
$$;
DROP FUNCTION institution.hand_over_course(uuid, uuid);
DELETE FROM institution.notification WHERE kind = 'course_handover';
ALTER TABLE institution.notification DROP CONSTRAINT notification_check;
ALTER TABLE institution.notification ADD CONSTRAINT notification_check CHECK (
  event_key ~ '^(comment_posted|assignment_version|submission_recorded):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:[1-9][0-9]{0,9})?$'
  AND event_key LIKE kind || ':%'
  AND (kind = 'assignment_version') = (event_key ~ ':[1-9][0-9]{0,9}$')
);
ALTER TABLE institution.notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE institution.notification ADD CONSTRAINT notification_kind_check
  CHECK (kind IN ('comment_posted', 'assignment_version', 'submission_recorded'));
DROP TABLE audit.course_handover;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA audit FROM ductus_identity;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

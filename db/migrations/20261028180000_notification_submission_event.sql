-- D1 / DAN-305: one metadata-only event per recipient of a recorded course
-- submission. A request or receipt alone does not create an event.
-- migrate:up
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app TO ductus_identity, ductus_evidence;
GRANT CREATE ON SCHEMA evidence TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;
-- The identity role gets only this scope of one existing submission, never a
-- grant on the evidence schema or a work's content, hashes or exact times.
CREATE FUNCTION app.submission_notification_scope(p_submission_id uuid)
RETURNS TABLE (institution_id uuid, assignment_id uuid, principal_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.institution_id, s.assignment_id, s.principal_id
  FROM evidence.submission s WHERE s.id = p_submission_id
$$;
REVOKE ALL ON FUNCTION app.submission_notification_scope(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.submission_notification_scope(uuid) TO ductus_identity;

SET LOCAL ROLE ductus_identity;
-- Callable only by the evidence role, and useful only inside a trigger. The
-- id is checked again against the real submission before recipients are read.
CREATE FUNCTION app.notify_submission(p_submission_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF pg_catalog.pg_trigger_depth() = 0 THEN
    RETURN;
  END IF;
  INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
  SELECT s.institution_id, m.user_id, 'submission_recorded',
         'submission_recorded:' || p_submission_id::text, p_submission_id
  FROM app.submission_notification_scope(p_submission_id) s
  JOIN institution.assignment a ON a.id = s.assignment_id AND a.institution_id = s.institution_id
  JOIN institution.course_member m ON m.course_id = a.course_id AND m.institution_id = s.institution_id
    AND m.member_to IS NULL
  WHERE a.course_id IS NOT NULL AND (
    (m.role = 'student' AND m.user_id = s.principal_id)
    OR (m.role = 'teacher' AND EXISTS (
      SELECT 1 FROM institution.institution_role r
      WHERE r.institution_id = s.institution_id AND r.user_id = m.user_id AND r.role = 'teacher'
        AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
    ))
  )
  ON CONFLICT (recipient_id, event_key) DO NOTHING;
END
$$;
REVOKE ALL ON FUNCTION app.notify_submission(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.notify_submission(uuid) TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;
CREATE FUNCTION evidence.notify_submission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM app.notify_submission(NEW.id);
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION evidence.notify_submission() FROM PUBLIC;
CREATE TRIGGER evidence_submission_notify AFTER INSERT ON evidence.submission
  FOR EACH ROW EXECUTE FUNCTION evidence.notify_submission();

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity, ductus_evidence;
REVOKE CREATE ON SCHEMA evidence FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_evidence;
DROP TRIGGER evidence_submission_notify ON evidence.submission;
DROP FUNCTION evidence.notify_submission();
SET LOCAL ROLE ductus_identity;
DROP FUNCTION app.notify_submission(uuid);
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.submission_notification_scope(uuid);
SET LOCAL ROLE ductus_migrator;

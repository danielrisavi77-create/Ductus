-- D1 / DAN-305: metadata-only reads for one comment or recorded-submission
-- notification. They do not list, mark, acknowledge or open the target.
-- migrate:up
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE FUNCTION institution.read_comment_notification(p_notification_id uuid)
RETURNS TABLE (notification_id uuid, kind text, target_id uuid, created_window timestamptz, is_read boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  RETURN QUERY
  SELECT n.id, n.kind, n.target_id,
         pg_catalog.date_bin(interval '5 minutes', n.created_at, timestamptz '1970-01-01 00:00:00+00'),
         n.read_at IS NOT NULL
  FROM institution.notification n
  JOIN collaboration.comment_thread t ON t.id = n.target_id AND t.institution_id = n.institution_id
  JOIN collaboration.comment c ON c.thread_id = t.id AND c.institution_id = t.institution_id
    AND n.event_key = 'comment_posted:' || c.id::text
  JOIN LATERAL collaboration.document_scope(t.document_id) s
    ON s.institution_id = t.institution_id AND s.assignment_id = t.assignment_id AND s.principal_id = t.owner_id
  WHERE n.id = p_notification_id AND n.kind = 'comment_posted'
    AND n.recipient_id = actor.user_id AND n.institution_id = actor.institution_id
    AND collaboration.actor_role(t.institution_id, t.assignment_id, t.owner_id) IS NOT NULL;
END
$$;

CREATE FUNCTION institution.read_submission_notification(p_notification_id uuid)
RETURNS TABLE (notification_id uuid, kind text, target_id uuid, created_window timestamptz, is_read boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  RETURN QUERY
  SELECT n.id, n.kind, n.target_id,
         pg_catalog.date_bin(interval '5 minutes', n.created_at, timestamptz '1970-01-01 00:00:00+00'),
         n.read_at IS NOT NULL
  FROM institution.notification n
  JOIN LATERAL app.submission_notification_scope(n.target_id) s ON s.institution_id = n.institution_id
  JOIN institution.assignment a ON a.id = s.assignment_id AND a.institution_id = s.institution_id
  WHERE n.id = p_notification_id AND n.kind = 'submission_recorded'
    AND n.recipient_id = actor.user_id AND n.institution_id = actor.institution_id
    AND n.event_key = 'submission_recorded:' || n.target_id::text AND a.course_id IS NOT NULL
    AND (
      (s.principal_id = actor.user_id AND institution.actor_assignment_role(a.id) = 'student')
      OR (institution.actor_assignment_role(a.id) = 'teacher' AND EXISTS (
        SELECT 1 FROM institution.course_member m
        WHERE m.course_id = a.course_id AND m.institution_id = s.institution_id
          AND m.user_id = s.principal_id AND m.role = 'student' AND m.member_to IS NULL
      ))
    );
END
$$;

REVOKE ALL ON FUNCTION institution.read_comment_notification(uuid), institution.read_submission_notification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.read_comment_notification(uuid), institution.read_submission_notification(uuid) TO ductus_app;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_identity;
DROP FUNCTION institution.read_submission_notification(uuid);
DROP FUNCTION institution.read_comment_notification(uuid);
SET LOCAL ROLE ductus_migrator;

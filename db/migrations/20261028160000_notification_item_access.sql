-- D1 / DAN-305: one assignment-version notification at a time. The inbox,
-- other event kinds and bulk actions require their own later contract.
-- migrate:up
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- Only the recipient of a real version of an accessible course assignment
-- sees a row. Event keys, exact times and the identities of others stay here.
CREATE FUNCTION institution.read_notification(p_notification_id uuid)
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
  JOIN institution.assignment a ON a.id = n.target_id AND a.institution_id = n.institution_id
  JOIN institution.assignment_version v ON v.assignment_id = a.id
    AND n.event_key = 'assignment_version:' || a.id::text || ':' || v.version_no::text
  WHERE n.id = p_notification_id AND n.recipient_id = actor.user_id AND n.institution_id = actor.institution_id
    AND n.kind = 'assignment_version' AND v.version_no > 1 AND a.course_id IS NOT NULL
    AND institution.actor_assignment_role(a.id) = 'student';
END
$$;

-- Lock assignment and active membership in the same order as the existing
-- evidence path. A concurrent removal waits for this transaction or is seen
-- before the update. Repeat calls retain the original read_at. No notice
-- acknowledgment is written.
CREATE FUNCTION institution.mark_notification_read(p_notification_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_assignment uuid;
  v_event_key text;
  v_updated uuid;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT a.id, n.event_key INTO v_assignment, v_event_key
  FROM institution.notification n
  JOIN institution.assignment a ON a.id = n.target_id AND a.institution_id = n.institution_id
  JOIN institution.assignment_version v ON v.assignment_id = a.id
    AND n.event_key = 'assignment_version:' || a.id::text || ':' || v.version_no::text
  WHERE n.id = p_notification_id AND n.recipient_id = actor.user_id AND n.institution_id = actor.institution_id
    AND n.kind = 'assignment_version' AND v.version_no > 1 AND a.course_id IS NOT NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM 1 FROM app.lock_student_assignment(v_assignment);
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE institution.notification n SET read_at = pg_catalog.clock_timestamp()
  WHERE n.id = p_notification_id AND n.recipient_id = actor.user_id AND n.institution_id = actor.institution_id
    AND n.kind = 'assignment_version' AND n.target_id = v_assignment
    AND n.event_key = v_event_key AND n.read_at IS NULL
  RETURNING n.id INTO v_updated;
  IF v_updated IS NOT NULL THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM institution.notification n
    WHERE n.id = p_notification_id AND n.recipient_id = actor.user_id AND n.institution_id = actor.institution_id
      AND n.kind = 'assignment_version' AND n.target_id = v_assignment
      AND n.event_key = v_event_key AND n.read_at IS NOT NULL
  );
END
$$;
REVOKE ALL ON FUNCTION institution.read_notification(uuid), institution.mark_notification_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.read_notification(uuid), institution.mark_notification_read(uuid) TO ductus_app;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_identity;
DROP FUNCTION institution.mark_notification_read(uuid);
DROP FUNCTION institution.read_notification(uuid);
SET LOCAL ROLE ductus_migrator;

-- D1 / DAN-305: internal storage and the course assignment-version event.
-- No application-facing inbox exists in this step.
-- migrate:up
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE TABLE institution.notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('comment_posted', 'assignment_version', 'submission_recorded')),
  -- Internal event identifiers only: a UUID, with a version for assignments.
  -- No body, label, URL or arbitrary free text is stored in this table.
  event_key text NOT NULL CHECK (
    event_key ~ '^(comment_posted|assignment_version|submission_recorded):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:[1-9][0-9]{0,9})?$'
    AND event_key LIKE kind || ':%'
    AND (kind = 'assignment_version') = (event_key ~ ':[1-9][0-9]{0,9}$')
  ),
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (recipient_id, event_key),
  FOREIGN KEY (recipient_id, institution_id) REFERENCES identity.user_account (id, institution_id)
);
CREATE INDEX notification_recipient_order_idx ON institution.notification (recipient_id, created_at DESC, id DESC);

ALTER TABLE institution.notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution.notification FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_owner ON institution.notification TO ductus_identity USING (true) WITH CHECK (true);

-- A new course-assignment version and its notifications commit or roll back
-- together. Recipients are current student members; the browser supplies none.
-- Version 1 is initial creation, and mentorship version publishing is not yet
-- supported by the existing domain RPC.
CREATE FUNCTION institution.notify_assignment_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
  SELECT a.institution_id, m.user_id, 'assignment_version',
         'assignment_version:' || a.id::text || ':' || NEW.version_no::text, a.id
  FROM institution.assignment a
  JOIN institution.course_member m ON m.course_id = a.course_id AND m.institution_id = a.institution_id
  WHERE a.id = NEW.assignment_id AND a.course_id IS NOT NULL
    AND m.role = 'student' AND m.member_to IS NULL
  ON CONFLICT (recipient_id, event_key) DO NOTHING;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION institution.notify_assignment_version() FROM PUBLIC;
CREATE TRIGGER assignment_version_notify AFTER INSERT ON institution.assignment_version
  FOR EACH ROW WHEN (NEW.version_no > 1) EXECUTE FUNCTION institution.notify_assignment_version();

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_identity;
DROP TRIGGER assignment_version_notify ON institution.assignment_version;
DROP FUNCTION institution.notify_assignment_version();
DROP TABLE institution.notification;
SET LOCAL ROLE ductus_migrator;

-- D1 / DAN-305: internal storage only. No producer or application-facing
-- function exists in this step. The event owner must validate the recipient,
-- target and transaction before later code writes here.
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

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_identity;
DROP TABLE institution.notification;
SET LOCAL ROLE ductus_migrator;

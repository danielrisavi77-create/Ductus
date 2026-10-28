-- D1 / DAN-305: a real comment and its metadata-only notifications share a
-- transaction. This does not expose comment notifications to the app yet.
-- migrate:up
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE FUNCTION collaboration.notify_comment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.author_role = 'teacher' THEN
    -- A teacher's comment is for the document owner only if that student
    -- currently has a part in the assignment (course or mentorship).
    INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
    SELECT t.institution_id, t.owner_id, 'comment_posted', 'comment_posted:' || NEW.id::text, t.id
    FROM collaboration.comment_thread t
    JOIN institution.assignment a ON a.id = t.assignment_id AND a.institution_id = t.institution_id
    WHERE t.id = NEW.thread_id AND t.institution_id = NEW.institution_id AND t.owner_id <> NEW.author_id
      AND (
        EXISTS (SELECT 1 FROM institution.course_member m
                WHERE m.course_id = a.course_id AND m.institution_id = t.institution_id
                  AND m.user_id = t.owner_id AND m.role = 'student' AND m.member_to IS NULL)
        OR EXISTS (SELECT 1 FROM institution.mentorship m
                   WHERE m.id = a.mentorship_id AND m.institution_id = t.institution_id
                     AND m.student_id = t.owner_id AND m.ended_at IS NULL)
      )
    ON CONFLICT (recipient_id, event_key) DO NOTHING;
  ELSIF NEW.author_role = 'student' THEN
    -- Notify only teachers who participated in this thread, still have an
    -- active teacher role, and still have their part in its assignment.
    INSERT INTO institution.notification (institution_id, recipient_id, kind, event_key, target_id)
    SELECT DISTINCT t.institution_id, c.author_id, 'comment_posted', 'comment_posted:' || NEW.id::text, t.id
    FROM collaboration.comment_thread t
    JOIN institution.assignment a ON a.id = t.assignment_id AND a.institution_id = t.institution_id
    JOIN collaboration.comment c ON c.thread_id = t.id AND c.institution_id = t.institution_id
      AND c.author_role = 'teacher' AND c.author_id <> NEW.author_id
    JOIN institution.institution_role r ON r.institution_id = t.institution_id AND r.user_id = c.author_id
      AND r.role = 'teacher' AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
    WHERE t.id = NEW.thread_id AND t.institution_id = NEW.institution_id AND t.owner_id = NEW.author_id
      AND (
        EXISTS (SELECT 1 FROM institution.course_member m
                WHERE m.course_id = a.course_id AND m.institution_id = t.institution_id
                  AND m.user_id = c.author_id AND m.role = 'teacher' AND m.member_to IS NULL)
        OR EXISTS (SELECT 1 FROM institution.mentorship m
                   WHERE m.id = a.mentorship_id AND m.institution_id = t.institution_id
                     AND m.mentor_id = c.author_id AND m.ended_at IS NULL)
      )
    ON CONFLICT (recipient_id, event_key) DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION collaboration.notify_comment() FROM PUBLIC;
CREATE TRIGGER comment_notify AFTER INSERT ON collaboration.comment
  FOR EACH ROW EXECUTE FUNCTION collaboration.notify_comment();

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_identity;
DROP TRIGGER comment_notify ON collaboration.comment;
DROP FUNCTION collaboration.notify_comment();
SET LOCAL ROLE ductus_migrator;

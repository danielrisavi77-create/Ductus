-- DAN-215 (M6.1-P03, D-201 t. 3(c)): the student who owns the work opens a
-- thread and deletes only their own comments; the deletion stays in the
-- thread's history (docs/backend/suradnja.md 4.11, attack plan #1886).
--
-- A deleted comment keeps its row, position, author role and anchor; only its
-- text goes (body NULL) and deleted_at records when. list_comments returns it
-- at its place to student and teacher alike, with the time of deletion only to
-- the 5-minute window. No new table: the comment table keeps its forced RLS
-- and the web role still reaches it only through these functions.
-- migrate:up
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
SET LOCAL ROLE ductus_identity;

ALTER TABLE collaboration.comment
  DROP CONSTRAINT comment_body_check,
  ALTER COLUMN body DROP NOT NULL,
  ADD COLUMN deleted_at timestamptz,
  ADD CONSTRAINT comment_body_check CHECK (
    CASE WHEN deleted_at IS NULL THEN collaboration.is_comment_body(body)
         ELSE body IS NULL AND deleted_at >= created_at END
  );

-- The teacher or the student who owns the work opens a thread; anyone else
-- reads as a missing document. The thread waits on the other side: a
-- teacher's opens as open (the student's turn), a student's as answered.
CREATE OR REPLACE FUNCTION collaboration.create_comment(p_document_id text, p_body text, p_anchor jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  scope record;
  v_role text;
  v_thread uuid;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT * INTO scope FROM collaboration.document_scope(p_document_id);
  v_role := collaboration.actor_role(scope.institution_id, scope.assignment_id, scope.principal_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- Checked before the table constraints, whose errors would quote the row.
  IF NOT coalesce(collaboration.is_comment_body(p_body), false)
     OR NOT coalesce(collaboration.is_text_anchor(p_anchor), false) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  INSERT INTO collaboration.comment_thread (institution_id, document_id, assignment_id, owner_id, anchor, state, created_by)
  VALUES (scope.institution_id, p_document_id, scope.assignment_id, scope.principal_id, p_anchor,
          CASE WHEN v_role = 'student' THEN 'answered' ELSE 'open' END, actor.user_id)
  RETURNING id INTO v_thread;
  INSERT INTO collaboration.comment (thread_id, institution_id, position, author_id, author_role, body)
  VALUES (v_thread, scope.institution_id, 1, actor.user_id, v_role, p_body);
  RETURN v_thread;
END
$$;

-- The student who owns the work deletes one of their own comments, in any
-- state of the thread, which it does not change. A teacher's or mentor's
-- comment, another person's, one in another institution and one that does
-- not exist all read as forbidden; a second deletion is a conflict. The
-- thread row is locked first, as for a reply, so a deletion and a reply or
-- two deletions of one comment run one after the other.
CREATE FUNCTION collaboration.delete_comment(p_comment_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_thread uuid;
  t record;
  c record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT x.thread_id INTO v_thread FROM collaboration.comment x
  WHERE x.id = p_comment_id AND x.institution_id = actor.institution_id;
  IF v_thread IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  SELECT * INTO t FROM collaboration.thread_for_actor(v_thread, true);
  SELECT x.author_id, x.author_role, x.deleted_at INTO c FROM collaboration.comment x
  WHERE x.id = p_comment_id FOR UPDATE;
  IF t.role IS DISTINCT FROM 'student' OR c.author_role IS DISTINCT FROM 'student'
     OR c.author_id IS DISTINCT FROM actor.user_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF c.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  UPDATE collaboration.comment x SET body = NULL, deleted_at = now() WHERE x.id = p_comment_id;
END
$$;

-- As before, plus deleted_window: a deleted comment comes back with a null
-- body and the 5-minute window of its deletion, the same row for everyone.
DROP FUNCTION collaboration.list_comments(text);
CREATE FUNCTION collaboration.list_comments(p_document_id text)
RETURNS TABLE (
  thread_id uuid, comment_id uuid, comment_position integer, author_role text, is_own boolean,
  body text, anchor jsonb, state text, created_window timestamptz, deleted_window timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  scope record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT * INTO scope FROM collaboration.document_scope(p_document_id);
  IF collaboration.actor_role(scope.institution_id, scope.assignment_id, scope.principal_id) IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  RETURN QUERY
    SELECT t.id, c.id, c.position, c.author_role, c.author_id = actor.user_id, c.body,
           CASE WHEN c.position = 1 THEN t.anchor END, t.state,
           date_bin('5 minutes', c.created_at, timestamptz '2000-01-01 00:00:00+00'),
           date_bin('5 minutes', c.deleted_at, timestamptz '2000-01-01 00:00:00+00')
    FROM collaboration.comment_thread t
    JOIN collaboration.comment c ON c.thread_id = t.id AND c.institution_id = t.institution_id
    WHERE t.document_id = p_document_id AND t.institution_id = scope.institution_id
    ORDER BY t.created_at, t.id, c.position;
END
$$;

GRANT EXECUTE ON FUNCTION
  collaboration.delete_comment(uuid),
  collaboration.list_comments(text)
TO ductus_app;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;

-- migrate:down
-- A deleted comment's text is gone and cannot come back, and the earlier
-- table does not allow a comment without text, so this refuses to run while
-- any comment is deleted. Threads a student opened stay; the earlier
-- functions read them as any other thread.
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM collaboration.comment WHERE deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'deleted comments exist; this migration cannot be rolled back';
  END IF;
END
$$;

DROP FUNCTION collaboration.delete_comment(uuid);

DROP FUNCTION collaboration.list_comments(text);
CREATE FUNCTION collaboration.list_comments(p_document_id text)
RETURNS TABLE (
  thread_id uuid, comment_id uuid, comment_position integer, author_role text, is_own boolean,
  body text, anchor jsonb, state text, created_window timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  scope record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT * INTO scope FROM collaboration.document_scope(p_document_id);
  IF collaboration.actor_role(scope.institution_id, scope.assignment_id, scope.principal_id) IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  RETURN QUERY
    SELECT t.id, c.id, c.position, c.author_role, c.author_id = actor.user_id, c.body,
           CASE WHEN c.position = 1 THEN t.anchor END, t.state,
           date_bin('5 minutes', c.created_at, timestamptz '2000-01-01 00:00:00+00')
    FROM collaboration.comment_thread t
    JOIN collaboration.comment c ON c.thread_id = t.id AND c.institution_id = t.institution_id
    WHERE t.document_id = p_document_id AND t.institution_id = scope.institution_id
    ORDER BY t.created_at, t.id, c.position;
END
$$;
GRANT EXECUTE ON FUNCTION collaboration.list_comments(text) TO ductus_app;

CREATE OR REPLACE FUNCTION collaboration.create_comment(p_document_id text, p_body text, p_anchor jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  scope record;
  v_thread uuid;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT * INTO scope FROM collaboration.document_scope(p_document_id);
  IF collaboration.actor_role(scope.institution_id, scope.assignment_id, scope.principal_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  -- Checked before the table constraints, whose errors would quote the row.
  IF NOT coalesce(collaboration.is_comment_body(p_body), false)
     OR NOT coalesce(collaboration.is_text_anchor(p_anchor), false) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  INSERT INTO collaboration.comment_thread (institution_id, document_id, assignment_id, owner_id, anchor, created_by)
  VALUES (scope.institution_id, p_document_id, scope.assignment_id, scope.principal_id, p_anchor, actor.user_id)
  RETURNING id INTO v_thread;
  INSERT INTO collaboration.comment (thread_id, institution_id, position, author_id, author_role, body)
  VALUES (v_thread, scope.institution_id, 1, actor.user_id, 'teacher', p_body);
  RETURN v_thread;
END
$$;

ALTER TABLE collaboration.comment
  DROP CONSTRAINT comment_body_check,
  DROP COLUMN deleted_at,
  ALTER COLUMN body SET NOT NULL,
  ADD CONSTRAINT comment_body_check CHECK (collaboration.is_comment_body(body));

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;

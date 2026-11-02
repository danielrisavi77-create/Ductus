-- migrate:up
-- DAN-302 L4: a thread holds at most 10000 comments (CHECK on
-- collaboration.comment.position). A reply past the last position used to
-- reach that CHECK, whose 23514 the route turns into 503; it is now the
-- documented ZD409, as for any thread that does not allow the step. The
-- thread row is locked by thread_for_actor, so two replies cannot race for
-- the last position. Nothing else in the function changes.
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE OR REPLACE FUNCTION collaboration.reply_comment(p_thread_id uuid, p_body text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  t record;
  v_last integer;
  v_comment uuid;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT * INTO t FROM collaboration.thread_for_actor(p_thread_id, true);
  IF NOT coalesce(collaboration.is_comment_body(p_body), false) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF t.state = 'resolved' THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  SELECT max(c.position) INTO v_last FROM collaboration.comment c WHERE c.thread_id = t.thread_id;
  IF v_last >= 10000 THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  INSERT INTO collaboration.comment (thread_id, institution_id, position, author_id, author_role, body)
  VALUES (t.thread_id, actor.institution_id, v_last + 1, actor.user_id, t.role, p_body)
  RETURNING id INTO v_comment;
  UPDATE collaboration.comment_thread c
  SET state = CASE WHEN t.role = 'student' THEN 'answered' ELSE 'open' END, updated_at = now()
  WHERE c.id = t.thread_id AND (t.role, c.state) IN (('student', 'open'), ('teacher', 'answered'));
  RETURN v_comment;
END
$$;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE OR REPLACE FUNCTION collaboration.reply_comment(p_thread_id uuid, p_body text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  t record;
  v_comment uuid;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT * INTO t FROM collaboration.thread_for_actor(p_thread_id, true);
  IF NOT coalesce(collaboration.is_comment_body(p_body), false) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  IF t.state = 'resolved' THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  INSERT INTO collaboration.comment (thread_id, institution_id, position, author_id, author_role, body)
  SELECT t.thread_id, actor.institution_id, max(c.position) + 1, actor.user_id, t.role, p_body
  FROM collaboration.comment c WHERE c.thread_id = t.thread_id
  RETURNING id INTO v_comment;
  UPDATE collaboration.comment_thread c
  SET state = CASE WHEN t.role = 'student' THEN 'answered' ELSE 'open' END, updated_at = now()
  WHERE c.id = t.thread_id AND (t.role, c.state) IN (('student', 'open'), ('teacher', 'answered'));
  RETURN v_comment;
END
$$;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;

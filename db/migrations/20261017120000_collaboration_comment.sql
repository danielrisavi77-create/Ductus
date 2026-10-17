-- B-10 / DAN-86: comments on a paragraph (docs/BACKEND.md 4.11, issue #177).
-- A comment is its own record with an anchor the client shows as a
-- decoration. It never writes the document, a revision, a segment or a
-- receipt; the document keeps its single writer (D-34). Errors: ZD401 no
-- session, ZD403 not allowed or not there (same answer), ZD409 the thread is
-- not in a state that allows the step, ZD422 invalid input.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
CREATE SCHEMA collaboration;
GRANT USAGE ON SCHEMA collaboration TO ductus_app, ductus_identity;
GRANT CREATE ON SCHEMA collaboration TO ductus_identity;
-- Only while this migration creates document_scope; revoked at the end.
GRANT USAGE, CREATE ON SCHEMA collaboration TO ductus_evidence;

-- The one way from a comment to the evidence schema: which institution,
-- assignment and student a document belongs to. Owned by the evidence role,
-- executable only by the identity role, so neither the web role nor the
-- identity role gets any right on evidence tables.
SET LOCAL ROLE ductus_evidence;
CREATE FUNCTION collaboration.document_scope(
  p_document_id text, OUT institution_id uuid, OUT assignment_id uuid, OUT principal_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT d.institution_id, p.assignment_id, d.principal_id
  FROM evidence.document d
  JOIN evidence.project p ON p.id = d.project_id AND p.institution_id = d.institution_id
  WHERE d.id = p_document_id
$$;
GRANT EXECUTE ON FUNCTION collaboration.document_scope(text) TO ductus_identity;

SET LOCAL ROLE ductus_identity;

-- Comment text: NFC, 1 to 2000 characters, not only blanks, no control
-- characters but newline and tab, no bidirectional overrides or isolates.
CREATE FUNCTION collaboration.is_comment_body(p_body text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT p_body IS NOT NULL AND p_body IS NFC NORMALIZED
    AND char_length(p_body) BETWEEN 1 AND 2000
    AND p_body ~ '[^[:space:]]'
    AND translate(p_body, E'\n\t', '') !~ '[[:cntrl:]]'
    AND p_body !~ E'[\u202A-\u202E\u2066-\u2069]'
$$;

-- A TextAnchor (src/domain/collaboration/anchor.ts) with exactly its six
-- fields; nodeId as isNodeId in src/domain/document/schema.ts. The server stores it and never resolves it against the content.
CREATE FUNCTION collaboration.is_text_anchor(p_anchor jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  v_text text;
  v_limit integer;
BEGIN
  IF jsonb_typeof(p_anchor) IS DISTINCT FROM 'object'
     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_anchor) k)
        IS DISTINCT FROM ARRAY['endHint', 'nodeId', 'prefix', 'quote', 'startHint', 'suffix'] THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_anchor->'nodeId') <> 'string'
     OR p_anchor->>'nodeId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  FOREACH v_text IN ARRAY ARRAY['quote', 'prefix', 'suffix'] LOOP
    v_limit := CASE v_text WHEN 'quote' THEN 500 ELSE 64 END;
    IF jsonb_typeof(p_anchor->v_text) <> 'string'
       OR char_length(p_anchor->>v_text) > v_limit
       OR translate(p_anchor->>v_text, E'\n\t', '') ~ '[[:cntrl:]]'
       OR (p_anchor->>v_text) ~ E'[\u202A-\u202E\u2066-\u2069]' THEN
      RETURN false;
    END IF;
  END LOOP;
  IF char_length(p_anchor->>'quote') = 0
     OR jsonb_typeof(p_anchor->'startHint') <> 'number' OR jsonb_typeof(p_anchor->'endHint') <> 'number' THEN
    RETURN false;
  END IF;
  RETURN (p_anchor->>'startHint')::numeric = trunc((p_anchor->>'startHint')::numeric)
    AND (p_anchor->>'endHint')::numeric = trunc((p_anchor->>'endHint')::numeric)
    AND (p_anchor->>'startHint')::numeric >= 0
    AND (p_anchor->>'startHint')::numeric < (p_anchor->>'endHint')::numeric
    AND (p_anchor->>'endHint')::numeric <= 1000000;
END
$$;

-- No foreign key to evidence.document: deleting a document under its
-- retention rule must not depend on comments. The document is checked when
-- the thread is created; assignment and owner are copied from it then.
CREATE TABLE collaboration.comment_thread (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  document_id text NOT NULL CHECK (length(document_id) BETWEEN 1 AND 256),
  assignment_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  anchor jsonb NOT NULL CHECK (collaboration.is_text_anchor(anchor)),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'answered', 'resolved')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, institution_id),
  FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment (id, institution_id),
  FOREIGN KEY (owner_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (created_by, institution_id) REFERENCES identity.user_account (id, institution_id)
);

-- The text of a comment never changes; position 1 is the teacher's opening one.
CREATE TABLE collaboration.comment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 10000),
  author_id uuid NOT NULL,
  author_role text NOT NULL CHECK (author_role IN ('teacher', 'student')),
  body text NOT NULL CHECK (collaboration.is_comment_body(body)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, position),
  FOREIGN KEY (thread_id, institution_id) REFERENCES collaboration.comment_thread (id, institution_id),
  FOREIGN KEY (author_id, institution_id) REFERENCES identity.user_account (id, institution_id)
);
CREATE INDEX comment_thread_document_idx ON collaboration.comment_thread (document_id, institution_id);

-- Forced RLS with only the owner's policy: the web role has no privilege on
-- either table and reads through list_comments alone, which never returns
-- exact times or other people's ids.
ALTER TABLE collaboration.comment_thread ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration.comment_thread FORCE ROW LEVEL SECURITY;
ALTER TABLE collaboration.comment ENABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration.comment FORCE ROW LEVEL SECURITY;
CREATE POLICY comment_thread_owner ON collaboration.comment_thread TO ductus_identity USING (true) WITH CHECK (true);
CREATE POLICY comment_owner ON collaboration.comment TO ductus_identity USING (true) WITH CHECK (true);

-- The caller's part on a student's document, or null: the teacher of the
-- assignment's course, or the student who owns it. Decided on every call, so
-- a removed teacher loses reading and writing at once (4.4).
CREATE FUNCTION collaboration.actor_role(p_institution_id uuid, p_assignment_id uuid, p_owner_id uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_institution_id IS DISTINCT FROM a.institution_id THEN NULL
    WHEN institution.actor_assignment_role(p_assignment_id) = 'teacher' THEN 'teacher'
    WHEN institution.actor_assignment_role(p_assignment_id) = 'student' AND p_owner_id = a.user_id THEN 'student'
  END
  FROM app.current_actor() a
$$;

-- The thread and the caller's part in it; a thread the caller may not see
-- reads as missing. With p_lock the thread row is locked for the step.
CREATE FUNCTION collaboration.thread_for_actor(p_thread_id uuid, p_lock boolean, OUT thread_id uuid, OUT state text, OUT role text)
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  actor record;
  t record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  SELECT * INTO t FROM collaboration.comment_thread c WHERE c.id = p_thread_id AND c.institution_id = actor.institution_id;
  role := collaboration.actor_role(t.institution_id, t.assignment_id, t.owner_id);
  IF t.id IS NULL OR role IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF p_lock THEN
    SELECT c.state INTO t.state FROM collaboration.comment_thread c WHERE c.id = t.id FOR UPDATE;
  END IF;
  thread_id := t.id;
  state := t.state;
END
$$;

-- A teacher opens a thread on a paragraph of a student's document.
CREATE FUNCTION collaboration.create_comment(p_document_id text, p_body text, p_anchor jsonb) RETURNS uuid
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

-- A reply. The student's reply makes an open thread answered, the
-- teacher's makes an answered thread open; a resolved thread takes none.
CREATE FUNCTION collaboration.reply_comment(p_thread_id uuid, p_body text) RETURNS uuid
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

-- Only the teacher resolves (from open or answered) and reopens (from resolved).
CREATE FUNCTION collaboration.set_thread_state(p_thread_id uuid, p_to text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  t record;
BEGIN
  SELECT * INTO t FROM collaboration.thread_for_actor(p_thread_id, true);
  IF t.role <> 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF (p_to = 'resolved' AND t.state = 'resolved') OR (p_to = 'open' AND t.state <> 'resolved') THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  UPDATE collaboration.comment_thread c SET state = p_to, updated_at = now() WHERE c.id = t.thread_id;
END
$$;

CREATE FUNCTION collaboration.resolve_thread(p_thread_id uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$ SELECT collaboration.set_thread_state(p_thread_id, 'resolved') $$;

CREATE FUNCTION collaboration.reopen_thread(p_thread_id uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$ SELECT collaboration.set_thread_state(p_thread_id, 'open') $$;

-- One reading for student and teacher alike (PRODUCT 5, t. 5). Time only to
-- the P-03 window of 5 minutes, no person ids, no document content: the
-- anchor comes back as the teacher stored it and the client resolves it.
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

GRANT EXECUTE ON FUNCTION
  collaboration.create_comment(text, text, jsonb),
  collaboration.reply_comment(uuid, text),
  collaboration.resolve_thread(uuid),
  collaboration.reopen_thread(uuid),
  collaboration.list_comments(text)
TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA collaboration FROM ductus_identity;
REVOKE USAGE, CREATE ON SCHEMA collaboration FROM ductus_evidence;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
DROP SCHEMA collaboration CASCADE;

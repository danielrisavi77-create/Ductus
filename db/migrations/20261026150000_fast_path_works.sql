-- B-11b (#757, DAN-308): the teacher's fast path reads every work of an
-- assignment in one call. Per enrolled student it returns the name pair
-- (B-11a), the work's document, whether it is submitted, the revision and
-- segment listing the process summary is derived from, and the text
-- checkpoint at that revision. Only the teacher of the assignment gets rows;
-- every other caller, and an assignment that does not exist, gets the same
-- empty set. No session is ZD401.
--
-- P-03 is held here, not in the web process (#757 D3): the first read of a
-- teacher opens a window that fixes, per work, the revision and the
-- submission flag; reads within P-03 of its opening return the state at
-- those revisions, and a work created within it stays without a record until
-- the next window. The list of students is not state of a work and is always
-- current. The window holds no text, name or summary.
--
-- Every text returned writes the teacher's opening of that work to
-- audit.access_log under the surface fast_path, in the same transaction, one
-- row per reader, work and surface per 5-minute interval (20261021130000).
-- A work whose package, head or checkpoint is not what the read expects is
-- ZD503 for the whole call, so there is no partial list and no read without
-- its row. Nothing in evidence is written except the window.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT USAGE, CREATE ON SCHEMA evidence TO ductus_identity;
GRANT CREATE ON SCHEMA evidence TO ductus_evidence;
GRANT CREATE ON SCHEMA app TO ductus_identity, ductus_evidence;
GRANT ductus_evidence TO ductus_identity WITH INHERIT FALSE, SET TRUE;

SET LOCAL ROLE ductus_identity;

-- A new surface widens the closed list (20261021120000).
ALTER TABLE audit.access_log DROP CONSTRAINT access_log_surface_check;
ALTER TABLE audit.access_log ADD CONSTRAINT access_log_surface_check
  CHECK (surface IN ('live_view', 'process_summary', 'fast_path'));

-- The students of teacher_assignment_students with their name pair, null
-- when the account has none (#757 D1). Executable by the evidence role alone,
-- so a name leaves the identity schema only through the fast path.
CREATE FUNCTION app.teacher_assignment_student_names(p_assignment_id uuid)
RETURNS TABLE (student_id uuid, given_name text, family_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.student_id, n.given_name, n.family_name
    FROM app.teacher_assignment_students(p_assignment_id) s
    LEFT JOIN identity.person_name n ON n.user_id = s.student_id
$$;
REVOKE ALL ON FUNCTION app.teacher_assignment_student_names(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.teacher_assignment_student_names(uuid) TO ductus_evidence;

-- Writes the caller's fast path opening of a work. The caller must be the
-- teacher of the work's assignment, decided here again, so the evidence role
-- cannot write an opening for anyone else.
CREATE FUNCTION app.record_fast_path_opening(p_document_id text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_scope record;
BEGIN
  SELECT * INTO v_scope FROM collaboration.document_scope(p_document_id);
  IF v_scope.institution_id IS NULL
     OR collaboration.actor_role(v_scope.institution_id, v_scope.assignment_id, v_scope.principal_id)
        IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  PERFORM audit.record_work_opening(v_scope.institution_id, p_document_id, v_scope.assignment_id,
                                    v_scope.principal_id, 'fast_path');
END
$$;
REVOKE ALL ON FUNCTION app.record_fast_path_opening(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_fast_path_opening(text) TO ductus_evidence;

-- One window per teacher and assignment. works maps a document id to the
-- revision and submission flag the window fixed for it.
CREATE TABLE evidence.fast_path_window (
  reader_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  opened_at timestamptz NOT NULL,
  works jsonb NOT NULL CHECK (jsonb_typeof(works) = 'object'),
  PRIMARY KEY (reader_id, assignment_id),
  FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment (id, institution_id),
  FOREIGN KEY (reader_id, institution_id) REFERENCES identity.user_account (id, institution_id)
);
-- Created by the identity role, which may reference the identity and
-- institution tables, and handed to the evidence role (as 20261018140000).
ALTER TABLE evidence.fast_path_window OWNER TO ductus_evidence;

SET LOCAL ROLE ductus_evidence;
-- Forced RLS with only the owner's policy and no grant: only fast_path_works
-- reads and writes it.
ALTER TABLE evidence.fast_path_window ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence.fast_path_window FORCE ROW LEVEL SECURITY;
CREATE POLICY fast_path_window_owner ON evidence.fast_path_window TO ductus_evidence USING (true) WITH CHECK (true);

CREATE FUNCTION app.fast_path_works(p_assignment_id uuid)
RETURNS TABLE (
  student_id uuid, given_name text, family_name text, document_id text, submitted boolean, revision bigint,
  evidence_package_id text, head_segment_hash text, segment_hashes text[], body text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  -- P-03 (docs/DECISIONS.md); a constant, so changing the threshold is cheap.
  c_window CONSTANT interval := interval '5 minutes';
  v_actor record;
  v_window evidence.fast_path_window%ROWTYPE;
  v_works jsonb := '{}'::jsonb;
  v_student record;
  v_doc record;
  v_record record;
  v_count integer;
  v_head record;
  v_entry jsonb;
  v_revision bigint;
  v_document_id text;
  v_package_id text;
  v_head_hash text;
  v_hashes text[];
BEGIN
  SELECT * INTO v_actor FROM app.current_actor();
  IF v_actor.user_id IS NULL OR v_actor.institution_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'ZD401';
  END IF;
  -- Not the teacher of the assignment, or no students: no rows and no window.
  IF NOT EXISTS (SELECT 1 FROM app.teacher_assignment_students(p_assignment_id)) THEN
    RETURN;
  END IF;

  SELECT w.* INTO v_window FROM evidence.fast_path_window w
   WHERE w.reader_id = v_actor.user_id AND w.assignment_id = p_assignment_id
     AND w.institution_id = v_actor.institution_id
     FOR UPDATE;
  IF NOT FOUND OR v_window.opened_at + c_window <= pg_catalog.now() THEN
    -- A new window: per work, the revision the summary is derived from now.
    FOR v_doc IN
      SELECT d.id, d.institution_id, d.principal_id
        FROM app.teacher_assignment_students(p_assignment_id) s
        JOIN evidence.project p
          ON p.assignment_id = p_assignment_id AND p.institution_id = v_actor.institution_id
         AND p.principal_id = s.student_id
        JOIN evidence.document d
          ON d.project_id = p.id AND d.institution_id = p.institution_id AND d.principal_id = p.principal_id
    LOOP
      v_count := 0;
      FOR v_record IN
        SELECT r.head_segment_hash, r.segment_hashes FROM app.process_summary_record(v_doc.id) r
      LOOP
        v_count := v_count + 1;
        v_head_hash := v_record.head_segment_hash;
        v_hashes := v_record.segment_hashes;
      END LOOP;
      IF v_count <> 1 OR v_head_hash IS DISTINCT FROM v_hashes[pg_catalog.cardinality(v_hashes)] THEN
        RAISE EXCEPTION 'work unavailable' USING ERRCODE = 'ZD503';
      END IF;
      IF v_head_hash IS NULL THEN
        v_entry := pg_catalog.jsonb_build_object('revision', 0);
      ELSE
        SELECT pg_catalog.count(*)::integer, pg_catalog.min((rc.receipt_payload::jsonb ->> 'revision')::bigint)
          INTO v_count, v_revision
          FROM evidence.package k
          JOIN evidence.segment sg ON sg.evidence_package_id = k.id AND sg.institution_id = k.institution_id
          JOIN evidence.receipt rc
            ON rc.segment_id = sg.id AND rc.evidence_package_id = sg.evidence_package_id
           AND rc.institution_id = sg.institution_id
         WHERE k.document_id = v_doc.id AND k.institution_id = v_doc.institution_id
           AND sg.segment_hash = v_head_hash
           AND pg_catalog.jsonb_typeof(rc.receipt_payload::jsonb -> 'revision') = 'number';
        IF v_count <> 1 THEN
          RAISE EXCEPTION 'work unavailable' USING ERRCODE = 'ZD503';
        END IF;
        v_entry := pg_catalog.jsonb_build_object('revision', v_revision);
      END IF;
      v_works := v_works || pg_catalog.jsonb_build_object(v_doc.id, v_entry || pg_catalog.jsonb_build_object(
        'submitted', EXISTS (
          SELECT 1 FROM evidence.submission b
           WHERE b.assignment_id = p_assignment_id AND b.institution_id = v_doc.institution_id
             AND b.principal_id = v_doc.principal_id)));
    END LOOP;
    -- A concurrent first read of the same teacher may have opened it already.
    INSERT INTO evidence.fast_path_window AS w (reader_id, institution_id, assignment_id, opened_at, works)
    VALUES (v_actor.user_id, v_actor.institution_id, p_assignment_id, pg_catalog.now(), v_works)
    ON CONFLICT (reader_id, assignment_id) DO UPDATE
      SET opened_at = EXCLUDED.opened_at, works = EXCLUDED.works
      WHERE w.opened_at + c_window <= EXCLUDED.opened_at;
    SELECT w.* INTO STRICT v_window FROM evidence.fast_path_window w
     WHERE w.reader_id = v_actor.user_id AND w.assignment_id = p_assignment_id;
  END IF;

  FOR v_student IN
    SELECT n.student_id, n.given_name, n.family_name
      FROM app.teacher_assignment_student_names(p_assignment_id) n
     ORDER BY n.student_id
  LOOP
    student_id := v_student.student_id;
    given_name := v_student.given_name;
    family_name := v_student.family_name;
    document_id := NULL; submitted := NULL; revision := NULL;
    evidence_package_id := NULL; head_segment_hash := NULL; segment_hashes := NULL; body := NULL;

    SELECT pg_catalog.count(*)::integer, pg_catalog.min(d.id) INTO v_count, v_document_id
      FROM evidence.project p
      JOIN evidence.document d
        ON d.project_id = p.id AND d.institution_id = p.institution_id AND d.principal_id = p.principal_id
     WHERE p.assignment_id = p_assignment_id AND p.institution_id = v_actor.institution_id
       AND p.principal_id = v_student.student_id;
    IF v_count > 1 THEN
      RAISE EXCEPTION 'work unavailable' USING ERRCODE = 'ZD503';
    END IF;
    v_entry := v_window.works -> v_document_id;
    IF v_entry IS NULL THEN
      -- No work, or one created within the window: no record yet.
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_revision := (v_entry ->> 'revision')::bigint;
    SELECT pg_catalog.count(*)::integer, pg_catalog.min(k.id) INTO v_count, v_package_id
      FROM evidence.package k
     WHERE k.document_id = v_document_id AND k.institution_id = v_actor.institution_id;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'work unavailable' USING ERRCODE = 'ZD503';
    END IF;
    document_id := v_document_id;
    submitted := (v_entry ->> 'submitted')::boolean;
    revision := v_revision;
    evidence_package_id := v_package_id;
    IF v_revision = 0 THEN
      segment_hashes := ARRAY[]::text[];
    ELSE
      -- The segment whose receipt names the window's revision, and the
      -- listing up to it, as read_submission_record cuts at a revision.
      SELECT pg_catalog.count(*)::integer AS n, pg_catalog.min(sg.segment_hash) AS hash,
             pg_catalog.min(sg.sequence_from) AS sequence_from
        INTO v_head
        FROM evidence.segment sg
        JOIN evidence.receipt rc
          ON rc.segment_id = sg.id AND rc.evidence_package_id = sg.evidence_package_id
         AND rc.institution_id = sg.institution_id
       WHERE sg.evidence_package_id = v_package_id AND sg.institution_id = v_actor.institution_id
         AND pg_catalog.jsonb_typeof(rc.receipt_payload::jsonb -> 'revision') = 'number'
         AND (rc.receipt_payload::jsonb ->> 'revision')::numeric = v_revision;
      IF v_head.n <> 1 THEN
        RAISE EXCEPTION 'work unavailable' USING ERRCODE = 'ZD503';
      END IF;
      head_segment_hash := v_head.hash;
      SELECT pg_catalog.array_agg(sg.segment_hash ORDER BY sg.sequence_from) INTO segment_hashes
        FROM evidence.segment sg
       WHERE sg.evidence_package_id = v_package_id AND sg.institution_id = v_actor.institution_id
         AND sg.sequence_from <= v_head.sequence_from;
    END IF;
    SELECT c.body INTO body FROM evidence.document_checkpoint c
     WHERE c.document_id = v_document_id AND c.institution_id = v_actor.institution_id
       AND c.revision = v_revision;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'work unavailable' USING ERRCODE = 'ZD503';
    END IF;
    PERFORM app.record_fast_path_opening(v_document_id);
    RETURN NEXT;
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION app.fast_path_works(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fast_path_works(uuid) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity, ductus_evidence;
REVOKE CREATE ON SCHEMA evidence FROM ductus_identity, ductus_evidence;
REVOKE USAGE ON SCHEMA evidence FROM ductus_identity;
REVOKE ductus_evidence FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app TO ductus_identity, ductus_evidence;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.fast_path_works(uuid);
DROP TABLE evidence.fast_path_window;
SET LOCAL ROLE ductus_identity;
DROP FUNCTION app.record_fast_path_opening(text);
DROP FUNCTION app.teacher_assignment_student_names(uuid);
-- Fails while a fast_path row exists, which the append-only log keeps.
ALTER TABLE audit.access_log DROP CONSTRAINT access_log_surface_check;
ALTER TABLE audit.access_log ADD CONSTRAINT access_log_surface_check
  CHECK (surface IN ('live_view', 'process_summary'));
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA app FROM ductus_identity, ductus_evidence;

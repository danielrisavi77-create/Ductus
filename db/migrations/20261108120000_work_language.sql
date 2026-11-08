-- migrate:up
-- DAN-386, M2.10-P01 (contract on #1091, c.6720558678; orchestrator decision
-- c.6720126406): the language of the work, kept apart from the language of
-- the interface (F-06, D-67). D-70 is not read, written or mixed in here.
--
-- The set is closed: 'hr' and 'en'. Widening it takes a new migration.
--
-- The assignment carries the default language of its works on every version.
-- A new version without a language inherits the one of the version before,
-- so create_assignment and publish_assignment_version stay as they are and
-- never reset it. A version that changes the language is refused (ZD409)
-- once any student of the assignment has requested a submission.
--
-- One work may differ from its assignment: an override for one student,
-- written only by a teacher of the work through set_work_language(), and
-- refused (ZD409) once that student has requested a submission. Both writers
-- lock the assignment FOR UPDATE; request_submission holds it FOR SHARE, so
-- the first of the two decides and the other sees it
-- (tests/integration/work-language-submission-race.integration.test.ts).
-- A co-mentor or committee member (work_grant) changes nothing here.
SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA app TO ductus_evidence;
GRANT CREATE ON SCHEMA institution TO ductus_identity;

SET LOCAL ROLE ductus_evidence;
-- Yes or no: has a submission been requested on this assignment in the
-- caller's institution, by this student or, with NULL, by anyone. Nothing
-- else. The institution comes from the session, never from a parameter (U1).
CREATE FUNCTION app.work_submission_requested(p_assignment_id uuid, p_principal_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM app.current_actor() a
      JOIN evidence.submission_request r ON r.institution_id = a.institution_id
     WHERE r.assignment_id = p_assignment_id
       AND (p_principal_id IS NULL OR r.principal_id = p_principal_id)
  )
$$;
REVOKE ALL ON FUNCTION app.work_submission_requested(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.work_submission_requested(uuid, uuid) TO ductus_identity;

RESET ROLE;
SET LOCAL ROLE ductus_identity;

CREATE FUNCTION institution.is_work_language(p_language text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT coalesce(p_language IN ('hr', 'en'), false)
$$;

-- Every existing version is Croatian; afterwards the trigger below fills it.
-- No column default: it would hide an omitted language from the trigger.
-- Versions are immutable; the trigger that says so is off for this one update.
ALTER TABLE institution.assignment_version ADD COLUMN work_language text;
ALTER TABLE institution.assignment_version DISABLE TRIGGER assignment_version_immutable;
UPDATE institution.assignment_version SET work_language = 'hr';
ALTER TABLE institution.assignment_version ENABLE TRIGGER assignment_version_immutable;
-- squawk-ignore adding-not-nullable-field
ALTER TABLE institution.assignment_version ALTER COLUMN work_language SET NOT NULL;
ALTER TABLE institution.assignment_version
  -- squawk-ignore constraint-missing-not-valid
  ADD CONSTRAINT assignment_version_work_language_check CHECK (institution.is_work_language(work_language));

-- After the institution fill and the mentorship rule, which fire before it by name.
CREATE FUNCTION institution.assignment_version_work_language() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_previous text;
BEGIN
  SELECT v.work_language INTO v_previous FROM institution.assignment_version v
   WHERE v.assignment_id = NEW.assignment_id AND v.version_no = NEW.version_no - 1;
  IF NEW.work_language IS NULL THEN
    NEW.work_language := coalesce(v_previous, 'hr');
  ELSIF v_previous IS NOT NULL AND NEW.work_language IS DISTINCT FROM v_previous
        AND app.work_submission_requested(NEW.assignment_id, NULL) THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER assignment_version_work_language BEFORE INSERT ON institution.assignment_version
  FOR EACH ROW EXECUTE FUNCTION institution.assignment_version_work_language();

-- A new version with the content of the current one and another language.
-- The same language is no change and writes nothing. Who may: as
-- publish_assignment_version, whose rules a mentorship's assignment does not
-- take yet (#916).
CREATE FUNCTION institution.set_assignment_work_language(
  p_assignment_id uuid, p_expected_version integer, p_work_language text
) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_current integer;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_assignment_role(p_assignment_id) IS DISTINCT FROM 'teacher'
     OR EXISTS (SELECT 1 FROM institution.assignment a WHERE a.id = p_assignment_id AND a.mentorship_id IS NOT NULL) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF NOT institution.is_work_language(p_work_language) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  -- A submission request waits here, or this call waits for it, then sees it.
  SELECT a.current_version INTO v_current FROM institution.assignment a WHERE a.id = p_assignment_id FOR UPDATE;
  IF v_current IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  IF EXISTS (SELECT 1 FROM institution.assignment_version v
              WHERE v.assignment_id = p_assignment_id AND v.version_no = v_current
                AND v.work_language = p_work_language) THEN
    RETURN v_current;
  END IF;
  IF app.work_submission_requested(p_assignment_id, NULL) THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  INSERT INTO institution.assignment_version (
    assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
    ai_purposes, evidence_profile, import_allowed, word_min, word_max, work_language, created_by
  )
  SELECT v.assignment_id, v_current + 1, v.title, v.instructions, v.work_type, v.opens_at, v.due_at, v.ai_policy,
         v.ai_purposes, v.evidence_profile, v.import_allowed, v.word_min, v.word_max, p_work_language, actor.user_id
    FROM institution.assignment_version v
   WHERE v.assignment_id = p_assignment_id AND v.version_no = v_current;
  UPDATE institution.assignment a SET current_version = v_current + 1 WHERE a.id = p_assignment_id;
  RETURN v_current + 1;
END
$$;

CREATE TABLE institution.work_language_override (
  institution_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  student_id uuid NOT NULL,
  work_language text NOT NULL CHECK (institution.is_work_language(work_language)),
  set_by uuid NOT NULL,
  set_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (assignment_id, student_id),
  FOREIGN KEY (assignment_id, institution_id) REFERENCES institution.assignment (id, institution_id),
  FOREIGN KEY (student_id, institution_id) REFERENCES identity.user_account (id, institution_id),
  FOREIGN KEY (set_by, institution_id) REFERENCES identity.user_account (id, institution_id)
);

ALTER TABLE institution.work_language_override ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution.work_language_override FORCE ROW LEVEL SECURITY;
CREATE POLICY work_language_override_owner ON institution.work_language_override TO ductus_identity
  USING (true) WITH CHECK (true);
-- The student of the work and a teacher of the work see the override.
CREATE POLICY work_language_override_read ON institution.work_language_override FOR SELECT TO ductus_app
  USING (
    institution_id = (SELECT app.current_institution_id())
    AND (student_id = (SELECT app.current_user_id())
         OR institution.actor_assignment_role(assignment_id) = 'teacher')
  );

-- The language of one work, as the student sees it: the override, else the
-- language of the current version. Null for anyone but that student and a
-- teacher of the work.
CREATE FUNCTION institution.work_language(p_assignment_id uuid, p_student_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_institution uuid;
  v_role text;
BEGIN
  SELECT a.user_id, a.institution_id INTO v_user, v_institution FROM app.current_actor() a;
  v_role := institution.actor_assignment_role(p_assignment_id);
  IF v_user IS NULL OR p_student_id IS NULL
     OR NOT coalesce((v_role = 'student' AND p_student_id = v_user)
                     OR (v_role = 'teacher'
                         AND institution.work_relation(p_student_id, p_assignment_id) = 'student'), false) THEN
    RETURN NULL;
  END IF;
  RETURN (
    SELECT coalesce(o.work_language, v.work_language)
      FROM institution.assignment a
      JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = a.current_version
      LEFT JOIN institution.work_language_override o
        ON o.assignment_id = a.id AND o.student_id = p_student_id AND o.institution_id = a.institution_id
     WHERE a.id = p_assignment_id AND a.institution_id = v_institution);
END
$$;

-- Sets or, with NULL, removes the override of one work and returns the
-- language the work has afterwards.
CREATE FUNCTION institution.set_work_language(p_assignment_id uuid, p_student_id uuid, p_work_language text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_assignment_role(p_assignment_id) IS DISTINCT FROM 'teacher'
     OR institution.work_relation(p_student_id, p_assignment_id) IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF p_work_language IS NOT NULL AND NOT institution.is_work_language(p_work_language) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  -- A submission request waits here, or this call waits for it, then sees it.
  PERFORM 1 FROM institution.assignment a WHERE a.id = p_assignment_id FOR UPDATE;
  IF app.work_submission_requested(p_assignment_id, p_student_id) THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  IF p_work_language IS NULL THEN
    DELETE FROM institution.work_language_override o
     WHERE o.assignment_id = p_assignment_id AND o.student_id = p_student_id;
  ELSE
    INSERT INTO institution.work_language_override (institution_id, assignment_id, student_id, work_language, set_by)
    VALUES (actor.institution_id, p_assignment_id, p_student_id, p_work_language, actor.user_id)
    ON CONFLICT (assignment_id, student_id) DO UPDATE
      SET work_language = EXCLUDED.work_language, set_by = EXCLUDED.set_by, set_at = statement_timestamp();
  END IF;
  RETURN institution.work_language(p_assignment_id, p_student_id);
END
$$;

REVOKE ALL ON FUNCTION institution.is_work_language(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION institution.assignment_version_work_language() FROM PUBLIC;
REVOKE ALL ON FUNCTION institution.set_assignment_work_language(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION institution.work_language(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION institution.set_work_language(uuid, uuid, text) FROM PUBLIC;
GRANT SELECT ON institution.work_language_override TO ductus_app;
GRANT EXECUTE ON FUNCTION institution.set_assignment_work_language(uuid, integer, text) TO ductus_app;
GRANT EXECUTE ON FUNCTION institution.work_language(uuid, uuid) TO ductus_app;
GRANT EXECUTE ON FUNCTION institution.set_work_language(uuid, uuid, text) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA app TO ductus_evidence;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

DROP FUNCTION institution.set_work_language(uuid, uuid, text);
DROP FUNCTION institution.work_language(uuid, uuid);
DROP TABLE institution.work_language_override;
DROP FUNCTION institution.set_assignment_work_language(uuid, integer, text);
DROP TRIGGER assignment_version_work_language ON institution.assignment_version;
DROP FUNCTION institution.assignment_version_work_language();
ALTER TABLE institution.assignment_version DROP COLUMN work_language;
DROP FUNCTION institution.is_work_language(text);

RESET ROLE;
SET LOCAL ROLE ductus_evidence;
DROP FUNCTION app.work_submission_requested(uuid, uuid);

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;
REVOKE CREATE ON SCHEMA app FROM ductus_evidence;

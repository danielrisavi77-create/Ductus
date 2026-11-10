-- migrate:up
-- DAN-402, M9.3-P01b (contract on #1836, c.6779376817; attack plan #1855):
-- every assignment version names the version of the AI purpose catalogue its
-- purposes come from (src/domain/assistant/purpose-catalog.ts). Version 1 is
-- the five FPZG čl. 8 purposes (D-80 t. 1); version 2 (D-268 O2) adds five of
-- level 2, which a teacher switches on by listing them.
--
-- Expand only. Every existing version is version 1 and keeps its purposes.
-- A version without one inherits the version before it, the first one gets 1;
-- naming another version than the one before is refused (ZD422), so an
-- assignment keeps its catalogue for its life. Only the new create_assignment
-- overload chooses 2. The old signatures, the server and a mentorship's rule
-- stay on version 1.
SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- The keys of a catalogue version, in catalogue order; NULL for any other.
CREATE FUNCTION institution.purpose_catalog_keys(p_version integer) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE p_version
    WHEN 1 THEN ARRAY['formatting', 'proofreading', 'literature_search', 'transcription', 'translation']
    WHEN 2 THEN ARRAY['formatting', 'proofreading', 'literature_search', 'transcription', 'translation',
                      'explanation', 'brainstorming', 'restructuring', 'example_generation', 'data_coding']
  END
$$;

-- As 20261104120000, with the purposes checked against one catalogue version.
-- An unknown or missing version makes every content invalid.
CREATE FUNCTION institution.is_assignment_content(
  p_title text, p_instructions text, p_work_type text, p_opens_at timestamptz, p_due_at timestamptz,
  p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_import_allowed boolean,
  p_purpose_catalog_version integer
) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT coalesce(
    institution.is_plain_label(p_title)
    AND length(p_instructions) <= 20000
    AND p_instructions !~ '[\x0001-\x0008\x000B\x000C\x000E-\x001F\x007F-\x009F\x202A-\x202E\x2066-\x2069]'
    AND p_work_type IN ('short_paper', 'essay', 'seminar_paper', 'bachelor_thesis', 'master_thesis',
                        'specialist_thesis', 'doctoral_thesis')
    AND isfinite(p_opens_at) AND isfinite(p_due_at) AND p_opens_at < p_due_at
    AND extract(year FROM p_opens_at AT TIME ZONE 'UTC') BETWEEN 1000 AND 9999
    AND extract(year FROM p_due_at AT TIME ZONE 'UTC') BETWEEN 1000 AND 9999
    AND institution.ai_policy_rank(p_ai_policy) IS NOT NULL
    AND p_ai_purposes <@ institution.purpose_catalog_keys(p_purpose_catalog_version)
    AND cardinality(p_ai_purposes) <= cardinality(institution.purpose_catalog_keys(p_purpose_catalog_version))
    AND coalesce(array_ndims(p_ai_purposes), 1) = 1
    AND (p_ai_policy <> 'prohibited' OR cardinality(p_ai_purposes) = 0)
    AND p_evidence_profile IN ('basic', 'extended')
    AND p_import_allowed IS NOT NULL,
    false)
$$;

-- The old rule is the rule of version 1, for the callers that name none.
CREATE OR REPLACE FUNCTION institution.is_assignment_content(
  p_title text, p_instructions text, p_work_type text, p_opens_at timestamptz, p_due_at timestamptz,
  p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_import_allowed boolean
) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT institution.is_assignment_content(p_title, p_instructions, p_work_type, p_opens_at, p_due_at,
                                           p_ai_policy, p_ai_purposes, p_evidence_profile, p_import_allowed, 1)
$$;

-- A constant default sets 1 on every existing row without rewriting the table
-- or firing the immutability trigger. It stays: a first version that names no
-- catalogue gets the old rule, and the trigger below decides later versions.
-- squawk-ignore adding-not-nullable-field
ALTER TABLE institution.assignment_version ADD COLUMN purpose_catalog_version integer NOT NULL DEFAULT 1
  CONSTRAINT assignment_version_purpose_catalog_version_check CHECK (purpose_catalog_version IN (1, 2));

-- The same name, now with the version, replaced in this transaction. Validated
-- at once (c.6779526400): every stored row is version 1, whose rule is the old
-- one, and validation scans without rewriting. It also revalidates rows stored
-- before 20261104120000 (PR #1510); one that broke the rule fails the whole
-- migration, which then changes nothing.
-- squawk-ignore ban-drop-constraint
ALTER TABLE institution.assignment_version DROP CONSTRAINT assignment_version_check;
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE institution.assignment_version ADD CONSTRAINT assignment_version_check
  CHECK (institution.is_assignment_content(title, instructions, work_type, opens_at, due_at, ai_policy,
                                           ai_purposes, evidence_profile, import_allowed, purpose_catalog_version));

-- After the institution fill and the mentorship rule, before the language,
-- which fire by name; the CHECKs see the filled value.
CREATE FUNCTION institution.assignment_version_purpose_catalog() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_previous integer;
BEGIN
  SELECT v.purpose_catalog_version INTO v_previous FROM institution.assignment_version v
   WHERE v.assignment_id = NEW.assignment_id AND v.version_no = NEW.version_no - 1;
  -- A later version keeps the catalogue of the one before. 1 is also the
  -- column default, which a writer that names no version gets, so only another
  -- value is a writer asking for a different catalogue.
  IF v_previous IS NOT NULL THEN
    IF NEW.purpose_catalog_version IS DISTINCT FROM 1 AND NEW.purpose_catalog_version IS DISTINCT FROM v_previous THEN
      RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
    END IF;
    NEW.purpose_catalog_version := v_previous;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER assignment_version_purpose_catalog BEFORE INSERT ON institution.assignment_version
  FOR EACH ROW EXECUTE FUNCTION institution.assignment_version_purpose_catalog();

-- As 20261022090000, with the catalogue version, which a replay must repeat too.
CREATE FUNCTION institution.create_assignment(
  p_course_id uuid, p_request_id uuid, p_title text, p_instructions text, p_work_type text,
  p_opens_at timestamptz, p_due_at timestamptz, p_ai_policy text, p_ai_purposes text[],
  p_evidence_profile text, p_import_allowed boolean,
  p_word_min integer, p_word_max integer, p_purpose_catalog_version integer
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_assignment uuid;
  existing record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF p_request_id IS NULL
     OR NOT institution.is_assignment_content(p_title, p_instructions, p_work_type, p_opens_at, p_due_at,
                                              p_ai_policy, p_ai_purposes, p_evidence_profile, p_import_allowed,
                                              p_purpose_catalog_version)
     OR NOT institution.is_word_range(p_word_min, p_word_max)
     OR institution.ai_policy_rank(p_ai_policy)
        > (SELECT institution.ai_policy_rank(c.ai_policy) FROM institution.course c WHERE c.id = p_course_id) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;

  INSERT INTO institution.assignment (course_id, institution_id, created_by, request_id)
  VALUES (p_course_id, actor.institution_id, actor.user_id, p_request_id)
  ON CONFLICT (created_by, request_id) WHERE request_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_assignment;

  IF v_assignment IS NOT NULL THEN
    INSERT INTO institution.assignment_version (
      assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
      ai_purposes, evidence_profile, import_allowed, word_min, word_max, purpose_catalog_version, created_by
    )
    VALUES (v_assignment, 1, p_title, p_instructions, p_work_type, p_opens_at, p_due_at, p_ai_policy,
            p_ai_purposes, p_evidence_profile, p_import_allowed, p_word_min, p_word_max,
            p_purpose_catalog_version, actor.user_id);
    RETURN v_assignment;
  END IF;

  -- A key belongs to one creator. Replays return the original assignment only
  -- when every field of its immutable first version and its course match.
  SELECT a.id, a.course_id, v.title, v.instructions, v.work_type, v.opens_at, v.due_at,
         v.ai_policy, v.ai_purposes, v.evidence_profile, v.import_allowed, v.word_min, v.word_max,
         v.purpose_catalog_version
    INTO existing
    FROM institution.assignment a
    JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = 1
   WHERE a.created_by = actor.user_id AND a.request_id = p_request_id;
  IF existing.id IS NULL
     OR existing.course_id IS DISTINCT FROM p_course_id
     OR existing.title IS DISTINCT FROM p_title
     OR existing.instructions IS DISTINCT FROM p_instructions
     OR existing.work_type IS DISTINCT FROM p_work_type
     OR existing.opens_at IS DISTINCT FROM p_opens_at
     OR existing.due_at IS DISTINCT FROM p_due_at
     OR existing.ai_policy IS DISTINCT FROM p_ai_policy
     OR existing.ai_purposes IS DISTINCT FROM p_ai_purposes
     OR existing.evidence_profile IS DISTINCT FROM p_evidence_profile
     OR existing.import_allowed IS DISTINCT FROM p_import_allowed
     OR existing.word_min IS DISTINCT FROM p_word_min
     OR existing.word_max IS DISTINCT FROM p_word_max
     OR existing.purpose_catalog_version IS DISTINCT FROM p_purpose_catalog_version THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  RETURN existing.id;
END
$$;

-- The old signature is version 1: a replay of a version 2 assignment through
-- it is a different request (ZD409).
CREATE OR REPLACE FUNCTION institution.create_assignment(
  p_course_id uuid, p_request_id uuid, p_title text, p_instructions text, p_work_type text,
  p_opens_at timestamptz, p_due_at timestamptz, p_ai_policy text, p_ai_purposes text[],
  p_evidence_profile text, p_import_allowed boolean,
  p_word_min integer, p_word_max integer
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN institution.create_assignment(p_course_id, p_request_id, p_title, p_instructions, p_work_type,
                                       p_opens_at, p_due_at, p_ai_policy, p_ai_purposes, p_evidence_profile,
                                       p_import_allowed, p_word_min, p_word_max, 1);
END
$$;

-- As 20261028100000, with the purposes checked against the assignment's
-- catalogue version, which the new version keeps. Versions are immutable, so
-- version 1 is read before the lock.
CREATE OR REPLACE FUNCTION institution.publish_assignment_version(
  p_assignment_id uuid, p_expected_version integer, p_title text, p_instructions text, p_work_type text,
  p_opens_at timestamptz, p_due_at timestamptz, p_ai_policy text, p_ai_purposes text[],
  p_evidence_profile text, p_import_allowed boolean,
  p_word_min integer, p_word_max integer
) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  cur record;
  v_current integer;
  v_catalog integer;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_assignment_role(p_assignment_id) IS DISTINCT FROM 'teacher'
     OR EXISTS (SELECT 1 FROM institution.assignment a WHERE a.id = p_assignment_id AND a.mentorship_id IS NOT NULL) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  SELECT v.purpose_catalog_version INTO v_catalog FROM institution.assignment_version v
   WHERE v.assignment_id = p_assignment_id AND v.version_no = 1;
  IF NOT institution.is_assignment_content(p_title, p_instructions, p_work_type, p_opens_at, p_due_at,
                                           p_ai_policy, p_ai_purposes, p_evidence_profile, p_import_allowed,
                                           v_catalog)
     OR NOT institution.is_word_range(p_word_min, p_word_max) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  -- Two teachers at once: the second waits here, then fails the comparison.
  SELECT a.current_version INTO v_current FROM institution.assignment a WHERE a.id = p_assignment_id FOR UPDATE;
  IF v_current IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  SELECT v.* INTO cur FROM institution.assignment_version v
   WHERE v.assignment_id = p_assignment_id AND v.version_no = v_current;
  IF institution.ai_policy_rank(p_ai_policy) > institution.ai_policy_rank(cur.ai_policy)
     OR NOT p_ai_purposes <@ cur.ai_purposes
     OR (p_evidence_profile = 'extended' AND cur.evidence_profile = 'basic')
     OR (p_import_allowed AND NOT cur.import_allowed)
     -- Rule 14: a bound may be dropped or relaxed, never added or tightened.
     OR (p_word_min IS NOT NULL AND (cur.word_min IS NULL OR p_word_min > cur.word_min))
     OR (p_word_max IS NOT NULL AND (cur.word_max IS NULL OR p_word_max < cur.word_max)) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  INSERT INTO institution.assignment_version (
    assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
    ai_purposes, evidence_profile, import_allowed, word_min, word_max, purpose_catalog_version, created_by
  )
  VALUES (p_assignment_id, v_current + 1, p_title, p_instructions, p_work_type, p_opens_at, p_due_at, p_ai_policy,
          p_ai_purposes, p_evidence_profile, p_import_allowed, p_word_min, p_word_max, v_catalog, actor.user_id);
  UPDATE institution.assignment a SET current_version = v_current + 1 WHERE a.id = p_assignment_id;
  RETURN v_current + 1;
END
$$;

REVOKE ALL ON FUNCTION institution.purpose_catalog_keys(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION institution.is_assignment_content(
  text, text, text, timestamptz, timestamptz, text, text[], text, boolean, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION institution.assignment_version_purpose_catalog() FROM PUBLIC;
REVOKE ALL ON FUNCTION institution.create_assignment(
  uuid, uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean, integer, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.create_assignment(
  uuid, uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean, integer, integer, integer
) TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
-- The bodies are those of 20261022090000, 20261028100000 and 20261104120000.
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;
CREATE OR REPLACE FUNCTION institution.create_assignment(
  p_course_id uuid, p_request_id uuid, p_title text, p_instructions text, p_work_type text,
  p_opens_at timestamptz, p_due_at timestamptz, p_ai_policy text, p_ai_purposes text[],
  p_evidence_profile text, p_import_allowed boolean,
  p_word_min integer, p_word_max integer
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_assignment uuid;
  existing record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_course_role(p_course_id) IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF p_request_id IS NULL
     OR NOT institution.is_assignment_content(p_title, p_instructions, p_work_type, p_opens_at, p_due_at,
                                              p_ai_policy, p_ai_purposes, p_evidence_profile, p_import_allowed)
     OR NOT institution.is_word_range(p_word_min, p_word_max)
     OR institution.ai_policy_rank(p_ai_policy)
        > (SELECT institution.ai_policy_rank(c.ai_policy) FROM institution.course c WHERE c.id = p_course_id) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;

  INSERT INTO institution.assignment (course_id, institution_id, created_by, request_id)
  VALUES (p_course_id, actor.institution_id, actor.user_id, p_request_id)
  ON CONFLICT (created_by, request_id) WHERE request_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_assignment;

  IF v_assignment IS NOT NULL THEN
    INSERT INTO institution.assignment_version (
      assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
      ai_purposes, evidence_profile, import_allowed, word_min, word_max, created_by
    )
    VALUES (v_assignment, 1, p_title, p_instructions, p_work_type, p_opens_at, p_due_at, p_ai_policy,
            p_ai_purposes, p_evidence_profile, p_import_allowed, p_word_min, p_word_max, actor.user_id);
    RETURN v_assignment;
  END IF;

  -- A key belongs to one creator. Replays return the original assignment only
  -- when every field of its immutable first version and its course match.
  SELECT a.id, a.course_id, v.title, v.instructions, v.work_type, v.opens_at, v.due_at,
         v.ai_policy, v.ai_purposes, v.evidence_profile, v.import_allowed, v.word_min, v.word_max
    INTO existing
    FROM institution.assignment a
    JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = 1
   WHERE a.created_by = actor.user_id AND a.request_id = p_request_id;
  IF existing.id IS NULL
     OR existing.course_id IS DISTINCT FROM p_course_id
     OR existing.title IS DISTINCT FROM p_title
     OR existing.instructions IS DISTINCT FROM p_instructions
     OR existing.work_type IS DISTINCT FROM p_work_type
     OR existing.opens_at IS DISTINCT FROM p_opens_at
     OR existing.due_at IS DISTINCT FROM p_due_at
     OR existing.ai_policy IS DISTINCT FROM p_ai_policy
     OR existing.ai_purposes IS DISTINCT FROM p_ai_purposes
     OR existing.evidence_profile IS DISTINCT FROM p_evidence_profile
     OR existing.import_allowed IS DISTINCT FROM p_import_allowed
     OR existing.word_min IS DISTINCT FROM p_word_min
     OR existing.word_max IS DISTINCT FROM p_word_max THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  RETURN existing.id;
END
$$;
CREATE OR REPLACE FUNCTION institution.publish_assignment_version(
  p_assignment_id uuid, p_expected_version integer, p_title text, p_instructions text, p_work_type text,
  p_opens_at timestamptz, p_due_at timestamptz, p_ai_policy text, p_ai_purposes text[],
  p_evidence_profile text, p_import_allowed boolean,
  p_word_min integer, p_word_max integer
) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  cur record;
  v_current integer;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_assignment_role(p_assignment_id) IS DISTINCT FROM 'teacher'
     OR EXISTS (SELECT 1 FROM institution.assignment a WHERE a.id = p_assignment_id AND a.mentorship_id IS NOT NULL) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF NOT institution.is_assignment_content(p_title, p_instructions, p_work_type, p_opens_at, p_due_at,
                                           p_ai_policy, p_ai_purposes, p_evidence_profile, p_import_allowed)
     OR NOT institution.is_word_range(p_word_min, p_word_max) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  -- Two teachers at once: the second waits here, then fails the comparison.
  SELECT a.current_version INTO v_current FROM institution.assignment a WHERE a.id = p_assignment_id FOR UPDATE;
  IF v_current IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  SELECT v.* INTO cur FROM institution.assignment_version v
   WHERE v.assignment_id = p_assignment_id AND v.version_no = v_current;
  IF institution.ai_policy_rank(p_ai_policy) > institution.ai_policy_rank(cur.ai_policy)
     OR NOT p_ai_purposes <@ cur.ai_purposes
     OR (p_evidence_profile = 'extended' AND cur.evidence_profile = 'basic')
     OR (p_import_allowed AND NOT cur.import_allowed)
     -- Rule 14: a bound may be dropped or relaxed, never added or tightened.
     OR (p_word_min IS NOT NULL AND (cur.word_min IS NULL OR p_word_min > cur.word_min))
     OR (p_word_max IS NOT NULL AND (cur.word_max IS NULL OR p_word_max < cur.word_max)) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  INSERT INTO institution.assignment_version (
    assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
    ai_purposes, evidence_profile, import_allowed, word_min, word_max, created_by
  )
  VALUES (p_assignment_id, v_current + 1, p_title, p_instructions, p_work_type, p_opens_at, p_due_at, p_ai_policy,
          p_ai_purposes, p_evidence_profile, p_import_allowed, p_word_min, p_word_max, actor.user_id);
  UPDATE institution.assignment a SET current_version = v_current + 1 WHERE a.id = p_assignment_id;
  RETURN v_current + 1;
END
$$;
DROP FUNCTION institution.create_assignment(
  uuid, uuid, text, text, text, timestamptz, timestamptz, text, text[], text, boolean, integer, integer, integer
);
DROP TRIGGER assignment_version_purpose_catalog ON institution.assignment_version;
DROP FUNCTION institution.assignment_version_purpose_catalog();
ALTER TABLE institution.assignment_version DROP CONSTRAINT assignment_version_check;
CREATE OR REPLACE FUNCTION institution.is_assignment_content(
  p_title text, p_instructions text, p_work_type text, p_opens_at timestamptz, p_due_at timestamptz,
  p_ai_policy text, p_ai_purposes text[], p_evidence_profile text, p_import_allowed boolean
) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT coalesce(
    institution.is_plain_label(p_title)
    AND length(p_instructions) <= 20000
    AND p_instructions !~ '[\x0001-\x0008\x000B\x000C\x000E-\x001F\x007F-\x009F\x202A-\x202E\x2066-\x2069]'
    AND p_work_type IN ('short_paper', 'essay', 'seminar_paper', 'bachelor_thesis', 'master_thesis',
                        'specialist_thesis', 'doctoral_thesis')
    AND isfinite(p_opens_at) AND isfinite(p_due_at) AND p_opens_at < p_due_at
    AND extract(year FROM p_opens_at AT TIME ZONE 'UTC') BETWEEN 1000 AND 9999
    AND extract(year FROM p_due_at AT TIME ZONE 'UTC') BETWEEN 1000 AND 9999
    AND institution.ai_policy_rank(p_ai_policy) IS NOT NULL
    AND p_ai_purposes <@ ARRAY['formatting', 'proofreading', 'literature_search', 'transcription', 'translation']
    AND cardinality(p_ai_purposes) <= 5 AND coalesce(array_ndims(p_ai_purposes), 1) = 1
    AND (p_ai_policy <> 'prohibited' OR cardinality(p_ai_purposes) = 0)
    AND p_evidence_profile IN ('basic', 'extended')
    AND p_import_allowed IS NOT NULL,
    false)
$$;
ALTER TABLE institution.assignment_version ADD CONSTRAINT assignment_version_check
  CHECK (institution.is_assignment_content(title, instructions, work_type, opens_at, due_at, ai_policy,
                                           ai_purposes, evidence_profile, import_allowed));
DROP FUNCTION institution.is_assignment_content(
  text, text, text, timestamptz, timestamptz, text, text[], text, boolean, integer
);
DROP FUNCTION institution.purpose_catalog_keys(integer);
ALTER TABLE institution.assignment_version DROP COLUMN purpose_catalog_version;
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

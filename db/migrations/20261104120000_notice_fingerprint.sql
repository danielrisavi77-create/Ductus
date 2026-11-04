-- migrate:up
-- DAN-306, M2.13-P02a (contract on #1091, c.6626223893): an acknowledgment
-- records which notice the student saw. Two columns on
-- institution.notice_acknowledgment, the notice template version and the
-- fingerprint of the notice built from the stored assignment version, are
-- written only by institution.acknowledge_notice and never change. The text
-- is not stored. The gate does not change: has_acknowledged_current still asks
-- for a row of the current version, with or without a fingerprint, so a row
-- written before this migration (both columns null) still counts.
--
-- Fingerprint, the same bytes as src/domain/notice/fingerprint.ts:
--   sha256(UTF-8("ductus-notice-fingerprint-v1") || 0x0a || JCS(payload)),
-- lowercase hex. The payload has the keys aiPolicy, aiPurposes, dueAt,
-- evidenceProfile, instructions, opensAt, templateVersion, title, wordMax,
-- wordMin, workType (JCS order); aiPurposes without repeats in code-unit
-- order, [] when the policy is prohibited; instants in UTC with milliseconds.
-- to_json(text) escapes as JSON.stringify does for the text a version may hold
-- (is_assignment_content refuses control characters but tab, LF and CR).
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- Nullable columns rewrite no row. Both null (a row written before this
-- migration) or both set; num_nulls, so that a null never lets one through.
ALTER TABLE institution.notice_acknowledgment
  ADD COLUMN notice_template_version integer,
  ADD COLUMN notice_fingerprint text,
  -- squawk-ignore constraint-missing-not-valid
  ADD CONSTRAINT notice_acknowledgment_fingerprint_check CHECK (
    num_nulls(notice_template_version, notice_fingerprint) = 2
    OR (num_nulls(notice_template_version, notice_fingerprint) = 0
        AND notice_template_version >= 1 AND notice_fingerprint ~ '^[0-9a-f]{64}$')
  );

CREATE FUNCTION institution.notice_fingerprint(
  p_template_version integer, p_title text, p_instructions text, p_work_type text,
  p_opens_at timestamptz, p_due_at timestamptz, p_ai_policy text, p_ai_purposes text[],
  p_evidence_profile text, p_word_min integer, p_word_max integer
) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT encode(pg_catalog.sha256(pg_catalog.convert_to(
    'ductus-notice-fingerprint-v1' || E'\n'
    || '{"aiPolicy":' || to_json(p_ai_policy)::text
    || ',"aiPurposes":' || CASE WHEN p_ai_policy = 'prohibited' THEN '[]' ELSE coalesce(
         (SELECT '[' || string_agg(to_json(s.p)::text, ',' ORDER BY s.p COLLATE "C") || ']'
            FROM (SELECT DISTINCT u.p FROM unnest(p_ai_purposes) AS u(p)) s),
         '[]') END
    || ',"dueAt":' || to_json(to_char(p_due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text
    || ',"evidenceProfile":' || to_json(p_evidence_profile)::text
    || ',"instructions":' || to_json(p_instructions)::text
    || ',"opensAt":' || to_json(to_char(p_opens_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text
    || ',"templateVersion":' || p_template_version::text
    || ',"title":' || to_json(p_title)::text
    || ',"wordMax":' || coalesce(p_word_max::text, 'null')
    || ',"wordMin":' || coalesce(p_word_min::text, 'null')
    || ',"workType":' || to_json(p_work_type)::text
    || '}',
    'UTF8')), 'hex')
$$;
REVOKE ALL ON FUNCTION institution.notice_fingerprint(
  integer, text, text, text, timestamptz, timestamptz, text, text[], text, integer, integer
) FROM PUBLIC;

-- What a student confirmed stays what they confirmed: the owner role and its
-- functions cannot change the record either (C2). Other columns keep their
-- rules (ductus_app has no UPDATE or DELETE on the table).
CREATE FUNCTION institution.refuse_acknowledgment_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'notice acknowledgment is immutable' USING ERRCODE = 'ZD403';
END
$$;
REVOKE ALL ON FUNCTION institution.refuse_acknowledgment_change() FROM PUBLIC;
CREATE TRIGGER notice_acknowledgment_fingerprint_immutable
  BEFORE UPDATE OF notice_template_version, notice_fingerprint ON institution.notice_acknowledgment
  FOR EACH ROW EXECUTE FUNCTION institution.refuse_acknowledgment_change();

-- The old signature goes: a caller that does not name the template version
-- it showed cannot acknowledge (B5).
-- squawk-ignore ban-drop-function
DROP FUNCTION institution.acknowledge_notice(uuid, integer);

-- As 20261011100000, plus the template version the client showed. The
-- fingerprint is computed here from the stored version that is current under
-- the share lock, never taken from the caller. A repeat for the same notice
-- returns the first time; a repeat for another notice (another template
-- version, or a row written before this migration) is a conflict and changes
-- nothing (C1, C3).
CREATE FUNCTION institution.acknowledge_notice(
  p_assignment_id uuid, p_version_no integer, p_template_version integer
) RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_current integer;
  v_fingerprint text;
  stored record;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_assignment_role(p_assignment_id) IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  IF p_template_version IS NULL OR p_template_version < 1 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  SELECT a.current_version INTO v_current FROM institution.assignment a WHERE a.id = p_assignment_id FOR SHARE;
  IF v_current IS DISTINCT FROM p_version_no THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  SELECT institution.notice_fingerprint(p_template_version, v.title, v.instructions, v.work_type, v.opens_at,
           v.due_at, v.ai_policy, v.ai_purposes, v.evidence_profile, v.word_min, v.word_max)
    INTO v_fingerprint
    FROM institution.assignment_version v
   WHERE v.assignment_id = p_assignment_id AND v.version_no = v_current;
  INSERT INTO institution.notice_acknowledgment
    (assignment_id, version_no, student_id, institution_id, notice_template_version, notice_fingerprint)
  VALUES (p_assignment_id, v_current, actor.user_id, actor.institution_id, p_template_version, v_fingerprint)
  ON CONFLICT (assignment_id, version_no, student_id) DO NOTHING;
  SELECT n.acknowledged_at, n.notice_template_version, n.notice_fingerprint INTO stored
    FROM institution.notice_acknowledgment n
   WHERE n.assignment_id = p_assignment_id AND n.version_no = v_current AND n.student_id = actor.user_id;
  IF stored.notice_template_version IS DISTINCT FROM p_template_version
     OR stored.notice_fingerprint IS DISTINCT FROM v_fingerprint THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  RETURN stored.acknowledged_at;
END
$$;
REVOKE ALL ON FUNCTION institution.acknowledge_notice(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.acknowledge_notice(uuid, integer, integer) TO ductus_app;

-- The supported years of an assignment instant are 1000 to 9999 in UTC
-- (review c.6632344287, QA c.6632559838). Below them to_char's YYYY and
-- Date.prototype.toISOString write different years for the same instant
-- (1 BC is 0001 here and 0000 in JavaScript), so the fingerprint would not be
-- the bytes of src/domain/notice/fingerprint.ts. The range is checked after
-- conversion to UTC, as validInstant in src/server/institution/create-assignment.ts.
-- The same signature and body otherwise; the table's CHECK and every function
-- that creates or publishes a version call this one rule. A row stored before
-- this migration is not revalidated (known limit in PR #1510).
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

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;
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
    AND institution.ai_policy_rank(p_ai_policy) IS NOT NULL
    AND p_ai_purposes <@ ARRAY['formatting', 'proofreading', 'literature_search', 'transcription', 'translation']
    AND cardinality(p_ai_purposes) <= 5 AND coalesce(array_ndims(p_ai_purposes), 1) = 1
    AND (p_ai_policy <> 'prohibited' OR cardinality(p_ai_purposes) = 0)
    AND p_evidence_profile IN ('basic', 'extended')
    AND p_import_allowed IS NOT NULL,
    false)
$$;
DROP FUNCTION institution.acknowledge_notice(uuid, integer, integer);
DROP TRIGGER notice_acknowledgment_fingerprint_immutable ON institution.notice_acknowledgment;
DROP FUNCTION institution.refuse_acknowledgment_change();
DROP FUNCTION institution.notice_fingerprint(
  integer, text, text, text, timestamptz, timestamptz, text, text[], text, integer, integer
);
ALTER TABLE institution.notice_acknowledgment
  DROP CONSTRAINT notice_acknowledgment_fingerprint_check,
  DROP COLUMN notice_fingerprint,
  DROP COLUMN notice_template_version;
CREATE FUNCTION institution.acknowledge_notice(p_assignment_id uuid, p_version_no integer) RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_current integer;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  IF institution.actor_assignment_role(p_assignment_id) IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;
  SELECT a.current_version INTO v_current FROM institution.assignment a WHERE a.id = p_assignment_id FOR SHARE;
  IF v_current IS DISTINCT FROM p_version_no THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;
  INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
  VALUES (p_assignment_id, v_current, actor.user_id, actor.institution_id)
  ON CONFLICT (assignment_id, version_no, student_id) DO NOTHING;
  RETURN (SELECT n.acknowledged_at FROM institution.notice_acknowledgment n
           WHERE n.assignment_id = p_assignment_id AND n.version_no = v_current AND n.student_id = actor.user_id);
END
$$;
REVOKE ALL ON FUNCTION institution.acknowledge_notice(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.acknowledge_notice(uuid, integer) TO ductus_app;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

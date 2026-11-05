-- DAN-315 (M2.12-P01a, D-175, D-174, D-117; plan of attack #1505, contract
-- on #1091): the faculty rule for a kind of work becomes a chain of published
-- versions that never change. A version carries only what faculty_work_rule
-- holds today (AI policy, purposes, evidence profile, import); thresholds,
-- retention and providers are not decided and have no column or parameter.
--
-- One confirmed, unrevoked administrator of the institution publishes the
-- next version through publish_faculty_rule_version, naming the version they
-- expect to be the latest (0 when there is none). The institution, the author
-- and the time come from the session and the database clock, never from the
-- caller. The version and its audit row are written by one statement, and a
-- deferred check refuses to commit an administrator's version without one.
-- faculty_work_rule stays as the projection of the latest version, so the
-- mentorship trigger that reads it is unchanged until P01b binds assignments
-- to a version.
--
-- Errors carry no input: ZD401 no session, ZD403 not allowed, ZD409 the
-- expected version is not the latest, ZD422 invalid input.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- Only while this migration runs; revoked at the end.
GRANT CREATE ON SCHEMA audit TO ductus_identity;
GRANT CREATE ON SCHEMA institution TO ductus_identity;

SET LOCAL ROLE ductus_identity;

-- The CHECKs are those of faculty_work_rule, so every row it holds can become
-- version 1. 'operator' marks a row converted below, published by no one in
-- the application; every later version is an administrator's.
CREATE TABLE institution.faculty_rule_version (
  institution_id uuid NOT NULL REFERENCES identity.institution (id),
  work_type text NOT NULL CHECK (work_type IN ('short_paper', 'essay', 'seminar_paper', 'bachelor_thesis',
                                               'master_thesis', 'specialist_thesis', 'doctoral_thesis')),
  version_no integer NOT NULL CHECK (version_no >= 1),
  ai_policy text NOT NULL CHECK (institution.ai_policy_rank(ai_policy) IS NOT NULL),
  ai_purposes text[] NOT NULL CHECK (
    ai_purposes <@ ARRAY['formatting', 'proofreading', 'literature_search', 'transcription', 'translation']
    AND cardinality(ai_purposes) <= 5 AND coalesce(array_ndims(ai_purposes), 1) = 1),
  evidence_profile text NOT NULL CHECK (evidence_profile IN ('basic', 'extended')),
  import_allowed boolean NOT NULL,
  origin text NOT NULL CHECK (origin IN ('operator', 'administrator')),
  published_by uuid,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id, work_type, version_no),
  UNIQUE (institution_id, work_type, version_no, published_by),
  FOREIGN KEY (published_by, institution_id) REFERENCES identity.user_account (id, institution_id),
  CHECK ((origin = 'administrator') = (published_by IS NOT NULL)),
  CHECK (ai_policy <> 'prohibited' OR cardinality(ai_purposes) = 0)
);
CREATE INDEX faculty_rule_version_published_by_idx ON institution.faculty_rule_version (published_by);

CREATE FUNCTION institution.refuse_rule_version_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'published rule version is immutable' USING ERRCODE = 'ZD403';
END
$$;
CREATE TRIGGER faculty_rule_version_immutable BEFORE UPDATE OR DELETE ON institution.faculty_rule_version
  FOR EACH ROW EXECUTE FUNCTION institution.refuse_rule_version_change();
CREATE TRIGGER faculty_rule_version_no_truncate BEFORE TRUNCATE ON institution.faculty_rule_version
  FOR EACH STATEMENT EXECUTE FUNCTION institution.refuse_rule_version_change();

ALTER TABLE institution.faculty_rule_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution.faculty_rule_version FORCE ROW LEVEL SECURITY;
CREATE POLICY faculty_rule_version_owner ON institution.faculty_rule_version TO ductus_identity
  USING (true) WITH CHECK (true);
-- The administrator reads the versions of the own institution; teachers and
-- students read what applies to their assignments once P01b binds them.
CREATE POLICY faculty_rule_version_read ON institution.faculty_rule_version FOR SELECT TO ductus_app
  USING (institution_id = (SELECT app.current_institution_id()) AND (SELECT institution.actor_has_role('admin')));

-- One row per published version. The composite key binds the row to the
-- version and its publisher, so the trail cannot name another author.
CREATE TABLE audit.faculty_rule_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  work_type text NOT NULL,
  version_no integer NOT NULL,
  kind text NOT NULL CHECK (kind = 'published'),
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (institution_id, work_type, version_no, kind),
  CONSTRAINT faculty_rule_event_version_fkey FOREIGN KEY (institution_id, work_type, version_no, actor_id)
    REFERENCES institution.faculty_rule_version (institution_id, work_type, version_no, published_by)
);
CREATE INDEX faculty_rule_event_institution_idx ON audit.faculty_rule_event (institution_id, occurred_at);

CREATE TRIGGER faculty_rule_event_append_only BEFORE UPDATE OR DELETE ON audit.faculty_rule_event
  FOR EACH ROW EXECUTE FUNCTION audit.reject_change();
CREATE TRIGGER faculty_rule_event_no_truncate BEFORE TRUNCATE ON audit.faculty_rule_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_change();

ALTER TABLE audit.faculty_rule_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.faculty_rule_event FORCE ROW LEVEL SECURITY;
CREATE POLICY faculty_rule_event_owner ON audit.faculty_rule_event TO ductus_identity USING (true) WITH CHECK (true);

-- No version of an administrator without its audit row (the foreign key
-- already refuses a row without its version). Checked at commit, where the
-- caller is still ductus_app, which cannot read the trail: hence the definer.
CREATE FUNCTION institution.check_rule_version_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM audit.faculty_rule_event e
                 WHERE e.institution_id = NEW.institution_id AND e.work_type = NEW.work_type
                   AND e.version_no = NEW.version_no) THEN
    RAISE EXCEPTION 'rule version without audit row' USING ERRCODE = 'ZD409';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER faculty_rule_version_has_event AFTER INSERT ON institution.faculty_rule_version
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.origin = 'administrator')
  EXECUTE FUNCTION institution.check_rule_version_event();

-- F1: every rule that exists becomes version 1, unchanged, as of its last change.
INSERT INTO institution.faculty_rule_version
  (institution_id, work_type, version_no, ai_policy, ai_purposes, evidence_profile, import_allowed,
   origin, published_by, published_at)
SELECT institution_id, work_type, 1, ai_policy, ai_purposes, evidence_profile, import_allowed,
       'operator', NULL, updated_at
FROM institution.faculty_work_rule;

-- Returns the number of the version published, or of the one this caller
-- already published from the same expected version with the same content (a
-- retry after a lost answer writes nothing).
CREATE FUNCTION institution.publish_faculty_rule_version(
  p_work_type text, p_expected_version integer, p_ai_policy text, p_ai_purposes text[],
  p_evidence_profile text, p_import_allowed boolean
) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  v_latest institution.faculty_rule_version;
  v_current integer;
BEGIN
  SELECT * INTO actor FROM institution.require_actor();
  -- The role row FOR SHARE: a revocation waits for this transaction, and one
  -- that committed first leaves no row to find.
  PERFORM 1 FROM institution.institution_role r
   WHERE r.institution_id = actor.institution_id AND r.user_id = actor.user_id AND r.role = 'admin'
     AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL
   FOR SHARE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'ZD403';
  END IF;

  IF p_work_type IS NULL OR p_work_type NOT IN ('short_paper', 'essay', 'seminar_paper', 'bachelor_thesis',
                                                'master_thesis', 'specialist_thesis', 'doctoral_thesis')
     OR institution.ai_policy_rank(p_ai_policy) IS NULL
     OR p_evidence_profile IS NULL OR p_evidence_profile NOT IN ('basic', 'extended')
     OR p_import_allowed IS NULL
     OR p_expected_version IS NULL OR p_expected_version < 0
     OR p_ai_purposes IS NULL OR coalesce(pg_catalog.array_ndims(p_ai_purposes), 1) <> 1 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;
  -- One dimension from here on, so array_position and unnest are safe.
  IF coalesce(pg_catalog.array_lower(p_ai_purposes, 1), 1) <> 1
     OR pg_catalog.cardinality(p_ai_purposes) > 5
     OR pg_catalog.array_position(p_ai_purposes, NULL) IS NOT NULL
     OR NOT p_ai_purposes <@ ARRAY['formatting', 'proofreading', 'literature_search', 'transcription', 'translation']
     OR (SELECT count(DISTINCT u) FROM pg_catalog.unnest(p_ai_purposes) AS u) <> pg_catalog.cardinality(p_ai_purposes)
     OR (p_ai_policy = 'prohibited' AND pg_catalog.cardinality(p_ai_purposes) > 0) THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = 'ZD422';
  END IF;

  -- Publications of one rule run one at a time; the next statement reads
  -- what the one before committed.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'faculty_rule_version:' || actor.institution_id::text || ':' || p_work_type, 0));
  SELECT * INTO v_latest FROM institution.faculty_rule_version v
   WHERE v.institution_id = actor.institution_id AND v.work_type = p_work_type
   ORDER BY v.version_no DESC LIMIT 1;
  v_current := coalesce(v_latest.version_no, 0);

  IF p_expected_version <> v_current THEN
    IF p_expected_version = v_current - 1
       AND v_latest.published_by = actor.user_id
       AND v_latest.ai_policy = p_ai_policy AND v_latest.ai_purposes = p_ai_purposes
       AND v_latest.evidence_profile = p_evidence_profile AND v_latest.import_allowed = p_import_allowed THEN
      RETURN v_current;
    END IF;
    RAISE EXCEPTION 'conflict' USING ERRCODE = 'ZD409';
  END IF;

  WITH published AS (
    INSERT INTO institution.faculty_rule_version
      (institution_id, work_type, version_no, ai_policy, ai_purposes, evidence_profile, import_allowed,
       origin, published_by)
    VALUES (actor.institution_id, p_work_type, v_current + 1, p_ai_policy, p_ai_purposes, p_evidence_profile,
            p_import_allowed, 'administrator', actor.user_id)
    RETURNING institution_id, work_type, version_no, published_by, published_at
  )
  INSERT INTO audit.faculty_rule_event (institution_id, work_type, version_no, kind, actor_id, occurred_at)
  SELECT institution_id, work_type, version_no, 'published', published_by, published_at FROM published;

  INSERT INTO institution.faculty_work_rule
    (institution_id, work_type, ai_policy, ai_purposes, evidence_profile, import_allowed, updated_at)
  VALUES (actor.institution_id, p_work_type, p_ai_policy, p_ai_purposes, p_evidence_profile, p_import_allowed, now())
  ON CONFLICT (institution_id, work_type) DO UPDATE
    SET ai_policy = EXCLUDED.ai_policy, ai_purposes = EXCLUDED.ai_purposes,
        evidence_profile = EXCLUDED.evidence_profile, import_allowed = EXCLUDED.import_allowed,
        updated_at = EXCLUDED.updated_at;
  RETURN v_current + 1;
END
$$;

REVOKE ALL ON FUNCTION institution.publish_faculty_rule_version(text, integer, text, text[], text, boolean),
  institution.refuse_rule_version_change(), institution.check_rule_version_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION institution.publish_faculty_rule_version(text, integer, text, text[], text, boolean)
  TO ductus_app;
GRANT SELECT ON institution.faculty_rule_version TO ductus_app;

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA audit FROM ductus_identity;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only; staging and production only go forward (docs/BACKEND.md §6).
-- faculty_work_rule keeps the latest published content.
SET LOCAL ROLE ductus_migrator;
GRANT CREATE ON SCHEMA institution TO ductus_identity;
GRANT CREATE ON SCHEMA audit TO ductus_identity;
SET LOCAL ROLE ductus_identity;
DROP FUNCTION institution.publish_faculty_rule_version(text, integer, text, text[], text, boolean);
DROP TABLE audit.faculty_rule_event;
DROP TABLE institution.faculty_rule_version;
DROP FUNCTION institution.check_rule_version_event();
DROP FUNCTION institution.refuse_rule_version_change();
RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA audit FROM ductus_identity;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:up
-- DAN-306, M2.13-P03 (contract on #1091, c.6685108734): an acknowledgment
-- says whether it is bound to the notice the student saw. P02a
-- (20261104120000) added the template version and the fingerprint; this
-- names the two kinds of row:
--   bound              both set, written by institution.acknowledge_notice
--   legacy_unverified  both null: written before P02a, or by a direct insert
--                      of the owner role (fixtures, operator); nobody can say
--                      which notice it confirmed
-- The binding is never taken from the writer: a trigger derives it from the
-- fingerprint on insert, a CHECK holds it to the fingerprint for an insert
-- that skips triggers, and nobody changes it after. No row is removed or
-- rewritten but for the new column, and the gate does not change: a
-- legacy_unverified row of the current version still counts (#1502 answer 1).
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- A constant default rewrites no row (PostgreSQL 11+): every existing row is
-- legacy_unverified until the UPDATE below names those with a fingerprint.
ALTER TABLE institution.notice_acknowledgment
  ADD COLUMN notice_binding text NOT NULL DEFAULT 'legacy_unverified';
UPDATE institution.notice_acknowledgment SET notice_binding = 'bound' WHERE notice_fingerprint IS NOT NULL;
ALTER TABLE institution.notice_acknowledgment
  -- squawk-ignore constraint-missing-not-valid
  ADD CONSTRAINT notice_acknowledgment_binding_check CHECK (
    (notice_binding = 'bound' AND num_nulls(notice_template_version, notice_fingerprint) = 0)
    OR (notice_binding = 'legacy_unverified' AND num_nulls(notice_template_version, notice_fingerprint) = 2)
  );

-- Whatever binding an insert names, the row gets the one its fingerprint
-- gives; the fingerprint CHECK then refuses a half-filled row.
CREATE FUNCTION institution.notice_acknowledgment_binding_fill() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  NEW.notice_binding := CASE WHEN NEW.notice_fingerprint IS NULL THEN 'legacy_unverified' ELSE 'bound' END;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION institution.notice_acknowledgment_binding_fill() FROM PUBLIC;
CREATE TRIGGER notice_acknowledgment_binding_fill BEFORE INSERT ON institution.notice_acknowledgment
  FOR EACH ROW EXECUTE FUNCTION institution.notice_acknowledgment_binding_fill();

-- A legacy row never becomes bound, and a bound one never loses it (C2 of P02a).
CREATE TRIGGER notice_acknowledgment_binding_immutable
  BEFORE UPDATE OF notice_binding ON institution.notice_acknowledgment
  FOR EACH ROW EXECUTE FUNCTION institution.refuse_acknowledgment_change();

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
-- Only the derived column goes; every row and its fingerprint stay.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;
DROP TRIGGER notice_acknowledgment_binding_immutable ON institution.notice_acknowledgment;
DROP TRIGGER notice_acknowledgment_binding_fill ON institution.notice_acknowledgment;
DROP FUNCTION institution.notice_acknowledgment_binding_fill();
ALTER TABLE institution.notice_acknowledgment
  DROP CONSTRAINT notice_acknowledgment_binding_check,
  DROP COLUMN notice_binding;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:up
-- Issue #182 (DAN-191): the rule of part 2 counted tag characters and the
-- combining grapheme joiner as invisible, but only refused a name made of
-- them alone. Beside a visible name they passed, so "K1" and "K1" with a tag
-- character were two courses that look the same, and tag characters can carry
-- hidden text. Both move to the refused class; nothing else changes. Only
-- the tag block (U+E0000-E007F) is refused: the variation selectors after it
-- (U+E0100-E01EF) belong to ideographic variation sequences.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

CREATE OR REPLACE FUNCTION institution.is_plain_label(p_text text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT length(p_text) BETWEEN 1 AND 200
     AND p_text !~ '[\x0001-\x001F\x007F-\x009F\x00AD\x034F\x061C\x180E\x200B-\x200F\x2028-\x202E\x2060-\x206F\xFEFF\xFFF9-\xFFFB\U000E0000-\U000E007F]'
     AND p_text ~ '[^\s\x00A0\x034F\x115F\x1160\x1680\x17B4\x17B5\x180B-\x180D\x2000-\x200A\x202F\x205F\x2800\x3000\x3164\xFE00-\xFE0F\xFFA0\U000E0000-\U000E0FFF]'
$$;
-- The rule guards CHECK constraints on course names, display names and
-- assignment titles. A stored value that no longer passes would break a later
-- restore, so the migration stops instead.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM institution.course c WHERE NOT institution.is_plain_label(c.name))
     OR EXISTS (SELECT 1 FROM institution.institution_settings s WHERE NOT institution.is_plain_label(s.display_name))
     OR EXISTS (SELECT 1 FROM institution.assignment_version v WHERE NOT institution.is_plain_label(v.title)) THEN
    RAISE EXCEPTION 'a stored name does not pass the stricter is_plain_label';
  END IF;
END
$$;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- The rule of part 2 (20261010190000_institution_removal.sql).
CREATE OR REPLACE FUNCTION institution.is_plain_label(p_text text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT length(p_text) BETWEEN 1 AND 200
     AND p_text !~ '[\x0001-\x001F\x007F-\x009F\x00AD\x061C\x180E\x200B-\x200F\x2028-\x202E\x2060-\x206F\xFEFF\xFFF9-\xFFFB]'
     AND p_text ~ '[^\s\x00A0\x034F\x115F\x1160\x1680\x17B4\x17B5\x180B-\x180D\x2000-\x200A\x202F\x205F\x2800\x3000\x3164\xFE00-\xFE0F\xFFA0\U000E0000-\U000E0FFF]'
$$;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

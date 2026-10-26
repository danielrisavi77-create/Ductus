-- F-149 t. 2 (security finding, low): a row of audit.course_member_event is
-- bound to the membership it records, not only to its id. Its course, student
-- and institution must be those of that membership row, so the append-only
-- trail cannot name a course or student the membership never had. The two
-- writers (remove_student, allow_student_return) already take all three from
-- the RETURNING of the changed membership, so every existing row satisfies the
-- new key and the functions are unchanged.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
-- The unique key below creates an index in the schema; only while this
-- migration runs, revoked at the end.
GRANT CREATE ON SCHEMA institution TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- The target of the composite key. id alone is already unique; this adds no
-- new rule to institution.course_member.
ALTER TABLE institution.course_member
  ADD CONSTRAINT course_member_binding_key UNIQUE (id, course_id, user_id, institution_id);

-- The composite key replaces the key on membership_id alone, which it covers.
ALTER TABLE audit.course_member_event
  DROP CONSTRAINT course_member_event_membership_id_fkey,
  ADD CONSTRAINT course_member_event_membership_fkey
    FOREIGN KEY (membership_id, course_id, student_id, institution_id)
    REFERENCES institution.course_member (id, course_id, user_id, institution_id);

RESET ROLE;
SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA institution FROM ductus_identity;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_identity;
ALTER TABLE audit.course_member_event
  DROP CONSTRAINT course_member_event_membership_fkey,
  ADD CONSTRAINT course_member_event_membership_id_fkey
    FOREIGN KEY (membership_id) REFERENCES institution.course_member (id);
ALTER TABLE institution.course_member DROP CONSTRAINT course_member_binding_key;
RESET ROLE;

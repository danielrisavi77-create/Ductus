-- migrate:up
-- DAN-429, M11.7-P01 (contract on #1836, c.6820482621; orchestrator
-- c.6820602587, scope c.6820715294): the public status page at /stanje is a
-- page in the shell, so a problem can be reported from it. Its route template
-- joins the closed set in src/domain/support/problem-report.ts
-- (PROBLEM_REPORT_ROUTES). This migration runs after
-- 20261112150000_problem_report_access_log_route.sql (DAN-294, #1969) and
-- 20261112160000_problem_report_route_how_it_works.sql (DAN-431, #1973) and
-- carries their routes too, /rad/[assignmentId]/dnevnik-pristupa and
-- /kako-radi, so it must land after both: dbmate up --strict (D-91) refuses a
-- migration older than one already applied, so either PR landing later would
-- need a new version above this one that also carries /stanje.
-- Every existing row still holds: the CHECK is replaced by a wider one (the
-- drop is deliberate) and validated in this migration's one transaction. No
-- row is changed or removed.
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- squawk-ignore ban-drop-constraint
ALTER TABLE identity.problem_report DROP CONSTRAINT problem_report_route_check;
ALTER TABLE identity.problem_report ADD CONSTRAINT problem_report_route_check
  CHECK (route IN (
    '/', '/kako-radi', '/nastavnik', '/nastavnik/brz-put', '/nastavnik/kolegiji', '/nastavnik/mentorstva',
    '/nastavnik/rad/[id]', '/nastavnik/rad/[id]/reprodukcija', '/nastavnik/zadatak/[assignmentId]/uredi',
    '/nastavnik/zadatak/novi', '/prijava', '/rad', '/rad/[assignmentId]/dnevnik-pristupa',
    '/rad/[assignmentId]/predaja', '/rad/[assignmentId]/reprodukcija', '/stanje', '/upis',
    '/upis/kolegij/[courseId]', '/ustanova', '/ustanova/kolegiji', '/ustanova/korisnici', '/ustanova/pravila',
    '/zadaci', '/zadaci/kolegiji', '/zadaci/radovi', '/zadatak/[id]'
  )) NOT VALID;
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE identity.problem_report VALIDATE CONSTRAINT problem_report_route_check;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
-- Removes /stanje only and leaves the set 20261112160000 sets (with the access
-- log route and /kako-radi). Refused while a report names /stanje; nothing is
-- deleted to make room.
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- squawk-ignore ban-drop-constraint
ALTER TABLE identity.problem_report DROP CONSTRAINT problem_report_route_check;
ALTER TABLE identity.problem_report ADD CONSTRAINT problem_report_route_check
  CHECK (route IN (
    '/', '/kako-radi', '/nastavnik', '/nastavnik/brz-put', '/nastavnik/kolegiji', '/nastavnik/mentorstva',
    '/nastavnik/rad/[id]', '/nastavnik/rad/[id]/reprodukcija', '/nastavnik/zadatak/[assignmentId]/uredi',
    '/nastavnik/zadatak/novi', '/prijava', '/rad', '/rad/[assignmentId]/dnevnik-pristupa',
    '/rad/[assignmentId]/predaja', '/rad/[assignmentId]/reprodukcija', '/upis',
    '/upis/kolegij/[courseId]', '/ustanova', '/ustanova/kolegiji', '/ustanova/korisnici', '/ustanova/pravila',
    '/zadaci', '/zadaci/kolegiji', '/zadaci/radovi', '/zadatak/[id]'
  )) NOT VALID;
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE identity.problem_report VALIDATE CONSTRAINT problem_report_route_check;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

-- migrate:up
-- DAN-386, M2.10-P02d (contract on #1836, c.6858305983): the page for one
-- work's language, /nastavnik/zadatak/[assignmentId]/rad/[documentId]/jezik,
-- is a page in the shell, so a problem can be reported from it. Its route
-- template joins the closed set in src/domain/support/problem-report.ts
-- (PROBLEM_REPORT_ROUTES). This migration runs after
-- 20261112190000_problem_report_route_status.sql (DAN-429), which added
-- /stanje and carries /kako-radi and the access log route; it keeps that set
-- and adds the new template only.
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
    '/nastavnik/rad/[id]', '/nastavnik/rad/[id]/reprodukcija',
    '/nastavnik/zadatak/[assignmentId]/rad/[documentId]/jezik', '/nastavnik/zadatak/[assignmentId]/uredi',
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
-- Removes the work language template only and leaves the set 20261112190000
-- sets (with /stanje). Refused while a report names that template; nothing is
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
    '/rad/[assignmentId]/predaja', '/rad/[assignmentId]/reprodukcija', '/stanje', '/upis',
    '/upis/kolegij/[courseId]', '/ustanova', '/ustanova/kolegiji', '/ustanova/korisnici', '/ustanova/pravila',
    '/zadaci', '/zadaci/kolegiji', '/zadaci/radovi', '/zadatak/[id]'
  )) NOT VALID;
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE identity.problem_report VALIDATE CONSTRAINT problem_report_route_check;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

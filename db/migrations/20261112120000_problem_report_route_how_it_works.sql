-- migrate:up
-- DAN-431, J-02 (contract on #1836, c.6818525525; orchestrator c.6818853971):
-- the page "Kako Ductura radi" at /kako-radi is a page in the shell, so a
-- problem can be reported from it. Its route template joins the closed set in
-- src/domain/support/problem-report.ts (PROBLEM_REPORT_ROUTES). Every existing
-- row still holds: the CHECK is replaced by a wider one (the drop is
-- deliberate) and validated in this migration's one transaction. No row is
-- changed or removed.
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- squawk-ignore ban-drop-constraint
ALTER TABLE identity.problem_report DROP CONSTRAINT problem_report_route_check;
ALTER TABLE identity.problem_report ADD CONSTRAINT problem_report_route_check
  CHECK (route IN (
    '/', '/kako-radi', '/nastavnik', '/nastavnik/brz-put', '/nastavnik/kolegiji', '/nastavnik/mentorstva',
    '/nastavnik/rad/[id]', '/nastavnik/rad/[id]/reprodukcija', '/nastavnik/zadatak/[assignmentId]/uredi',
    '/nastavnik/zadatak/novi', '/prijava', '/rad', '/rad/[assignmentId]/predaja',
    '/rad/[assignmentId]/reprodukcija', '/upis', '/upis/kolegij/[courseId]',
    '/ustanova', '/ustanova/kolegiji', '/ustanova/korisnici', '/ustanova/pravila',
    '/zadaci', '/zadaci/kolegiji', '/zadaci/radovi', '/zadatak/[id]'
  )) NOT VALID;
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE identity.problem_report VALIDATE CONSTRAINT problem_report_route_check;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
-- Refused while a report names /kako-radi; nothing is deleted to make room.
GRANT CREATE ON SCHEMA identity TO ductus_identity;
SET LOCAL ROLE ductus_identity;

-- squawk-ignore ban-drop-constraint
ALTER TABLE identity.problem_report DROP CONSTRAINT problem_report_route_check;
ALTER TABLE identity.problem_report ADD CONSTRAINT problem_report_route_check
  CHECK (route IN (
    '/', '/nastavnik', '/nastavnik/brz-put', '/nastavnik/kolegiji', '/nastavnik/mentorstva',
    '/nastavnik/rad/[id]', '/nastavnik/rad/[id]/reprodukcija', '/nastavnik/zadatak/[assignmentId]/uredi',
    '/nastavnik/zadatak/novi', '/prijava', '/rad', '/rad/[assignmentId]/predaja',
    '/rad/[assignmentId]/reprodukcija', '/upis', '/upis/kolegij/[courseId]',
    '/ustanova', '/ustanova/kolegiji', '/ustanova/korisnici', '/ustanova/pravila',
    '/zadaci', '/zadaci/kolegiji', '/zadaci/radovi', '/zadatak/[id]'
  )) NOT VALID;
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE identity.problem_report VALIDATE CONSTRAINT problem_report_route_check;

SET LOCAL ROLE ductus_migrator;
REVOKE CREATE ON SCHEMA identity FROM ductus_identity;

-- DAN-294 (S-42, contract on #1836, c.6814737263): the student's own access
-- log is a new app page, /rad/[assignmentId]/dnevnik-pristupa, so a problem
-- report may name it as its route (DAN-431: every app page has a route
-- template, and the CHECK and PROBLEM_REPORT_ROUTES are one closed set).
-- Migrations are append-only, so the CHECK is replaced here, not in
-- 20261112110000_problem_report.sql. Every existing row still holds: the
-- drop is deliberate and the wider CHECK is validated in this transaction.
-- Nothing else of the table changes.
-- migrate:up

SET LOCAL ROLE ductus_identity;

-- squawk-ignore ban-drop-constraint
ALTER TABLE identity.problem_report DROP CONSTRAINT problem_report_route_check;
ALTER TABLE identity.problem_report ADD CONSTRAINT problem_report_route_check CHECK (route IN (
    '/', '/nastavnik', '/nastavnik/brz-put', '/nastavnik/kolegiji', '/nastavnik/mentorstva',
    '/nastavnik/rad/[id]', '/nastavnik/rad/[id]/reprodukcija', '/nastavnik/zadatak/[assignmentId]/uredi',
    '/nastavnik/zadatak/novi', '/prijava', '/rad', '/rad/[assignmentId]/dnevnik-pristupa',
    '/rad/[assignmentId]/predaja', '/rad/[assignmentId]/reprodukcija', '/upis', '/upis/kolegij/[courseId]',
    '/ustanova', '/ustanova/kolegiji', '/ustanova/korisnici', '/ustanova/pravila',
    '/zadaci', '/zadaci/kolegiji', '/zadaci/radovi', '/zadatak/[id]'
  )) NOT VALID;
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE identity.problem_report VALIDATE CONSTRAINT problem_report_route_check;

SET LOCAL ROLE ductus_migrator;

-- migrate:down
-- Local only: staging and production migrate forward (docs/BACKEND.md 6).
SET LOCAL ROLE ductus_identity;

-- squawk-ignore ban-drop-constraint
ALTER TABLE identity.problem_report DROP CONSTRAINT problem_report_route_check;
ALTER TABLE identity.problem_report ADD CONSTRAINT problem_report_route_check CHECK (route IN (
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

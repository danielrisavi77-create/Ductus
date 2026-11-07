import { closedSessionKind } from "@/components/auth/access-kind";
import type { SessionPrincipal } from "@/server/auth/principal";
import type { InstitutionOverviewRead } from "@/server/institution/institution-overview";
import type { FacultyRulesRead } from "@/server/institution/faculty-rules";
import type { TeacherRolesRead } from "@/server/institution/teacher-roles";

import type { CoursesPage } from "./institution-courses-view";

export type InstitutionScreen = "allowed" | "unavailable" | "notFound" | "expired" | "signedOut";

/**
 * DAN-313 (A-01): the screen of /ustanova from the overview's read (null
 * without a cookie) and the same request's principal. A person the database
 * refused (ZD403) gets "notFound", the same answer as a route that does not
 * exist, so the page never tells that an overview is there. The two reads run
 * in parallel and a session never reopens, so a read that succeeded or was
 * refused beside a closed principal means the session closed between them:
 * the page shows Z-03, never the counts and never a 404 (#1316
 * c.6584772547). A principal that could not be read is "unavailable", as in
 * `teacherPageAccess`. DAN-581 (A-02): /ustanova/korisnici takes the same
 * screen from the teacher roles' read, whose kinds are the same, and so does
 * /ustanova/pravila (DAN-590, A-04) from the faculty rules' read, and
 * /ustanova/kolegiji (DAN-591, A-03) from its two reads joined by `coursesPage`.
 */
export function institutionScreen(
  read: InstitutionOverviewRead["kind"] | TeacherRolesRead["kind"] | FacultyRulesRead["kind"] | CoursesPage["kind"] | null,
  principal: SessionPrincipal["kind"], token: string | undefined,
): InstitutionScreen {
  if (read === null || read === "unauthorized") return closedSessionKind(token);
  if (read === "unavailable") return read;
  if (principal === "signed-in") return read === "ok" ? "allowed" : "notFound";
  return principal === "unverified" ? "unavailable" : closedSessionKind(token);
}

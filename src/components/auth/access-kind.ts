import type { TeacherAccess } from "@/components/teacher/teacher-access";
import type { SessionPrincipal } from "@/server/auth/principal";
import type { TeacherCoursesRead } from "@/server/institution/teacher-courses";

/** Which access screen a page shows instead of its content (DAN-378, Z-03 and Z-05). */
export type AccessKind = "expired" | "signedOut" | "denied";

const SESSION_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * A page the database refused for want of a session: "expired" (Z-03) when
 * the browser still carries a cookie of the session's shape, so there was a
 * session that is now closed; "signedOut" when there is none, so the page
 * never says "istekla" to someone who never signed in (#1234). A revoked
 * session reads as expired too.
 */
export function closedSessionKind(token: string | undefined): "expired" | "signedOut" {
  return token !== undefined && SESSION_SHAPE.test(token) ? "expired" : "signedOut";
}

/**
 * The screen of a teacher page from `teacherAccess` and the same request's
 * principal. `teacherAccess` answers "denied" both for a closed session and
 * for a signed-in person without the teacher role; the principal tells them
 * apart, so only a signed-in person reads Z-05 and is never offered a new
 * sign-in (#1233). A principal that could not be read is "unavailable", as
 * a failed role read is.
 */
export function teacherPageAccess(
  access: TeacherAccess, principal: SessionPrincipal["kind"], token: string | undefined,
): "allowed" | "unavailable" | AccessKind {
  if (access === "allowed" || access === "unavailable") return access;
  if (access === "signedOut") return closedSessionKind(token);
  if (principal === "signed-in") return "denied";
  return principal === "unverified" ? "unavailable" : closedSessionKind(token);
}

/**
 * The course list's read as a teacher access: no read (no cookie) and a
 * refused session as signed out, a person the database refused the list
 * (ZD403) as denied, for `teacherPageAccess` to tell apart.
 */
export function coursesAccess(read: TeacherCoursesRead["kind"] | null): TeacherAccess {
  if (read === null || read === "unauthorized") return "signedOut";
  if (read === "not_found") return "denied";
  return read === "ok" ? "allowed" : "unavailable";
}

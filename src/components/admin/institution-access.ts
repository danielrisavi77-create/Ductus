import { closedSessionKind } from "@/components/auth/access-kind";
import type { SessionPrincipal } from "@/server/auth/principal";
import type { InstitutionOverviewRead } from "@/server/institution/institution-overview";

export type InstitutionScreen = "allowed" | "unavailable" | "notFound" | "expired" | "signedOut";

/**
 * DAN-313 (A-01): the screen of /ustanova from the overview's read (null
 * without a cookie) and the same request's principal. A person the database
 * refused (ZD403) gets "notFound", the same answer as a route that does not
 * exist, so the page never tells that an overview is there. A read that
 * succeeded beside a closed principal means the session closed between the
 * two reads, and the page shows Z-03, never the counts.
 */
export function institutionScreen(
  read: InstitutionOverviewRead["kind"] | null, principal: SessionPrincipal["kind"], token: string | undefined,
): InstitutionScreen {
  if (read === null || read === "unauthorized") return closedSessionKind(token);
  if (read === "notFound" || read === "unavailable") return read;
  if (principal === "signed-in") return "allowed";
  return principal === "unverified" ? "unavailable" : closedSessionKind(token);
}

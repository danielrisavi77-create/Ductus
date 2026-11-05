import { principalScope, type SessionPrincipal } from "@/server/auth/principal";
import type { WithActor } from "@/server/db/with-actor";

// B-7 decides teacher authority from a confirmed and unrevoked institution
// role, never from OIDC affiliation or client-supplied identity.
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type TeacherAccess = "allowed" | "signedOut" | "denied" | "unavailable";

export async function teacherAccess(token: string | undefined, withActor: WithActor): Promise<TeacherAccess> {
  if (!token || !TOKEN.test(token)) return "signedOut";
  try {
    return await withActor(token, async (tx) => {
      const { rows } = await tx.query<{ allowed: boolean }>(
        "SELECT institution.actor_has_role('teacher') AS allowed",
      );
      return rows[0]?.allowed === true ? "allowed" : "denied";
    });
  } catch {
    // Never show a privileged form on DB or access-control failures.
    return "unavailable";
  }
}

/** A teacher page's access and its principal, from one snapshot. */
export type TeacherPageRead = { access: TeacherAccess; principal: SessionPrincipal };

/**
 * `teacherAccess` and `sessionPrincipal` in one statement (DAN-378 round 1,
 * #1242 c.6562992740 and c.6563056077). Both `app.current_actor()` and
 * `institution.actor_has_role` are STABLE, so the session and the role are
 * read from the same snapshot: a session closed in another tab can never
 * read as open for one and closed for the other. "denied" therefore always
 * means an open session without the role (Z-05), and "signedOut" a closed
 * one (Z-03); "allowed" only comes with a signed-in principal.
 */
export async function teacherPageRead(token: string | undefined, withActor: WithActor): Promise<TeacherPageRead> {
  if (!token || !TOKEN.test(token)) return { access: "signedOut", principal: { kind: "signed-out" } };
  let row: { user_id: string | null; institution_id: string | null; allowed: boolean | null } | undefined;
  try {
    row = await withActor(token, async (tx) => {
      const { rows } = await tx.query<{ user_id: string | null; institution_id: string | null; allowed: boolean | null }>(
        `SELECT a.user_id, a.institution_id, institution.actor_has_role('teacher') AS allowed
           FROM app.current_actor() a`,
      );
      return rows[0];
    });
  } catch (error) {
    // Only the error's name: never the token, a statement or a message.
    console.error("teacher page read failed", error instanceof Error ? error.name : "unknown");
    return { access: "unavailable", principal: { kind: "unverified" } };
  }
  if (!row?.user_id || !row.institution_id) return { access: "signedOut", principal: { kind: "signed-out" } };
  const principal = { kind: "signed-in", scope: principalScope(row.user_id, row.institution_id) } as const;
  return { access: row.allowed === true ? "allowed" : "denied", principal };
}

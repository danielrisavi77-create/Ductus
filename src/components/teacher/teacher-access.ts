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

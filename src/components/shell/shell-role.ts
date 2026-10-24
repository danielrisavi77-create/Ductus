import type { WithActor } from "@/server/db/with-actor";

import type { ShellRole } from "./nav";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The role the shell shows (#476 6314969336, I3), read under the session like
 * every other page read: a confirmed teacher role at the institution makes a
 * teacher (B-7, the same check as teacherAccess); any other open session is a
 * student, since a student's part lives in course membership, not in an
 * institution role. No cookie, a closed session or a failed read shows no
 * role, so the shell lists nothing rather than guess.
 */
export async function readShellRole(token: string | undefined, withActor: WithActor): Promise<ShellRole | null> {
  if (token === undefined || !TOKEN.test(token)) return null;
  try {
    const row = await withActor(token, async (tx) => {
      const { rows } = await tx.query<{ signed_in: boolean; teacher: boolean }>(
        `SELECT a.user_id IS NOT NULL AND a.institution_id IS NOT NULL AS signed_in,
                institution.actor_has_role('teacher') AS teacher
           FROM app.current_actor() a`,
      );
      return rows[0];
    });
    if (row?.signed_in !== true) return null;
    return row.teacher === true ? "teacher" : "student";
  } catch (error) {
    console.error("shell role read failed", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

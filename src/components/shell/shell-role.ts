import { principalScope } from "@/server/auth/principal";
import type { WithActor } from "@/server/db/with-actor";

import type { ShellRole } from "./nav";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The scope is the digest `/rad` already hands the browser; no secret (D-118). */
export type ShellAccount = { role: ShellRole | null; scope: string | null };

const NO_ONE: ShellAccount = { role: null, scope: null };

/**
 * The role the shell shows (#476 6314969336, I3), read under the session like
 * every other page read: a confirmed teacher role at the institution makes a
 * teacher (B-7, the same check as teacherAccess); any other open session is a
 * student, since a student's part lives in course membership, not in an
 * institution role. No cookie, a closed session or a failed read shows no
 * role, so the shell lists nothing rather than guess. The scope comes from
 * the same read.
 */
export async function readShellAccount(token: string | undefined, withActor: WithActor): Promise<ShellAccount> {
  return (await readShellAccountOrFailure(token, withActor)) ?? NO_ONE;
}

/**
 * `readShellAccount`, except that a failed read is `null` rather than no
 * one, so a caller can tell a closed session from a database it could not
 * reach.
 */
export async function readShellAccountOrFailure(
  token: string | undefined, withActor: WithActor,
): Promise<ShellAccount | null> {
  if (token === undefined || !TOKEN.test(token)) return NO_ONE;
  try {
    const row = await withActor(token, async (tx) => {
      const { rows } = await tx.query<{
        signed_in: boolean; teacher: boolean; user_id?: string | null; institution_id?: string | null;
      }>(
        `SELECT a.user_id IS NOT NULL AND a.institution_id IS NOT NULL AS signed_in,
                institution.actor_has_role('teacher') AS teacher,
                a.user_id, a.institution_id
           FROM app.current_actor() a`,
      );
      return rows[0];
    });
    if (row?.signed_in !== true) return NO_ONE;
    const scope = row.user_id && row.institution_id ? principalScope(row.user_id, row.institution_id) : null;
    return { role: row.teacher === true ? "teacher" : "student", scope };
  } catch (error) {
    console.error("shell role read failed", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

/** Only the role of `readShellAccount`. */
export async function readShellRole(token: string | undefined, withActor: WithActor): Promise<ShellRole | null> {
  return (await readShellAccount(token, withActor)).role;
}

/**
 * Where "/" sends a signed-in person (DAN-325): a confirmed teacher to the
 * teacher's page, any other open session to the workspace, and no one when
 * the session is closed or could not be read. `closed` tells those two
 * apart (#1231): the database answered and there is no open session behind
 * the cookie, so "/" can say so (Z-03) rather than guess. One read gives
 * the way on and the shell's scope (F-151): the role is the same B-7 check
 * `list_teacher_courses` makes, so nothing is guessed from the cookie.
 */
export async function readHome(
  token: string | undefined, withActor: WithActor,
): Promise<{ path: "/rad" | "/nastavnik" | null; scope: string | null; closed: boolean }> {
  const account = await readShellAccountOrFailure(token, withActor);
  const { role, scope } = account ?? NO_ONE;
  const path = role === "teacher" ? "/nastavnik" : role === "student" ? "/rad" : null;
  return { path, scope, closed: account !== null && role === null };
}

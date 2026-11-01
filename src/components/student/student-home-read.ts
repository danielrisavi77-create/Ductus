import { readShellAccountOrFailure, type ShellAccount } from "@/components/shell/shell-role";
import type { WithActor } from "@/server/db/with-actor";

import { readMyAssignments, type MyAssignmentsRead } from "./my-assignments-read";

export type StudentHomeRead = { read: MyAssignmentsRead; account: ShellAccount };

const NO_ONE: ShellAccount = { role: null, scope: null };

/**
 * The reads of /zadaci and /zadaci/kolegiji (DAN-344, F-171): the shell
 * account is read first, and the courses and assignments only when that read
 * finds an open session. A closed session reads as signed out and a failed
 * read as unavailable, as `readMyAssignments` would answer them.
 */
export async function readStudentHome(token: string | undefined, withActor: WithActor): Promise<StudentHomeRead> {
  const account = await readShellAccountOrFailure(token, withActor);
  if (account === null) return { read: { kind: "unavailable" }, account: NO_ONE };
  if (account.role === null) return { read: { kind: "signedOut" }, account };
  return { read: await readMyAssignments(token, withActor), account };
}

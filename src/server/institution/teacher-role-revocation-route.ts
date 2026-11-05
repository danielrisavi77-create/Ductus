import type { WithActor } from "@/server/db/with-actor";
import { readEmptyMutation, respond, rpcErrorResponse } from "./mutation-route";

export const MAX_TEACHER_ROLE_REVOCATION_BODY_BYTES = 64;

export interface TeacherRoleRevocationDeps {
  withActor: WithActor;
  expectedOrigin: string;
  sessionToken?: string;
}

// An administrator of the institution ends one person's confirmed teacher
// role. The body carries nothing; the person comes only from the path, the
// caller and the institution only from the session. The existing SECURITY
// DEFINER RPC decides who may (ZD403 for anyone who is not an administrator)
// and answers false when that person holds no active confirmed teacher role
// in the caller's institution, so a person of another institution looks the
// same as one who does not exist.
export async function handleTeacherRoleRevocationRequest(
  request: Request, teacherId: unknown, deps: TeacherRoleRevocationDeps,
): Promise<Response> {
  const input = await readEmptyMutation(request, [teacherId], deps, MAX_TEACHER_ROLE_REVOCATION_BODY_BYTES);
  if (!input.ok) return input.response;
  try {
    const revoked = await deps.withActor(input.sessionToken, async (tx) => {
      const result = await tx.query<{ revoked: unknown }>(
        "SELECT institution.revoke_teacher_role($1) AS revoked", [teacherId],
      );
      const outcome = result.rows[0]?.revoked;
      if (result.rows.length !== 1 || typeof outcome !== "boolean") {
        throw new Error("invalid teacher role revocation result");
      }
      return outcome;
    });
    return respond(200, { revoked });
  } catch (error) {
    return rpcErrorResponse(error);
  }
}

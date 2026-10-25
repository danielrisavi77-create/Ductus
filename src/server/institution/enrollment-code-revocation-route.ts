import type { WithActor } from "@/server/db/with-actor";
import { readEmptyMutation, respond, rpcErrorResponse } from "./mutation-route";

export const MAX_REVOCATION_BODY_BYTES = 64;

export interface EnrollmentCodeRevocationDeps {
  withActor: WithActor;
  expectedOrigin: string;
  sessionToken?: string;
}

// The body carries nothing and must be exactly {}; the JSON content type makes
// a cross-origin caller send a preflight first. The session is the only
// principal: who may revoke, and for which course, is decided by the existing
// SECURITY DEFINER RPC, which answers ZD403 for a course of another
// institution exactly as for one that does not exist.
export async function handleEnrollmentCodeRevocationRequest(
  request: Request, courseId: unknown, deps: EnrollmentCodeRevocationDeps,
): Promise<Response> {
  const input = await readEmptyMutation(request, [courseId], deps, MAX_REVOCATION_BODY_BYTES);
  if (!input.ok) return input.response;
  try {
    const revoked = await deps.withActor(input.sessionToken, async (tx) => {
      const result = await tx.query<{ revoked: unknown }>(
        "SELECT institution.revoke_enrollment_code($1) AS revoked", [courseId],
      );
      const outcome = result.rows[0]?.revoked;
      if (result.rows.length !== 1 || typeof outcome !== "boolean") {
        throw new Error("invalid enrollment code revocation result");
      }
      return outcome;
    });
    return respond(200, { revoked });
  } catch (error) {
    return rpcErrorResponse(error);
  }
}

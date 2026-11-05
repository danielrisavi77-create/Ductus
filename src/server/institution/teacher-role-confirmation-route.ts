import type { WithActor } from "@/server/db/with-actor";
import { readEmptyMutation, respond, rpcErrorResponse } from "./mutation-route";

export const MAX_TEACHER_ROLE_CONFIRMATION_BODY_BYTES = 64;

export interface TeacherRoleConfirmationDeps {
  withActor: WithActor;
  expectedOrigin: string;
  sessionToken?: string;
}

/** The SQLSTATE of a database error, or undefined. */
function codeOf(error: unknown): unknown {
  return error && typeof error === "object" && "code" in error ? error.code : undefined;
}

// An administrator of the institution confirms one candidate as a teacher
// (DAN-476, M2.2). The body carries nothing; the candidate comes only from
// the path, the caller and the institution only from the session. The
// existing SECURITY DEFINER RPC decides: it refuses with ZD403 a caller who
// is not an administrator, the administrator themself, a person of another
// institution, one who does not exist and one whose last login gave no
// right (D-171). The route reads first, in the same transaction, whether
// the caller is a signed-in administrator. Only then does a ZD403 of the RPC
// mean "no such candidate here", and every such reason gets the same 404,
// so the answer never tells another institution's person apart.
export async function handleTeacherRoleConfirmationRequest(
  request: Request, candidateId: unknown, deps: TeacherRoleConfirmationDeps,
): Promise<Response> {
  const input = await readEmptyMutation(request, [candidateId], deps, MAX_TEACHER_ROLE_CONFIRMATION_BODY_BYTES);
  if (!input.ok) return input.response;
  let administrator = false;
  try {
    const outcome = await deps.withActor(input.sessionToken, async (tx) => {
      // The session and the role from one snapshot, as teacherPageRead.
      const caller = await tx.query<{ user_id: unknown; admin: unknown }>(
        "SELECT a.user_id, institution.actor_has_role('admin') AS admin FROM app.current_actor() a",
      );
      const row = caller.rows[0];
      if (caller.rows.length > 1) throw new Error("invalid actor result");
      if (row?.user_id === null || row?.user_id === undefined) return "unauthorized" as const;
      if (typeof row.admin !== "boolean") throw new Error("invalid actor result");
      if (!row.admin) return "forbidden" as const;
      administrator = true;
      const result = await tx.query("SELECT institution.confirm_teacher_role($1)", [candidateId]);
      if (result.rows.length !== 1) throw new Error("invalid teacher role confirmation result");
      return "confirmed" as const;
    });
    if (outcome === "unauthorized") return respond(401, { error: "unauthorized" });
    if (outcome === "forbidden") return respond(403, { error: "forbidden" });
    return respond(200, { confirmed: true });
  } catch (error) {
    if (administrator && codeOf(error) === "ZD403") return respond(404, { error: "not_found" });
    return rpcErrorResponse(error);
  }
}

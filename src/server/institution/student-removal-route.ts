import type { WithActor } from "@/server/db/with-actor";
import { readEmptyMutation, respond, rpcErrorResponse } from "./mutation-route";

export const MAX_STUDENT_REMOVAL_BODY_BYTES = 64;

export interface StudentRemovalDeps {
  withActor: WithActor;
  expectedOrigin: string;
  sessionToken?: string;
}

// A teacher of the course ends one student's membership. The body carries
// nothing; the course and the student come only from the path, the caller
// only from the session. The existing SECURITY DEFINER RPC decides who may
// (ZD403 for a course of another institution exactly as for a missing one)
// and answers false when that user holds no open student membership there.
export async function handleStudentRemovalRequest(
  request: Request, courseId: unknown, studentId: unknown, deps: StudentRemovalDeps,
): Promise<Response> {
  const input = await readEmptyMutation(request, [courseId, studentId], deps, MAX_STUDENT_REMOVAL_BODY_BYTES);
  if (!input.ok) return input.response;
  try {
    const removed = await deps.withActor(input.sessionToken, async (tx) => {
      const result = await tx.query<{ removed: unknown }>(
        "SELECT institution.remove_student($1, $2) AS removed", [courseId, studentId],
      );
      const outcome = result.rows[0]?.removed;
      if (result.rows.length !== 1 || typeof outcome !== "boolean") {
        throw new Error("invalid student removal result");
      }
      return outcome;
    });
    return respond(200, { removed });
  } catch (error) {
    return rpcErrorResponse(error);
  }
}

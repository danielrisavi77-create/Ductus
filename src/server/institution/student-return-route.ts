import type { WithActor } from "@/server/db/with-actor";
import { readEmptyMutation, respond, rpcErrorResponse } from "./mutation-route";

export const MAX_STUDENT_RETURN_BODY_BYTES = 64;

export interface StudentReturnDeps {
  withActor: WithActor;
  expectedOrigin: string;
  sessionToken?: string;
}

// A teacher of the course lets one removed student enrol again; the student
// still needs a valid code, nothing here enrols anyone. The body carries
// nothing; the course and the student come only from the path, the caller
// only from the session. The existing SECURITY DEFINER RPC decides who may
// (ZD403 for a course of another institution exactly as for a missing one)
// and answers false when nothing was blocking that student there.
export async function handleStudentReturnRequest(
  request: Request, courseId: unknown, studentId: unknown, deps: StudentReturnDeps,
): Promise<Response> {
  const input = await readEmptyMutation(request, [courseId, studentId], deps, MAX_STUDENT_RETURN_BODY_BYTES);
  if (!input.ok) return input.response;
  try {
    const allowed = await deps.withActor(input.sessionToken, async (tx) => {
      const result = await tx.query<{ allowed: unknown }>(
        "SELECT institution.allow_student_return($1, $2) AS allowed", [courseId, studentId],
      );
      const outcome = result.rows[0]?.allowed;
      if (result.rows.length !== 1 || typeof outcome !== "boolean") {
        throw new Error("invalid student return result");
      }
      return outcome;
    });
    return respond(200, { allowed });
  } catch (error) {
    return rpcErrorResponse(error);
  }
}

import type { WithActor } from "@/server/db/with-actor";
import { parseAssignmentInput, type AssignmentInput } from "./create-assignment";
import { readJsonMutation, respond, rpcErrorResponse } from "./mutation-route";

export const MAX_ASSIGNMENT_VERSION_BODY_BYTES = 90_000;
const MAX_VERSION = 2_147_483_647;
const PUBLISH = `SELECT institution.publish_assignment_version(
  $1::uuid, $2::integer, $3::text, $4::text, $5::text, $6::timestamptz, $7::timestamptz,
  $8::text, $9::text[], $10::text, $11::boolean, $12::integer, $13::integer
) AS version_no`;

export interface AssignmentVersionDeps {
  withActor: WithActor;
  expectedOrigin: string;
  sessionToken?: string;
}

const isVersion = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= MAX_VERSION;

/** `expectedVersion` and exactly the content of a version, with both word bounds named. */
function parseBody(value: unknown): { expectedVersion: number; content: AssignmentInput } | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, "expectedVersion")) return null;
  const { expectedVersion, ...fields } = value as Record<string, unknown>;
  if (!isVersion(expectedVersion)) return null;
  const content = parseAssignmentInput(fields, true);
  return content && { expectedVersion, content };
}

// A teacher of the assignment publishes its next version (DAN-292, plan B7).
// The assignment comes only from the path, the caller only from the session.
// The existing SECURITY DEFINER RPC decides who may (ZD403 alike for another
// teacher's, another institution's or a missing assignment), refuses a
// tightening (ZD422, PRODUCT rule 14) and, under a row lock, a stale
// expectedVersion (ZD409): of two requests with the same one, one writes.
export async function handleAssignmentVersionRequest(
  request: Request, assignmentId: unknown, deps: AssignmentVersionDeps,
): Promise<Response> {
  const input = await readJsonMutation(request, [assignmentId], deps, MAX_ASSIGNMENT_VERSION_BODY_BYTES);
  if (!input.ok) return input.response;
  const body = parseBody(input.value);
  if (!body) return respond(422, { error: "invalid_input" });
  const { expectedVersion, content: c } = body;
  try {
    const versionNo = await deps.withActor(input.sessionToken, async (tx) => {
      const result = await tx.query<{ version_no: unknown }>(PUBLISH, [
        assignmentId, expectedVersion, c.title, c.instructions, c.workType, c.opensAt, c.dueAt,
        c.aiPolicy, c.aiPurposes, c.evidenceProfile, c.importAllowed, c.wordMin, c.wordMax,
      ]);
      const next = result.rows[0]?.version_no;
      if (result.rows.length !== 1 || next !== expectedVersion + 1 || !isVersion(next)) {
        throw new Error("invalid assignment version result");
      }
      return next;
    });
    return respond(201, { assignmentId: (assignmentId as string).toLowerCase(), versionNo });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ZD409") {
      return respond(409, { error: "version_conflict" });
    }
    return rpcErrorResponse(error, true);
  }
}

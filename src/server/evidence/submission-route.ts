import { consoleLog, parseClosedObject, readGuardedBody, reply, unavailable, type Log } from "./ingest-http";
import { submitWork, type SubmissionDependencies, type SubmissionOutcome } from "./submission";

/**
 * B-12 step 4b2: `POST /api/submission`. The guards of the evidence routes
 * (method, `Origin` and `Sec-Fetch-Site`, protocol, media type, cookie) come
 * before the body, which is a closed set of two keys under a small byte and
 * time limit: no time, document or hash from the client (plan items A1, B2).
 * The log carries the outcome and codes only, never ids, text or the hash.
 */

export type SubmissionRouteDeps = SubmissionDependencies & {
  expectedOrigin: string | null;
  sessionToken?: string;
  log?: Log;
};

/** The closed mapping onto the wire; a status not named here is never a success. */
export function submissionResponse(outcome: SubmissionOutcome): Response {
  switch (outcome.status) {
    case "submitted":
      return reply(200, { status: "submitted", receipt: outcome.receipt });
    case "blocked":
      return reply(409, { status: "blocked", reason: outcome.reason });
    case "stale_revision":
      return reply(409, { status: "stale_revision", currentRevision: outcome.currentRevision });
    case "already_requested":
      return reply(409, { status: "already_requested", revision: outcome.revision });
    case "not_acknowledged":
    case "not_open":
      return reply(409, { status: outcome.status });
    case "not_found":
      return reply(404, { status: "not_found" });
    case "unauthenticated":
      return reply(401, { status: "unauthenticated" });
    case "invalid":
      return reply(422, { status: "invalid" });
    case "unavailable":
      return unavailable(outcome.stage);
    default:
      return unavailable("submission");
  }
}

export async function handleSubmissionRequest(request: Request, deps: SubmissionRouteDeps): Promise<Response> {
  const log = deps.log ?? consoleLog;
  const read = await readGuardedBody(request, deps.expectedOrigin, deps.sessionToken, { maxBytes: 1024, timeoutMs: 5_000 });
  if (!read.ok) return read.response;
  const body = parseClosedObject(read.bytes, ["documentId", "revision"]);
  const documentId = body?.documentId;
  const revision = body?.revision;
  if (
    typeof documentId !== "string" ||
    documentId === "" ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    // Revision 0 is a work with nothing saved: the database answers `no_evidence`.
    revision < 0
  ) {
    return reply(422, { status: "invalid" });
  }

  const outcome = await submitWork(deps, read.token, { documentId, revision });
  // A blocked submission is an incident without content: the reason code only (D2, G2).
  if (outcome.status === "unavailable") log("submission", outcome.status, outcome.stage, outcome.code);
  else if (outcome.status === "blocked") log("submission", outcome.status, outcome.reason);
  else if (outcome.status !== "submitted") log("submission", outcome.status);
  return submissionResponse(outcome);
}

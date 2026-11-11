import { parseProblemReport } from "@/domain/support/problem-report";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import type { WithActor } from "@/server/db/with-actor";
import { checkMutationRequest, readBodyWithLimit } from "@/server/http/mutation-request";

/**
 * DAN-431 (M11.10-P01) HTTP boundary for "Prijavi problem" (contract on #1836,
 * c.6788234570). The body is the report's closed classes and nothing else:
 * src/domain/support/problem-report.ts refuses every key and value outside
 * them, so the text of a work, a paragraph, a title or a journal entry has no
 * key to travel in. Identity and institution come from the session inside
 * identity.submit_problem_report(), never from the body.
 *
 * The answer is the reference alone. A log line carries one closed code,
 * never the description or any context value.
 */

// 1000 code points are at most 4000 UTF-8 bytes, an escape at most doubles
// an ASCII one, and the context keys add under 300: 8 KiB holds every
// report the classes allow and nothing much larger.
export const MAX_PROBLEM_REPORT_BODY_BYTES = 8 * 1024;
const BODY_TIMEOUT_MS = 5_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const REFERENCE = /^PR-[0-9A-F]{10}$/;

// Spelled out in full: the RPC/HTTP inventory looks for "identity.submit_problem_report(".
const SUBMIT_SQL =
  "SELECT identity.submit_problem_report($1, $2, $3, $4, $5, $6::integer, $7) AS reference";

export interface ProblemReportDeps {
  withActor: WithActor;
  expectedOrigin: string;
  sessionToken?: string;
}

function respond(status: number, payload: Record<string, unknown> = { error: "unavailable" }): Response {
  return Response.json(payload, { status, headers: { "cache-control": "no-store" } });
}

/** The exact JCS bytes of the value: a duplicate key or a second spelling is refused. */
function canonical(text: string, value: unknown): boolean {
  try {
    return canonicalizeJcs(value) === text;
  } catch {
    return false;
  }
}

export async function handleProblemReport(request: Request, deps: ProblemReportDeps): Promise<Response> {
  let allowed;
  try {
    allowed = checkMutationRequest(request, deps.expectedOrigin);
  } catch {
    return respond(503);
  }
  if (!allowed.ok) return respond(allowed.status, { error: allowed.reason });
  const token = deps.sessionToken;
  if (token === undefined || !TOKEN.test(token)) return respond(401, { error: "unauthorized" });
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return respond(415, { error: "unsupported_media_type" });
  }

  const raw = await readBodyWithLimit(request, MAX_PROBLEM_REPORT_BODY_BYTES, BODY_TIMEOUT_MS);
  if (!raw.ok) return respond(raw.status, { error: raw.reason });
  let text: string;
  let value: unknown;
  try {
    // A byte order mark stays in the text, so it is refused like any other byte.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw.bytes);
    value = JSON.parse(text);
  } catch {
    return respond(400, { error: "invalid_json" });
  }
  const report = canonical(text, value) ? parseProblemReport(value) : null;
  if (!report) return respond(422, { error: "invalid_input" });

  let reference: unknown;
  try {
    const result = await deps.withActor(token, async (tx) =>
      tx.query<{ reference: unknown }>(SUBMIT_SQL, [
        report.category,
        report.description,
        report.route,
        report.appVersion,
        report.browserFamily,
        report.browserMajor,
        report.syncState,
      ]));
    reference = result.rows.length === 1 ? result.rows[0]?.reference : undefined;
  } catch (error) {
    // PostgreSQL raises documented ZD codes; its message, SQL and parameters never leave.
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ZD401") return respond(401, { error: "unauthorized" });
    if (code === "ZD422") return respond(422, { error: "invalid_input" });
    if (code === "ZD429") return respond(429, { error: "too_many_reports" });
    console.error("problem report failed", typeof code === "string" && SQLSTATE.test(code) ? code : "unknown");
    return respond(503);
  }
  if (typeof reference !== "string" || !REFERENCE.test(reference)) {
    console.error("problem report failed", "row_malformed");
    return respond(503);
  }
  return respond(201, { reference });
}

import { isInstitutionId } from "@/application/ports/evidence-object-key";
import type { InstitutionEvidencePayloadReader } from "@/application/ports/evidence-reconstruction";
import { readProcessSummary } from "@/application/projection/process-summary-reader";
import { verifyDocumentSnapshot } from "@/domain/document/snapshot";
import { textBlocksOf, type TextBlock } from "@/domain/document/text-blocks";
import type { ProcessSummaryThresholds, ProcessSummaryV1 } from "@/domain/projection/process-summary";
import { processSummaryLines } from "@/domain/projection/process-summary-lines";
import { compareHr } from "@/domain/text/compare-hr";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";
import { checkMutationRequest, readBodyWithLimit } from "@/server/http/mutation-request";

/**
 * B-11c (#757, DAN-308): the teacher's fast path through the works of one
 * assignment. One `app.fast_path_works` call inside withActor names the
 * students, the work at the revision the teacher's P-03 window holds and its
 * text, and logs the opening of each text (B-11b). Each record is projected
 * by the same reader as the process-summary route, from a source bound to
 * that row, so the summary is the one the student is shown (PRODUCT §5 rule
 * 5, D-80 point 6) and the text, head and segments are of one revision.
 *
 * Every failure is whole: a malformed row, an unreadable record or a head
 * that does not match twice gives `unavailable`, never a partial list. The
 * log names closed codes only, never a name, a text or an id.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const PACKAGE_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const HASH = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9]{1,19}$/;
const NAME_MAX = 255;
const MAX_BODY_BYTES = 1024;
const NO_STORE = { "cache-control": "no-store" };

const SQL =
  "SELECT student_id::text, given_name, family_name, document_id, submitted, revision::text, " +
  "evidence_package_id, head_segment_hash, segment_hashes, body, institution_id::text " +
  "FROM app.fast_path_works($1::uuid)";

export type FastPathRecord = {
  pastesWithoutSource: number;
  blocks: TextBlock[];
  /** The same summary the student is shown (PRODUCT §5 rule 5). */
  summary: ProcessSummaryV1;
};

export type FastPathStudent = {
  id: string;
  /** Both null when the account has no name pair (#757 D1); never a stand-in. */
  givenName: string | null;
  surname: string | null;
  work: "notice_pending" | "writing" | "submitted";
  lastChangeAt: string | null;
  record: FastPathRecord | null;
};

export type FastPathRead =
  | { kind: "ok"; students: FastPathStudent[] }
  | { kind: "unauthorized" | "unavailable" };

export type FastPathDeps = {
  /** Storage of every institution; bound to the institution the row names. */
  payloads: InstitutionEvidencePayloadReader;
  /** The process-summary route's thresholds, never a request field. */
  thresholds: ProcessSummaryThresholds;
  log?: (message: string, code: string) => void;
};

type Row = Record<string, unknown>;
type Attempt = { status: "ok"; students: FastPathStudent[] } | { status: "retry" } | { status: "failed"; code: string };

function codeOf(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" ? code : undefined;
}

function isName(value: unknown): value is string {
  // Code points, as the login claims and length() in the database count (F-149).
  return typeof value === "string" && value.length >= 1 && [...value].length <= NAME_MAX;
}

/** Named students by surname, given name and id; then the unnamed by id (#757 D1). */
export function compareStudents(a: FastPathStudent, b: FastPathStudent): number {
  const byId = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (a.surname === null || b.surname === null) {
    if (a.surname !== b.surname) return a.surname === null ? 1 : -1;
    return byId;
  }
  return compareHr(a.surname, b.surname) || compareHr(a.givenName!, b.givenName!) || byId;
}

async function studentOf(row: Row, deps: FastPathDeps): Promise<FastPathStudent | Exclude<Attempt, { status: "ok" }>> {
  const malformed = { status: "failed", code: "row_malformed" } as const;
  const { student_id: id, given_name: givenName, family_name: surname, document_id: documentId } = row;
  if (typeof id !== "string" || !UUID.test(id)) return malformed;
  const named = isName(givenName) && isName(surname);
  if (!named && (givenName !== null || surname !== null)) return malformed;
  const person = { id, givenName: named ? givenName : null, surname: named ? surname : null };

  if (documentId === null) {
    const rest = [row.submitted, row.revision, row.evidence_package_id, row.head_segment_hash, row.segment_hashes, row.body];
    if (!rest.every((value) => value === null)) return malformed;
    return { ...person, work: "notice_pending", lastChangeAt: null, record: null };
  }
  const { institution_id: institutionId, evidence_package_id: packageId, head_segment_hash: head } = row;
  const hashes = row.segment_hashes;
  if (
    typeof documentId !== "string" ||
    typeof row.submitted !== "boolean" ||
    typeof row.revision !== "string" || !REVISION.test(row.revision) ||
    !isInstitutionId(institutionId) ||
    typeof packageId !== "string" || !PACKAGE_ID.test(packageId) ||
    !(head === null || (typeof head === "string" && HASH.test(head))) ||
    !Array.isArray(hashes) || !hashes.every((hash) => typeof hash === "string" && HASH.test(hash)) ||
    typeof row.body !== "string"
  ) {
    return malformed;
  }
  const segmentHashes = [...(hashes as string[])];
  // The listing must end at the row's head: otherwise text and record could
  // be of two revisions, so the read is tried once more (#757 invariant 2).
  if ((segmentHashes.at(-1) ?? null) !== head) return { status: "retry" };

  const text = await verifyDocumentSnapshot(new TextEncoder().encode(row.body));
  if (!text.ok) return { status: "failed", code: "text_malformed" };

  const read = await readProcessSummary(
    {
      source: {
        readSource: async () => ({
          status: "found",
          institutionId,
          evidencePackageId: packageId,
          head: head === null ? null : { segmentHash: head, segmentCount: segmentHashes.length },
          segmentHashes,
        }),
      },
      payloads: deps.payloads,
      thresholds: deps.thresholds,
    },
    documentId,
  );
  if (read.status !== "ok") {
    if (read.status === "unavailable" && read.reason === "head_mismatch") return { status: "retry" };
    return { status: "failed", code: read.status === "unavailable" ? read.reason : "record_unreadable" };
  }
  // The JCS text the student route returns, read back: the same summary.
  const summary = JSON.parse(read.body) as ProcessSummaryV1;
  const lines = processSummaryLines(summary);
  return {
    ...person,
    work: row.submitted ? "submitted" : "writing",
    lastChangeAt: lines.lastChangeAt,
    record: { pastesWithoutSource: lines.pastesWithoutSource, blocks: textBlocksOf(text.document), summary },
  };
}

async function rowsOf(tx: ActorTransaction, assignmentId: string): Promise<Row[]> {
  return (await tx.query<Row>(SQL, [assignmentId])).rows;
}

/**
 * Checks the rows after their transaction has closed: the reads from storage
 * can take longer than the pool's idle-in-transaction limit (#780, Codex P2).
 * Each row carries its own head and listing, so nothing here needs the
 * transaction; a row that moved on is caught as `retry` as before.
 */
async function attempt(rows: readonly Row[], deps: FastPathDeps): Promise<Attempt> {
  const students: FastPathStudent[] = [];
  for (const row of rows) {
    const student = await studentOf(row, deps);
    if ("status" in student) return student;
    students.push(student);
  }
  return { status: "ok", students: students.sort(compareStudents) };
}

export async function readFastPath(
  sessionToken: string | undefined,
  assignmentId: string,
  withActor: WithActor,
  deps: FastPathDeps,
): Promise<FastPathRead> {
  const log = deps.log ?? ((message, code) => console.error(message, code));
  if (sessionToken === undefined || !TOKEN.test(sessionToken)) return { kind: "unauthorized" };
  // A malformed id names no assignment: the same empty list as any other.
  if (!UUID.test(assignmentId)) return { kind: "ok", students: [] };
  for (let tries = 0; tries < 2; tries += 1) {
    let outcome: Attempt;
    try {
      const rows = await withActor(sessionToken, (tx) => rowsOf(tx, assignmentId));
      outcome = await attempt(rows, deps);
    } catch (error) {
      const code = codeOf(error);
      if (code === "ZD401") return { kind: "unauthorized" };
      log("fast path read failed", code !== undefined && SQLSTATE.test(code) ? code : "unknown");
      return { kind: "unavailable" };
    }
    if (outcome.status === "ok") return { kind: "ok", students: outcome.students };
    if (outcome.status === "failed") {
      log("fast path read failed", outcome.code);
      return { kind: "unavailable" };
    }
  }
  log("fast path read failed", "head_mismatch");
  return { kind: "unavailable" };
}

export interface FastPathRouteDeps {
  withActor: WithActor;
  payloads: InstitutionEvidencePayloadReader;
  thresholds: ProcessSummaryThresholds | null;
  expectedOrigin: string;
  sessionToken?: string;
  log?: (message: string, code: string) => void;
}

function refuse(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

/**
 * `POST /api/teacher/fast-path` (#757 D4): the same origin, media type and
 * body checks as the process-summary route. The body is exactly
 * `{assignmentId}`; who reads comes only from the session cookie. An
 * assignment the reader does not teach, or that does not exist, is the same
 * empty list, never 403 or 404.
 */
export async function handleFastPathRequest(request: Request, deps: FastPathRouteDeps): Promise<Response> {
  const log = deps.log ?? ((message, code) => console.error(message, code));
  let allowed;
  try {
    allowed = checkMutationRequest(request, deps.expectedOrigin);
  } catch {
    return refuse(503, "unavailable");
  }
  if (!allowed.ok) return refuse(allowed.status, allowed.reason);
  if (!deps.sessionToken || !TOKEN.test(deps.sessionToken)) return refuse(401, "unauthorized");
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return refuse(415, "unsupported_media_type");
  }
  const raw = await readBodyWithLimit(request, MAX_BODY_BYTES, 5_000);
  if (!raw.ok) return refuse(raw.status, raw.reason);
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw.bytes));
  } catch {
    return refuse(400, "invalid_json");
  }
  // Exactly one key: a role, a window or a student in the body is refused, never read.
  const assignmentId =
    input && typeof input === "object" && !Array.isArray(input) && Object.keys(input).length === 1
      ? (input as { assignmentId?: unknown }).assignmentId
      : undefined;
  if (typeof assignmentId !== "string" || !UUID.test(assignmentId.toLowerCase())) {
    return refuse(422, "invalid_input");
  }
  if (deps.thresholds === null) {
    log("fast path read failed", "thresholds_invalid");
    return refuse(503, "unavailable");
  }

  const read = await readFastPath(deps.sessionToken, assignmentId.toLowerCase(), deps.withActor, {
    payloads: deps.payloads,
    thresholds: deps.thresholds,
    log,
  });
  switch (read.kind) {
    case "ok":
      return Response.json(read, { status: 200, headers: NO_STORE });
    case "unauthorized":
      return refuse(401, "unauthorized");
    default:
      return refuse(503, "unavailable");
  }
}

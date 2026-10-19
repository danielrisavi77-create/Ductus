import { isInstitutionId } from "@/application/ports/evidence-object-key";
import type { InstitutionEvidencePayloadReader } from "@/application/ports/evidence-reconstruction";
import type {
  ProcessSummarySource,
  ProcessSummarySourceResult,
} from "@/application/ports/process-summary-source";
import { readProcessSummary } from "@/application/projection/process-summary-reader";
import type { ProcessSummaryThresholds } from "@/domain/projection/process-summary";
import type { WithActor } from "@/server/db/with-actor";
import { checkMutationRequest, readBodyWithLimit } from "@/server/http/mutation-request";

/**
 * B-13 step 3 HTTP boundary: the process summary of one document, the same
 * bytes for its owner and the teacher of its assignment (PRODUCT §5 rule 5,
 * D-80 point 6). POST like the comment reads, so the document id never lands
 * in a URL or access log. Who asks comes only from the session cookie, bound
 * into the source; the request body carries the document id and nothing else.
 */

const MAX_BODY_BYTES = 1024;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const PACKAGE_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const HASH = /^[0-9a-f]{64}$/;
const COUNT = /^[0-9]{1,6}$/;
const NO_STORE = { "cache-control": "no-store" };

/**
 * P-01 and P-02 from configuration (PRODUCT §5 rule 12); when unset, the
 * defaults of docs/DECISIONS.md ("Zadane vrijednosti pragova"). A value that
 * is set but not a whole number in range gives null: the route then answers
 * unavailable for every reader instead of guessing.
 */
export function loadProcessSummaryThresholds(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProcessSummaryThresholds | null {
  const read = (name: string, fallback: number, min: number) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    return COUNT.test(raw) && Number(raw) >= min ? Number(raw) : null;
  };
  const sessionBreakAboveMinutes = read("PROCESS_SUMMARY_SESSION_BREAK_MINUTES", 30, 1);
  const pasteListedAboveCharacters = read("PROCESS_SUMMARY_PASTE_LISTED_CHARACTERS", 200, 0);
  if (sessionBreakAboveMinutes === null || pasteListedAboveCharacters === null) return null;
  return { sessionBreakAboveMinutes, pasteListedAboveCharacters };
}

type SourceRow = {
  outcome?: unknown;
  institution_id?: unknown;
  evidence_package_id?: unknown;
  segment_hashes?: unknown;
};

function sourceResult(rows: SourceRow[]): ProcessSummarySourceResult {
  const malformed = { status: "unavailable", reason: "source_malformed" } as const;
  if (rows.length !== 1) return malformed;
  const { outcome, institution_id: institutionId, evidence_package_id: packageId, segment_hashes: hashes } = rows[0];
  if (outcome === "not_found") return { status: "not_found" };
  if (outcome === "unavailable") return { status: "unavailable", reason: "source_unavailable" };
  if (
    outcome !== "found" ||
    !isInstitutionId(institutionId) ||
    typeof packageId !== "string" ||
    !PACKAGE_ID.test(packageId) ||
    !Array.isArray(hashes) ||
    !hashes.every((hash) => typeof hash === "string" && HASH.test(hash))
  ) {
    return malformed;
  }
  const segmentHashes = [...(hashes as string[])];
  return {
    status: "found",
    institutionId,
    evidencePackageId: packageId,
    head: segmentHashes.length === 0
      ? null
      : { segmentHash: segmentHashes[segmentHashes.length - 1], segmentCount: segmentHashes.length },
    segmentHashes,
  };
}

/**
 * The source bound to one session: app.read_process_summary_source under
 * withActor. The institution of a found record comes from that row, so the
 * storage domain is chosen by the database, never by the request.
 */
export function sessionProcessSummarySource(withActor: WithActor, sessionToken: string): ProcessSummarySource {
  return {
    async readSource(documentId) {
      const result = await withActor(sessionToken, (tx) =>
        tx.query<SourceRow>(
          "SELECT outcome, institution_id, evidence_package_id, segment_hashes FROM app.read_process_summary_source($1)",
          [documentId],
        ),
      );
      return sourceResult(result.rows);
    },
  };
}

export interface ProcessSummaryRouteDeps {
  withActor: WithActor;
  /** Storage of every institution; the reader binds it to the source row's. */
  payloads: InstitutionEvidencePayloadReader;
  thresholds: ProcessSummaryThresholds | null;
  expectedOrigin: string;
  sessionToken?: string;
}

function refuse(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

export async function handleProcessSummaryRequest(
  request: Request,
  deps: ProcessSummaryRouteDeps,
): Promise<Response> {
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
  // Exactly one key: a role, threshold or time in the body is refused, never read (#384 item 62).
  if (
    !input || typeof input !== "object" || Array.isArray(input) ||
    Object.keys(input).length !== 1 || typeof (input as { documentId?: unknown }).documentId !== "string"
  ) {
    return refuse(422, "invalid_input");
  }
  if (deps.thresholds === null) {
    console.error("process summary unavailable", "thresholds_invalid");
    return refuse(503, "unavailable");
  }

  const read = await readProcessSummary(
    {
      source: sessionProcessSummarySource(deps.withActor, deps.sessionToken),
      payloads: deps.payloads,
      thresholds: deps.thresholds,
    },
    (input as { documentId: string }).documentId,
  );
  switch (read.status) {
    case "ok":
      // The JCS text unchanged: the same bytes for every reader.
      return new Response(read.body, {
        status: 200,
        headers: { ...NO_STORE, "content-type": "application/json; charset=utf-8" },
      });
    case "not_found":
      return refuse(404, "not_found");
    default:
      // A closed code only: never an id, a message or work content.
      console.error("process summary unavailable", read.reason);
      return refuse(503, "unavailable");
  }
}

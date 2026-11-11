import type { InstitutionEvidencePayloadReader } from "@/application/ports/evidence-reconstruction";
import type { ReplayCheckpointsResult, ReplaySource } from "@/application/ports/replay-source";
import type { EvidenceChainHeadV2 } from "@/domain/forensics/evidence-chain-v2";
import { readReplayPage } from "@/application/evidence/replay-reader";
import type { WithActor } from "@/server/db/with-actor";
import { checkMutationRequest, readBodyWithLimit } from "@/server/http/mutation-request";
import { sourceResult, type SourceRow } from "@/server/projection/process-summary";

/**
 * DAN-344 route R3 (contract on #923): one page of the replay of a document,
 * the same bytes for its owner and the teacher of its assignment (PRODUCT §5
 * rule 5). POST like the process summary, so the document id never lands in a
 * URL. Who asks comes only from the session cookie, bound into the source;
 * the body carries the document id and the page start and, for every page
 * after the first, the head the first page reported (DAN-537), nothing else.
 */

const MAX_BODY_BYTES = 1024;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const NO_STORE = { "cache-control": "no-store" };
const HASH = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Exactly `{segmentHash, segmentCount}`: a lowercase SHA-256 and a count of at least one. */
function readHead(value: unknown): EvidenceChainHeadV2 | null {
  if (!isRecord(value) || Object.keys(value).length !== 2) return null;
  const { segmentHash, segmentCount } = value;
  if (typeof segmentHash !== "string" || !HASH.test(segmentHash)) return null;
  if (!Number.isSafeInteger(segmentCount) || (segmentCount as number) < 1) return null;
  return { segmentHash, segmentCount: segmentCount as number };
}

/**
 * The closed body: `{documentId, from: 0}` for the first page and
 * `{documentId, from, head}` for every later one; anything else is null.
 */
function readBody(input: unknown): { documentId: string; from: number; pin: EvidenceChainHeadV2 | null } | null {
  if (!isRecord(input) || typeof input.documentId !== "string") return null;
  const { documentId, from } = input;
  if (!Number.isSafeInteger(from) || (from as number) < 0) return null;
  const keys = Object.keys(input).length;
  if (from === 0) return keys === 2 ? { documentId, from: 0, pin: null } : null;
  const pin = readHead(input.head);
  return keys === 3 && pin !== null ? { documentId, from: from as number, pin } : null;
}

function isUnauthenticated(error: unknown): boolean {
  // ZD401: no open session (DAN-85). Anything else is rethrown; the reader
  // turns it into unavailable, no message.
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ZD401");
}

/**
 * The source bound to one session: app.read_replay_source and
 * app.read_replay_checkpoints under withActor. The institution of a found
 * record comes from that row, so the storage domain is chosen by the
 * database, never by the request.
 */
export function sessionReplaySource(withActor: WithActor, sessionToken: string): ReplaySource {
  return {
    async readSource(documentId) {
      let result;
      try {
        result = await withActor(sessionToken, (tx) =>
          tx.query<SourceRow>(
            "SELECT outcome, institution_id, evidence_package_id, segment_hashes FROM app.read_replay_source($1)",
            [documentId],
          ),
        );
      } catch (error) {
        if (isUnauthenticated(error)) return { status: "unauthenticated" };
        throw error;
      }
      return sourceResult(result.rows);
    },
    async readCheckpoints(documentId, contentHashes): Promise<ReplayCheckpointsResult> {
      let result;
      try {
        result = await withActor(sessionToken, (tx) =>
          tx.query<{ content_hash?: unknown; body?: unknown }>(
            "SELECT content_hash, body FROM app.read_replay_checkpoints($1, $2::text[])",
            [documentId, [...contentHashes]],
          ),
        );
      } catch (error) {
        if (isUnauthenticated(error)) return { status: "unauthenticated" };
        throw error;
      }
      const texts = new Map<string, string>();
      for (const row of result.rows) {
        if (typeof row.content_hash !== "string" || typeof row.body !== "string" || texts.has(row.content_hash)) {
          return { status: "unavailable", reason: "checkpoints_malformed" };
        }
        texts.set(row.content_hash, row.body);
      }
      return { status: "found", texts };
    },
  };
}

export interface ReplayRouteDeps {
  withActor: WithActor;
  /** Storage of every institution; the reader binds it to the source row's. */
  payloads: InstitutionEvidencePayloadReader;
  expectedOrigin: string;
  sessionToken?: string;
}

function refuse(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

export async function handleReplayRequest(request: Request, deps: ReplayRouteDeps): Promise<Response> {
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
  // Only the closed keys: a role, institution or time in the body is refused, never read.
  const body = readBody(input);
  if (body === null) return refuse(422, "invalid_input");

  const read = await readReplayPage(
    { source: sessionReplaySource(deps.withActor, deps.sessionToken), payloads: deps.payloads },
    body.documentId,
    body.from,
    body.pin,
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
    case "unauthenticated":
      return refuse(401, "unauthorized");
    case "record_changed":
      // Reached only after access is decided; the browser reads again from the first page.
      return refuse(409, "record_changed");
    default:
      // A closed code only: never an id, a message or work content.
      console.error("replay unavailable", read.reason);
      return refuse(503, "unavailable");
  }
}

import {
  DUCTUS_ASYNC_COMMIT_PROTOCOL,
  DUCTUS_PROTOCOL_VERSION,
  MAX_COMMIT_REQUEST_BYTES,
} from "@/domain/evidence/commit-envelope";
import type { WithActor } from "@/server/db/with-actor";

import {
  commitEvidenceRequest,
  type EvidenceCommitRequest,
  type EvidenceCommitRequestDependencies,
  type EvidenceCommitRequestOutcome,
} from "./evidence-commit-request";
import { consoleLog, parseClosedObject, readGuardedBody, reply, unavailable, type Log } from "./ingest-http";

/**
 * B-8 step 5 (docs/BACKEND.md 4.13 t. 1, 2, 4 and 8): `POST
 * /api/evidence/commit`. The headers are checked before the body is read,
 * the envelope is a closed set of keys, the bytes travel as base64 that must
 * encode back to the same text, and every outcome of step 4d goes on the
 * wire through one closed mapping. The log carries the outcome, stage and
 * code only: never bytes, text, the idempotency key or the client's ids.
 *
 * DAN-518: with `asyncSigning` the route also takes `Ductus-Protocol: 2`,
 * under which it never signs: an acceptance is 202 `pending_signature` with
 * `Retry-After`, and a retry after the worker has signed is the verified 200
 * `duplicate`. Without it, "2" is 426 like any other value.
 */

const BODY_TIMEOUT_MS = 60_000;
/** Seconds until a client asks again for a receipt the worker has not signed yet. */
const PENDING_RETRY_AFTER = "2";
const KEYS = ["documentId", "clientTransactionId", "baseRevision", "segments", "document"] as const;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type EvidenceCommitRouteDeps = EvidenceCommitRequestDependencies & {
  withActor: WithActor;
  expectedOrigin: string | null;
  sessionToken?: string;
  log?: Log;
  /** Protocol 2, signed by the worker; only `true` turns it on. */
  asyncSigning?: boolean;
};

/** Standard base64 with padding that encodes back to the same text, into a buffer of its own. */
function strictBase64(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !BASE64.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? new Uint8Array(decoded) : null;
}

/** The envelope of 4.13 t. 2, or null for anything else (`gap` included). */
export function parseCommitEnvelope(bytes: Uint8Array): EvidenceCommitRequest | null {
  const body = parseClosedObject(bytes, KEYS);
  if (body === null) return null;
  const { documentId, clientTransactionId, baseRevision, segments, document } = body;
  if (
    typeof documentId !== "string" ||
    typeof clientTransactionId !== "string" ||
    typeof baseRevision !== "number" ||
    !Array.isArray(segments) ||
    segments.length !== 1
  ) {
    return null;
  }
  const segment = strictBase64(segments[0]);
  const snapshot = strictBase64(document);
  if (segment === null || snapshot === null) return null;
  return { documentId, clientTransactionId, baseRevision, segment, document: snapshot };
}

/** The closed mapping of 4.13 t. 4. */
export function commitResponse(outcome: EvidenceCommitRequestOutcome): Response {
  switch (outcome.status) {
    case "committed":
    case "duplicate":
      return reply(200, {
        status: outcome.status,
        revision: outcome.revision,
        receipt: { status: "signed", signedReceipt: outcome.signedReceipt },
      });
    case "committed_pending":
    case "duplicate_pending":
      return reply(
        202,
        {
          status: outcome.status === "committed_pending" ? "committed" : "duplicate",
          revision: outcome.revision,
          receipt: { status: "pending_signature" },
        },
        { "retry-after": PENDING_RETRY_AFTER },
      );
    case "stale_base":
    case "chain_conflict":
    case "not_continuous":
      return reply(409, { status: outcome.status, ...outcome.state });
    case "txid_reused":
    case "not_accepting":
      return reply(409, { status: outcome.status });
    case "invalid":
    case "document_mismatch":
      return reply(422, { status: outcome.status });
    case "too_large":
      return reply(413, { status: "too_large" });
    case "not_found":
      return reply(404, { status: "not_found" });
    case "unauthenticated":
      return reply(401, { status: "unauthenticated" });
    case "unavailable":
      return unavailable(outcome.stage);
    default:
      return unavailable("repository");
  }
}

export async function handleEvidenceCommitRequest(request: Request, deps: EvidenceCommitRouteDeps): Promise<Response> {
  const log = deps.log ?? consoleLog;
  const read = await readGuardedBody(request, deps.expectedOrigin, deps.sessionToken, {
    maxBytes: MAX_COMMIT_REQUEST_BYTES,
    timeoutMs: BODY_TIMEOUT_MS,
    // The largest body of all: the session is checked first (F-098).
    liveSession: deps.withActor,
    protocols:
      deps.asyncSigning === true ? [DUCTUS_PROTOCOL_VERSION, DUCTUS_ASYNC_COMMIT_PROTOCOL] : [DUCTUS_PROTOCOL_VERSION],
  });
  if (!read.ok) return read.response;
  const envelope = parseCommitEnvelope(read.bytes);
  if (envelope === null) return reply(422, { status: "invalid" });

  const signing = read.protocol === DUCTUS_ASYNC_COMMIT_PROTOCOL ? "deferred" : "inline";
  const outcome = await commitEvidenceRequest(deps, read.token, envelope, signing);
  if (outcome.status === "unavailable") log("evidence commit", outcome.status, outcome.stage, outcome.code);
  else if (!["committed", "duplicate", "committed_pending", "duplicate_pending"].includes(outcome.status)) {
    log("evidence commit", outcome.status);
  }
  return commitResponse(outcome);
}

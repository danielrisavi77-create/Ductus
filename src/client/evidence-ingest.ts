/**
 * The browser side of the evidence routes (F-8 step 3c, DAN-37; routes: B-8,
 * docs/BACKEND.md 4.13). `openWork` asks `POST /api/evidence/open` for the
 * student's work, `commitEvidence` sends one segment and the document after it
 * to `POST /api/evidence/commit`, and `createReceiptVerifier` is the trusted-key
 * verifier the drain runner needs before SYNCED.
 *
 * - Bytes go out exactly as they were hashed: the caller hands over the JCS
 *   bytes of the segment and of the snapshot, and they travel as standard
 *   base64 (4.13 t. 2). Nothing here re-serialises a document.
 * - Every answer of the commit route maps onto the drain's one vocabulary
 *   (`DrainOutcome`) through one closed table (4.13 t. 4); a status, code or
 *   shape outside it is never read as success.
 * - SYNCED needs a receipt that verifies under a receipt key from the open
 *   route, never under a key from the response that carries the receipt, and
 *   whose `segmentHash` is the hash of the segment this client sent.
 */

import { DUCTUS_PROTOCOL_VERSION } from "@/domain/evidence/commit-envelope";
import { MAX_DOCUMENT_SNAPSHOT_BYTES } from "@/domain/document/snapshot";
import { exceedsEvidenceSegmentLimit } from "@/domain/forensics/evidence-chain-v2";
import { isReceiptClientTransactionId } from "@/domain/forensics/evidence-receipt";
import { isEvidenceProfileIdV2 } from "@/domain/forensics/evidence-segment-v2";
import {
  verifySignedEvidenceReceiptV2,
  type EvidenceDomainKey,
} from "@/domain/forensics/evidence-receipt-verifier";
import { parseCommitOutcome } from "@/domain/serverSync/contract";
import type { DrainOutcome, SignedCommitReceiptVerifier } from "@/domain/sync/drain";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** The student's work as the open route reports it (4.13 t. 6). */
export type OpenedWork = {
  documentId: string;
  evidenceProfileId: string;
  currentRevision: number;
  documentHash: string;
  headSegmentHash: string | null;
  lastSequenceTo: number;
  /** Exact JCS bytes of the snapshot of `currentRevision`. */
  document: Uint8Array;
  /** The one evidence domain every receipt key belongs to. */
  evidenceDomainId: string;
  receiptKeys: readonly EvidenceDomainKey[];
  /** True exactly when the student's submission of this work is recorded (DAN-289 O2). */
  submitted: boolean;
};

export type OpenOutcome =
  | { status: "opened"; work: OpenedWork }
  /** Not signed in, no such work for this person, notice not acknowledged (F-7). */
  | { status: "unauthenticated" | "not_found" | "not_accepting" }
  /** The app is older than the server's protocol: reload it. */
  | { status: "upgrade_required" }
  /** No answer, or one this client cannot vouch for. */
  | { status: "unavailable" };

export type EvidenceCommitInput = {
  documentId: string;
  clientTransactionId: string;
  baseRevision: number;
  /** Exact JCS bytes of one segment v2. */
  segment: Uint8Array;
  /** Exact JCS bytes of the document after the segment's last event. */
  document: Uint8Array;
};

const SHA256_HEX = /^[0-9a-f]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const OPEN_KEYS = [
  "status", "documentId", "evidenceProfileId", "currentRevision", "documentHash",
  "headSegmentHash", "lastSequenceTo", "document", "receiptKeys", "submitted",
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Standard base64 with padding that encodes back to the same text; else null. */
export function decodeBase64(text: unknown): Uint8Array | null {
  if (typeof text !== "string" || !BASE64.test(text)) return null;
  try {
    const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
    return encodeBase64(bytes) === text ? bytes : null;
  } catch {
    return null;
  }
}

async function post(fetchImpl: FetchLike, path: string, body: unknown): Promise<Response | null> {
  try {
    return await fetchImpl(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", "ductus-protocol": DUCTUS_PROTOCOL_VERSION },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

async function jsonOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * The receipt keys of exactly one evidence domain, or null. The verifier
 * judges each key itself; here only the domain is read, so that a list
 * mixing domains cannot choose which domain a receipt is held to.
 */
function receiptDomainOf(keys: unknown): { domain: string; keys: EvidenceDomainKey[] } | null {
  if (!Array.isArray(keys) || keys.length === 0) return null;
  const domains = new Set<unknown>();
  for (const key of keys) {
    if (!isObject(key) || key.purpose !== "receipt") return null;
    domains.add(key.evidenceDomainId);
  }
  const [domain] = [...domains];
  return domains.size === 1 && typeof domain === "string" && domain !== ""
    ? { domain, keys: keys as EvidenceDomainKey[] }
    : null;
}

/** The open answer in its closed shape, or null. */
export function openedWorkFrom(value: unknown): OpenedWork | null {
  if (!isObject(value) || value.status !== "opened") return null;
  const own = Object.keys(value);
  if (own.length !== OPEN_KEYS.length || !OPEN_KEYS.every((key) => own.includes(key))) return null;
  const {
    documentId, evidenceProfileId, currentRevision, documentHash, headSegmentHash, lastSequenceTo, submitted,
  } = value;
  const document = decodeBase64(value.document);
  const keys = receiptDomainOf(value.receiptKeys);
  if (
    typeof documentId !== "string" || documentId === "" ||
    // The same rule as the journal and segment v2, so a profile they would refuse is refused here (#733).
    !isEvidenceProfileIdV2(evidenceProfileId) ||
    !isCount(currentRevision) || !isCount(lastSequenceTo) ||
    typeof documentHash !== "string" || !SHA256_HEX.test(documentHash) ||
    !(headSegmentHash === null || (typeof headSegmentHash === "string" && SHA256_HEX.test(headSegmentHash))) ||
    document === null || document.byteLength > MAX_DOCUMENT_SNAPSHOT_BYTES || keys === null ||
    // Never false by assumption: only a real boolean says whether the work is submitted.
    typeof submitted !== "boolean"
  ) {
    return null;
  }
  return {
    documentId, evidenceProfileId, currentRevision, documentHash, headSegmentHash, lastSequenceTo,
    document, evidenceDomainId: keys.domain, receiptKeys: keys.keys, submitted,
  };
}

/**
 * Opens the student's work for one assignment. Only `start: true`, sent from
 * the student's own "Započni rad", makes a work that does not exist yet
 * (DAN-331, F-137); without it the server answers 409 `not_started`, which
 * is `unavailable` here.
 */
export async function openWork(
  assignmentId: string, fetchImpl: FetchLike = fetch, options: { start?: boolean } = {},
): Promise<OpenOutcome> {
  const response = await post(fetchImpl, "/api/evidence/open", options.start === true ? { assignmentId, start: true } : { assignmentId });
  if (response === null) return { status: "unavailable" };
  const body = await jsonOf(response);
  const status = isObject(body) ? body.status : undefined;
  if (response.status === 200) {
    const work = openedWorkFrom(body);
    return work ? { status: "opened", work } : { status: "unavailable" };
  }
  if (response.status === 401 && status === "unauthenticated") return { status };
  if (response.status === 404 && status === "not_found") return { status };
  if (response.status === 409 && status === "not_accepting") return { status };
  if (response.status === 426) return { status: "upgrade_required" };
  return { status: "unavailable" };
}

/** HTTP code each refusal of 4.13 t. 4 comes with; a mismatch is not that refusal. */
const REFUSALS: Readonly<Record<string, readonly [number, DrainOutcome]>> = {
  txid_reused: [409, { status: "txid_reused" }],
  invalid: [422, { status: "invalid_document" }],
  document_mismatch: [422, { status: "invalid_document" }],
  too_large: [413, { status: "too_large" }],
  not_found: [404, { status: "not_found" }],
  // The notice was not acknowledged, or the package takes no more evidence:
  // repeating changes nothing, and the key was not stored.
  not_accepting: [409, { status: "not_found" }],
  unauthenticated: [401, { status: "unauthenticated" }],
};

const CONFLICTS: ReadonlySet<unknown> = new Set(["stale_base", "chain_conflict", "not_continuous"]);

/** One answer of the commit route as a drain outcome (4.13 t. 4). */
export function commitOutcomeFrom(httpStatus: number, body: unknown): DrainOutcome {
  const status = isObject(body) ? body.status : undefined;
  if (httpStatus === 200 && (status === "committed" || status === "duplicate")) {
    return parseCommitOutcome(body);
  }
  // Our own commit cannot be overwritten: any of the three asks the author to reconcile.
  if (httpStatus === 409 && CONFLICTS.has(status)) {
    const currentRevision = (body as Record<string, unknown>).currentRevision;
    return isCount(currentRevision) ? { status: "stale_base", currentRevision } : { status: "invalid" };
  }
  const refusal = typeof status === "string" && Object.hasOwn(REFUSALS, status) ? REFUSALS[status] : undefined;
  if (refusal && refusal[0] === httpStatus) return refusal[1];
  // The server, a proxy or the network did not finish: the same key is sent again.
  if (httpStatus >= 500) return { status: "transport_error" };
  // The body did not arrive in time, so the route read no key and stored nothing.
  if (httpStatus === 408 && status === "timeout") return { status: "transport_error" };
  // `upgrade_required` and anything unreadable: the commit may have landed,
  // so the row stays held and nothing is retried by itself.
  return { status: "invalid" };
}

/**
 * Sends one segment and the snapshot after it. Never throws: a request that
 * could not be made or whose answer was lost is `transport_error`.
 */
export async function commitEvidence(input: EvidenceCommitInput, fetchImpl: FetchLike = fetch): Promise<DrainOutcome> {
  if (!isReceiptClientTransactionId(input.clientTransactionId)) return { status: "invalid_client_transaction_id" };
  if (exceedsEvidenceSegmentLimit(input.segment.byteLength) || input.document.byteLength > MAX_DOCUMENT_SNAPSHOT_BYTES) {
    return { status: "too_large" };
  }
  const response = await post(fetchImpl, "/api/evidence/commit", {
    documentId: input.documentId,
    clientTransactionId: input.clientTransactionId,
    baseRevision: input.baseRevision,
    segments: [encodeBase64(input.segment)],
    document: encodeBase64(input.document),
  });
  if (response === null) return { status: "transport_error" };
  const body = await jsonOf(response);
  if (body === undefined && response.status >= 500) return { status: "transport_error" };
  return commitOutcomeFrom(response.status, body);
}

/**
 * The verifier for the drain runner. A receipt passes only when it verifies
 * under a receipt key of the work's domain (from the open route), names the
 * expected document, transaction and revision, and carries the hash of the
 * segment this client sent under that transaction id (`sentSegmentHash`).
 * Anything else, a runtime that cannot verify included, is false.
 */
export function createReceiptVerifier(
  work: Pick<OpenedWork, "evidenceDomainId" | "receiptKeys">,
  sentSegmentHash: (clientTransactionId: string) => string | null,
): SignedCommitReceiptVerifier {
  return async (signedReceipt, expected) => {
    let segmentHash: string | null;
    try {
      segmentHash = sentSegmentHash(expected.clientTransactionId);
    } catch {
      return false;
    }
    if (typeof segmentHash !== "string" || !SHA256_HEX.test(segmentHash)) return false;
    const verified = await verifySignedEvidenceReceiptV2(
      signedReceipt,
      {
        documentId: expected.documentId,
        clientTransactionId: expected.clientTransactionId,
        revision: expected.revision,
        evidenceDomainId: work.evidenceDomainId,
      },
      work.receiptKeys,
    );
    return verified.ok && verified.payload.segmentHash === segmentHash;
  };
}

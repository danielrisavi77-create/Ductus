/**
 * The browser side of the submission route (F-10, #476 contract 6384297464;
 * route: B-12, POST /api/submission, docs/BACKEND.md 4.6). The body is the
 * document and the revision the student sees on the submission page, never a
 * time, a hash or text (QA criterion 1).
 *
 * Every answer maps onto one closed table. A receipt is shown only for a 200
 * `submitted` whose receipt has exactly the signed shape and names the
 * document and revision that were sent (criterion 3); anything else is never
 * a submission. The browser does not check the signature (no verifier before
 * the demo, contract §2), so nothing here says it is verified.
 */

import { DUCTUS_PROTOCOL_VERSION } from "@/domain/evidence/commit-envelope";
import {
  isSignedSubmissionReceiptV1,
  type SignedSubmissionReceiptV1,
} from "@/domain/forensics/submission-receipt";

export type SubmitOutcome =
  | { kind: "submitted"; receipt: SignedSubmissionReceiptV1 }
  | { kind: "noEvidence" | "recordMismatch" | "blocked" }
  | { kind: "staleRevision" | "alreadyRequested" | "notOpen" | "notAcknowledged" }
  | { kind: "signedOut" | "notFound" | "unavailable" };

export type SubmitInput = { readonly documentId: string; readonly revision: number };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One answer of the route as an outcome; a status or shape outside the table is `unavailable`. */
export function submitOutcomeFrom(httpStatus: number, body: unknown, sent: SubmitInput): SubmitOutcome {
  const status = isObject(body) ? body.status : undefined;
  if (httpStatus === 200) {
    if (status !== "submitted") return { kind: "unavailable" };
    const receipt = (body as Record<string, unknown>).receipt;
    if (!isSignedSubmissionReceiptV1(receipt)) return { kind: "unavailable" };
    // The receipt must be for what this page sent.
    if (receipt.payload.documentId !== sent.documentId || receipt.payload.revision !== sent.revision) {
      return { kind: "unavailable" };
    }
    return { kind: "submitted", receipt };
  }
  if (httpStatus === 409) {
    if (status === "blocked") {
      const reason = (body as Record<string, unknown>).reason;
      if (reason === "no_evidence") return { kind: "noEvidence" };
      if (reason === "record_mismatch") return { kind: "recordMismatch" };
      return { kind: "blocked" };
    }
    if (status === "stale_revision") return { kind: "staleRevision" };
    if (status === "already_requested") return { kind: "alreadyRequested" };
    if (status === "not_open") return { kind: "notOpen" };
    if (status === "not_acknowledged") return { kind: "notAcknowledged" };
  }
  if (httpStatus === 401) return { kind: "signedOut" };
  if (httpStatus === 404) return { kind: "notFound" };
  return { kind: "unavailable" };
}

/**
 * Sends one submission. `current()` is asked right before the request: once
 * the session has ended in this browser nothing is sent (D-118, F-093).
 * Never throws.
 */
export async function submitWork(
  input: SubmitInput,
  current: () => boolean = () => true,
  fetcher: typeof fetch = fetch,
): Promise<SubmitOutcome> {
  if (!current()) return { kind: "signedOut" };
  let response: Response;
  try {
    response = await fetcher("/api/submission", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", "ductus-protocol": DUCTUS_PROTOCOL_VERSION },
      body: JSON.stringify({ documentId: input.documentId, revision: input.revision }),
    });
  } catch {
    return { kind: "unavailable" };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return submitOutcomeFrom(response.status, body, input);
}

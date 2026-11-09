/**
 * F-8 3d-2a (DAN-285): the drain runner's transport and verifier for a
 * document with evidence, over the commit route of 3c.
 *
 * - The stored bytes of the segment and of the document go out exactly as the
 *   journal keeps them (`commitEvidence` base64-encodes them); nothing is
 *   serialised again, and the time of each step never leaves the browser (I4).
 * - A row that is not a segment is refused without a request.
 * - A receipt counts only when its `segmentHash` is the hash the journal stored
 *   with the row that was sent, never one taken from the answer (I5).
 * - DAN-595: the `Ductus-Protocol` state comes from the caller. The browser
 *   passes the tab's one state (`evidence-session-deps.ts`), so a 426 to "2"
 *   keeps every work opened in this tab on "1" until a reload and touches no
 *   other tab (QA c.6730803432). Without one, the transport keeps its own.
 */

import {
  commitEvidence,
  createCommitProtocol,
  type CommitProtocol,
  createReceiptVerifier,
  type FetchLike,
  type OpenedWork,
} from "../../client/evidence-ingest";
import type { QueuedRow, SignedCommitReceiptVerifier } from "../../domain/sync/drain";
import type { QueuedTransaction } from "../../domain/sync/journal-types";
import type { CommitTransport } from "./drain-runner";

export function createEvidenceTransport(
  fetchImpl?: FetchLike,
  protocol: CommitProtocol = createCommitProtocol(),
): CommitTransport<QueuedTransaction> {
  return async (documentId, tx) => {
    if (tx?.kind !== "EVIDENCE_SEGMENT") return { status: "invalid_document" };
    return commitEvidence({
      documentId,
      clientTransactionId: tx.clientTransactionId,
      baseRevision: tx.baseRevision,
      segment: tx.segment,
      document: tx.document,
    }, fetchImpl, protocol);
  };
}

/** `verifyFor` of the drain runner: each sent row with its own stored segment hash. */
export function evidenceVerifierFor(
  work: Pick<OpenedWork, "evidenceDomainId" | "receiptKeys">,
): (sent: QueuedRow) => SignedCommitReceiptVerifier {
  return (sent) => createReceiptVerifier(work, (clientTransactionId) =>
    sent.tx.kind === "EVIDENCE_SEGMENT" && sent.tx.clientTransactionId === clientTransactionId
      ? sent.tx.segmentHash
      : null);
}

import type { EvidencePayloadReader } from "@/application/ports/evidence-reconstruction";
import { REVISION_ZERO_JCS } from "@/domain/document/revision-zero";
import {
  digestEvidenceReceiptPayloadV2,
  isEvidenceReceiptPayloadV2,
  isSignedEvidenceReceiptV2,
  type EvidenceReceiptPayloadV2,
} from "@/domain/forensics/evidence-receipt";
import {
  EVIDENCE_VERIFICATION_UNAVAILABLE,
  verifySignedEvidenceReceiptV2,
  type EvidenceDomainKey,
} from "@/domain/forensics/evidence-receipt-verifier";
import type { EvidenceStepReplayerV2 } from "@/domain/forensics/evidence-replay-v2";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";

import {
  reconstructAndCompareEvidence,
  type EvidenceReceiptCheck,
  type EvidenceReconstructionOutcome,
} from "./evidence-reconstruction";

/**
 * B-12 step 4b1 (docs/BACKEND.md 4.6, 4.10 t. 1 and 3; contract on #385):
 * the reconstruction of a submission request's revision over the stored
 * record, with receipts v2 checked by the full verifier under the registry
 * keys of the package's domain (owner decision P2).
 */

/** A receipt as the database keeps it: the exact payload text and the signature. */
export type StoredEvidenceReceiptV2 = { receiptPayload: string; signature: unknown };

/** What `app.read_submission_record` gives, cut at the requested revision. */
export type SubmissionRecord = {
  institutionId: string;
  evidencePackageId: string;
  evidenceDomainId: string;
  documentId: string;
  principalId: string;
  revision: number;
  /** `content_hash` of the requested revision: the target of the reconstruction. */
  contentHash: string;
  head: { segmentHash: string; segmentCount: number };
  segments: { segmentHash: string; receipt: StoredEvidenceReceiptV2 | null }[];
};

/**
 * Reasons that depend on the key registry or on the runtime, not on the
 * receipt: the check could not be made, so the outcome is `unavailable` and a
 * retry may succeed, never a verdict on the record. A receipt under a key the
 * registry does not hold is therefore never accepted, and never called broken.
 */
const NOT_CHECKED: ReadonlySet<string> = new Set([
  EVIDENCE_VERIFICATION_UNAVAILABLE,
  "key_unknown",
  "key_scope",
  "key_revoked",
  "key_not_valid",
]);

function isStoredReceipt(value: unknown): value is StoredEvidenceReceiptV2 {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StoredEvidenceReceiptV2).receiptPayload === "string"
  );
}

/** The payload, only when the stored text is its own JCS form byte for byte. */
function storedPayload(text: string): EvidenceReceiptPayloadV2 | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isEvidenceReceiptPayloadV2(parsed) && canonicalizeJcs(parsed) === text ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Each receipt of the record: a valid v2 payload stored as its exact JCS, of
 * this package, domain, document and segment, continuing the receipt before it, by the author
 * of the request, at a revision no lower than the one before and no higher
 * than the request's, the last one exactly the request's; its signature
 * verified under a receipt key of the package's domain from the registry
 * (never from a signer), as the receipt of the commit it names.
 */
export function submissionReceiptCheck(
  record: SubmissionRecord,
  keys: readonly EvidenceDomainKey[],
): EvidenceReceiptCheck {
  let previousRevision = 0;
  return async ({ receipt, index, evidencePackageId, segmentSha256, previousReceiptId }) => {
    if (!isStoredReceipt(receipt)) return { status: "mismatch" };
    const payload = storedPayload(receipt.receiptPayload);
    if (payload === null) return { status: "mismatch" };
    const digest = await digestEvidenceReceiptPayloadV2(payload);
    const signed = { payload, payloadDigestSha256: digest.sha256, signature: receipt.signature };
    const last = index === record.segments.length - 1;
    if (
      !isSignedEvidenceReceiptV2(signed) ||
      payload.evidencePackageId !== evidencePackageId ||
      payload.evidenceDomainId !== record.evidenceDomainId ||
      payload.documentId !== record.documentId ||
      payload.segmentHash !== segmentSha256 ||
      payload.previousReceiptId !== previousReceiptId ||
      payload.principalId !== record.principalId ||
      payload.revision < previousRevision ||
      payload.revision > record.revision ||
      (last && payload.revision !== record.revision)
    ) {
      return { status: "mismatch" };
    }
    const verified = await verifySignedEvidenceReceiptV2(
      signed,
      {
        documentId: record.documentId,
        clientTransactionId: payload.clientTransactionId,
        revision: payload.revision,
        evidenceDomainId: record.evidenceDomainId,
      },
      keys,
    );
    if (verified.ok) {
      previousRevision = payload.revision;
      return { status: "verified", receiptId: payload.receiptId };
    }
    if (NOT_CHECKED.has(verified.reason)) return { status: "unavailable", reason: verified.reason };
    return verified.reason === "signature_invalid" ? { status: "signature_invalid" } : { status: "mismatch" };
  };
}

/**
 * Replays the record from revision 0 (the known-answer bytes, 4.10 t. 3,
 * never the snapshot table) and compares the result with the requested
 * revision's hash (4.10 t. 1: no comparison with the snapshot in the demo).
 * The payloads are read from the storage domain of the record's institution.
 */
export function reconstructSubmission<TDocument>(
  dependencies: {
    payloads: EvidencePayloadReader;
    replayer: EvidenceStepReplayerV2<TDocument>;
    keys: readonly EvidenceDomainKey[];
  },
  record: SubmissionRecord,
): Promise<EvidenceReconstructionOutcome> {
  return reconstructAndCompareEvidence(
    {
      chain: { readChain: async () => ({ status: "found", head: record.head, segments: record.segments }) },
      payloads: dependencies.payloads,
      replayer: dependencies.replayer,
      receipts: submissionReceiptCheck(record, dependencies.keys),
    },
    {
      evidencePackageId: record.evidencePackageId,
      initialDocument: JSON.parse(REVISION_ZERO_JCS) as JcsJsonValue,
      expectedDocumentSha256: record.contentHash,
    },
  );
}

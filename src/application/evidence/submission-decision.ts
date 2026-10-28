import type { EvidenceReconstructionOutcome } from "@/application/evidence/evidence-reconstruction";
import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import {
  digestSubmissionReceiptPayloadV1,
  isSignedSubmissionReceiptV1,
  type SignedSubmissionReceiptV1,
  type SubmissionReceiptPayloadV1,
} from "@/domain/forensics/submission-receipt";

/**
 * Why a submission was not carried out. The interface turns the code into a
 * neutral message with the coordinator's contact (owner decision P7 on issue
 * 385); the code itself is never shown and says nothing about the student.
 *
 * - `segment_unsigned`: a segment of the record has no signed receipt. P3 of
 *   19 October 2026: the submission is blocked and the answer says so; there
 *   is no deferral and no "waiting for a signature" state (D-98).
 * - `record_mismatch`: the stored record is broken or does not reproduce the
 *   revision (D-11).
 * - `record_discontinuous`: the record has a break. P1 lets a recorded gap
 *   through, marked in the receipt, but the server records no gaps yet, so
 *   every break is an unrecorded one and blocks (plan item C5).
 * - `no_evidence`: nothing was accepted for the work (plan item C3).
 */
export type SubmissionBlockReason =
  | "segment_unsigned"
  | "record_mismatch"
  | "record_discontinuous"
  | "no_evidence";

/**
 * `submit` is the only decision that lets `record_submission` run. `retry`
 * is an outage, never a verdict on the record: the request and its
 * `requested_at` stay as they are (P5) and the same request is tried again.
 */
export type SubmissionDecision =
  | {
      decision: "submit";
      artifactSha256: string;
      evidenceHeadSegmentHash: string;
      evidenceRecord: "continuous";
    }
  | { decision: "blocked"; reason: SubmissionBlockReason }
  | { decision: "retry"; stage: "chain" | "storage" | "verification" };

/** The decision on a submission from the outcome of its reconstruction. */
export function decideSubmission(outcome: EvidenceReconstructionOutcome): SubmissionDecision {
  switch (outcome.status) {
    case "match":
      return {
        decision: "submit",
        artifactSha256: outcome.documentSha256,
        evidenceHeadSegmentHash: outcome.head.segmentHash,
        evidenceRecord: "continuous",
      };
    case "mismatch":
      return {
        decision: "blocked",
        reason: outcome.reason === "receipt_missing" ? "segment_unsigned" : "record_mismatch",
      };
    case "discontinuity":
      return { decision: "blocked", reason: "record_discontinuous" };
    case "no_evidence":
      return { decision: "blocked", reason: "no_evidence" };
    case "unavailable":
      return { decision: "retry", stage: outcome.stage };
  }
}

export type SubmissionReceiptIssue =
  | { status: "signed"; receipt: SignedSubmissionReceiptV1 }
  | { status: "unavailable"; reason: "invalid_payload" | "signing" };

/**
 * Signs a submission receipt and checks the signature before handing it out.
 * Fails closed (plan item E5): no key, a signer that throws, a signature of
 * another algorithm or one that does not verify gives no receipt at all,
 * never an unsigned one. The payload is deterministic, and so is Ed25519, so
 * the same submission signed again under the same key gives the same receipt.
 */
export async function issueSubmissionReceipt(
  signer: Pick<SigningKeyProvider, "sign" | "verify">,
  payload: SubmissionReceiptPayloadV1,
): Promise<SubmissionReceiptIssue> {
  let digest: Awaited<ReturnType<typeof digestSubmissionReceiptPayloadV1>>;
  try {
    digest = await digestSubmissionReceiptPayloadV1(payload);
  } catch {
    return { status: "unavailable", reason: "invalid_payload" };
  }
  try {
    const signature = await signer.sign(digest.signingInput);
    const receipt = {
      payload: JSON.parse(digest.canonical) as SubmissionReceiptPayloadV1,
      payloadDigestSha256: digest.sha256,
      signature,
    };
    if (!isSignedSubmissionReceiptV1(receipt)) return { status: "unavailable", reason: "signing" };
    if ((await signer.verify(digest.signingInput, signature)) !== true) {
      return { status: "unavailable", reason: "signing" };
    }
    return { status: "signed", receipt };
  } catch {
    return { status: "unavailable", reason: "signing" };
  }
}

import type {
  EvidenceChainReader,
  EvidencePayloadReader,
} from "@/application/ports/evidence-reconstruction";
import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import {
  verifyCanonicalEvidencePayloadV2,
  verifyEvidenceChainV2,
  type EvidenceChainDiscontinuityV2,
  type EvidenceChainFailureV2,
  type EvidenceChainHeadV2,
} from "@/domain/forensics/evidence-chain-v2";
import { digestEvidenceReceiptPayload } from "@/domain/forensics/evidence-receipt";
import {
  replayEvidenceSegmentsV2,
  type EvidenceReplayFailureV2,
  type EvidenceStepReplayerV2,
} from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceSegmentV2 } from "@/domain/forensics/evidence-segment-v2";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";

type ReconstructionDependencies<TDocument> = {
  chain: EvidenceChainReader;
  payloads: EvidencePayloadReader;
  signer: Pick<SigningKeyProvider, "verify">;
  replayer: EvidenceStepReplayerV2<TDocument>;
};

export type EvidenceReconstructionFailure =
  | EvidenceChainFailureV2
  | EvidenceReplayFailureV2
  | "missing_payload"
  | "receipt_missing"
  | "receipt_mismatch"
  | "receipt_signature_invalid"
  | "target_mismatch";

/**
 * `match` is the only outcome that lets a submission proceed.
 *
 * `mismatch` means the stored record is broken or does not reproduce the
 * target document, and blocks (D-11); `index` is the segment's chain position.
 *
 * `discontinuity` is not a verdict on the record: the chain is intact, but a
 * segment does not continue the one before it, so this pass cannot replay
 * across the break. It has no checkpoints and no recorded gaps; B-12 compares
 * the break with the recorded gaps and restarts from the checkpoint after it.
 */
export type EvidenceReconstructionOutcome =
  | { status: "match"; head: EvidenceChainHeadV2 | null; documentSha256: string }
  | {
      status: "mismatch";
      reason: EvidenceReconstructionFailure;
      index: number | null;
    }
  | { status: "discontinuity"; discontinuity: EvidenceChainDiscontinuityV2 }
  | {
      status: "unavailable";
      stage: "chain" | "storage" | "verification";
      reason: string;
    };

function mismatch(
  reason: EvidenceReconstructionFailure,
  index: number | null,
): EvidenceReconstructionOutcome {
  return { status: "mismatch", reason, index };
}

/**
 * Thin critical path of a submission (B-14, D-98): read what was accepted,
 * verify the bytes against the chain head and the signed receipts, replay
 * the steps and compare the result with the target in canonical form (JCS).
 *
 * `initialDocument` is the document the first stored segment starts from.
 * The caller authorizes the submission before calling.
 */
export async function reconstructAndCompareEvidence<TDocument>(
  dependencies: ReconstructionDependencies<TDocument>,
  input: {
    evidencePackageId: string;
    initialDocument: JcsJsonValue;
    expectedDocument: JcsJsonValue;
  },
): Promise<EvidenceReconstructionOutcome> {
  const expected = canonicalizeJcs(input.expectedDocument);

  const chain = await dependencies.chain.readChain(input.evidencePackageId);
  if (chain.status === "unavailable") {
    return { status: "unavailable", stage: "chain", reason: chain.reason };
  }

  const payloads: Uint8Array[] = [];
  for (const [index, entry] of chain.segments.entries()) {
    const read = await dependencies.payloads.readImmutable({
      evidencePackageId: input.evidencePackageId,
      segmentHash: entry.segmentHash,
    });
    if (read.status === "unavailable") {
      return { status: "unavailable", stage: "storage", reason: read.reason };
    }
    if (read.status === "not_found") return mismatch("missing_payload", index);
    // Copy once so the bytes that are verified are the bytes that are replayed.
    payloads.push(new Uint8Array(read.bytes));
  }

  const verifiedChain = await verifyEvidenceChainV2(payloads, chain.head);
  if (!verifiedChain.ok) return mismatch(verifiedChain.reason, verifiedChain.index);
  if (verifiedChain.discontinuities.length > 0) {
    return { status: "discontinuity", discontinuity: verifiedChain.discontinuities[0] };
  }

  const segments: EvidenceSegmentV2[] = [];
  let previousReceiptId: string | null = null;
  for (const [index, entry] of chain.segments.entries()) {
    const verified = await verifyCanonicalEvidencePayloadV2(payloads[index]);
    if (!verified.ok) return mismatch("invalid_segment", index);

    const receipt = entry.receipt;
    if (receipt === null) return mismatch("receipt_missing", index);
    const digest = await digestEvidenceReceiptPayload(receipt.payload);
    if (
      receipt.payload.evidencePackageId !== input.evidencePackageId ||
      receipt.payload.segmentHash !== verified.sha256 ||
      receipt.payload.previousReceiptId !== previousReceiptId ||
      receipt.payloadDigestSha256 !== digest.sha256
    ) {
      return mismatch("receipt_mismatch", index);
    }
    let signatureValid: boolean;
    try {
      signatureValid = await dependencies.signer.verify(digest.bytes, receipt.signature);
    } catch (error) {
      return {
        status: "unavailable",
        stage: "verification",
        reason: error instanceof Error ? error.message : "verification failed",
      };
    }
    if (!signatureValid) return mismatch("receipt_signature_invalid", index);

    previousReceiptId = receipt.payload.receiptId;
    segments.push(verified.segment);
  }

  const replayed = await replayEvidenceSegmentsV2(
    input.initialDocument,
    segments,
    dependencies.replayer,
  );
  if (!replayed.ok) return mismatch(replayed.reason, replayed.segmentIndex);
  if (replayed.canonicalDocument !== expected) return mismatch("target_mismatch", null);

  return {
    status: "match",
    head: verifiedChain.head,
    documentSha256: replayed.documentSha256,
  };
}

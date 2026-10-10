import type {
  EvidenceChainReader,
  EvidenceChainReadResult,
  EvidencePayloadReader,
  EvidencePayloadReadResult,
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
  findEvidenceStartBreakV2,
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
  | "invalid_target"
  | "target_mismatch";

/**
 * `match` is the only outcome that lets a submission proceed. It always
 * stands on at least one verified segment, so `head` is never `null`.
 *
 * `mismatch` means the stored record is broken or does not reproduce the
 * target document, and blocks (D-11); `index` is the segment's chain position.
 * `invalid_target` is a target with no canonical form (not JSON as RFC 8785
 * takes it): nothing can reproduce it.
 *
 * `discontinuity` is returned only for a record that passed every check this
 * pass can make: the bytes against the head, every receipt and signature, and
 * the replay of the segments before the break. The segment at
 * `discontinuity.index` does not continue what stands before it, so nothing
 * from there on is replayed and the target is not compared. Only the first
 * break is reported; a later one, even a `regression`, is not in this outcome.
 * This pass has no checkpoints and no recorded gaps; B-12 compares the break
 * with the recorded gaps and restarts from the checkpoint after it.
 *
 * `index: 0` is a break at the start of the record. The first segment
 * continues a virtual start (`previousSequenceTo: 0`, the hash of
 * `initialDocument`): a record that begins after event 1, or from another
 * document, is a break there and never a `match`, whatever it replays to.
 * This pass cannot tell a wrong `initialDocument` from a record that starts
 * somewhere else; both are that break. A reconstruction that starts from a
 * checkpoint (ARCHITECTURE §5 and §6) starts after event 1 on purpose, but
 * the input has no event number for the starting document, so that start is
 * a break here too (the closed side) until B-12 adds one.
 *
 * `no_evidence` means nothing was accepted for the package, or the store does
 * not know the package. An empty record proves nothing about any document,
 * so it is never a `match`, not even for a target equal to the starting
 * document. It is not `unavailable` either: a retry gives the same answer.
 */
export type EvidenceReconstructionOutcome =
  | { status: "match"; head: EvidenceChainHeadV2; documentSha256: string }
  | {
      status: "mismatch";
      reason: EvidenceReconstructionFailure;
      index: number | null;
    }
  | { status: "discontinuity"; discontinuity: EvidenceChainDiscontinuityV2 }
  | { status: "no_evidence" }
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

/** A dependency that threw or rejected did not answer; that is never a verdict. */
function unavailable(
  stage: "chain" | "storage" | "verification",
  error: unknown,
): EvidenceReconstructionOutcome {
  return {
    status: "unavailable",
    stage,
    reason: error instanceof Error ? error.message : `${stage} failed`,
  };
}

/**
 * Thin critical path of a submission (B-14, D-98): read what was accepted,
 * verify the bytes against the chain head and the signed receipts, replay
 * the steps and compare the result with the target in canonical form (JCS).
 *
 * `initialDocument` is the document the record starts from, before event 1.
 * The caller authorizes the submission before calling.
 *
 * A port that throws or rejects is `unavailable`, and an input without a
 * canonical form is a `mismatch`; neither leaves as an exception. A port
 * result that breaks the port's own type is a bug in the adapter and is not
 * handled here.
 *
 * Order of precedence. When several faults are present, the outcome is the
 * first of these that applies; inside a step, the lowest chain position wins:
 *
 * 1. `unavailable` (chain): the chain listing cannot be read, or its port
 *    rejects.
 * 2. Stored bytes, per segment: `unavailable` (storage, also when the port
 *    rejects), `missing_payload`.
 * 3. Chain against the head: per segment `too_large` or `invalid_segment`,
 *    `predecessor_mismatch`, `document_mismatch`; then `head_mismatch`.
 * 4. `no_evidence`: the head is `null` and no segment is listed.
 * 5. Receipts, per segment: `receipt_missing`, `receipt_mismatch` (also a
 *    receipt with no canonical form), `unavailable` (verification),
 *    `receipt_signature_invalid`.
 * 6. `invalid_document`: the starting document cannot be loaded or hashed.
 * 7. The first break is located: at the start (index 0) when the first
 *    segment does not continue the starting document, otherwise the first
 *    one between two segments.
 * 8. Replay, per segment and only of the segments before that break (none
 *    for a break at the start): `unsupported_format`,
 *    `document_hash_mismatch`, `step_failed`.
 * 9. `discontinuity`, for the break of step 7.
 * 10. `invalid_target`, then `target_mismatch`.
 * 11. `match`.
 *
 * So the three outcomes that are not a fault (`no_evidence`, `discontinuity`,
 * `match`) are reached only after steps 1 to 3, and the last two only after
 * every receipt and signature was verified: a break in the sequence never
 * hides a broken record. `match` also needs a record that starts at event 1
 * on top of `initialDocument` and has no break after that. `unavailable` and
 * `mismatch` both block; an outage can be reported ahead of a fault that a
 * later step would find, and a retry then reports that fault. The target is
 * judged last, where it is compared: an invalid target does not hide a fault
 * of the record, and `no_evidence` and `discontinuity` say nothing about it.
 */
export async function reconstructAndCompareEvidence<TDocument>(
  dependencies: ReconstructionDependencies<TDocument>,
  input: {
    evidencePackageId: string;
    initialDocument: JcsJsonValue;
    expectedDocument: JcsJsonValue;
  },
): Promise<EvidenceReconstructionOutcome> {
  let chain: EvidenceChainReadResult;
  try {
    chain = await dependencies.chain.readChain(input.evidencePackageId);
  } catch (error) {
    return unavailable("chain", error);
  }
  if (chain.status === "unavailable") {
    return { status: "unavailable", stage: "chain", reason: chain.reason };
  }

  const payloads: Uint8Array[] = [];
  for (const [index, entry] of chain.segments.entries()) {
    let read: EvidencePayloadReadResult;
    try {
      read = await dependencies.payloads.readImmutable({
        evidencePackageId: input.evidencePackageId,
        segmentHash: entry.segmentHash,
      });
    } catch (error) {
      return unavailable("storage", error);
    }
    if (read.status === "unavailable") {
      return { status: "unavailable", stage: "storage", reason: read.reason };
    }
    if (read.status === "not_found") return mismatch("missing_payload", index);
    // Copy once so the bytes that are verified are the bytes that are replayed.
    payloads.push(new Uint8Array(read.bytes));
  }

  const verifiedChain = await verifyEvidenceChainV2(payloads, chain.head);
  if (!verifiedChain.ok) return mismatch(verifiedChain.reason, verifiedChain.index);
  // The head is `null` exactly when no segment is listed (anything else is a
  // `head_mismatch` above). Nothing accepted is not a confirmed reconstruction.
  if (verifiedChain.head === null) return { status: "no_evidence" };

  // Receipts come before any word about a break in the sequence: a record
  // with a missing receipt or a bad signature is broken, not discontinuous.
  const segments: EvidenceSegmentV2[] = [];
  let previousReceiptId: string | null = null;
  for (const [index, entry] of chain.segments.entries()) {
    const verified = await verifyCanonicalEvidencePayloadV2(payloads[index]);
    if (!verified.ok) return mismatch("invalid_segment", index);

    const receipt = entry.receipt;
    if (receipt === null) return mismatch("receipt_missing", index);
    // A payload with no canonical form has no digest, so it is not the signed one.
    const digest = await digestEvidenceReceiptPayload(receipt.payload).catch(() => null);
    if (
      digest === null ||
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
      return unavailable("verification", error);
    }
    if (!signatureValid) return mismatch("receipt_signature_invalid", index);

    previousReceiptId = receipt.payload.receiptId;
    segments.push(verified.segment);
  }

  // The first segment has no predecessor, so nothing above looked at where the
  // record starts. It has to continue the starting document from event 1.
  const start = await findEvidenceStartBreakV2(
    input.initialDocument,
    segments[0],
    dependencies.replayer,
  );
  if (!start.ok) return mismatch(start.reason, null);

  // Never replay across a break: with one, only the segments before it are
  // replayed, so a fault in them is still a `mismatch`.
  const firstBreak = start.discontinuity ?? verifiedChain.discontinuities.at(0);
  const replayed = await replayEvidenceSegmentsV2(
    input.initialDocument,
    firstBreak ? segments.slice(0, firstBreak.index) : segments,
    dependencies.replayer,
  );
  if (!replayed.ok) return mismatch(replayed.reason, replayed.segmentIndex);
  if (firstBreak) return { status: "discontinuity", discontinuity: firstBreak };

  let expected: string;
  try {
    expected = canonicalizeJcs(input.expectedDocument);
  } catch {
    return mismatch("invalid_target", null);
  }
  if (replayed.canonicalDocument !== expected) return mismatch("target_mismatch", null);

  return {
    status: "match",
    head: verifiedChain.head,
    documentSha256: replayed.documentSha256,
  };
}

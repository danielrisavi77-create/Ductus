import type {
  EvidenceChainReader,
  EvidenceCheckpointReader,
  EvidenceCheckpointReadResult,
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
import {
  evidenceCheckpointHashesV2,
  evidenceResumeHashesV2,
  replayEvidenceAcrossGapsV2,
  replayEvidenceFromCheckpointV2,
  type EvidenceGapReplayResultV2,
} from "@/domain/forensics/evidence-checkpoint-v2";
import {
  digestEvidenceReceiptPayload,
  isSignedEvidenceReceipt,
} from "@/domain/forensics/evidence-receipt";
import {
  findEvidenceStartBreakV2,
  replayEvidenceSegmentsV2,
  type EvidenceReplayFailureV2,
  type EvidenceStepReplayerV2,
} from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceSegment } from "@/domain/forensics/evidence-segment-v2";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";

/**
 * What a receipt check says about the stored receipt of one segment (not
 * `null`: a missing receipt is `receipt_missing` before any check).
 * `unavailable` means the check could not be made, which is no word on the
 * record; `mismatch` and `signature_invalid` block (D-11).
 */
export type EvidenceReceiptCheckResult =
  | { status: "verified"; receiptId: string }
  | { status: "mismatch" | "signature_invalid" }
  | { status: "unavailable"; reason: string };

export type EvidenceReceiptCheck = (input: {
  receipt: unknown;
  index: number;
  evidencePackageId: string;
  /** SHA-256 of the segment's verified bytes. */
  segmentSha256: string;
  /** Receipt id of the segment before, `null` for the first. */
  previousReceiptId: string | null;
}) => Promise<EvidenceReceiptCheckResult>;

/** Receipts v1 under one signer: the check of the thin path (B-14). */
export function signerReceiptCheck(signer: Pick<SigningKeyProvider, "verify">): EvidenceReceiptCheck {
  return async ({ receipt, evidencePackageId, segmentSha256, previousReceiptId }) => {
    // The signature covers the payload only; a field next to it, or a payload
    // of another shape, is not what was issued.
    if (!isSignedEvidenceReceipt(receipt)) return { status: "mismatch" };
    // A payload with no canonical form has no digest, so it is not the signed one.
    const digest = await digestEvidenceReceiptPayload(receipt.payload).catch(() => null);
    if (
      digest === null ||
      receipt.payload.evidencePackageId !== evidencePackageId ||
      receipt.payload.segmentHash !== segmentSha256 ||
      receipt.payload.previousReceiptId !== previousReceiptId ||
      receipt.payloadDigestSha256 !== digest.sha256
    ) {
      return { status: "mismatch" };
    }
    const valid = await signer.verify(digest.bytes, receipt.signature);
    return valid ? { status: "verified", receiptId: receipt.payload.receiptId } : { status: "signature_invalid" };
  };
}

type ReconstructionDependencies<TDocument> = {
  chain: EvidenceChainReader<unknown>;
  payloads: EvidencePayloadReader;
  replayer: EvidenceStepReplayerV2<TDocument>;
  /** Without it no break is ever crossed: the first one is the outcome. */
  checkpoints?: EvidenceCheckpointReader;
} & (
  | { signer: Pick<SigningKeyProvider, "verify">; receipts?: undefined }
  | { receipts: EvidenceReceiptCheck; signer?: undefined }
);

export type EvidenceReconstructionFailure =
  | EvidenceChainFailureV2
  | EvidenceReplayFailureV2
  | "missing_payload"
  | "receipt_missing"
  | "receipt_mismatch"
  | "receipt_signature_invalid"
  | "checkpoint_invalid"
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
 * With a checkpoint reader, see `match_across_gaps`.
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
 * `match_across_gaps` (B-12, D-191 t. 4) is reached only with a checkpoint
 * reader: the record reproduces the target, but only by continuing past
 * `breaks` (every break of the record, in order, never empty) from verified
 * checkpoints. Only a `gap` is crossed, and only from bytes that are the
 * canonical form of the document the chain names at the end of the gap. The
 * gaps stay in the outcome (D-11) and it is not a `match`. A checkpoint that
 * fails that check is `checkpoint_invalid` at the break; a gap with no
 * checkpoint, or a break that is not a gap, is `discontinuity` for that break.
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
  | {
      status: "match_across_gaps";
      head: EvidenceChainHeadV2;
      documentSha256: string;
      breaks: EvidenceChainDiscontinuityV2[];
    }
  | { status: "no_evidence" }
  | {
      status: "unavailable";
      stage: "chain" | "storage" | "verification";
      reason: string;
    };

/**
 * What a reconstruction that may start at a checkpoint returns (B-12,
 * ARCHITECTURE §6 t. 3). `match_from_checkpoint` says the record reproduces
 * the target from the checkpoint the chain vouches for at segment
 * `resumedAt` (never 0), with every break after it crossed as in
 * `match_across_gaps`; `breaks` is every break of the record, also those
 * before `resumedAt`.
 *
 * It is not a `match` and not a `match_across_gaps`, and no submission is
 * decided on it: the segments before `resumedAt` were verified against the
 * head and their receipts, but not replayed, so a step in them that does not
 * apply is not seen. The checkpoint comes from the client; the chain proves
 * only that its bytes are the document the segment at `resumedAt` names as
 * its start.
 */
export type EvidenceResumedReconstructionOutcome =
  | EvidenceReconstructionOutcome
  | {
      status: "match_from_checkpoint";
      head: EvidenceChainHeadV2;
      documentSha256: string;
      breaks: EvidenceChainDiscontinuityV2[];
      resumedAt: number;
    };

type ReconstructionInput = {
  evidencePackageId: string;
  initialDocument: JcsJsonValue;
} & (
  | { expectedDocument: JcsJsonValue; expectedDocumentSha256?: undefined }
  /** The target by its hash (a stored revision's `content_hash`, BACKEND 4.10 t. 1). */
  | { expectedDocumentSha256: string; expectedDocument?: undefined }
);

/** The record after steps 1 to 7 below: verified, with every break located. */
type VerifiedRecord = {
  head: EvidenceChainHeadV2;
  segments: EvidenceSegment[];
  /** Every break of the record in order, the one at the start first. */
  breaks: EvidenceChainDiscontinuityV2[];
};

/**
 * How many of the newest positions a resumed reconstruction asks checkpoints
 * for. A bound on one read, not a cadence: with no checkpoint among them the
 * replay starts at the beginning, which is slower and gives the same outcome.
 */
const RESUME_CANDIDATES = 32;

const SHA256_HEX = /^[0-9a-f]{64}$/;

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
 * 5. Receipts, per segment: `receipt_missing`, then the receipt check
 *    (`signerReceiptCheck` for v1 unless another is given):
 *    `receipt_mismatch` (also a receipt with an unknown or malformed field,
 *    or with no canonical form), `unavailable` (verification, also when the
 *    check throws), `receipt_signature_invalid`.
 * 6. `invalid_document`: the starting document cannot be loaded or hashed.
 * 7. The first break is located: at the start (index 0) when the first
 *    segment does not continue the starting document, otherwise the first
 *    one between two segments.
 * 8. Replay, per segment and only of the segments before that break (none
 *    for a break at the start): `unsupported_format`,
 *    `document_hash_mismatch`, `step_failed`.
 * 9. Without a checkpoint reader, or when the break of step 7 is not a
 *    gap: `discontinuity` for that break.
 * 10. With a reader, one read for the checkpoint hashes of every gap:
 *    `unavailable` (storage, also when the port rejects). Then the replay
 *    of the whole record across the gaps, in record order: the replay
 *    faults of step 8 and `checkpoint_invalid` are a `mismatch`, a gap with
 *    no checkpoint or a later break that is not a gap is `discontinuity`.
 * 11. `invalid_target`, then `target_mismatch`; a target given by its hash
 *    is compared with the hash of the replayed document.
 * 12. `match`, or `match_across_gaps` when a gap was crossed.
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
  input: ReconstructionInput,
): Promise<EvidenceReconstructionOutcome> {
  return reconstruct(dependencies, input);
}

/**
 * The same pass, started at the newest checkpoint the chain vouches for
 * instead of at the beginning (B-12, D-191 t. 4), for a worker that runs a
 * reconstruction again or picks one up after a gap. Steps 1 to 7 are those of
 * `reconstructAndCompareEvidence`: every segment and receipt of the record is
 * verified whatever the start. Then:
 *
 * 8. One read for the checkpoints at the gaps and at the newest
 *    `RESUME_CANDIDATES` positions before the first break that is not a gap
 *    (no read when there is no such position): `unavailable` (storage, also
 *    when the port rejects).
 * 9. The replay starts at the newest of those positions whose checkpoint the
 *    chain vouches for, before the first break the full replay cannot cross;
 *    a checkpoint that is missing, damaged or of another document is passed
 *    over and an older one, or the beginning, is the start. Faults from the
 *    start on are reported as in steps 8 and 10 above.
 * 10. `invalid_target`, then `target_mismatch`.
 * 11. `match_from_checkpoint` when the start was a checkpoint; otherwise
 *    `match`, or `match_across_gaps` when a gap was crossed.
 *
 * With the same checkpoints the outcome is the one of the full pass, except
 * that a success from a checkpoint is `match_from_checkpoint` and that a
 * replay fault before the start is not seen (see the outcome type). The
 * checkpoints are read once, so one written during the pass is not used and
 * cannot change the start between two steps; a second pass may start later
 * and gives the same verdict on the segments both replay.
 */
export async function reconstructEvidenceFromCheckpoint<TDocument>(
  dependencies: ReconstructionDependencies<TDocument> & { checkpoints: EvidenceCheckpointReader },
  input: ReconstructionInput,
): Promise<EvidenceResumedReconstructionOutcome> {
  return reconstruct(dependencies, input, async ({ head, segments, breaks }) => {
    const documentHashes = [
      ...new Set([
        ...evidenceCheckpointHashesV2(segments, breaks),
        ...evidenceResumeHashesV2(segments, breaks, RESUME_CANDIDATES),
      ]),
    ].sort();
    let checkpoints: ReadonlyMap<string, Uint8Array> = new Map();
    if (documentHashes.length > 0) {
      const read = await readCheckpoints(dependencies.checkpoints, input.evidencePackageId, documentHashes);
      if (read.status !== "found") return read;
      checkpoints = read.checkpoints;
    }
    const resumed = await replayEvidenceFromCheckpointV2(
      input.initialDocument,
      segments,
      dependencies.replayer,
      checkpoints,
    );
    if (!resumed.ok) return replayStop(resumed);
    const { documentSha256, resumedAt } = resumed;
    const fault = targetFault(input, resumed);
    if (fault) return fault;
    if (resumedAt > 0) return { status: "match_from_checkpoint", head, documentSha256, breaks: resumed.breaks, resumedAt };
    if (resumed.breaks.length > 0) return { status: "match_across_gaps", head, documentSha256, breaks: resumed.breaks };
    return { status: "match", head, documentSha256 };
  });
}

/** One read of the checkpoints under `documentHashes`; a port that rejects did not answer. */
async function readCheckpoints(
  reader: EvidenceCheckpointReader,
  evidencePackageId: string,
  documentHashes: string[],
): Promise<Extract<EvidenceCheckpointReadResult, { status: "found" }> | EvidenceReconstructionOutcome> {
  let read: EvidenceCheckpointReadResult;
  try {
    read = await reader.readCheckpoints({ evidencePackageId, documentHashes });
  } catch (error) {
    return unavailable("storage", error);
  }
  return read.status === "unavailable" ? { status: "unavailable", stage: "storage", reason: read.reason } : read;
}

/** A replay that stopped: at a break it could not cross, or on a fault. */
function replayStop(stop: Exclude<EvidenceGapReplayResultV2, { ok: true }>): EvidenceReconstructionOutcome {
  if (stop.reason === "checkpoint_missing" || stop.reason === "break_not_resumable") {
    return { status: "discontinuity", discontinuity: stop.discontinuity };
  }
  return mismatch(stop.reason, stop.segmentIndex);
}

async function reconstruct<TDocument, TResumed = never>(
  dependencies: ReconstructionDependencies<TDocument>,
  input: ReconstructionInput,
  resume?: (record: VerifiedRecord) => Promise<EvidenceReconstructionOutcome | TResumed>,
): Promise<EvidenceReconstructionOutcome | TResumed> {
  const checkReceipt = dependencies.receipts ?? signerReceiptCheck(dependencies.signer);
  let chain: EvidenceChainReadResult<unknown>;
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
  const segments: EvidenceSegment[] = [];
  let previousReceiptId: string | null = null;
  for (const [index, entry] of chain.segments.entries()) {
    const verified = await verifyCanonicalEvidencePayloadV2(payloads[index]);
    if (!verified.ok) return mismatch("invalid_segment", index);

    const receipt = entry.receipt;
    if (receipt === null) return mismatch("receipt_missing", index);
    let checked: EvidenceReceiptCheckResult;
    try {
      checked = await checkReceipt({
        receipt,
        index,
        evidencePackageId: input.evidencePackageId,
        segmentSha256: verified.sha256,
        previousReceiptId,
      });
    } catch (error) {
      return unavailable("verification", error);
    }
    if (checked.status === "unavailable") {
      return { status: "unavailable", stage: "verification", reason: checked.reason };
    }
    if (checked.status !== "verified") {
      return mismatch(checked.status === "mismatch" ? "receipt_mismatch" : "receipt_signature_invalid", index);
    }

    previousReceiptId = checked.receiptId;
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
  const breaks = [...(start.discontinuity ? [start.discontinuity] : []), ...verifiedChain.discontinuities];
  if (resume) return resume({ head: verifiedChain.head, segments, breaks });

  // Never replay across a break: with one, only the segments before it are
  // replayed, so a fault in them is still a `mismatch`.
  const firstBreak = start.discontinuity ?? verifiedChain.discontinuities.at(0);
  const replayed = await replayEvidenceSegmentsV2(
    input.initialDocument,
    firstBreak ? segments.slice(0, firstBreak.index) : segments,
    dependencies.replayer,
  );
  if (!replayed.ok) return mismatch(replayed.reason, replayed.segmentIndex);
  if (!firstBreak) {
    return (
      targetFault(input, replayed) ?? {
        status: "match",
        head: verifiedChain.head,
        documentSha256: replayed.documentSha256,
      }
    );
  }
  if (dependencies.checkpoints === undefined || firstBreak.sequence !== "gap") {
    return { status: "discontinuity", discontinuity: firstBreak };
  }

  // Only the checkpoints at the gaps are asked for, so one offered anywhere
  // else is never read and never stands in for a replayed event.
  const read = await readCheckpoints(
    dependencies.checkpoints,
    input.evidencePackageId,
    evidenceCheckpointHashesV2(segments, breaks),
  );
  if (read.status !== "found") return read;

  const across = await replayEvidenceAcrossGapsV2(
    input.initialDocument,
    segments,
    dependencies.replayer,
    read.checkpoints,
  );
  if (!across.ok) return replayStop(across);
  return (
    targetFault(input, across) ?? {
      status: "match_across_gaps",
      head: verifiedChain.head,
      documentSha256: across.documentSha256,
      breaks: across.breaks,
    }
  );
}

/** `invalid_target` or `target_mismatch`, or `null` when the replay reproduces the target. */
function targetFault(
  input: ReconstructionInput,
  replayed: { canonicalDocument: string; documentSha256: string },
): EvidenceReconstructionOutcome | null {
  if (input.expectedDocumentSha256 !== undefined) {
    if (!SHA256_HEX.test(input.expectedDocumentSha256)) return mismatch("invalid_target", null);
    if (replayed.documentSha256 !== input.expectedDocumentSha256) return mismatch("target_mismatch", null);
    return null;
  }
  let expected: string;
  try {
    expected = canonicalizeJcs(input.expectedDocument);
  } catch {
    return mismatch("invalid_target", null);
  }
  return replayed.canonicalDocument === expected ? null : mismatch("target_mismatch", null);
}

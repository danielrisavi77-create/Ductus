import type {
  EvidenceIngestCommandV2,
  EvidenceIngestOutcome,
  EvidenceSegmentDescriptorV2,
} from "@/application/ports/evidence-ingest";
import type { EvidenceOutboxItem } from "@/application/ports/evidence-outbox";
import type { SignedEvidenceReceipt } from "@/domain/forensics/evidence-receipt";
import {
  digestEvidenceSegmentV2,
  type EvidenceSegmentV2,
} from "@/domain/forensics/evidence-segment-v2";

function canonicalInstant(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export async function buildEvidenceIngestCommandV2(input: {
  evidencePackageId: string;
  clientRequestId: string;
  segment: EvidenceSegmentV2;
}): Promise<EvidenceIngestCommandV2> {
  // Snapshot before await so payload and descriptor come from the same state.
  const segment = structuredClone(input.segment);
  const evidencePackageId = input.evidencePackageId;
  const clientRequestId = input.clientRequestId;
  const digest = await digestEvidenceSegmentV2(segment);
  const descriptor: EvidenceSegmentDescriptorV2 = {
    evidencePackageId,
    documentId: segment.documentId,
    sessionId: segment.sessionId,
    segmentId: segment.segmentId,
    evidenceSchema: segment.evidenceSchema,
    canonicalization: segment.canonicalization,
    hashAlgorithm: segment.hashAlgorithm,
    evidenceProfileId: segment.evidenceProfileId,
    sequenceFrom: segment.sequenceFrom,
    sequenceTo: segment.sequenceTo,
    eventCount: segment.events.length,
    observedStartedAt: segment.observedStartedAt,
    observedEndedAt: segment.observedEndedAt,
    segmentHash: digest.sha256,
    predecessorSegmentHash: segment.predecessorSegmentHash,
    payloadBytes: digest.byteLength,
  };

  return Object.freeze({
    clientRequestId,
    descriptor: Object.freeze(descriptor),
    canonicalPayload: digest.canonical,
  });
}

export async function createEvidenceOutboxItem(input: {
  id: string;
  evidencePackageId: string;
  clientRequestId: string;
  segment: EvidenceSegmentV2;
  createdAt: string;
}): Promise<EvidenceOutboxItem> {
  if (!input.id.trim() || !canonicalInstant(input.createdAt)) {
    throw new Error("evidence-outbox: invalid identity/time");
  }

  return {
    id: input.id,
    command: await buildEvidenceIngestCommandV2(input),
    status: "pending",
    attempts: 0,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

export function beginEvidenceOutboxAttempt(
  item: EvidenceOutboxItem,
  updatedAt: string,
): EvidenceOutboxItem {
  if (item.status !== "pending" || !canonicalInstant(updatedAt)) {
    throw new Error("evidence-outbox: invalid attempt transition");
  }
  return {
    ...item,
    status: "uploading",
    attempts: item.attempts + 1,
    updatedAt,
    lastFailure: undefined,
  };
}

function receiptMatchesCommand(
  receipt: SignedEvidenceReceipt,
  item: EvidenceOutboxItem,
): boolean {
  const p = receipt.payload;
  const d = item.command.descriptor;
  return (
    p.evidencePackageId === d.evidencePackageId &&
    p.documentId === d.documentId &&
    p.sessionId === d.sessionId &&
    p.segmentId === d.segmentId &&
    p.segmentHash === d.segmentHash &&
    p.predecessorSegmentHash === d.predecessorSegmentHash &&
    p.evidenceSchema === d.evidenceSchema &&
    p.evidenceProfileId === d.evidenceProfileId &&
    p.sequenceFrom === d.sequenceFrom &&
    p.sequenceTo === d.sequenceTo &&
    p.eventCount === d.eventCount &&
    p.payloadBytes === d.payloadBytes
  );
}

export function applyEvidenceOutboxOutcome(
  item: EvidenceOutboxItem,
  outcome: EvidenceIngestOutcome,
  updatedAt: string,
): EvidenceOutboxItem {
  if (item.status !== "uploading" || !canonicalInstant(updatedAt)) {
    throw new Error("evidence-outbox: invalid outcome transition");
  }

  if (outcome.status === "accepted" || outcome.status === "duplicate") {
    // A receipt only settles the item it was issued for.
    if (!receiptMatchesCommand(outcome.receipt, item)) {
      return { ...item, status: "blocked", updatedAt, lastFailure: "invalid" };
    }
    return {
      ...item,
      status: "accepted",
      updatedAt,
      receipt: outcome.receipt,
      lastFailure: undefined,
    };
  }

  if (outcome.status === "unavailable") {
    return {
      ...item,
      status: "pending",
      updatedAt,
      lastFailure: outcome.status,
    };
  }

  return {
    ...item,
    status: "blocked",
    updatedAt,
    lastFailure: outcome.status,
  };
}

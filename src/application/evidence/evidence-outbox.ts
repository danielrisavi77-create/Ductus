import type {
  EvidenceIngestCommandV2,
  EvidenceIngestOutcome,
  EvidenceSegmentDescriptorV2,
} from "@/application/ports/evidence-ingest";
import type { EvidenceOutboxItem } from "@/application/ports/evidence-outbox";
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
  const digest = await digestEvidenceSegmentV2(input.segment);
  const descriptor: EvidenceSegmentDescriptorV2 = {
    evidencePackageId: input.evidencePackageId,
    documentId: input.segment.documentId,
    sessionId: input.segment.sessionId,
    segmentId: input.segment.segmentId,
    evidenceSchema: input.segment.evidenceSchema,
    canonicalization: input.segment.canonicalization,
    hashAlgorithm: input.segment.hashAlgorithm,
    evidenceProfileId: input.segment.evidenceProfileId,
    sequenceFrom: input.segment.sequenceFrom,
    sequenceTo: input.segment.sequenceTo,
    eventCount: input.segment.events.length,
    observedStartedAt: input.segment.observedStartedAt,
    observedEndedAt: input.segment.observedEndedAt,
    segmentHash: digest.sha256,
    predecessorSegmentHash: input.segment.predecessorSegmentHash,
    payloadBytes: digest.byteLength,
  };

  return Object.freeze({
    clientRequestId: input.clientRequestId,
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

export function applyEvidenceOutboxOutcome(
  item: EvidenceOutboxItem,
  outcome: EvidenceIngestOutcome,
  updatedAt: string,
): EvidenceOutboxItem {
  if (item.status !== "uploading" || !canonicalInstant(updatedAt)) {
    throw new Error("evidence-outbox: invalid outcome transition");
  }

  if (outcome.status === "accepted" || outcome.status === "duplicate") {
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

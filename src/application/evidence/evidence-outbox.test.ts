import { describe, expect, it } from "vitest";

import type { EvidenceOutboxItem } from "@/application/ports/evidence-outbox";
import type { SignedEvidenceReceipt } from "@/domain/forensics/evidence-receipt";
import {
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  type EvidenceSegmentV2,
} from "@/domain/forensics/evidence-segment-v2";
import {
  applyEvidenceOutboxOutcome,
  beginEvidenceOutboxAttempt,
  buildEvidenceIngestCommandV2,
  createEvidenceOutboxItem,
} from "./evidence-outbox";

const A = "a".repeat(64);
const B = "b".repeat(64);

function segment(): EvidenceSegmentV2 {
  return {
    evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
    canonicalization: EVIDENCE_CANONICALIZATION_V2,
    hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
    documentId: "doc-1",
    sessionId: "session-1",
    segmentId: "segment-1",
    sequenceFrom: 1,
    sequenceTo: 1,
    observedStartedAt: "2026-10-03T06:00:00.000Z",
    observedEndedAt: "2026-10-03T06:00:01.000Z",
    initialDocumentHash: A,
    finalDocumentHash: B,
    predecessorSegmentHash: null,
    events: [
      {
        sequence: 1,
        occurredAt: "2026-10-03T06:00:00.500Z",
        elapsedMs: 500,
        source: "editor",
        steps: [{ stepType: "replace", from: 1, to: 1 }],
        beforeDocumentHash: A,
        afterDocumentHash: B,
      },
    ],
    captureContext: {
      editorModel: "prosemirror",
      transactionFormat: "prosemirror-step-json-v1",
    },
    evidenceProfileId: "standard-v1",
  };
}

function receiptFor(item: EvidenceOutboxItem): SignedEvidenceReceipt {
  const d = item.command.descriptor;
  const base = receipt();
  return {
    ...base,
    payload: {
      ...base.payload,
      evidencePackageId: d.evidencePackageId,
      documentId: d.documentId,
      sessionId: d.sessionId,
      segmentId: d.segmentId,
      segmentHash: d.segmentHash,
      predecessorSegmentHash: d.predecessorSegmentHash,
      sequenceFrom: d.sequenceFrom,
      sequenceTo: d.sequenceTo,
      eventCount: d.eventCount,
      payloadBytes: d.payloadBytes,
    },
  };
}

function receipt(): SignedEvidenceReceipt {
  return {
    payload: {
      receiptSchema: "ductus-evidence-receipt-v1",
      receiptId: "receipt-1",
      evidencePackageId: "evidence-1",
      documentId: "doc-1",
      sessionId: "session-1",
      segmentId: "segment-1",
      segmentHash: "c".repeat(64),
      predecessorSegmentHash: null,
      previousReceiptId: null,
      evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
      evidenceProfileId: "standard-v1",
      sequenceFrom: 1,
      sequenceTo: 1,
      eventCount: 1,
      payloadBytes: 100,
      acceptedAt: "2026-10-03T06:05:00.000Z",
    },
    payloadDigestSha256: "d".repeat(64),
    signature: {
      algorithm: "Ed25519",
      keyId: "test",
      keyVersion: "v1",
      signatureEncoding: "raw",
      signatureBase64Url: "signature",
    },
  };
}

describe("Evidence Outbox state machine", () => {
  it("creates immutable upload intent from exact Evidence v2 canonical bytes", async () => {
    const item = await createEvidenceOutboxItem({
      id: "outbox-1",
      evidencePackageId: "evidence-1",
      clientRequestId: "request-1",
      segment: segment(),
      createdAt: "2026-10-03T06:01:00.000Z",
    });

    expect(item).toMatchObject({
      id: "outbox-1",
      status: "pending",
      attempts: 0,
      createdAt: "2026-10-03T06:01:00.000Z",
    });
    expect(item.command.descriptor).toMatchObject({
      evidencePackageId: "evidence-1",
      evidenceSchema: "ductus-evidence-segment-v2",
      canonicalization: "RFC8785-JCS",
      hashAlgorithm: "sha256",
      eventCount: 1,
    });
    expect(item.command.descriptor.payloadBytes).toBe(
      new TextEncoder().encode(item.command.canonicalPayload).byteLength,
    );
    expect(item.command.descriptor.segmentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("retries transient unavailability without losing the immutable command", async () => {
    const original = await createEvidenceOutboxItem({
      id: "outbox-1",
      evidencePackageId: "evidence-1",
      clientRequestId: "request-1",
      segment: segment(),
      createdAt: "2026-10-03T06:01:00.000Z",
    });
    const command = original.command;

    const uploading = beginEvidenceOutboxAttempt(
      original,
      "2026-10-03T06:02:00.000Z",
    );
    const retry = applyEvidenceOutboxOutcome(
      uploading,
      {
        status: "unavailable",
        stage: "storage",
        reason: "offline",
      },
      "2026-10-03T06:02:01.000Z",
    );

    expect(retry.status).toBe("pending");
    expect(retry.attempts).toBe(1);
    expect(retry.lastFailure).toBe("unavailable");
    expect(retry.command).toEqual(command);

    const second = beginEvidenceOutboxAttempt(
      retry,
      "2026-10-03T06:03:00.000Z",
    );
    expect(second.attempts).toBe(2);
    expect(second.command).toEqual(command);
  });

  it("treats accepted and duplicate responses as the same anchored terminal state", async () => {
    for (const status of ["accepted", "duplicate"] as const) {
      const item = beginEvidenceOutboxAttempt(
        await createEvidenceOutboxItem({
          id: `outbox-${status}`,
          evidencePackageId: "evidence-1",
          clientRequestId: `request-${status}`,
          segment: segment(),
          createdAt: "2026-10-03T06:01:00.000Z",
        }),
        "2026-10-03T06:02:00.000Z",
      );

      const final = applyEvidenceOutboxOutcome(
        item,
        { status, receipt: receiptFor(item) },
        "2026-10-03T06:02:01.000Z",
      );
      expect(final.status).toBe("accepted");
      expect(final.receipt).toEqual(receiptFor(item));
      expect(() =>
        beginEvidenceOutboxAttempt(
          final,
          "2026-10-03T06:03:00.000Z",
        ),
      ).toThrow("invalid attempt transition");
    }
  });

  it("blocks non-transient semantic/security failures for explicit resolution", async () => {
    for (const outcome of [
      { status: "invalid" as const },
      { status: "unauthorized" as const },
      { status: "too_large" as const },
      { status: "not_accepting" as const },
      { status: "idempotency_conflict" as const },
      {
        status: "chain_conflict" as const,
        expectedPreviousSegmentHash: null,
      },
    ]) {
      const item = beginEvidenceOutboxAttempt(
        await createEvidenceOutboxItem({
          id: `outbox-${outcome.status}`,
          evidencePackageId: "evidence-1",
          clientRequestId: `request-${outcome.status}`,
          segment: segment(),
          createdAt: "2026-10-03T06:01:00.000Z",
        }),
        "2026-10-03T06:02:00.000Z",
      );

      const final = applyEvidenceOutboxOutcome(
        item,
        outcome,
        "2026-10-03T06:02:01.000Z",
      );
      expect(final.status).toBe("blocked");
      expect(final.lastFailure).toBe(outcome.status);
    }
  });

  it("does not settle an item with a receipt issued for another segment", async () => {
    const item = beginEvidenceOutboxAttempt(
      await createEvidenceOutboxItem({
        id: "outbox-mismatch",
        evidencePackageId: "evidence-1",
        clientRequestId: "request-mismatch",
        segment: segment(),
        createdAt: "2026-10-03T06:01:00.000Z",
      }),
      "2026-10-03T06:02:00.000Z",
    );
    const other = receiptFor(item);
    other.payload.segmentId = "segment-2";

    const final = applyEvidenceOutboxOutcome(
      item,
      { status: "accepted", receipt: other },
      "2026-10-03T06:02:01.000Z",
    );
    expect(final.status).toBe("blocked");
    expect(final.receipt).toBeUndefined();
  });

  it("builds payload and descriptor from one snapshot of the segment", async () => {
    const input = segment();
    const pending = buildEvidenceIngestCommandV2({
      evidencePackageId: "evidence-1",
      clientRequestId: "request-snapshot",
      segment: input,
    });
    input.segmentId = "changed-during-hash";
    const command = await pending;
    expect(command.descriptor.segmentId).toBe("segment-1");
    expect(JSON.parse(command.canonicalPayload).segmentId).toBe("segment-1");
  });
});

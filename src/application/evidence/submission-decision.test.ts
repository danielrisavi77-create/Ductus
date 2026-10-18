import { describe, expect, it, vi } from "vitest";

import { DevelopmentEd25519SigningKeyProvider } from "@/adapters/crypto/development-ed25519-signer";
import type {
  EvidenceReconstructionFailure,
  EvidenceReconstructionOutcome,
} from "@/application/evidence/evidence-reconstruction";
import {
  decideSubmission,
  issueSubmissionReceipt,
} from "@/application/evidence/submission-decision";
import type { SignatureEnvelope } from "@/application/ports/signing-key-provider";
import {
  digestSubmissionReceiptPayloadV1,
  type SubmissionReceiptPayloadV1,
} from "@/domain/forensics/submission-receipt";

/** Invented data only: persona Ana (U1), assignment Z1, deadline 2 Nov 2026 12:00 Zagreb. */
const payload: SubmissionReceiptPayloadV1 = {
  receiptSchema: "ductus-submission-receipt-v1",
  submissionId: "c4a1e9d2-7b3f-4a65-8e0c-1f2d3b4c5a69",
  evidenceDomainId: "d21fe0a3-103c-42e5-a29e-c102f9030af5",
  principalId: "72cd1705-85fc-4754-a382-c2500d038368",
  assignmentId: "3b7e2f4a-9c1d-4e8b-a5f6-0d2c4b6a8e91",
  assignmentVersion: 1,
  documentId: "doc-ana-z1",
  evidencePackageId: "evidence-ana-z1",
  revision: 3,
  artifactSha256: "b".repeat(64),
  evidenceHeadSegmentHash: "a".repeat(64),
  evidenceRecord: "continuous",
  requestedAt: "2026-11-02T10:59:30.000000Z",
  dueAt: "2026-11-02T11:00:00.000000Z",
  afterDeadline: false,
};

const ALL_FAILURES: EvidenceReconstructionFailure[] = [
  "too_large",
  "invalid_segment",
  "predecessor_mismatch",
  "document_mismatch",
  "head_mismatch",
  "unsupported_format",
  "invalid_document",
  "step_failed",
  "document_hash_mismatch",
  "missing_payload",
  "receipt_missing",
  "receipt_mismatch",
  "receipt_signature_invalid",
  "invalid_target",
  "target_mismatch",
];

describe("decideSubmission", () => {
  it("submits a match with the reconstructed hash and the head it stood on (C1)", () => {
    expect(
      decideSubmission({
        status: "match",
        head: { segmentHash: "c".repeat(64), segmentCount: 3 },
        documentSha256: "d".repeat(64),
      }),
    ).toEqual({
      decision: "submit",
      artifactSha256: "d".repeat(64),
      evidenceHeadSegmentHash: "c".repeat(64),
      evidenceRecord: "continuous",
    });
  });

  it("blocks a segment without a signed receipt and says so (P3, C9)", () => {
    expect(decideSubmission({ status: "mismatch", reason: "receipt_missing", index: 2 })).toEqual({
      decision: "blocked",
      reason: "segment_unsigned",
    });
  });

  it.each(ALL_FAILURES.filter((reason) => reason !== "receipt_missing"))(
    "blocks a record with %s (D-11, C8, C12 to C14)",
    (reason) => {
      expect(decideSubmission({ status: "mismatch", reason, index: null })).toEqual({
        decision: "blocked",
        reason: "record_mismatch",
      });
    },
  );

  it.each([
    { index: 0, previousSequenceTo: 0, sequenceFrom: 5, sequence: "gap", documentHashBreak: false },
    { index: 1, previousSequenceTo: 10, sequenceFrom: 21, sequence: "gap", documentHashBreak: false },
    { index: 2, previousSequenceTo: 20, sequenceFrom: 15, sequence: "regression", documentHashBreak: false },
    { index: 2, previousSequenceTo: 20, sequenceFrom: 21, sequence: "continuous", documentHashBreak: true },
  ] as const)("blocks a break no gap was recorded for (C2, C5 to C7): %o", (discontinuity) => {
    expect(decideSubmission({ status: "discontinuity", discontinuity })).toEqual({
      decision: "blocked",
      reason: "record_discontinuous",
    });
  });

  it("blocks a work with no evidence (C3)", () => {
    expect(decideSubmission({ status: "no_evidence" })).toEqual({ decision: "blocked", reason: "no_evidence" });
  });

  it.each(["chain", "storage", "verification"] as const)(
    "asks for a retry on an outage of %s, never a verdict (C18, P5)",
    (stage) => {
      expect(decideSubmission({ status: "unavailable", stage, reason: "down" })).toEqual({
        decision: "retry",
        stage,
      });
    },
  );

  it("submits for no outcome but a match", () => {
    const outcomes: EvidenceReconstructionOutcome[] = [
      ...ALL_FAILURES.map((reason) => ({ status: "mismatch" as const, reason, index: 0 })),
      { status: "no_evidence" },
      { status: "unavailable", stage: "storage", reason: "down" },
      {
        status: "discontinuity",
        discontinuity: { index: 1, previousSequenceTo: 1, sequenceFrom: 3, sequence: "gap", documentHashBreak: false },
      },
    ];
    for (const outcome of outcomes) expect(decideSubmission(outcome).decision).not.toBe("submit");
  });
});

describe("issueSubmissionReceipt", () => {
  it("signs the receipt over the 61 bytes and the signature verifies", async () => {
    const signer = new DevelopmentEd25519SigningKeyProvider("submission-test-key", "v1");
    const issued = await issueSubmissionReceipt(signer, payload);
    expect(issued.status).toBe("signed");
    if (issued.status !== "signed") return;
    const digest = await digestSubmissionReceiptPayloadV1(payload);
    expect(issued.receipt.payload).toEqual(payload);
    expect(issued.receipt.payloadDigestSha256).toBe(digest.sha256);
    expect(await signer.verify(digest.signingInput, issued.receipt.signature)).toBe(true);
  });

  it("gives the same receipt for the same submission and key (A6)", async () => {
    const signer = new DevelopmentEd25519SigningKeyProvider("submission-test-key", "v1");
    const first = await issueSubmissionReceipt(signer, payload);
    const second = await issueSubmissionReceipt(signer, { ...payload });
    expect(second).toEqual(first);
  });

  it("hands out a copy of the signed payload, not the caller's object", async () => {
    const own = { ...payload };
    const issued = await issueSubmissionReceipt(
      new DevelopmentEd25519SigningKeyProvider("submission-test-key", "v1"),
      own,
    );
    own.revision = 4;
    expect(issued.status === "signed" && issued.receipt.payload.revision).toBe(3);
  });

  it("issues nothing for an invalid payload and never asks the signer", async () => {
    const sign = vi.fn();
    const issued = await issueSubmissionReceipt(
      { sign, verify: vi.fn() },
      { ...payload, afterDeadline: true },
    );
    expect(issued).toEqual({ status: "unavailable", reason: "invalid_payload" });
    expect(sign).not.toHaveBeenCalled();
  });

  const good = new DevelopmentEd25519SigningKeyProvider("submission-test-key", "v1");
  const envelope = async (): Promise<SignatureEnvelope> =>
    good.sign((await digestSubmissionReceiptPayloadV1(payload)).signingInput);

  it.each([
    ["a signer with no key", { sign: () => Promise.reject(new Error("no key")), verify: () => Promise.resolve(true) }],
    ["a signer that throws", { sign: () => { throw new Error("down"); }, verify: () => Promise.resolve(true) }],
    [
      "a signature of another algorithm",
      {
        sign: async () => ({ ...(await envelope()), algorithm: "ECDSA_P256_SHA256" as const, signatureEncoding: "der" as const }),
        verify: () => Promise.resolve(true),
      },
    ],
    ["a signature that does not verify", { sign: envelope, verify: () => Promise.resolve(false) }],
    ["a check that throws", { sign: envelope, verify: () => Promise.reject(new Error("down")) }],
    ["a check that is not true", { sign: envelope, verify: () => Promise.resolve("yes" as unknown as boolean) }],
  ])("fails closed with %s (E5)", async (_name, signer) => {
    expect(await issueSubmissionReceipt(signer, payload)).toEqual({ status: "unavailable", reason: "signing" });
  });
});

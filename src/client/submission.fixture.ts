import type { SignedSubmissionReceiptV2 } from "@/domain/forensics/submission-receipt-v2";

/** An invented receipt in the exact signed shape (F-10 tests); the signature is not a real one. */
export const RECEIPT: SignedSubmissionReceiptV2 = {
  payload: {
    receiptSchema: "ductus-submission-receipt-v2",
    submissionId: "c4a1e9d2-7b3f-4a65-8e0c-1f2d3b4c5a69",
    evidenceDomainId: "d21fe0a3-103c-42e5-a29e-c102f9030af5",
    principalId: "72cd1705-85fc-4754-a382-c2500d038368",
    assignmentId: "3b7e2f4a-9c1d-4e8b-a5f6-0d2c4b6a8e91",
    assignmentVersion: 1,
    documentId: "doc-1",
    evidencePackageId: "evidence-1",
    revision: 7,
    artifactSha256: "b".repeat(64),
    evidenceHeadSegmentHash: "a".repeat(64),
    evidenceRecord: "continuous",
    requestedAt: "2026-11-02T10:58:00.123456Z",
    dueAt: "2026-11-02T11:00:00.000000Z",
    afterDeadline: false,
    signedAt: "2026-11-02T10:58:01.654321Z",
  },
  payloadDigestSha256: "f24592900fb8c817c52186dda58e025139f0da331cb95f0bf7cb0f8456dddd61",
  signature: {
    algorithm: "Ed25519",
    keyId: "test-key",
    keyVersion: "1",
    signatureEncoding: "raw",
    signatureBase64Url: "A".repeat(86),
  },
} as SignedSubmissionReceiptV2;

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { DevelopmentEd25519SigningKeyProvider } from "@/adapters/crypto/development-ed25519-signer";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";
import { digestSubmissionReceiptPayloadV2 } from "@/domain/forensics/submission-receipt-v2";
import type { SubmissionReceiptExpectationV2 } from "@/domain/forensics/submission-receipt-verifier-v2";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { issueSubmissionReceiptV2 } from "./submission-receipt";

// DAN-291 (#746, 291b): invented ids; the database is a script of rows.
const EXPECTED: SubmissionReceiptExpectationV2 = {
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
  requestedAt: "2026-11-02T10:59:30.123456Z",
  dueAt: "2026-11-02T11:00:00.000000Z",
  afterDeadline: false,
};
const ISSUANCE = "00000000-0000-4000-8000-0000000000a1";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const text = (over: Record<string, unknown> = {}) =>
  canonicalizeJcs({
    ...EXPECTED, receiptSchema: "ductus-submission-receipt-v2", signedAt: "2026-11-02T10:59:31.000001Z", ...over,
  } as JcsJsonValue);
const v1Text = () => {
  const payload = JSON.parse(text()) as Record<string, JcsJsonValue>;
  delete payload.signedAt;
  return canonicalizeJcs({ ...payload, receiptSchema: "ductus-submission-receipt-v1" });
};
const OTHER_SIGNATURE = {
  algorithm: "Ed25519", keyId: "submission-test-key", keyVersion: "v1", signatureEncoding: "raw",
  signatureBase64Url: "B".repeat(85) + "A",
};

type Rows = { read?: unknown[]; prepared?: unknown[]; attach?: (params: readonly unknown[]) => unknown[] };

function setup(rows: Rows = {}) {
  const payload = text();
  const queries: string[] = [];
  const withActor = vi.fn(async (_token: string | null, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({
      async query(sql, params = []) {
        queries.push(sql.includes("read_submission_receipt") ? "read" : sql.includes("prepare_") ? "prepare" : "attach");
        const result = sql.includes("read_submission_receipt")
          ? (rows.read ?? [{ outcome: "none" }])
          : sql.includes("prepare_submission_receipt")
            ? (rows.prepared ?? [{ outcome: "prepared", issuance_id: ISSUANCE, receipt_payload: payload, payload_digest_sha256: sha(payload) }])
            : (rows.attach ?? ((p) => [{
                outcome: "attached", receipt_payload: payload, payload_digest_sha256: p[1], signature: JSON.parse(String(p[2])),
              }]))(params);
        return { rows: result as never[], rowCount: result.length };
      },
    }),
  );
  const signer = new DevelopmentEd25519SigningKeyProvider("submission-test-key", "v1");
  const sign = vi.spyOn(signer, "sign");
  const key = vi.spyOn(signer, "publicVerificationKey");
  const issue = () => issueSubmissionReceiptV2({ withActor: withActor as unknown as WithActor, signer }, "token", EXPECTED);
  return { issue, queries, signer, sign, key, payload };
}

describe("submission receipt v2: signed and bound once (DAN-291)", () => {
  it("freezes, signs outside the transaction, binds and returns the stored row", async () => {
    const s = setup();
    const issued = await s.issue();
    if (issued.status !== "signed") throw new Error(issued.code);
    expect(s.queries).toEqual(["read", "prepare", "attach"]);
    expect(JSON.stringify(issued.receipt.payload)).toBe(s.payload);
    const digest = await digestSubmissionReceiptPayloadV2(issued.receipt.payload);
    expect(issued.receipt.payloadDigestSha256).toBe(sha(s.payload));
    expect(await s.signer.verify(digest.signingInput, issued.receipt.signature)).toBe(true);
  });

  it("returns a bound receipt without asking the signer or freezing again", async () => {
    const s = setup({ read: [{ outcome: "found", receipt_payload: text(), payload_digest_sha256: sha(text()), signature: OTHER_SIGNATURE }] });
    const issued = await s.issue();
    expect(issued).toEqual({ status: "signed", receipt: { payload: JSON.parse(s.payload), payloadDigestSha256: sha(s.payload), signature: OTHER_SIGNATURE } });
    expect(s.queries).toEqual(["read"]);
    expect(s.sign).not.toHaveBeenCalled();
    expect(s.key).not.toHaveBeenCalled();
  });

  it("in a race (attach answers existing) returns the stored receipt, never its own signature", async () => {
    const s = setup({ attach: () => [{ outcome: "existing", receipt_payload: text(), payload_digest_sha256: sha(text()), signature: OTHER_SIGNATURE }] });
    const issued = await s.issue();
    expect(s.sign).toHaveBeenCalledTimes(1);
    expect(issued).toMatchObject({ status: "signed", receipt: { signature: OTHER_SIGNATURE } });
  });

  const prepared = (receipt: string, digest = sha(receipt)) => ({
    prepared: [{ outcome: "prepared", issuance_id: ISSUANCE, receipt_payload: receipt, payload_digest_sha256: digest }],
  });
  it.each<[string, Rows, ((s: ReturnType<typeof setup>) => void)?]>([
    ["a signer that throws", {}, (s) => s.sign.mockRejectedValue(new Error("kms"))],
    ["a signature that does not verify", {}, (s) => vi.spyOn(s.signer, "verify").mockResolvedValue(false)],
    ["a signature of another key", {}, (s) => s.sign.mockResolvedValue({ ...OTHER_SIGNATURE, keyId: "other-key" } as never)],
    ["no key", {}, (s) => s.key.mockRejectedValue(new Error("no key"))],
    ["a v1 payload", prepared(v1Text())],
    ["a payload that is not its own JCS", prepared(" " + text())],
    ["a payload that is not its own JCS, with the digest of its JCS", prepared(" " + text(), sha(text()))],
    ["a payload with reordered keys", prepared(JSON.stringify({ signedAt: "2026-11-02T10:59:31.000001Z", ...JSON.parse(text()) }))],
    ["a wrong digest", prepared(text(), "0".repeat(64))],
    ["another revision than the reconstruction", prepared(text({ revision: 4 }))],
    ["another document", prepared(text({ documentId: "doc-other" }))],
    ["another head segment", prepared(text({ evidenceHeadSegmentHash: "c".repeat(64) }))],
    ["another submission", prepared(text({ submissionId: "00000000-0000-4000-8000-0000000000ff" }))],
    ["a refused freeze", { prepared: [{ outcome: "key_unavailable" }] }],
  ])("refuses %s with no receipt and without binding", async (_name, rows, arrange) => {
    const s = setup(rows);
    arrange?.(s);
    const issued = await s.issue();
    expect(issued.status).toBe("unavailable");
    expect(s.queries).not.toContain("attach");
  });

  it.each<[string, Rows]>([
    ["a stored v1 receipt", { read: [{ outcome: "found", receipt_payload: v1Text(), payload_digest_sha256: sha(v1Text()), signature: OTHER_SIGNATURE }] }],
    ["a stored receipt of another submission", { read: [{ outcome: "found", receipt_payload: text({ revision: 9 }), payload_digest_sha256: sha(text({ revision: 9 })), signature: OTHER_SIGNATURE }] }],
    ["a stored receipt without a signature", { read: [{ outcome: "found", receipt_payload: text(), payload_digest_sha256: sha(text()), signature: null }] }],
    ["a refused read", { read: [{ outcome: "unauthorized" }] }],
    ["a refused bind", { attach: () => [{ outcome: "key_revoked" }] }],
    ["a bound row for another submission", { attach: () => [{ outcome: "existing", receipt_payload: text({ revision: 9 }), payload_digest_sha256: sha(text({ revision: 9 })), signature: OTHER_SIGNATURE }] }],
  ])("never hands out %s", async (_name, rows) => {
    expect((await setup(rows).issue()).status).toBe("unavailable");
  });
});

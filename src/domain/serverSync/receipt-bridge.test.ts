// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ackedRevision, isRetryable, outcomeToEvents } from "../sync/drain";
import { parseCommitOutcome } from "./contract";

const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";
const TRANSACTION_ID = "test-tx-1";
const SIGNED = { receiptSchema: "synthetic-test", signature: "not-a-real-signature" };

function verification(revision: number, result = true) {
  return {
    expected: {
      documentId: DOCUMENT_ID,
      clientTransactionId: TRANSACTION_ID,
      revision,
    },
    verify: async (signedReceipt: unknown, expected: {
      documentId: string; clientTransactionId: string; revision: number;
    }) => result
      && signedReceipt === SIGNED
      && expected.documentId === DOCUMENT_ID
      && expected.clientTransactionId === TRANSACTION_ID
      && expected.revision === revision,
  };
}

describe("canonical wire parser -> sync ACK boundary (DAN-25)", () => {
  it.each(["committed", "duplicate"] as const)(
    "%s preserves the signed receipt until the verifier checks it",
    async (status) => {
      const raw = { status, revision: 5, receipt: { status: "signed", signedReceipt: SIGNED } };
      const parsed = parseCommitOutcome(raw);
      expect(parsed).toEqual(raw);
      expect(ackedRevision(parsed)).toBeNull();
      const events = await outcomeToEvents(parsed, verification(5));
      expect(events).toEqual([{ type: "SYNC_ACK" }]);
      expect(ackedRevision(parsed)).toBe(5);
    },
  );

  it.each(["committed", "duplicate"] as const)(
    "%s pending_signature remains retryable with no ACK",
    async (status) => {
      const parsed = parseCommitOutcome({
        status, revision: 5, receipt: { status: "pending_signature" },
      });
      expect(parsed.status).toBe(status);
      expect(await outcomeToEvents(parsed, verification(5))).toEqual([]);
      expect(isRetryable(parsed)).toBe(true);
      expect(ackedRevision(parsed)).toBeNull();
    },
  );

  it("rejects a failed signature check without ACK or a verified revision", async () => {
    const parsed = parseCommitOutcome({
      status: "committed", revision: 5,
      receipt: { status: "signed", signedReceipt: SIGNED },
    });
    expect(await outcomeToEvents(parsed, verification(5, false))).toEqual([
      { type: "SYNC_FAILED", retryable: false },
    ]);
    expect(ackedRevision(parsed)).toBeNull();
  });

  it("rejects a valid-looking signed receipt for another server revision", async () => {
    const parsed = parseCommitOutcome({
      status: "duplicate", revision: 6,
      receipt: { status: "signed", signedReceipt: SIGNED },
    });
    expect(await outcomeToEvents(parsed, verification(5))).toEqual([
      { type: "SYNC_FAILED", retryable: false },
    ]);
    expect(ackedRevision(parsed)).toBeNull();
  });

  it("rejects a wrong document binding when the verifier returns false", async () => {
    const parsed = parseCommitOutcome({
      status: "committed", revision: 5,
      receipt: { status: "signed", signedReceipt: SIGNED },
    });
    const invalidBinding = {
      ...verification(5),
      expected: { documentId: "other-document", clientTransactionId: TRANSACTION_ID, revision: 5 },
    };
    expect(await outcomeToEvents(parsed, invalidBinding)).toEqual([
      { type: "SYNC_FAILED", retryable: false },
    ]);
    expect(ackedRevision(parsed)).toBeNull();
  });

  it("rejects all malformed receipt wire envelopes before the drain planner", () => {
    const invalidReceipts: unknown[] = [
      undefined, null, [], "signed", { status: "signed" },
      { status: "signed", signedReceipt: undefined },
      { status: "signed", signedReceipt: null },
      { status: "signed", signedReceipt: "signature-only" },
      { status: "signed", signedReceipt: [] },
      { status: "pending_signature", signedReceipt: SIGNED },
      { status: "unknown", signedReceipt: SIGNED },
      Object.create({ status: "signed", signedReceipt: SIGNED }),
    ];
    for (const receipt of invalidReceipts) {
      expect(parseCommitOutcome({ status: "committed", revision: 5, receipt })).toEqual({
        status: "invalid",
      });
    }
  });

  it("does not let an inherited receipt masquerade as a signed response", () => {
    const raw = Object.create({ receipt: { status: "signed", signedReceipt: SIGNED } });
    raw.status = "committed";
    raw.revision = 5;
    expect(parseCommitOutcome(raw)).toEqual({ status: "invalid" });
  });
});

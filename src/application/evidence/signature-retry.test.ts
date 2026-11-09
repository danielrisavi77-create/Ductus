import { describe, expect, it, vi } from "vitest";

import type { PendingReceiptRow } from "@/application/ports/pending-receipt-signing";

import {
  createSignPendingReceiptWithRetry,
  decideSignatureRetry,
  MAX_SIGNATURE_RETRY_ATTEMPTS,
  MAX_SIGNATURE_RETRY_DELAY_MS,
  signatureRetryDelayMs,
  type SignatureRetryPolicy,
} from "./signature-retry";
import type { SignPendingReceiptOutcome } from "./sign-pending-receipt";

// Every value here is invented for the test (plan napada #1778).
const ROW: PendingReceiptRow = {
  receiptId: "00000000-0000-4000-8000-0000000000c1",
  receiptPayloadText: '{"receiptId":"00000000-0000-4000-8000-0000000000c1"}',
};
const RECEIPT = { payload: { receiptId: ROW.receiptId }, payloadDigestSha256: "a".repeat(64), signature: {} };
const POLICY: SignatureRetryPolicy = { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 1_000 };

const unavailable = (stage: string) => ({ status: "unavailable", stage, reason: "x" });

// Input classes of one attempt's reply (A-4, A-5, A-7).
const classes: [string, unknown, "done" | "retry" | "refused" | "held" | "signer_rejected" | "hash"][] = [
  ["signed", { status: "signed", signedReceipt: RECEIPT }, "done"],
  ["already_signed", { status: "already_signed", signedReceipt: RECEIPT }, "done"],
  ...(["receipt_malformed", "not_canonical", "unsupported_schema", "receipt_id_mismatch", "invalid", "not_found", "digest_mismatch"]
    .map((reason): [string, unknown, "refused"] => [`refused ${reason}`, { status: "refused", reason }, "refused"])),
  ...(["not_pending", "locator_mismatch", "object_absent", "object_mismatch"]
    .map((reason): [string, unknown, "held"] => [`held ${reason}`, { status: "held", reason }, "held"])),
  ["signer_rejected", { status: "signer_rejected", reason: "key_revoked" }, "signer_rejected"],
  ["unavailable hash", unavailable("hash"), "hash"],
  ...(["keys", "object", "signing", "verification", "store", "elsewhere"]
    .map((stage): [string, unknown, "retry"] => [`unavailable ${stage}`, unavailable(stage), "retry"])),
  ["unavailable without stage", { status: "unavailable" }, "retry"],
  ["undefined", undefined, "retry"],
  ["null", null, "retry"],
  ["a string", "signed", "retry"],
  ["an array", [{ status: "signed" }], "retry"],
  ["unknown status", { status: "accepted", signedReceipt: RECEIPT }, "retry"],
  ["signed without a receipt", { status: "signed" }, "retry"],
  ["already_signed with a string receipt", { status: "already_signed", signedReceipt: "sig" }, "retry"],
];

describe("decideSignatureRetry", () => {
  it.each(classes)("A-4/A-7 %s", (_, reply, expected) => {
    const first = decideSignatureRetry(reply, 1, POLICY, 0.5);
    if (expected === "done") expect(first).toEqual({ action: "done" });
    else if (expected === "retry") expect(first).toMatchObject({ action: "retry" });
    else expect(first).toEqual({ action: "park", reason: expected });
    // On the last attempt a transient reply is exhausted, never retried.
    const last = decideSignatureRetry(reply, POLICY.maxAttempts, POLICY, 0.5);
    expect(last).toEqual(expected === "retry" ? { action: "park", reason: "exhausted" } : first);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1", null])(
    "A-8 parks on an invalid attempt number %s",
    (attempt) => {
      expect(decideSignatureRetry(unavailable("signing"), attempt as number, POLICY, 0.5))
        .toEqual({ action: "park", reason: "exhausted" });
    },
  );

  const invalid: [string, unknown][] = [
    ["not an object", null],
    ["maxAttempts 0", { ...POLICY, maxAttempts: 0 }],
    ["maxAttempts above the cap", { ...POLICY, maxAttempts: MAX_SIGNATURE_RETRY_ATTEMPTS + 1 }],
    ["maxAttempts 1.5", { ...POLICY, maxAttempts: 1.5 }],
    ["baseDelayMs 0", { ...POLICY, baseDelayMs: 0 }],
    ["baseDelayMs above maxDelayMs", { ...POLICY, baseDelayMs: 2_000 }],
    ["maxDelayMs above the cap", { ...POLICY, maxDelayMs: MAX_SIGNATURE_RETRY_DELAY_MS + 1 }],
    ["maxDelayMs as a string", { ...POLICY, maxDelayMs: "1000" }],
  ];
  it.each(invalid)("A-8 refuses a policy with %s", (_, policy) => {
    expect(() => decideSignatureRetry(unavailable("signing"), 1, policy as SignatureRetryPolicy, 0.5)).toThrow(RangeError);
    expect(() => createSignPendingReceiptWithRetry({
      signPendingReceipt: async () => unavailable("signing") as SignPendingReceiptOutcome,
      policy: policy as SignatureRetryPolicy,
      sleep: async () => {},
      random: () => 0.5,
    })).toThrow(RangeError);
  });
});

describe("signatureRetryDelayMs", () => {
  it("A-8 doubles the ceiling up to the cap and keeps every delay in [ceiling / 2, ceiling]", () => {
    const ceilings = [100, 200, 400, 800, 1_000, 1_000];
    ceilings.forEach((ceiling, i) => {
      expect(signatureRetryDelayMs(i + 1, POLICY, 0)).toBe(ceiling / 2);
      expect(signatureRetryDelayMs(i + 1, POLICY, 0.999_999)).toBe(ceiling);
    });
  });

  it.each([Number.NaN, -1, 1, 2, Number.POSITIVE_INFINITY, "0.5", undefined])(
    "A-8 answers an unusable random value %s with the ceiling",
    (random) => {
      expect(signatureRetryDelayMs(2, POLICY, random as number)).toBe(200);
    },
  );

  it("A-8 never answers 0, even with a 1 ms base", () => {
    expect(signatureRetryDelayMs(1, { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 }, 0)).toBe(1);
  });
});

function run(replies: unknown[], policy = POLICY, sleep = vi.fn(async (ms: number): Promise<void> => { void ms; })) {
  const calls: PendingReceiptRow[] = [];
  const signPendingReceipt = vi.fn(async (row: PendingReceiptRow) => {
    calls.push(row);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    return reply as SignPendingReceiptOutcome;
  });
  const signWithRetry = createSignPendingReceiptWithRetry({ signPendingReceipt, policy, sleep, random: () => 0.5 });
  return { signWithRetry, calls, sleep };
}

describe("createSignPendingReceiptWithRetry", () => {
  it("A-1 retries a signer failure with backoff and answers the receipt it finally signs", async () => {
    const signed = { status: "signed", signedReceipt: RECEIPT };
    const { signWithRetry, calls, sleep } = run([unavailable("signing"), new Error("down"), signed]);
    expect(await signWithRetry(ROW)).toEqual({ status: "done", outcome: signed, attempts: 3 });
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call).toEqual(ROW);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([75, 150]);
  });

  it.each([
    ["refused", { status: "refused", reason: "not_canonical" }, null],
    ["held", { status: "held", reason: "object_absent" }, null],
    ["signer_rejected", { status: "signer_rejected", reason: "key_scope" }, null],
    ["hash", unavailable("hash"), "hash"],
  ])("A-4/A-5 parks %s after one attempt and never waits", async (reason, reply, stage) => {
    const { signWithRetry, calls, sleep } = run([reply]);
    expect(await signWithRetry(ROW)).toEqual({ status: "parked", reason, attempts: 1, lastStage: stage });
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("A-6 parks as exhausted after maxAttempts and maxAttempts - 1 waits", async () => {
    const { signWithRetry, calls, sleep } = run([unavailable("store")]);
    expect(await signWithRetry(ROW)).toEqual({ status: "parked", reason: "exhausted", attempts: 4, lastStage: "store" });
    expect(calls).toHaveLength(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("A-9 parks as interrupted when the wait fails, and signs nothing more", async () => {
    const sleep = vi.fn(async () => { throw new Error("aborted"); });
    const { signWithRetry, calls } = run([unavailable("keys")], POLICY, sleep);
    expect(await signWithRetry(ROW)).toEqual({ status: "parked", reason: "interrupted", attempts: 1, lastStage: "keys" });
    expect(calls).toHaveLength(1);
  });

  it("A-9 parks as interrupted when the wait throws synchronously", async () => {
    const sleep = vi.fn((): Promise<void> => { throw new Error("aborted"); });
    const { signWithRetry, calls } = run([unavailable("keys")], POLICY, sleep);
    expect((await signWithRetry(ROW)).status).toBe("parked");
    expect(calls).toHaveLength(1);
  });

  it("A-12 signs the snapshot taken at the first attempt, whatever the caller does to its row", async () => {
    const row = { ...ROW };
    const sleep = vi.fn(async () => {
      row.receiptId = "00000000-0000-4000-8000-0000000000c2";
      row.receiptPayloadText = "{}";
    });
    const { signWithRetry, calls } = run([unavailable("object"), { status: "signed", signedReceipt: RECEIPT }], POLICY, sleep);
    await signWithRetry(row);
    expect(calls).toEqual([ROW, ROW]);
    // Each attempt gets its own copy, so one attempt cannot change the next.
    expect(calls[0]).not.toBe(calls[1]);
  });

  it("A-13 a parked result carries no receipt text or signature", async () => {
    const { signWithRetry } = run([{ status: "unavailable", stage: "store", reason: ROW.receiptPayloadText }]);
    const parked = await signWithRetry(ROW);
    expect(Object.keys(parked).sort()).toEqual(["attempts", "lastStage", "reason", "status"]);
    expect(JSON.stringify(parked)).not.toContain(ROW.receiptId);
  });

  it("A-7 a random source that throws waits for the ceiling instead of failing", async () => {
    const signPendingReceipt = vi.fn()
      .mockResolvedValueOnce(unavailable("signing"))
      .mockResolvedValueOnce({ status: "signed", signedReceipt: RECEIPT });
    const sleep = vi.fn(async () => {});
    const signWithRetry = createSignPendingReceiptWithRetry({
      signPendingReceipt, policy: POLICY, sleep, random: () => { throw new Error("no entropy"); },
    });
    expect((await signWithRetry(ROW)).status).toBe("done");
    expect(sleep).toHaveBeenCalledWith(100);
  });

  it("requires a signing function, a wait and a random source", () => {
    const base = { signPendingReceipt: async () => unavailable("x") as SignPendingReceiptOutcome, policy: POLICY, sleep: async () => {}, random: () => 0 };
    for (const missing of ["signPendingReceipt", "sleep", "random"] as const) {
      expect(() => createSignPendingReceiptWithRetry({ ...base, [missing]: undefined } as never)).toThrow(TypeError);
    }
  });
});

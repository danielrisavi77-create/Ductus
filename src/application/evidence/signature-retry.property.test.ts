import { createHash, generateKeyPairSync, sign as nodeSign } from "node:crypto";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type {
  AttachReceiptSignatureCommand,
  AttachReceiptSignatureOutcome,
} from "@/application/ports/pending-receipt-signing";
import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import type { EvidenceReceiptPayloadV2 } from "@/domain/forensics/evidence-receipt";
import type { EvidenceDomainKey } from "@/domain/forensics/evidence-receipt-verifier";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import type { SignatureEnvelope } from "@/domain/forensics/signature";

import type { PendingReceiptObjectCheck } from "./check-pending-receipt-object";
import { createSignPendingReceipt } from "./sign-pending-receipt";
import { createSignPendingReceiptWithRetry, type SignatureRetryPolicy } from "./signature-retry";

// Every value here is invented for the test (plan napada #1778).
const DOMAIN = "00000000-0000-4000-8000-0000000000d1";
const RECEIPT = "00000000-0000-4000-8000-0000000000c1";
const PAYLOAD: EvidenceReceiptPayloadV2 = {
  receiptSchema: "ductus-evidence-receipt-v2",
  receiptId: RECEIPT,
  evidenceDomainId: DOMAIN,
  evidencePackageId: "pkg-1",
  documentId: "doc-1",
  revision: 1,
  clientTransactionId: "tx-1",
  principalId: "00000000-0000-4000-8000-0000000000e1",
  sessionId: "session-1",
  segmentId: "segment-1",
  segmentHash: "b".repeat(64),
  predecessorSegmentHash: null,
  previousReceiptId: null,
  evidenceSchema: "ductus-evidence-segment-v2",
  evidenceProfileId: "standard-v1",
  sequenceFrom: 1,
  sequenceTo: 1,
  eventCount: 1,
  payloadBytes: 123,
  acceptedAt: "2026-10-19T06:00:00.000Z",
};
const TEXT = canonicalizeJcs(PAYLOAD);
const ROW = { receiptId: RECEIPT, receiptPayloadText: TEXT };

// One institution key shared by the worker and a second signer, so both
// produce the same deterministic Ed25519 signature (D-71).
const PAIR = generateKeyPairSync("ed25519");
const STRANGER = generateKeyPairSync("ed25519");
const KEY: EvidenceDomainKey = {
  algorithm: "Ed25519", keyId: "k1", keyVersion: "1", encoding: "spki-der",
  keyBase64Url: PAIR.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
  evidenceDomainId: DOMAIN, purpose: "receipt",
  validFrom: "2026-01-01T00:00:00.000Z", validTo: null, revokedAt: null,
};
const envelope = (input: Uint8Array, key = PAIR.privateKey): SignatureEnvelope => ({
  algorithm: "Ed25519", keyId: "k1", keyVersion: "1", signatureEncoding: "raw",
  signatureBase64Url: nodeSign(null, input, key).toString("base64url"),
});
const EXPECTED = envelope(Buffer.concat([
  Buffer.from("ductus-evidence-receipt-v2\n"),
  createHash("sha256").update(TEXT, "utf8").digest(),
]));

type SignFault = "ok" | "throw" | "malformed" | "stranger";
type KeysFault = "ok" | "throw" | "unavailable";
type ObjectFault = "ok" | "throw" | "unavailable" | "held";
type AttachFault = "ok" | "throw_before" | "lost_reply" | "unavailable";

/** Each call takes the next fault of its port; past the end everything works. */
const queue = <T extends string>(faults: T[]) => {
  let i = 0;
  return (): T | "ok" => faults[i++] ?? "ok";
};

const policyArb = fc.record({
  maxAttempts: fc.integer({ min: 1, max: 6 }),
  baseDelayMs: fc.integer({ min: 1, max: 50 }),
}).chain(({ maxAttempts, baseDelayMs }) => fc.record({
  maxAttempts: fc.constant(maxAttempts),
  baseDelayMs: fc.constant(baseDelayMs),
  maxDelayMs: fc.integer({ min: baseDelayMs, max: 400 }),
}));

const faultsArb = fc.record({
  sign: fc.array(fc.constantFrom<SignFault>("ok", "throw", "throw", "malformed", "stranger"), { maxLength: 8 }),
  keys: fc.array(fc.constantFrom<KeysFault>("ok", "ok", "throw", "unavailable"), { maxLength: 8 }),
  object: fc.array(fc.constantFrom<ObjectFault>("ok", "ok", "ok", "throw", "unavailable", "held"), { maxLength: 8 }),
  attach: fc.array(fc.constantFrom<AttachFault>("ok", "throw_before", "lost_reply", "lost_reply", "unavailable"), { maxLength: 8 }),
});

/** The worker's ports over one shared row, as `app.worker_attach_receipt_signature` locks it. */
type Faults = { sign: SignFault[]; keys: KeysFault[]; object: ObjectFault[]; attach: AttachFault[] };

function world(s: fc.Scheduler, faults: Faults) {
  const texts = new Map([[RECEIPT, TEXT]]);
  const stored = new Map<string, unknown>();
  const signFault = queue(faults.sign);
  const keysFault = queue(faults.keys);
  const objectFault = queue(faults.object);
  const attachFault = queue(faults.attach);
  const store = {
    receiptKeys: s.scheduleFunction(async function receiptKeys() {
      const fault = keysFault();
      if (fault === "throw") throw new Error("keys down");
      if (fault === "unavailable") return { status: "unavailable" as const };
      return { status: "ok" as const, keys: [KEY] };
    }),
    attachSignature: s.scheduleFunction(async function attachSignature(
      c: AttachReceiptSignatureCommand,
    ): Promise<AttachReceiptSignatureOutcome> {
      const fault = attachFault();
      if (fault === "throw_before") throw new Error("connection lost before the write");
      if (fault === "unavailable") return { outcome: "unavailable", reason: "store down" };
      const text = texts.get(c.receiptId);
      if (text === undefined) return { outcome: "not_found" };
      let out: AttachReceiptSignatureOutcome;
      if (stored.has(c.receiptId)) out = { outcome: "already_signed", signature: stored.get(c.receiptId) };
      else if (createHash("sha256").update(text, "utf8").digest("hex") !== c.payloadDigestSha256) out = { outcome: "digest_mismatch" };
      else {
        stored.set(c.receiptId, structuredClone(c.signature));
        out = { outcome: "signed", signature: c.signature };
      }
      // The row is committed; only the reply is lost on the way back.
      if (fault === "lost_reply") throw new Error("connection lost after the write");
      return out;
    }),
  } as unknown as Parameters<typeof createSignPendingReceipt>[0]["store"];
  const checkObject = s.scheduleFunction(async function checkObject(): Promise<PendingReceiptObjectCheck> {
    const fault = objectFault();
    if (fault === "throw") throw new Error("payload store down");
    if (fault === "unavailable") return { status: "unavailable", reason: "locator_unavailable" };
    if (fault === "held") return { status: "held", reason: "object_absent" };
    return { status: "present" };
  });
  let signCalls = 0;
  const faulty = {
    sign: async (input: Uint8Array) => {
      signCalls += 1;
      const fault = signFault();
      if (fault === "throw") throw new Error("signer down");
      if (fault === "malformed") return { algorithm: "Ed25519" };
      return envelope(input, fault === "stranger" ? STRANGER.privateKey : PAIR.privateKey);
    },
    verify: async () => false,
    publicVerificationKey: async () => { throw new Error("not used"); },
  } as unknown as SigningKeyProvider;
  const honest = { ...faulty, sign: async (input: Uint8Array) => envelope(input) } as SigningKeyProvider;
  const worker = createSignPendingReceipt({ signer: faulty, store, checkObject, signTimeoutMs: 60_000 });
  const second = createSignPendingReceipt({ signer: honest, store, checkObject, signTimeoutMs: 60_000 });
  return { texts, stored, worker, second, signCalls: () => signCalls };
}

const signatureOf = (out: unknown) =>
  (out as { signedReceipt?: { signature?: unknown } } | undefined)?.signedReceipt?.signature;

describe("signature retry under interruption (A-2, A-3, A-10, A-11)", () => {
  it("keeps one deterministic signature, never changes the receipt and answers only the stored signature", async () => {
    await fc.assert(fc.asyncProperty(
      fc.scheduler(),
      policyArb,
      faultsArb,
      fc.array(fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }), { maxLength: 8 }),
      fc.integer({ min: 0, max: 2 }),
      fc.integer({ min: 0, max: 4 }),
      async (s, policy: SignatureRetryPolicy, faults, randoms, secondCalls, resends) => {
        const w = world(s, faults);
        const delays: number[] = [];
        let drawn = 0;
        const signWithRetry = createSignPendingReceiptWithRetry({
          signPendingReceipt: w.worker,
          policy,
          sleep: async (ms) => {
            delays.push(ms);
            await s.schedule(Promise.resolve(), "sleep");
          },
          random: () => randoms[drawn++] ?? 0.5,
        });
        // A resend under the same idempotency key reads the row: pending, or the stored signature.
        const seen: unknown[] = [];
        const reads = Array.from({ length: resends }, () =>
          s.schedule(Promise.resolve(), "resend").then(() => { seen.push(structuredClone(w.stored.get(RECEIPT))); }));
        const others = Array.from({ length: secondCalls }, () => w.second({ ...ROW }));

        const [result, ...outcomes] = await s.waitFor(Promise.all([signWithRetry({ ...ROW }), ...others, ...reads]));
        const final = w.stored.get(RECEIPT);

        // A-2: at most one signature, the deterministic one, on an unchanged row.
        expect(w.stored.size).toBeLessThanOrEqual(1);
        if (final !== undefined) expect(final).toEqual(EXPECTED);
        expect(w.texts.get(RECEIPT)).toBe(TEXT);

        // A-3: a resend sees pending until the signature is stored, then only that signature.
        const firstSigned = seen.findIndex((v) => v !== undefined);
        if (firstSigned >= 0) for (const v of seen.slice(firstSigned)) expect(v).toEqual(final);

        // A-10: whoever answers done or signed answers the stored signature.
        if (result.status === "done") {
          expect(final).toBeDefined();
          expect(signatureOf(result.outcome)).toEqual(final);
          expect(result.outcome.signedReceipt.payload.receiptId).toBe(RECEIPT);
          expect(result.outcome.signedReceipt.payload.acceptedAt).toBe(PAYLOAD.acceptedAt);
        } else {
          expect(["exhausted", "held", "signer_rejected"]).toContain(result.reason);
          expect(JSON.stringify(result)).not.toContain(RECEIPT);
        }
        for (const out of outcomes.slice(0, secondCalls)) {
          const status = (out as { status: string }).status;
          if (status === "signed" || status === "already_signed") expect(signatureOf(out)).toEqual(final);
        }

        // A-11: bounded attempts and delays inside the backoff window.
        expect(result.attempts).toBeGreaterThanOrEqual(1);
        expect(result.attempts).toBeLessThanOrEqual(policy.maxAttempts);
        expect(delays).toHaveLength(result.attempts - 1);
        delays.forEach((ms, i) => {
          const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** i);
          expect(ms).toBeGreaterThanOrEqual(Math.ceil(ceiling / 2));
          expect(ms).toBeLessThanOrEqual(ceiling);
        });
      },
    ));
  });

  it("ends signed once the transient failures are fewer than the attempts (P-14)", async () => {
    await fc.assert(fc.asyncProperty(
      fc.scheduler(),
      policyArb,
      fc.array(fc.constantFrom<SignFault>("throw", "malformed"), { maxLength: 5 }),
      fc.array(fc.constantFrom<AttachFault>("throw_before", "lost_reply", "unavailable"), { maxLength: 5 }),
      async (s, policy: SignatureRetryPolicy, sign, attach) => {
        const w = world(s, { sign, attach, keys: [], object: [] });
        const signWithRetry = createSignPendingReceiptWithRetry({
          signPendingReceipt: w.worker, policy, sleep: async () => {}, random: () => 0,
        });
        const result = await s.waitFor(signWithRetry({ ...ROW }));
        // Every failed attempt takes at least one fault, and an attempt that
        // takes none is signed (or, after a lost reply, `already_signed`).
        expect(w.signCalls()).toBe(result.attempts);
        if (sign.length + attach.length < policy.maxAttempts) {
          expect(result.status).toBe("done");
          expect(w.stored.get(RECEIPT)).toEqual(EXPECTED);
        }
        if (result.status === "done") expect(signatureOf(result.outcome)).toEqual(EXPECTED);
        else expect(result.reason).toBe("exhausted");
      },
    ));
  });
});

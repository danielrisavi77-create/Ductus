import { createHash, generateKeyPairSync, sign as nodeSign } from "node:crypto";

import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import type {
  AttachReceiptSignatureCommand,
  AttachReceiptSignatureOutcome,
} from "@/application/ports/pending-receipt-signing";
import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import type { EvidenceReceiptPayloadV2 } from "@/domain/forensics/evidence-receipt";
import {
  verifySignedEvidenceReceiptV2,
  type EvidenceDomainKey,
} from "@/domain/forensics/evidence-receipt-verifier";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import type { SignatureEnvelope } from "@/domain/forensics/signature";

import { InMemoryEvidencePayloadStore } from "@/adapters/evidence/in-memory-evidence-payload-store";

import {
  createCheckPendingReceiptObject,
  type PendingReceiptObjectCheck,
} from "./check-pending-receipt-object";
import { createSignPendingReceipt, type SignPendingReceiptOutcome } from "./sign-pending-receipt";

// Every value here is invented for the test.
const DOMAIN = "00000000-0000-4000-8000-0000000000d1";
const OTHER_DOMAIN = "00000000-0000-4000-8000-0000000000d2";
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
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest();

type Behaviour = (input: Uint8Array, honest: () => SignatureEnvelope) => Promise<unknown> | unknown;

/** A signer over an ephemeral key, and its registry row with `scope`. */
function testSigner(keyId: string, behave: Behaviour = (_, honest) => honest()) {
  const pair = generateKeyPairSync("ed25519");
  const inputs: Uint8Array[] = [];
  const envelope = (input: Uint8Array): SignatureEnvelope => ({
    algorithm: "Ed25519", keyId, keyVersion: "1", signatureEncoding: "raw",
    signatureBase64Url: nodeSign(null, input, pair.privateKey).toString("base64url"),
  });
  const provider = {
    sign: vi.fn(async (input: Uint8Array) => {
      inputs.push(input);
      return behave(input, () => envelope(input));
    }),
    verify: async () => false,
    publicVerificationKey: async () => { throw new Error("not used: the registry is the key source"); },
  } as unknown as SigningKeyProvider & { sign: ReturnType<typeof vi.fn> };
  const key = (scope: Partial<EvidenceDomainKey> = {}): EvidenceDomainKey => ({
    algorithm: "Ed25519", keyId, keyVersion: "1", encoding: "spki-der",
    keyBase64Url: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
    evidenceDomainId: DOMAIN, purpose: "receipt",
    validFrom: "2026-01-01T00:00:00.000Z", validTo: null, revokedAt: null, ...scope,
  });
  return { provider, key, inputs, envelope };
}

/**
 * Mirrors `app.worker_attach_receipt_signature`: the digest is taken over the
 * stored text, and the row lock makes the first attach the only one stored.
 */
function memoryStore(keys: () => readonly EvidenceDomainKey[], gate?: (c: AttachReceiptSignatureCommand) => Promise<void>) {
  const texts = new Map([[RECEIPT, TEXT]]);
  const stored = new Map<string, unknown>();
  const store = {
    receiptKeys: vi.fn(async () => ({ status: "ok" as const, keys: keys() })),
    attachSignature: vi.fn(async (c: AttachReceiptSignatureCommand): Promise<AttachReceiptSignatureOutcome> => {
      await gate?.(c);
      const text = texts.get(c.receiptId);
      if (text === undefined) return { outcome: "not_found" };
      if (stored.has(c.receiptId)) return { outcome: "already_signed", signature: stored.get(c.receiptId) };
      if (sha256(text).toString("hex") !== c.payloadDigestSha256) return { outcome: "digest_mismatch" };
      stored.set(c.receiptId, c.signature);
      return { outcome: "signed", signature: c.signature };
    }),
  };
  return { store, stored };
}

const present = async (): Promise<PendingReceiptObjectCheck> => ({ status: "present" });

function setup(signer = testSigner("k1"), keys = () => [signer.key()], checkObject = present) {
  const { store, stored } = memoryStore(keys);
  const run = createSignPendingReceipt({ signer: signer.provider, store, signTimeoutMs: 1000, checkObject });
  return { signer, store, stored, run };
}

const expectation = { documentId: "doc-1", clientTransactionId: "tx-1", revision: 1, evidenceDomainId: DOMAIN };

describe("signPendingReceipt", () => {
  it("K1 signs exactly the 59 D-92 bytes and stores a signature the registry key verifies", async () => {
    const { signer, stored, run } = setup();
    const out = await run(ROW);
    expect(out.status).toBe("signed");
    expect(signer.inputs).toHaveLength(1);
    const expected = Buffer.concat([Buffer.from("ductus-evidence-receipt-v2\n"), sha256(TEXT)]);
    expect(signer.inputs[0]!.byteLength).toBe(59);
    expect(Buffer.from(signer.inputs[0]!).equals(expected)).toBe(true);
    const signed = (out as Extract<SignPendingReceiptOutcome, { status: "signed" }>).signedReceipt;
    expect(signed.payloadDigestSha256).toBe(sha256(TEXT).toString("hex"));
    expect(stored.get(RECEIPT)).toEqual(signed.signature);
    expect((await verifySignedEvidenceReceiptV2(signed, expectation, [signer.key()])).ok).toBe(true);
  });

  const refused: [string, unknown, unknown, string][] = [
    ["K2 not JSON", RECEIPT, "{", "receipt_malformed"],
    ["K2 empty", RECEIPT, "", "receipt_malformed"],
    ["K2 not a string", RECEIPT, 7, "receipt_malformed"],
    ["K2 over the length cap", RECEIPT, " ".repeat(16_385), "receipt_malformed"],
    ["K2 extra field", RECEIPT, canonicalizeJcs({ ...PAYLOAD, extra: 1 }), "receipt_malformed"],
    ["K2 acceptedAt with seconds", RECEIPT, canonicalizeJcs({ ...PAYLOAD, acceptedAt: "2026-10-19T06:00:07.000Z" }), "receipt_malformed"],
    ["K2 row id is not the payload's", "00000000-0000-4000-8000-0000000000c2", TEXT, "receipt_id_mismatch"],
    ["K2 lone surrogate escape", RECEIPT, TEXT.replace('"doc-1"', '"doc-\\ud800"'), "receipt_malformed"],
    ["K3 not its JCS form", RECEIPT, JSON.stringify(PAYLOAD, null, 1), "not_canonical"],
    ["K3 trailing newline", RECEIPT, `${TEXT}\n`, "not_canonical"],
    ["K3 duplicate key that parsing drops", RECEIPT, `{"documentId":"doc-9",${TEXT.slice(1)}`, "not_canonical"],
    ["K4 receipt v1", RECEIPT, canonicalizeJcs({ ...PAYLOAD, receiptSchema: "ductus-evidence-receipt-v1" }), "unsupported_schema"],
  ];
  it.each(refused)("%s is refused before the signer is asked", async (_, receiptId, text, reason) => {
    const { signer, store, run } = setup();
    const out = await run({ receiptId, receiptPayloadText: text } as never);
    expect(out).toEqual({ status: "refused", reason });
    expect(signer.provider.sign).not.toHaveBeenCalled();
    expect(store.attachSignature).not.toHaveBeenCalled();
  });

  it("K5 an already signed receipt answers with the stored signature, never its own", async () => {
    const first = testSigner("k1");
    const second = testSigner("k2");
    const { store, stored } = memoryStore(() => [first.key(), second.key()]);
    stored.set(RECEIPT, first.envelope(new Uint8Array(Buffer.concat([Buffer.from("ductus-evidence-receipt-v2\n"), sha256(TEXT)]))));
    const run = createSignPendingReceipt({ signer: second.provider, store, signTimeoutMs: 1000, checkObject: present });
    const out = await run(ROW);
    expect(out.status).toBe("already_signed");
    expect((out as { signedReceipt: { signature: SignatureEnvelope } }).signedReceipt.signature.keyId).toBe("k1");
  });

  it("K5 a stored signature that does not verify is not answered", async () => {
    const { stored, run } = setup();
    stored.set(RECEIPT, { algorithm: "Ed25519", keyId: "k1" });
    expect(await run(ROW)).toEqual({ status: "unavailable", stage: "store", reason: "stored_signature_unverified" });
  });

  const scopes: [string, Partial<EvidenceDomainKey> | null, string][] = [
    ["of another domain", { evidenceDomainId: OTHER_DOMAIN }, "key_scope"],
    ["for checkpoints", { purpose: "checkpoint" }, "key_scope"],
    ["revoked", { revokedAt: "2026-10-01T00:00:00.000Z" }, "key_revoked"],
    ["retired before acceptance", { validTo: "2026-10-01T00:00:00.000Z" }, "key_not_valid"],
    ["missing from the registry", null, "key_unknown"],
  ];
  it.each(scopes)("K6 a signer key %s is rejected and nothing is attached", async (_, scope, reason) => {
    const signer = testSigner("k1");
    const { store, run } = setup(signer, () => (scope === null ? [] : [signer.key(scope)]));
    expect(await run(ROW)).toEqual({ status: "signer_rejected", reason });
    expect(store.attachSignature).not.toHaveBeenCalled();
  });

  const faults: [string, Behaviour, SignPendingReceiptOutcome][] = [
    ["throws", () => { throw new Error("transport down"); }, { status: "unavailable", stage: "signing", reason: "sign_failed" }],
    ["answers a bad envelope", () => ({ algorithm: "Ed25519" }), { status: "unavailable", stage: "signing", reason: "signature_malformed" }],
    ["answers another algorithm", (_, honest) => ({ ...honest(), algorithm: "ECDSA_P256_SHA256", signatureEncoding: "ieee-p1363" }), { status: "unavailable", stage: "signing", reason: "signature_malformed" }],
    ["signs other bytes", (input, honest) => { input[58] = (input[58]! + 1) % 256; return honest(); }, { status: "signer_rejected", reason: "signature_invalid" }],
  ];
  it.each(faults)("K7 a signer that %s changes nothing", async (_, behave, expected) => {
    const { store, stored, run } = setup(testSigner("k1", behave));
    expect(await run(ROW)).toEqual(expected);
    expect(store.attachSignature).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);
  });

  it("K8 a timeout answers unavailable and a late signature is never attached", async () => {
    let late: (() => void) | undefined;
    const slow = testSigner("k1", (_, honest) => new Promise((resolve) => { late = () => resolve(honest()); }));
    const { store, stored } = memoryStore(() => [slow.key()]);
    const run = createSignPendingReceipt({ signer: slow.provider, store, signTimeoutMs: 20, checkObject: present });
    expect(await run(ROW)).toEqual({ status: "unavailable", stage: "signing", reason: "sign_timeout" });
    late!();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(store.attachSignature).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);
  });

  it("K9 a repeated call answers the first signature and keeps one record", async () => {
    const { stored, run } = setup();
    const first = await run(ROW);
    const second = await run(ROW);
    expect(first.status).toBe("signed");
    expect(second.status).toBe("already_signed");
    expect((second as { signedReceipt: unknown }).signedReceipt).toEqual((first as { signedReceipt: unknown }).signedReceipt);
    expect(stored.size).toBe(1);
  });

  const storeOutcomes: [AttachReceiptSignatureOutcome | "throws", SignPendingReceiptOutcome][] = [
    [{ outcome: "not_found" }, { status: "refused", reason: "not_found" }],
    [{ outcome: "invalid" }, { status: "refused", reason: "invalid" }],
    [{ outcome: "unsupported_schema" }, { status: "refused", reason: "unsupported_schema" }],
    [{ outcome: "digest_mismatch" }, { status: "refused", reason: "digest_mismatch" }],
    [{ outcome: "key_unknown" }, { status: "signer_rejected", reason: "key_unknown" }],
    [{ outcome: "key_scope" }, { status: "signer_rejected", reason: "key_scope" }],
    [{ outcome: "key_revoked" }, { status: "signer_rejected", reason: "key_revoked" }],
    [{ outcome: "key_not_valid" }, { status: "signer_rejected", reason: "key_not_valid" }],
    [{ outcome: "signed", signature: { algorithm: "Ed25519", keyId: "k9" } }, { status: "unavailable", stage: "store", reason: "stored_signature_mismatch" }],
    [{ outcome: "signed", signature: undefined }, { status: "unavailable", stage: "store", reason: "stored_signature_mismatch" }],
    [{ outcome: "unavailable", reason: "x" }, { status: "unavailable", stage: "store", reason: "store_unavailable" }],
    [{ outcome: "something_new" } as never, { status: "unavailable", stage: "store", reason: "unknown_outcome" }],
    [null as never, { status: "unavailable", stage: "store", reason: "unknown_outcome" }],
    [undefined as never, { status: "unavailable", stage: "store", reason: "unknown_outcome" }],
    ["signed" as never, { status: "unavailable", stage: "store", reason: "unknown_outcome" }],
    [{ outcome: { toString: () => "signed" } } as never, { status: "unavailable", stage: "store", reason: "unknown_outcome" }],
    ["throws", { status: "unavailable", stage: "store", reason: "store_unavailable" }],
  ];
  it.each(storeOutcomes)("K10 store outcome %j is never answered as signed", async (outcome, expected) => {
    const { store, run } = setup();
    store.attachSignature.mockImplementation(async () => {
      if (outcome === "throws") throw new Error("connection reset");
      return outcome;
    });
    expect(await run(ROW)).toEqual(expected);
  });

  it("K10 keys that cannot be read stop the call before the signer", async () => {
    const { signer, store, run } = setup();
    store.receiptKeys.mockResolvedValueOnce({ status: "unavailable", reason: "x" } as never);
    store.receiptKeys.mockRejectedValueOnce(new Error("down"));
    for (let i = 0; i < 2; i++) {
      expect(await run(ROW)).toEqual({ status: "unavailable", stage: "keys", reason: "keys_unavailable" });
    }
    expect(signer.provider.sign).not.toHaveBeenCalled();
  });

  it("refuses a timeout that is not a positive bound", () => {
    const { signer, store } = setup();
    for (const ms of [0, -1, 1.5, Number.NaN, 60_001]) {
      expect(() => createSignPendingReceipt({ signer: signer.provider, store, signTimeoutMs: ms, checkObject: present })).toThrow(RangeError);
    }
  });

  it("a one-character change of the stored text is never signed as the original", async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat(TEXT.length - 1), fc.constantFrom(..."0123456789abcdef\"{}:, -xZ"), async (at, ch) => {
        fc.pre(TEXT[at] !== ch);
        const { stored, run } = setup();
        const out = await run({ receiptId: RECEIPT, receiptPayloadText: TEXT.slice(0, at) + ch + TEXT.slice(at + 1) });
        expect(out.status).not.toBe("signed");
        expect(out.status).not.toBe("already_signed");
        expect(stored.size).toBe(0);
      }),
      { numRuns: 150 },
    );
  });

  it.each([["k1", "k2"], ["k2", "k1"]])(
    "Istodobnost: of two concurrent signatures (%s attaches first) one is stored and both answer it",
    async (firstId, secondId) => {
      // Both signers answer only once both were asked, so both sign before either attaches.
      let asked = 0;
      let release!: () => void;
      const bothAsked = new Promise<void>((resolve) => { release = resolve; });
      const barrier: Behaviour = async (_, honest) => { if (++asked === 2) release(); await bothAsked; return honest(); };
      const k1 = testSigner("k1", barrier);
      const k2 = testSigner("k2", barrier);
      let turn!: () => void;
      const firstDone = new Promise<void>((resolve) => { turn = resolve; });
      const gate = async (c: AttachReceiptSignatureCommand) => { if (c.signature.keyId === secondId) await firstDone; };
      const { store, stored } = memoryStore(() => [k1.key(), k2.key()], gate);
      const original = store.attachSignature.getMockImplementation()!;
      store.attachSignature.mockImplementation(async (c) => {
        const out = await original(c);
        if (c.signature.keyId === firstId) turn();
        return out;
      });
      const runFor = (s: ReturnType<typeof testSigner>) =>
        createSignPendingReceipt({ signer: s.provider, store, signTimeoutMs: 1000, checkObject: present })(ROW);
      const [a, b] = await Promise.all([runFor(k1), runFor(k2)]);
      const byId = { k1: a, k2: b } as Record<string, SignPendingReceiptOutcome>;
      expect(byId[firstId]!.status).toBe("signed");
      expect(byId[secondId]!.status).toBe("already_signed");
      expect(stored.size).toBe(1);
      const kept = stored.get(RECEIPT) as SignatureEnvelope;
      expect(kept.keyId).toBe(firstId);
      for (const out of [a, b]) {
        expect((out as { signedReceipt: { signature: unknown } }).signedReceipt.signature).toEqual(kept);
      }
    },
  );
  const holds = ["not_pending", "locator_mismatch", "object_absent", "object_mismatch"] as const;
  it.each(holds)("C1 an object check held as %s signs and stores nothing", async (reason) => {
    const { signer, store, stored, run } = setup(undefined, undefined, async () => ({ status: "held", reason }));
    expect(await run(ROW)).toEqual({ status: "held", reason });
    expect(signer.provider.sign).not.toHaveBeenCalled();
    expect(store.attachSignature).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);
  });

  const objectFaults: [string, () => Promise<unknown>, string][] = [
    ["locator unavailable", async () => ({ status: "unavailable", reason: "locator_unavailable" }), "locator_unavailable"],
    ["locator malformed", async () => ({ status: "unavailable", reason: "locator_malformed" }), "locator_malformed"],
    ["storage ref unavailable", async () => ({ status: "unavailable", reason: "storage_ref_unavailable" }), "storage_ref_unavailable"],
    ["presence unavailable", async () => ({ status: "unavailable", reason: "presence_unavailable" }), "presence_unavailable"],
    ["an unknown unavailable reason", async () => ({ status: "unavailable", reason: "x" }), "presence_unavailable"],
    ["a held reason outside the set", async () => ({ status: "held", reason: "other" }), "presence_unavailable"],
    ["throws", async () => { throw new Error("down"); }, "presence_unavailable"],
    ["answers null", async () => null, "presence_unavailable"],
    ["answers a string", async () => "present", "presence_unavailable"],
    ["answers an unknown status", async () => ({ status: "maybe" }), "presence_unavailable"],
  ];
  it.each(objectFaults)("C2 an object check that %s is unavailable and signs nothing", async (_, check, reason) => {
    const { signer, store, stored, run } = setup(undefined, undefined, check as never);
    expect(await run(ROW)).toEqual({ status: "unavailable", stage: "object", reason });
    expect(signer.provider.sign).not.toHaveBeenCalled();
    expect(store.attachSignature).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);
  });

  it("C3 the object check gets the parsed payload and runs before the signer", async () => {
    const order: string[] = [];
    const signer = testSigner("k1", (_, honest) => { order.push("sign"); return honest(); });
    const check = vi.fn(async (): Promise<PendingReceiptObjectCheck> => { order.push("check"); return { status: "present" }; });
    const { run } = setup(signer, undefined, check);
    expect((await run(ROW)).status).toBe("signed");
    expect(check).toHaveBeenCalledTimes(1);
    expect(check.mock.calls[0]).toEqual([PAYLOAD]);
    expect(order).toEqual(["check", "sign"]);
  });

  it("C4 a signer without an object check is not built", () => {
    const { signer, store } = setup();
    for (const checkObject of [undefined, null, {}, "present"]) {
      expect(() =>
        createSignPendingReceipt({ signer: signer.provider, store, signTimeoutMs: 1000, checkObject } as never),
      ).toThrow(TypeError);
    }
  });

  it("C5 a refused row never reaches the object check", async () => {
    const check = vi.fn(present);
    const { run } = setup(undefined, undefined, check);
    for (const [, receiptId, text] of refused) {
      await run({ receiptId, receiptPayloadText: text } as never);
    }
    expect(check).not.toHaveBeenCalled();
  });

  it("C5 keys that cannot be read stop the call before the object check", async () => {
    const check = vi.fn(present);
    const { store, run } = setup(undefined, undefined, check);
    store.receiptKeys.mockResolvedValueOnce({ status: "unavailable", reason: "x" } as never);
    expect((await run(ROW)).status).toBe("unavailable");
    expect(check).not.toHaveBeenCalled();
  });

  it("Istodobnost: two concurrent calls for a receipt whose object is missing both hold and sign nothing", async () => {
    const signer = testSigner("k1");
    const { store, stored } = memoryStore(() => [signer.key()]);
    const payloads = new InMemoryEvidencePayloadStore();
    const source = {
      receiptObject: vi.fn(async () => ({
        status: "ok" as const,
        object: {
          institutionId: "00000000-0000-4000-8000-0000000000a1",
          evidencePackageId: PAYLOAD.evidencePackageId,
          segmentHash: PAYLOAD.segmentHash,
          payloadBytes: PAYLOAD.payloadBytes,
          storageRef: `memory:v2/00000000-0000-4000-8000-0000000000a1/pkg-1/${PAYLOAD.segmentHash}.json`,
        },
      })),
    };
    const checkObject = createCheckPendingReceiptObject({ source, locator: payloads, presence: payloads });
    const run = createSignPendingReceipt({ signer: signer.provider, store, signTimeoutMs: 1000, checkObject });
    const outs = await Promise.all([run(ROW), run(ROW)]);
    expect(outs).toEqual([
      { status: "held", reason: "object_absent" },
      { status: "held", reason: "object_absent" },
    ]);
    expect(source.receiptObject).toHaveBeenCalledWith(DOMAIN, RECEIPT);
    expect(signer.provider.sign).not.toHaveBeenCalled();
    expect(store.attachSignature).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);
  });
});

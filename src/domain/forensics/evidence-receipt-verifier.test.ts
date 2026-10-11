import { createHash, generateKeyPairSync, sign as nodeSign } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { EvidenceReceiptPayloadV2, SignedEvidenceReceiptV2 } from "./evidence-receipt";
import {
  verifySignedEvidenceReceiptV2,
  type EvidenceDomainKey,
  type EvidenceReceiptExpectationV2,
} from "./evidence-receipt-verifier";
import { fromHex, goldenKeyVerifier, loadGoldenVectors, type GoldenReceiptV2Vector } from "./golden-vectors/load";
import { canonicalizeJcs } from "./jcs";

/**
 * Attacks on the verifier of receipt v2 (plan in issue 202 and its supplement
 * 6105090985; D-92, DAN-54). Known answers come from the golden-vector file.
 * Where an attack needs a validly signed receipt the file does not hold, the
 * test signs with a key made for that test. All data is invented.
 */
const { receiptV2, chain } = loadGoldenVectors();
const [contract, edges] = receiptV2.accepted;
const DOMAIN_A = receiptV2.evidenceDomainId;
const DOMAIN_B = receiptV2.otherEvidenceDomainId;
const goldenKey = goldenKeyVerifier(chain.verificationKey);

const GOLDEN: EvidenceDomainKey = {
  algorithm: "Ed25519",
  keyId: chain.verificationKey.keyId,
  keyVersion: chain.verificationKey.keyVersion,
  encoding: "spki-der",
  keyBase64Url: Buffer.from(fromHex(chain.verificationKey.spkiDerHex)).toString("base64url"),
  evidenceDomainId: DOMAIN_A,
  purpose: "receipt",
  validFrom: "2026-01-01T00:00:00.000Z",
  validTo: null,
  revokedAt: null,
};

const signedOf = (vector: GoldenReceiptV2Vector): SignedEvidenceReceiptV2 => ({
  payload: vector.payload,
  payloadDigestSha256: vector.payloadDigestSha256,
  signature: vector.signature,
});

const expectationOf = (payload: EvidenceReceiptPayloadV2): EvidenceReceiptExpectationV2 => ({
  documentId: payload.documentId,
  clientTransactionId: payload.clientTransactionId,
  revision: payload.revision,
  evidenceDomainId: payload.evidenceDomainId,
});

const EXPECTED = expectationOf(contract.payload);
const refused = (reason: string) => ({ ok: false, reason });

/**
 * A key pair for one test. `sign` builds the D-92 bytes with node:crypto, not
 * with the code under test, and signs whatever it is given: a test decides
 * what a dishonest signer would sign.
 */
function testKey(keyId: string, scope: Partial<EvidenceDomainKey> = {}) {
  const pair = generateKeyPairSync("ed25519");
  const trusted: EvidenceDomainKey = {
    ...GOLDEN,
    keyId,
    keyBase64Url: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
    ...scope,
  };
  const sign = (payload: unknown, message?: (digest: Buffer) => Buffer): SignedEvidenceReceiptV2 => {
    const digest = createHash("sha256").update(canonicalizeJcs(payload), "utf8").digest();
    const input = message?.(digest) ?? Buffer.concat([Buffer.from("ductus-evidence-receipt-v2\n"), digest]);
    return {
      payload: payload as EvidenceReceiptPayloadV2,
      payloadDigestSha256: digest.toString("hex"),
      signature: {
        algorithm: "Ed25519",
        keyId,
        keyVersion: trusted.keyVersion,
        signatureEncoding: "raw",
        signatureBase64Url: nodeSign(null, input, pair.privateKey).toString("base64url"),
      },
    };
  };
  return { trusted, sign };
}

describe("verifier of receipt v2: what it accepts", () => {
  it.each(receiptV2.accepted)("accepts $name for its own commit and domain", async (vector) => {
    expect(await verifySignedEvidenceReceiptV2(signedOf(vector), expectationOf(vector.payload), [GOLDEN])).toEqual({
      ok: true,
      payload: vector.payload,
    });
  });

  it("accepts every receipt of one commit, and ties no sequence number to the revision", async () => {
    // Owner decision of 11 October 2026 (issue 87, comment 6105502093, point 5):
    // the two fields mean the commit in which the segment was accepted, so a
    // revision may have more than one receipt.
    const key = testKey("kljuc-izmisljeni-1");
    const first = { ...contract.payload, sequenceFrom: 40, sequenceTo: 40 };
    const second = {
      ...first,
      receiptId: "receipt-2",
      previousReceiptId: first.receiptId,
      segmentId: "segment-2",
      segmentHash: "b".repeat(64),
      predecessorSegmentHash: first.segmentHash,
      sequenceFrom: 41,
      sequenceTo: 41,
    };
    expect([first.revision, second.revision]).toEqual([7, 7]);
    for (const payload of [first, second]) {
      expect(await verifySignedEvidenceReceiptV2(key.sign(payload), EXPECTED, [key.trusted])).toEqual({
        ok: true,
        payload,
      });
    }
    // The first receipt of a package carries revision 7 in the contract vector.
    expect([contract.payload.previousReceiptId, contract.payload.sequenceFrom, contract.payload.revision]).toEqual([
      null,
      1,
      7,
    ]);
  });

  it("accepts a receipt signed the D-92 way by a key made for the test", async () => {
    const key = testKey("kljuc-izmisljeni-1");
    expect(await verifySignedEvidenceReceiptV2(key.sign(contract.payload), EXPECTED, [GOLDEN, key.trusted])).toEqual({
      ok: true,
      payload: contract.payload,
    });
  });
});

describe("verifier of receipt v2: the commit it is bound to (plan attacks 1 and 7)", () => {
  it.each([
    ["another transaction id, same revision", { clientTransactionId: "tx-š-2" }],
    ["the same transaction id, a later revision", { revision: 8 }],
    ["the same transaction id, an earlier revision", { revision: 6 }],
    ["another document", { documentId: "doc-2" }],
  ])("refuses the contract receipt when %s is expected", async (_name, other) => {
    expect(await verifySignedEvidenceReceiptV2(signedOf(contract), { ...EXPECTED, ...other }, [GOLDEN])).toEqual(
      refused("commit_mismatch"),
    );
  });

  it.each([
    ["another transaction id", { clientTransactionId: "tx-š-2" }],
    ["another revision", { revision: 8 }],
    ["another document", { documentId: "doc-2" }],
  ])("refuses a validly signed receipt of %s", async (_name, other) => {
    const key = testKey("kljuc-izmisljeni-1");
    const signed = key.sign({ ...contract.payload, ...other });
    // The receipt itself is good: it verifies for the commit it names.
    expect((await verifySignedEvidenceReceiptV2(signed, expectationOf(signed.payload), [key.trusted])).ok).toBe(true);
    expect(await verifySignedEvidenceReceiptV2(signed, EXPECTED, [key.trusted])).toEqual(refused("commit_mismatch"));
  });

  it("does not let the original receipt of a duplicate pass for a newer revision", async () => {
    // The document moved on to revision 9; the duplicate still carries 7.
    expect(await verifySignedEvidenceReceiptV2(signedOf(contract), { ...EXPECTED, revision: 9 }, [GOLDEN])).toEqual(
      refused("commit_mismatch"),
    );
    expect((await verifySignedEvidenceReceiptV2(signedOf(contract), { ...EXPECTED, revision: 7 }, [GOLDEN])).ok).toBe(
      true,
    );
  });

  it.each([
    ["revision 0", { revision: 0 }],
    ["a fractional revision", { revision: 7.5 }],
    ["a revision as text", { revision: "7" }],
    ["an empty transaction id", { clientTransactionId: "" }],
    ["a transaction id with a control character", { clientTransactionId: "tx\u0000" }],
    ["an empty document id", { documentId: " " }],
    ["a domain id in capitals", { evidenceDomainId: DOMAIN_A.toUpperCase() }],
    ["a field nobody asked for", { receiptId: "receipt-1" }],
  ])("refuses to verify against an expectation with %s", async (_name, other) => {
    const expected = { ...EXPECTED, ...other } as unknown as EvidenceReceiptExpectationV2;
    expect(await verifySignedEvidenceReceiptV2(signedOf(contract), expected, [GOLDEN])).toEqual(
      refused("expectation_invalid"),
    );
  });

  it("refuses an expectation that leaves a field out", async () => {
    for (const field of ["documentId", "clientTransactionId", "revision", "evidenceDomainId"] as const) {
      const expected: Partial<EvidenceReceiptExpectationV2> = { ...EXPECTED };
      delete expected[field];
      expect(
        await verifySignedEvidenceReceiptV2(signedOf(contract), expected as EvidenceReceiptExpectationV2, [GOLDEN]),
      ).toEqual(refused("expectation_invalid"));
    }
  });
});

describe("verifier of receipt v2: what was signed (plan attacks 2, 3, 4, 6 and 10)", () => {
  it.each(receiptV2.rejectedSignatures)("refuses a signature that is $name", async (vector) => {
    const signature = { ...contract.signature, signatureBase64Url: vector.signatureBase64Url };
    // The vector is what it says: a real signature of the key, over other bytes.
    expect(vector.messageHex).not.toBe(contract.signingInputHex);
    expect(await goldenKey.verify(fromHex(vector.messageHex), signature)).toBe(true);
    expect(await verifySignedEvidenceReceiptV2({ ...signedOf(contract), signature }, EXPECTED, [GOLDEN])).toEqual(
      refused("signature_invalid"),
    );
  });

  it("refuses a receipt signed by a trusted key over anything but the 59 bytes", async () => {
    const key = testKey("kljuc-izmisljeni-1");
    const jcs = Buffer.from(contract.canonical, "utf8");
    for (const message of [
      () => jcs,
      (digest: Buffer) => digest,
      (digest: Buffer) => Buffer.concat([Buffer.from("ductus-evidence-receipt-v1\n"), digest]),
      (digest: Buffer) => Buffer.concat([Buffer.from("ductus-evidence-receipt-v2"), digest]),
    ]) {
      expect(await verifySignedEvidenceReceiptV2(key.sign(contract.payload, message), EXPECTED, [key.trusted])).toEqual(
        refused("signature_invalid"),
      );
    }
  });

  it.each(receiptV2.rejectedPayloads)("refuses the payload $name, also when a trusted key signed it", async (edit) => {
    const payload: Record<string, unknown> = structuredClone(contract.payload);
    for (const field of edit.remove ?? []) delete payload[field];
    Object.assign(payload, edit.set ?? {});
    const key = testKey("kljuc-izmisljeni-1");

    const borrowed = { ...signedOf(contract), payload };
    expect(await verifySignedEvidenceReceiptV2(borrowed, EXPECTED, [GOLDEN])).toEqual(refused("receipt_malformed"));
    let signed: SignedEvidenceReceiptV2 | null = null;
    try {
      signed = key.sign(payload);
    } catch {
      // A lone surrogate has no canonical form, so there is nothing to sign.
      expect(edit.name).toMatch(/lone-(high|low)-surrogate$/);
    }
    if (signed !== null) {
      expect(await verifySignedEvidenceReceiptV2(signed, EXPECTED, [key.trusted])).toEqual(
        refused("receipt_malformed"),
      );
    }
  });

  it("refuses the former v2 vector, whose signature is valid for its own bytes", async () => {
    const { former } = receiptV2;
    const signed = {
      payload: JSON.parse(former.canonical),
      payloadDigestSha256: former.payloadDigestSha256,
      signature: former.signature,
    };
    expect(await goldenKey.verify(fromHex(former.signingInputHex), former.signature)).toBe(true);
    expect(await verifySignedEvidenceReceiptV2(signed, EXPECTED, [GOLDEN])).toEqual(refused("receipt_malformed"));
  });

  it("refuses a receipt v1, also under a key that signed it", async () => {
    const { payload, payloadDigestSha256, signature } = chain.segments[0].receipt;
    expect(await goldenKey.verify(fromHex(chain.segments[0].receipt.canonicalUtf8Hex), signature)).toBe(true);
    expect(
      await verifySignedEvidenceReceiptV2({ payload, payloadDigestSha256, signature }, EXPECTED, [GOLDEN]),
    ).toEqual(refused("receipt_malformed"));
  });

  it("refuses a changed payload under the original signature", async () => {
    const key = testKey("kljuc-izmisljeni-1");
    const good = key.sign(contract.payload);
    const payload = { ...contract.payload, payloadBytes: 124 };
    expect(await verifySignedEvidenceReceiptV2({ ...good, payload }, EXPECTED, [key.trusted])).toEqual(
      refused("digest_mismatch"),
    );
    // With the digest recomputed the signature is what fails.
    const redigested = { ...key.sign(payload), signature: good.signature };
    expect(await verifySignedEvidenceReceiptV2(redigested, EXPECTED, [key.trusted])).toEqual(
      refused("signature_invalid"),
    );
  });

  it("refuses a signature that is not exactly 64 bytes in one spelling", async () => {
    const original = contract.signature.signatureBase64Url;
    const lastOtherBits = original.slice(0, -1) + (original.endsWith("Q") ? "R" : "Q");
    for (const signatureBase64Url of [
      original.slice(0, -2),
      `${original}AA`,
      // The same 64 bytes for a lenient decoder: other unused bits, another alphabet.
      Buffer.from(lastOtherBits, "base64url").equals(Buffer.from(original, "base64url")) ? lastOtherBits : "A",
      original.replaceAll("-", "+").replaceAll("_", "/"),
    ]) {
      expect(signatureBase64Url).not.toBe(original);
      const signature = { ...contract.signature, signatureBase64Url };
      // Refused as a receipt that is not well formed, before any key is asked.
      expect(await verifySignedEvidenceReceiptV2({ ...signedOf(contract), signature }, EXPECTED, [])).toEqual(
        refused("receipt_malformed"),
      );
    }
  });

  it("refuses a signature or a key of another size without decoding it", async () => {
    const decode = vi.spyOn(globalThis, "atob");
    try {
      const decodedSizes = () => decode.mock.calls.map(([text]) => text.length);
      const key = testKey("kljuc-izmisljeni-1");
      const signed = key.sign(contract.payload);
      const signatureText = signed.signature.signatureBase64Url;
      const keyText = key.trusted.keyBase64Url;
      // Unpadded base64url: 64 bytes are 86 characters, 44 bytes are 59.
      expect([signatureText.length, keyText.length]).toEqual([86, 59]);
      expect(await verifySignedEvidenceReceiptV2(signed, EXPECTED, [key.trusted])).toEqual({
        ok: true,
        payload: contract.payload,
      });
      expect(decodedSizes()).toEqual([86, 59]);

      for (const signatureBase64Url of ["A".repeat(1 << 20), `${signatureText}A`, signatureText.slice(0, -1)]) {
        decode.mockClear();
        const signature = { ...signed.signature, signatureBase64Url };
        expect(await verifySignedEvidenceReceiptV2({ ...signed, signature }, EXPECTED, [key.trusted])).toEqual(
          refused("receipt_malformed"),
        );
        expect(decodedSizes()).toEqual([]);
      }
      for (const keyBase64Url of ["A".repeat(1 << 20), `${keyText}A`, keyText.slice(0, -1)]) {
        decode.mockClear();
        expect(await verifySignedEvidenceReceiptV2(signed, EXPECTED, [{ ...key.trusted, keyBase64Url }])).toEqual(
          refused("key_unknown"),
        );
        // Only the signature of the receipt was decoded, never the key.
        expect(decodedSizes()).toEqual([86]);
      }
    } finally {
      decode.mockRestore();
    }
  });

  it("answers with a refusal, never an exception, for anything that is not plain data", async () => {
    const honest = signedOf(contract);
    for (const value of [
      null,
      undefined,
      "receipt",
      7,
      [honest],
      Object.create(honest),
      new Proxy(honest, {}),
      { ...honest, payload: new Proxy(contract.payload, {}) },
      { ...honest, extra: 1 },
      { ...honest, [Symbol("extra")]: 1 },
      { ...honest, payload: { ...contract.payload, [Symbol("extra")]: 1 } },
    ]) {
      expect(await verifySignedEvidenceReceiptV2(value, EXPECTED, [GOLDEN])).toEqual(refused("receipt_malformed"));
    }
    expect(
      await verifySignedEvidenceReceiptV2(honest, EXPECTED, null as unknown as EvidenceDomainKey[]),
    ).toEqual(refused("expectation_invalid"));
  });

  it("decides on one reading of a receipt that answers differently each time", async () => {
    const other = edges.payload;
    let reads = 0;
    const shifting = {
      get payload() {
        reads += 1;
        // The expected receipt on the first reading, another one afterwards.
        return reads === 1 ? contract.payload : other;
      },
      payloadDigestSha256: contract.payloadDigestSha256,
      signature: contract.signature,
    };
    const result = await verifySignedEvidenceReceiptV2(shifting, EXPECTED, [GOLDEN]);
    expect(reads).toBeGreaterThan(1);
    expect(result).toEqual(refused("commit_mismatch"));

    // The copy is held to the same rules: a field that shows up on the second
    // reading was checked by nobody.
    let signatureReads = 0;
    const growing = {
      ...signedOf(contract),
      get signature() {
        signatureReads += 1;
        return signatureReads === 1 ? contract.signature : { ...contract.signature, note: "x" };
      },
    };
    expect(await verifySignedEvidenceReceiptV2(growing, EXPECTED, [GOLDEN])).toEqual(refused("receipt_malformed"));
    expect(signatureReads).toBeGreaterThan(1);
  });
});

describe("verifier of receipt v2: evidence domain and key scope (supplement D1, D6, D7, D12; plan answer V5, V6)", () => {
  it("refuses a receipt of domain B where domain A is expected (D1)", async () => {
    const keyB = testKey("kljuc-domene-b", { evidenceDomainId: DOMAIN_B });
    const ofB = keyB.sign({ ...contract.payload, evidenceDomainId: DOMAIN_B });
    expect((await verifySignedEvidenceReceiptV2(ofB, expectationOf(ofB.payload), [GOLDEN, keyB.trusted])).ok).toBe(true);
    expect(await verifySignedEvidenceReceiptV2(ofB, EXPECTED, [GOLDEN, keyB.trusted])).toEqual(
      refused("domain_mismatch"),
    );
    // And the other way round: a receipt of A is no receipt of B.
    expect(
      await verifySignedEvidenceReceiptV2(signedOf(contract), { ...EXPECTED, evidenceDomainId: DOMAIN_B }, [
        GOLDEN,
        keyB.trusted,
      ]),
    ).toEqual(refused("domain_mismatch"));
  });

  it("refuses a payload of domain A signed by a key of domain B (D6, V5)", async () => {
    const keyB = testKey("kljuc-domene-b", { evidenceDomainId: DOMAIN_B });
    expect(await verifySignedEvidenceReceiptV2(keyB.sign(contract.payload), EXPECTED, [GOLDEN, keyB.trusted])).toEqual(
      refused("key_scope"),
    );
  });

  it("refuses the checkpoint key of the same domain (D7, V5)", async () => {
    const checkpoint = testKey("kljuc-kontrolne-tocke-a", { purpose: "checkpoint" });
    expect(
      await verifySignedEvidenceReceiptV2(checkpoint.sign(contract.payload), EXPECTED, [GOLDEN, checkpoint.trusted]),
    ).toEqual(refused("key_scope"));
  });

  it("refuses a key id the list does not hold exactly once (D12, V6)", async () => {
    const key = testKey("kljuc-izmisljeni-1");
    const signed = key.sign(contract.payload);
    const sameIdInB = { ...key.trusted, evidenceDomainId: DOMAIN_B };
    for (const keys of [[], [GOLDEN], [key.trusted, sameIdInB], [sameIdInB, key.trusted], [key.trusted, key.trusted]]) {
      expect(await verifySignedEvidenceReceiptV2(signed, EXPECTED, keys)).toEqual(refused("key_unknown"));
    }
    expect((await verifySignedEvidenceReceiptV2(signed, EXPECTED, [GOLDEN, key.trusted])).ok).toBe(true);
  });

  it("refuses a signature that names a key it was not made with, or a version the list does not hold (V6)", async () => {
    const key = testKey("kljuc-izmisljeni-1");
    const signed = key.sign(contract.payload);
    const renamed = { ...signed, signature: { ...signed.signature, keyId: GOLDEN.keyId } };
    expect(await verifySignedEvidenceReceiptV2(renamed, EXPECTED, [GOLDEN, key.trusted])).toEqual(
      refused("signature_invalid"),
    );
    const otherVersion = { ...signed, signature: { ...signed.signature, keyVersion: "2" } };
    expect(await verifySignedEvidenceReceiptV2(otherVersion, EXPECTED, [key.trusted])).toEqual(refused("key_unknown"));
  });

  it.each([
    ["an unknown field", { kmsKeyRef: "izmisljena-referenca" }],
    ["a domain id in capitals", { evidenceDomainId: DOMAIN_A.toUpperCase() }],
    ["no purpose", { purpose: undefined }],
    ["another purpose", { purpose: "root" }],
    ["a date that is no canonical instant", { validTo: "2026-10-04" }],
    ["no start of validity", { validFrom: undefined }],
    ["a start of validity that is no canonical instant", { validFrom: "2026-01-01" }],
    ["no word on revocation", { revokedAt: undefined }],
    ["a revocation time that is no canonical instant", { revokedAt: "2026-10-04" }],
    ["a public key that is not 44 bytes of SPKI", { keyBase64Url: "AQID" }],
    ["a public key of 44 bytes that is no key", { keyBase64Url: Buffer.alloc(44, 1).toString("base64url") }],
  ])("refuses a trusted key with %s", async (_name, change) => {
    const key = testKey("kljuc-izmisljeni-1");
    const broken = { ...key.trusted, ...change } as unknown as EvidenceDomainKey;
    expect(await verifySignedEvidenceReceiptV2(key.sign(contract.payload), EXPECTED, [broken])).toEqual(
      refused("key_unknown"),
    );
  });

  it("refuses a trusted key of another algorithm", async () => {
    const key = testKey("kljuc-izmisljeni-1", { algorithm: "ECDSA_P256_SHA256" });
    expect(await verifySignedEvidenceReceiptV2(key.sign(contract.payload), EXPECTED, [key.trusted])).toEqual(
      refused("key_scope"),
    );
  });
});

describe("verifier of receipt v2: rotation and revocation (supplement D8 to D10; plan answer 6105652638; owner decision 6105677746)", () => {
  // The contract receipt was accepted at 06:05:00.000; T is one millisecond later.
  const T = "2026-10-03T06:05:00.001Z";
  const AFTER = "2026-10-03T06:06:00.000Z";
  const acceptedAt = (time: string) => ({ ...contract.payload, acceptedAt: time, receiptId: "receipt-kasnija" });
  const accepted = (payload: EvidenceReceiptPayloadV2) => ({ ok: true, payload });

  it("V1: accepts a receipt reserved under the old key and signed by the new one after the rotation (D9)", async () => {
    const k1 = testKey("kljuc-a-2025", { validTo: T });
    const k2 = testKey("kljuc-a-2026", { validFrom: T });
    const keys = [k1.trusted, k2.trusted];
    // Reserved while K1 was the key of the domain, before K2 was valid at all.
    expect(Date.parse(contract.payload.acceptedAt)).toBeLessThan(Date.parse(k2.trusted.validFrom));
    expect(await verifySignedEvidenceReceiptV2(k2.sign(contract.payload), EXPECTED, keys)).toEqual(
      accepted(contract.payload),
    );

    // The start of validity bounds the moment of signing, never `acceptedAt`.
    const k3 = testKey("kljuc-a-2027", { validFrom: "2027-01-01T00:00:00.000Z" });
    expect(await verifySignedEvidenceReceiptV2(k3.sign(contract.payload), EXPECTED, [...keys, k3.trusted])).toEqual(
      accepted(contract.payload),
    );
  });

  it("V2: a retired key vouches for what was accepted before its validity ended, and for nothing later (D8)", async () => {
    const retired = testKey("kljuc-a-2025", { validTo: T });
    const active = testKey("kljuc-a-2026", { validFrom: T });
    const keys = [retired.trusted, active.trusted];

    // Expired, never revoked, `acceptedAt` before `validTo`: still a good receipt.
    expect(retired.trusted.revokedAt).toBeNull();
    expect(await verifySignedEvidenceReceiptV2(retired.sign(contract.payload), EXPECTED, keys)).toEqual(
      accepted(contract.payload),
    );
    for (const time of [T, AFTER, "2027-01-01T00:00:00.000Z"]) {
      expect(await verifySignedEvidenceReceiptV2(retired.sign(acceptedAt(time)), EXPECTED, keys)).toEqual(
        refused("key_not_valid"),
      );
    }
    // What is accepted after the rotation carries the new key.
    const later = active.sign(acceptedAt(AFTER));
    expect(later.signature.keyId).toBe("kljuc-a-2026");
    expect(await verifySignedEvidenceReceiptV2(later, EXPECTED, keys)).toEqual(accepted(later.payload));
  });

  it("V3: refuses a revoked key for a receipt accepted from the revocation on (D10)", async () => {
    const revoked = testKey("kljuc-a-opozvan", { revokedAt: T });
    for (const time of [T, AFTER, "2027-01-01T00:00:00.000Z"]) {
      expect(await verifySignedEvidenceReceiptV2(revoked.sign(acceptedAt(time)), EXPECTED, [revoked.trusted])).toEqual(
        refused("key_revoked"),
      );
    }
  });

  it("refuses a revoked key also for a receipt accepted before the revocation (owner decision, option A)", async () => {
    // Issue 87, comment 6105677746: every receipt of a revoked key is invalid.
    // `acceptedAt` is signed by the revoked key itself, so the holder of a
    // compromised key writes any earlier time. Without a time anchor the key
    // does not control, an honest old receipt and a back-dated one look alike.
    const revoked = testKey("kljuc-a-opozvan", { revokedAt: T });
    const honest = revoked.sign(contract.payload);
    expect(Date.parse(contract.payload.acceptedAt)).toBeLessThan(Date.parse(T));
    expect(await verifySignedEvidenceReceiptV2(honest, EXPECTED, [revoked.trusted])).toEqual(refused("key_revoked"));
    const backDated = revoked.sign(acceptedAt("2026-01-02T00:00:00.000Z"));
    expect(await verifySignedEvidenceReceiptV2(backDated, EXPECTED, [revoked.trusted])).toEqual(refused("key_revoked"));

    // Retired first and revoked afterwards: the revocation still decides.
    const both = testKey("kljuc-a-oboje", { validTo: T, revokedAt: AFTER });
    expect(await verifySignedEvidenceReceiptV2(both.sign(contract.payload), EXPECTED, [both.trusted])).toEqual(
      refused("key_revoked"),
    );

    // The way back for an honest receipt: the new key of the domain signs the
    // same payload again. Its digest, the leaf of the log, does not change.
    const k2 = testKey("kljuc-a-2026", { validFrom: T });
    const signedAgain = k2.sign(contract.payload);
    expect([honest.payloadDigestSha256, signedAgain.payloadDigestSha256]).toEqual([
      contract.payloadDigestSha256,
      contract.payloadDigestSha256,
    ]);
    expect(await verifySignedEvidenceReceiptV2(signedAgain, EXPECTED, [revoked.trusted, k2.trusted])).toEqual(
      accepted(contract.payload),
    );
  });
});

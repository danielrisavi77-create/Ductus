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
const { receiptV2, chain, ed25519Points } = loadGoldenVectors();
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
  // The domain, the purpose and the validity the vector file states for this entry.
  ...receiptV2.keyEntry,
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

  it("hands back the author the server signed, and no other author under that signature", async () => {
    const { principalId, otherPrincipalId } = receiptV2;
    const verified = await verifySignedEvidenceReceiptV2(signedOf(contract), EXPECTED, [GOLDEN]);
    expect(verified).toMatchObject({ ok: true, payload: { principalId } });

    // Another author in the same receipt: the digest no longer fits, and with
    // the digest worked out again the signature does not.
    const payload = { ...contract.payload, principalId: otherPrincipalId };
    expect(await verifySignedEvidenceReceiptV2({ ...signedOf(contract), payload }, EXPECTED, [GOLDEN])).toEqual(
      refused("digest_mismatch"),
    );
    const key = testKey("kljuc-izmisljeni-1");
    const redigested = { ...key.sign(payload), signature: contract.signature };
    expect(await verifySignedEvidenceReceiptV2(redigested, EXPECTED, [GOLDEN])).toEqual(refused("signature_invalid"));

    // The author is not part of the expectation: a receipt the server signed
    // for another author verifies, and the caller reads who it names.
    expect(await verifySignedEvidenceReceiptV2(key.sign(payload), EXPECTED, [key.trusted])).toEqual({
      ok: true,
      payload,
    });
    const withAuthor = { ...EXPECTED, principalId } as unknown as EvidenceReceiptExpectationV2;
    expect(await verifySignedEvidenceReceiptV2(signedOf(contract), withAuthor, [GOLDEN])).toEqual(
      refused("expectation_invalid"),
    );
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
    // The last of the 86 characters carries two bits of the signature and four
    // unused ones: with the lowest of those set it is another spelling of the
    // same 64 bytes for a lenient decoder.
    const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const lastOtherBits = original.slice(0, -1) + ALPHABET[ALPHABET.indexOf(original.slice(-1)) ^ 1];
    expect(Buffer.from(lastOtherBits, "base64url").equals(Buffer.from(original, "base64url"))).toBe(true);
    for (const signatureBase64Url of [
      original.slice(0, -2),
      `${original}AA`,
      lastOtherBits,
      // The same 64 bytes in the other alphabet.
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
      // Digest and signature of the other receipt: on every later reading the
      // value is a good receipt of another commit, and that is what is judged.
      payloadDigestSha256: edges.payloadDigestSha256,
      signature: edges.signature,
    };
    const result = await verifySignedEvidenceReceiptV2(shifting, EXPECTED, [GOLDEN]);
    expect(reads).toBeGreaterThan(1);
    expect(result).toEqual(refused("commit_mismatch"));
    expect((await verifySignedEvidenceReceiptV2(signedOf(edges), expectationOf(other), [GOLDEN])).ok).toBe(true);

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

  it.each(receiptV2.rejectedKeys)(
    "refuses the contract receipt, whose signature is valid, under a trusted $name",
    async (edit) => {
      // The honest entry verifies the receipt; only the change of the entry refuses it.
      expect([GOLDEN.evidenceDomainId, GOLDEN.purpose]).toEqual([contract.payload.evidenceDomainId, "receipt"]);
      expect([GOLDEN.validFrom, GOLDEN.validTo, GOLDEN.revokedAt]).toEqual(["2026-01-01T00:00:00.000Z", null, null]);
      expect((await verifySignedEvidenceReceiptV2(signedOf(contract), EXPECTED, [GOLDEN])).ok).toBe(true);
      const entry: Record<string, unknown> = { ...GOLDEN };
      for (const field of edit.remove ?? []) delete entry[field];
      Object.assign(entry, edit.set ?? {});
      const keys = [entry as unknown as EvidenceDomainKey];
      expect(await verifySignedEvidenceReceiptV2(signedOf(contract), EXPECTED, keys)).toEqual(refused(edit.reason));
      // Nor when the caller expects the domain the changed entry names.
      const domainOfEntry = typeof entry.evidenceDomainId === "string" ? entry.evidenceDomainId : DOMAIN_B;
      expect(
        (await verifySignedEvidenceReceiptV2(signedOf(contract), { ...EXPECTED, evidenceDomainId: domainOfEntry }, keys))
          .ok,
      ).toBe(false);
    },
  );

  it("holds a refused key of another domain, of another purpose and of no domain", () => {
    const reasonOf = (name: string) => receiptV2.rejectedKeys.find((edit) => edit.name === name)?.reason;
    expect(reasonOf("key-of-other-domain")).toBe("key_scope");
    expect(reasonOf("key-for-checkpoints")).toBe("key_scope");
    expect(reasonOf("key-without-domain")).toBe("key_unknown");
    expect(reasonOf("key-without-purpose")).toBe("key_unknown");
  });

  it.each(receiptV2.acceptedKeys)("accepts the contract receipt under a trusted $name", async (edit) => {
    const entry = { ...GOLDEN, ...edit.set } as unknown as EvidenceDomainKey;
    expect(entry).not.toEqual(GOLDEN);
    expect(await verifySignedEvidenceReceiptV2(signedOf(contract), EXPECTED, [entry])).toEqual({
      ok: true,
      payload: contract.payload,
    });
  });

  it("holds both sides of acceptedAt < validTo, and no key whose validity ends inside a minute", () => {
    // Owner decision of 11 October 2026 (issue 87, comment 6108490197).
    const refusedKey = (name: string) => receiptV2.rejectedKeys.find((edit) => edit.name === name);
    const acceptedKey = (name: string) => receiptV2.acceptedKeys.find((edit) => edit.name === name);
    const { acceptedAt } = contract.payload;
    const minuteLater = new Date(Date.parse(acceptedAt) + 60_000).toISOString();

    // acceptedAt = validTo is refused; acceptedAt = validTo - 1 min is accepted.
    expect(refusedKey("key-retired-at-accepted-at")).toMatchObject({
      set: { validTo: acceptedAt },
      reason: "key_not_valid",
    });
    expect(acceptedKey("key-retired-one-minute-after-accepted-at")?.set).toEqual({ validTo: minuteLater });

    // A rotation inside the minute of the receipt (the receipt would name
    // 06:05 for a segment accepted at 06:05:10 under a key that ends at
    // 06:05:30): refused as a key, so no receipt is judged by it.
    expect(refusedKey("key-valid-to-inside-the-minute-of-the-receipt")).toMatchObject({
      set: { validTo: "2026-10-03T06:05:30.000Z" },
      reason: "key_unknown",
    });
    // An end of validity off the minute is no key on either side of the
    // receipt, and so is a start of validity off the minute.
    const offTheMinute = receiptV2.rejectedKeys.filter((edit) => /^key-valid-(to|from)-(with|last)/.test(edit.name));
    expect(offTheMinute.map((edit) => edit.reason)).toEqual(Array(offTheMinute.length).fill("key_unknown"));
    expect(offTheMinute.filter((edit) => edit.set?.validTo !== undefined).length).toBeGreaterThanOrEqual(4);
    expect(offTheMinute.filter((edit) => edit.set?.validFrom !== undefined).length).toBeGreaterThanOrEqual(2);
    // A key whose validity ends before it starts, or as it starts, is no key.
    for (const name of ["key-valid-to-before-valid-from", "key-valid-to-at-valid-from"]) {
      const set = refusedKey(name)?.set as { validFrom: string; validTo: string };
      expect(refusedKey(name)?.reason).toBe("key_unknown");
      expect(Date.parse(set.validTo)).toBeLessThanOrEqual(Date.parse(set.validFrom));
      // Without the rule the receipt would pass: it is before that validTo.
      expect(Date.parse(acceptedAt)).toBeLessThan(Date.parse(set.validTo));
    }
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
  // The contract receipt names the minute 06:05: the segment was accepted
  // somewhere from 06:05:00.000 up to 06:06:00.000, which is T. AFTER is the
  // minute that starts at T. INSIDE is a moment within the minute of the receipt.
  const T = "2026-10-03T06:06:00.000Z";
  const AFTER = T;
  const INSIDE = "2026-10-03T06:05:00.001Z";
  const acceptedAt = (time: string) => ({ ...contract.payload, acceptedAt: time, receiptId: "receipt-kasnija" });
  const accepted = (payload: EvidenceReceiptPayloadV2) => ({ ok: true, payload });

  it("judges a retired key by acceptedAt < validTo, and knows no key that ends or starts inside a minute", async () => {
    // Owner decision of 11 October 2026 (issue 87, comment 6108490197): the
    // literal rule, and the end of validity of a key always on a whole minute.
    expect(contract.payload.acceptedAt).toBe("2026-10-03T06:05:00.000Z");
    const under = async (scope: Partial<EvidenceDomainKey>) => {
      const key = testKey("kljuc-a-2025", scope);
      return verifySignedEvidenceReceiptV2(key.sign(contract.payload), EXPECTED, [key.trusted]);
    };
    // acceptedAt < validTo: from the minute after the receipt on.
    for (const validTo of ["2026-10-03T06:06:00.000Z", "2026-10-03T06:07:00.000Z", "2027-01-01T00:00:00.000Z"]) {
      expect(await under({ validTo }), validTo).toEqual(accepted(contract.payload));
    }
    // acceptedAt = validTo and anything earlier: the end of validity is exclusive.
    for (const validTo of ["2026-10-03T06:05:00.000Z", "2026-10-03T06:04:00.000Z", "2026-01-02T00:00:00.000Z"]) {
      expect(await under({ validTo }), validTo).toEqual(refused("key_not_valid"));
    }
    // A key that ends inside a minute is no key, on either side of the
    // receipt: the time is never rounded, down or up. 06:05:30 is the honest
    // rotation inside the minute of the receipt (accepted at 06:05:10, signed
    // at 06:05:20); 06:06:30 and 06:06:00.001 would pass the comparison.
    for (const validTo of [
      "2026-10-03T06:05:30.000Z",
      "2026-10-03T06:04:59.999Z",
      "2026-10-03T06:05:00.001Z",
      "2026-10-03T06:05:59.999Z",
      "2026-10-03T06:06:00.001Z",
      "2026-10-03T06:06:30.000Z",
      "2026-10-03T06:06:59.999Z",
    ]) {
      expect(await under({ validTo }), validTo).toEqual(refused("key_unknown"));
    }
    // The start of validity is held to the same form: the end of one key is
    // the start of the next. It is still never compared with acceptedAt.
    for (const validFrom of ["2026-01-01T00:00:30.000Z", "2026-01-01T00:00:00.001Z", "2025-12-31T23:59:59.999Z"]) {
      expect(await under({ validFrom }), validFrom).toEqual(refused("key_unknown"));
    }
    expect(await under({ validFrom: "2027-01-01T00:00:00.000Z" })).toEqual(accepted(contract.payload));
    // A validity that ends before it starts, or as it starts, is no validity.
    expect(await under({ validFrom: T, validTo: "2026-10-03T06:07:00.000Z" })).toEqual(accepted(contract.payload));
    for (const validTo of [T, "2026-10-03T06:05:00.000Z", "2026-01-01T00:00:00.000Z"]) {
      expect(await under({ validFrom: T, validTo }), validTo).toEqual(refused("key_unknown"));
    }
    // A revocation is an event and may fall inside a minute; it refuses everything.
    expect(await under({ revokedAt: INSIDE })).toEqual(refused("key_revoked"));

    // The same boundary seen from the receipt, under one key.
    const onTheMinute = testKey("kljuc-a-2025", { validTo: T });
    const before = onTheMinute.sign(acceptedAt("2026-10-03T06:05:00.000Z"));
    const at = onTheMinute.sign(acceptedAt(T));
    expect(await verifySignedEvidenceReceiptV2(before, EXPECTED, [onTheMinute.trusted])).toEqual(
      accepted(before.payload),
    );
    expect(await verifySignedEvidenceReceiptV2(at, EXPECTED, [onTheMinute.trusted])).toEqual(refused("key_not_valid"));
  });

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
    for (const time of [AFTER, "2026-10-03T06:07:00.000Z", "2027-01-01T00:00:00.000Z"]) {
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
    // Revoked on a whole minute, and inside the minute the contract receipt names.
    for (const revokedAt of [T, INSIDE]) {
      const revoked = testKey("kljuc-a-opozvan", { revokedAt });
      for (const time of [AFTER, "2026-10-03T06:07:00.000Z", "2027-01-01T00:00:00.000Z"]) {
        expect(
          await verifySignedEvidenceReceiptV2(revoked.sign(acceptedAt(time)), EXPECTED, [revoked.trusted]),
        ).toEqual(refused("key_revoked"));
      }
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
    const both = testKey("kljuc-a-oboje", { validTo: T, revokedAt: "2026-10-03T06:07:00.000Z" });
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

describe("verifier of receipt v2: what a reason says (review 6108474330)", () => {
  const honest = signedOf(contract);
  const otherCommit = { ...EXPECTED, revision: 8 };
  const otherDomain = { ...EXPECTED, evidenceDomainId: DOMAIN_B };

  it("names another commit or domain only for a receipt whose signature it has verified", async () => {
    // Verified under a receipt key of its own domain: the server did sign it,
    // for another commit or for another domain than the caller expects.
    expect(await verifySignedEvidenceReceiptV2(honest, otherCommit, [GOLDEN])).toEqual(refused("commit_mismatch"));
    expect(await verifySignedEvidenceReceiptV2(honest, otherDomain, [GOLDEN])).toEqual(refused("domain_mismatch"));
    expect(
      await verifySignedEvidenceReceiptV2(honest, { ...otherCommit, evidenceDomainId: DOMAIN_B }, [GOLDEN]),
    ).toEqual(refused("domain_mismatch"));

    // Not verified: the reason is what kept it from being verified, and says
    // nothing about a commit or a domain anyone signed.
    const overOtherBytes = {
      ...honest,
      signature: { ...contract.signature, signatureBase64Url: receiptV2.rejectedSignatures[0].signatureBase64Url },
    };
    const smallOrderR = {
      ...honest,
      signature: { ...contract.signature, signatureBase64Url: Buffer.alloc(64).toString("base64url") },
    };
    const unverified: [string, unknown, EvidenceDomainKey[], string][] = [
      ["no key on the list", honest, [], "key_unknown"],
      ["a signature over other bytes", overOtherBytes, [GOLDEN], "signature_invalid"],
      ["the digest of another payload", { ...honest, payloadDigestSha256: edges.payloadDigestSha256 }, [GOLDEN], "digest_mismatch"],
      ["a signature no signer makes", smallOrderR, [GOLDEN], "receipt_malformed"],
      ["a checkpoint key", honest, [{ ...GOLDEN, purpose: "checkpoint" }], "key_scope"],
      ["a revoked key", honest, [{ ...GOLDEN, revokedAt: "2026-10-03T06:06:00.000Z" }], "key_revoked"],
      ["a retired key", honest, [{ ...GOLDEN, validTo: contract.payload.acceptedAt }], "key_not_valid"],
    ];
    for (const [name, receipt, keys, reason] of unverified) {
      for (const expected of [EXPECTED, otherCommit, otherDomain]) {
        expect(await verifySignedEvidenceReceiptV2(receipt, expected, keys), name).toEqual(refused(reason));
      }
    }
  });

  it("gives a receipt nobody signed no reason that reads as a signed commit", async () => {
    // A payload for a commit the caller does not expect, under the signature
    // of the contract receipt: the digest is right, the signature is not.
    const key = testKey("kljuc-izmisljeni-1");
    const payload = { ...contract.payload, revision: 8 };
    const unsigned = { ...key.sign(payload), signature: contract.signature };
    expect(await verifySignedEvidenceReceiptV2(unsigned, EXPECTED, [GOLDEN])).toEqual(refused("signature_invalid"));
    expect(await verifySignedEvidenceReceiptV2(unsigned, expectationOf(payload), [GOLDEN])).toEqual(
      refused("signature_invalid"),
    );
  });
});

describe("verifier of receipt v2: a runtime that cannot verify", () => {
  // Not a refusal: the check was not made, and the receipt may be a good one.
  const UNAVAILABLE = { ok: false, reason: "verification_unavailable" };
  const honest = () => verifySignedEvidenceReceiptV2(signedOf(contract), EXPECTED, [GOLDEN]);
  const notSupported = () => new DOMException("Unrecognized algorithm name", "NotSupportedError");

  async function withGlobal(name: string, value: unknown, act: () => Promise<unknown>) {
    vi.stubGlobal(name, value);
    try {
      return await act();
    } finally {
      vi.unstubAllGlobals();
    }
  }

  async function withSubtle<Result>(
    method: "digest" | "importKey" | "verify",
    stub: (...args: unknown[]) => unknown,
    act: () => Promise<Result>,
  ) {
    const spy = vi.spyOn(globalThis.crypto.subtle, method).mockImplementation(stub as never);
    try {
      return { result: await act(), calls: spy.mock.calls.length };
    } finally {
      spy.mockRestore();
    }
  }

  it("verifies the honest receipt in this runtime, so the stubs below are what changes the answer", async () => {
    expect(await honest()).toEqual({ ok: true, payload: contract.payload });
  });

  // The hashing and the key import of this runtime, for a runtime that has only part of Web Crypto.
  const real = globalThis.crypto.subtle;
  const digest: SubtleCrypto["digest"] = (...args) => real.digest(...args);
  const importKey = (...args: Parameters<SubtleCrypto["importKey"]>) => real.importKey(...args);

  it.each([
    ["no crypto at all", undefined],
    ["a crypto with no subtle", {}],
    ["a subtle that is null", { subtle: null }],
    ["a subtle with no method", { subtle: {} }],
    ["a subtle that can only hash", { subtle: { digest } }],
    ["a subtle that hashes and imports but cannot verify", { subtle: { digest, importKey } }],
  ])("says the check was not made under %s", async (_name, crypto) => {
    expect(await withGlobal("crypto", crypto, honest)).toEqual(UNAVAILABLE);
  });

  it("verifies under a crypto put together from the three calls it uses", async () => {
    const verify: SubtleCrypto["verify"] = (...args) => real.verify(...args);
    expect(await withGlobal("crypto", { subtle: { digest, importKey, verify } }, honest)).toEqual({
      ok: true,
      payload: contract.payload,
    });
  });

  it.each(["structuredClone", "atob", "btoa"])("says the check was not made where there is no %s", async (name) => {
    expect(await withGlobal(name, undefined, honest)).toEqual(UNAVAILABLE);
  });

  it("says the check was not made when the runtime cannot hash", async () => {
    for (const stub of [
      async () => Promise.reject(notSupported()),
      () => {
        throw new TypeError("digest is not available");
      },
      // A digest that is not 32 bytes is no SHA-256.
      async () => new ArrayBuffer(20),
      async () => undefined,
    ]) {
      expect(await withSubtle("digest", stub, honest)).toEqual({ result: UNAVAILABLE, calls: 1 });
    }
  });

  it("says the check was not made when the runtime does not import a key that is sound", async () => {
    // A runtime without Ed25519 rejects with NotSupportedError. The bytes of
    // the key were judged before the runtime was asked, so whatever it throws
    // for them is the runtime, never the key.
    for (const stub of [
      async () => Promise.reject(notSupported()),
      async () => Promise.reject(new DOMException("Invalid keyData", "DataError")),
      async () => Promise.reject(new Error("anything")),
      () => {
        throw new TypeError("importKey is not available");
      },
    ]) {
      expect(await withSubtle("importKey", stub, honest)).toEqual({ result: UNAVAILABLE, calls: 1 });
    }
  });

  it("still refuses a key that is no key in a runtime that imports nothing", async () => {
    const reject = async () => Promise.reject(notSupported());
    const smallOrder = { ...GOLDEN, keyBase64Url: Buffer.from(`302a300506032b6570032100${"00".repeat(32)}`, "hex").toString("base64url") };
    const notSpki = { ...GOLDEN, keyBase64Url: Buffer.alloc(44, 1).toString("base64url") };
    for (const key of [smallOrder, notSpki, { ...GOLDEN, keyBase64Url: "AQID" }]) {
      expect(
        await withSubtle("importKey", reject, () => verifySignedEvidenceReceiptV2(signedOf(contract), EXPECTED, [key])),
      ).toEqual({ result: refused("key_unknown"), calls: 0 });
    }
    // And every refusal that is decided before the key is imported keeps its reason.
    const before: [unknown, EvidenceDomainKey[], string][] = [
      [signedOf(contract), [], "key_unknown"],
      [signedOf(contract), [{ ...GOLDEN, purpose: "checkpoint" }], "key_scope"],
      [signedOf(contract), [{ ...GOLDEN, revokedAt: "2026-10-03T06:06:00.000Z" }], "key_revoked"],
      [signedOf(contract), [{ ...GOLDEN, validTo: contract.payload.acceptedAt }], "key_not_valid"],
      [{ ...signedOf(contract), payloadDigestSha256: edges.payloadDigestSha256 }, [GOLDEN], "digest_mismatch"],
      [{ ...signedOf(contract), payload: { ...contract.payload, revision: 0 } }, [GOLDEN], "receipt_malformed"],
    ];
    for (const [receipt, keys, reason] of before) {
      expect(
        await withSubtle("importKey", reject, () => verifySignedEvidenceReceiptV2(receipt, EXPECTED, keys)),
      ).toEqual({ result: refused(reason), calls: 0 });
    }
  });

  it("says the check was not made when the runtime cannot verify", async () => {
    for (const stub of [
      async () => Promise.reject(notSupported()),
      async () => Promise.reject(new DOMException("The operation failed", "OperationError")),
      () => {
        throw new TypeError("verify is not available");
      },
    ]) {
      expect(await withSubtle("verify", stub, honest)).toEqual({ result: UNAVAILABLE, calls: 1 });
    }
  });

  it("takes only the answer true of the runtime as a valid signature", async () => {
    // The honest receipt, and a runtime that answers with something truthy.
    for (const answer of [1, "true", {}, [true], false, 0, null, undefined]) {
      expect(await withSubtle("verify", async () => answer, honest)).toEqual({
        result: refused("signature_invalid"),
        calls: 1,
      });
    }
    expect(await withSubtle("verify", async () => true, honest)).toEqual({
      result: { ok: true, payload: contract.payload },
      calls: 1,
    });
  });

  it("keeps a fault of the receipt a refusal, in a runtime that can verify", async () => {
    const throwing = {
      ...signedOf(contract),
      get payload(): unknown {
        throw new Error("no payload");
      },
    };
    expect(await verifySignedEvidenceReceiptV2(throwing, EXPECTED, [GOLDEN])).toEqual(refused("receipt_malformed"));
    // A value that is gone when it is copied: the copy fails for the value, not for the runtime.
    let reads = 0;
    const vanishing = {
      ...signedOf(contract),
      get payload(): unknown {
        reads += 1;
        if (reads > 1) throw new Error("no payload any more");
        return contract.payload;
      },
    };
    expect(await verifySignedEvidenceReceiptV2(vanishing, EXPECTED, [GOLDEN])).toEqual(refused("receipt_malformed"));
    expect(reads).toBe(2);
  });

  it("never reads the unavailable check as a receipt", async () => {
    const forged = { ...signedOf(contract), signature: { ...contract.signature, signatureBase64Url: receiptV2.rejectedSignatures[0].signatureBase64Url } };
    for (const receipt of [signedOf(contract), forged]) {
      for (const method of ["digest", "importKey", "verify"] as const) {
        const { result } = await withSubtle(method, async () => Promise.reject(notSupported()), () =>
          verifySignedEvidenceReceiptV2(receipt, EXPECTED, [GOLDEN]),
        );
        expect(result).toEqual(UNAVAILABLE);
        expect(result.ok).toBe(false);
      }
    }
  });
});

describe("verifier of receipt v2: keys and signatures no honest signer makes (QA 6106245321)", () => {
  // The eight points of small order of edwards25519, as [L]Q for random points
  // Q, worked out by arithmetic outside this repository and not taken from a list.
  const SMALL_ORDER: [string, string][] = [
    ["the identity", "01" + "00".repeat(31)],
    ["the point of order 2", "ec" + "ff".repeat(30) + "7f"],
    ["a point of order 4", "00".repeat(32)],
    ["the other point of order 4", "00".repeat(31) + "80"],
    ["a point of order 8", "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05"],
    ["a second point of order 8", "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85"],
    ["a third point of order 8", "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a"],
    ["a fourth point of order 8", "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa"],
  ];
  // A second spelling of a number: y at or above p = 2^255 - 19, or the sign of x set where x is 0.
  const NOT_CANONICAL: [string, string][] = [
    ["the identity with the sign of x set", "01" + "00".repeat(30) + "80"],
    ["the point of order 2 with the sign of x set", "ec" + "ff".repeat(31)],
    ["y = p, a second spelling of 0", "ed" + "ff".repeat(30) + "7f"],
    ["y = p + 1, a second spelling of 1", "ee" + "ff".repeat(30) + "7f"],
    ["y = p + 2", "ef" + "ff".repeat(30) + "7f"],
    ["y = 2^255 - 1", "ff".repeat(31) + "7f"],
    ["32 bytes of 0xff", "ff".repeat(32)],
  ];
  const UNSOUND = [...SMALL_ORDER, ...NOT_CANONICAL];
  const GROUP_ORDER = 2n ** 252n + 27742317777372353535851937790883648493n;
  const BASE_POINT = "58" + "66".repeat(31);

  const spki = (keyHex: string, oid = "2b6570") =>
    Buffer.from(`302a300506${`03${oid}`}032100${keyHex}`, "hex").toString("base64url");
  const signatureText = (rHex: string, s: bigint) =>
    Buffer.concat([
      Buffer.from(rHex, "hex"),
      Buffer.from(s.toString(16).padStart(64, "0"), "hex").reverse(),
    ]).toString("base64url");
  const partsOf = (signed: SignedEvidenceReceiptV2) => {
    const bytes = Buffer.from(signed.signature.signatureBase64Url, "base64url");
    return {
      r: bytes.subarray(0, 32).toString("hex"),
      s: BigInt(`0x${Buffer.from(bytes.subarray(32)).reverse().toString("hex")}`),
    };
  };
  const withSignature = (signed: SignedEvidenceReceiptV2, signatureBase64Url: string) => ({
    ...signed,
    signature: { ...signed.signature, signatureBase64Url },
  });

  /** A runtime that imports and verifies anything, as some do for a weak key. */
  async function underLenientRuntime(act: () => Promise<unknown>) {
    const importKey = vi.spyOn(globalThis.crypto.subtle, "importKey").mockResolvedValue({} as CryptoKey);
    const verify = vi.spyOn(globalThis.crypto.subtle, "verify").mockResolvedValue(true);
    try {
      const result = await act();
      return { result, imports: importKey.mock.calls.length, verifications: verify.mock.calls.length };
    } finally {
      importKey.mockRestore();
      verify.mockRestore();
    }
  }

  it("is checked against a runtime that accepts a sound key and signature", async () => {
    const key = testKey("kljuc-izmisljeni-1");
    const signed = key.sign(contract.payload);
    expect(await underLenientRuntime(() => verifySignedEvidenceReceiptV2(signed, EXPECTED, [key.trusted]))).toEqual({
      result: { ok: true, payload: contract.payload },
      imports: 1,
      verifications: 1,
    });
  });

  it.each(UNSOUND)("refuses a trusted key that is %s, whatever the runtime would say", async (_name, keyHex) => {
    const key = testKey("kljuc-izmisljeni-1");
    const weak = { ...key.trusted, keyBase64Url: spki(keyHex) };
    expect(
      await underLenientRuntime(() => verifySignedEvidenceReceiptV2(key.sign(contract.payload), EXPECTED, [weak])),
    ).toEqual({ result: refused("key_unknown"), imports: 0, verifications: 0 });
  });

  it.each(UNSOUND)("refuses a signature whose R is %s, whatever the runtime would say", async (_name, rHex) => {
    const key = testKey("kljuc-izmisljeni-1");
    const signed = key.sign(contract.payload);
    const forged = withSignature(signed, signatureText(rHex, partsOf(signed).s));
    expect(await underLenientRuntime(() => verifySignedEvidenceReceiptV2(forged, EXPECTED, [key.trusted]))).toEqual({
      result: refused("receipt_malformed"),
      imports: 0,
      verifications: 0,
    });
  });

  it("refuses a receipt forged with no private key under the identity key (QA reproduction)", async () => {
    // With the identity as the key, [S]B = R holds for whoever picks S: R = [S]B
    // needs no secret. A runtime that does not refuse the key verifies any message.
    const payload = {
      ...contract.payload,
      documentId: "doc-krivotvoren",
      clientTransactionId: "tx-krivotvoren",
      revision: 234,
      segmentHash: "f".repeat(64),
    };
    const identity = { ...GOLDEN, keyId: "kljuc-slab", keyBase64Url: spki(SMALL_ORDER[0][1]) };
    const forgedWith = (signatureBase64Url: string): SignedEvidenceReceiptV2 => ({
      payload,
      payloadDigestSha256: createHash("sha256").update(canonicalizeJcs(payload), "utf8").digest("hex"),
      signature: {
        algorithm: "Ed25519",
        keyId: "kljuc-slab",
        keyVersion: GOLDEN.keyVersion,
        signatureEncoding: "raw",
        signatureBase64Url,
      },
    });
    // The signature of the reproduction (R the identity, S = 0), and R = B with S = 1.
    const reproduced = forgedWith(signatureText(SMALL_ORDER[0][1], 0n));
    const sound = forgedWith(signatureText(BASE_POINT, 1n));
    for (const lenient of [false, true]) {
      const run = lenient ? underLenientRuntime : async (act: () => Promise<unknown>) => ({ result: await act() });
      expect(
        (await run(() => verifySignedEvidenceReceiptV2(reproduced, expectationOf(payload), [identity]))).result,
      ).toEqual(refused("receipt_malformed"));
      expect(
        (await run(() => verifySignedEvidenceReceiptV2(sound, expectationOf(payload), [identity]))).result,
      ).toEqual(refused("key_unknown"));
    }
  });

  it("refuses a signature whose S is not below the group order", async () => {
    const key = testKey("kljuc-izmisljeni-1");
    const signed = key.sign(contract.payload);
    const { r, s } = partsOf(signed);
    expect(s < GROUP_ORDER).toBe(true);
    // S + L verifies wherever S does, unless the verifier asks for S < L.
    for (const other of [s + GROUP_ORDER, GROUP_ORDER, GROUP_ORDER + 1n, 2n ** 256n - 1n]) {
      const malleated = withSignature(signed, signatureText(r, other));
      expect(
        await underLenientRuntime(() => verifySignedEvidenceReceiptV2(malleated, EXPECTED, [key.trusted])),
      ).toEqual({ result: refused("receipt_malformed"), imports: 0, verifications: 0 });
    }
    // The largest S there is reaches the runtime, which finds the signature wrong.
    const largest = withSignature(signed, signatureText(r, GROUP_ORDER - 1n));
    expect(await verifySignedEvidenceReceiptV2(largest, EXPECTED, [key.trusted])).toEqual(
      refused("signature_invalid"),
    );
  });

  it.each(ed25519Points.accepted)("leaves $name, a point of the prime-order subgroup, to the runtime", async (point) => {
    // Before the subgroup was checked this test also sent y = p - 2 and y = 2
    // to the runtime; both are on no point of the curve and are refused below.
    const key = testKey("kljuc-izmisljeni-1");
    const signed = key.sign(contract.payload);
    expect(
      await underLenientRuntime(() =>
        verifySignedEvidenceReceiptV2(signed, EXPECTED, [{ ...key.trusted, keyBase64Url: spki(point.pointHex) }]),
      ),
    ).toMatchObject({ result: { ok: true }, imports: 1, verifications: 1 });
    const otherR = withSignature(signed, signatureText(point.pointHex, partsOf(signed).s));
    expect(
      await underLenientRuntime(() => verifySignedEvidenceReceiptV2(otherR, EXPECTED, [key.trusted])),
    ).toMatchObject({ result: { ok: true }, imports: 1, verifications: 1 });
    // The runtime itself finds such a signature wrong: the point is sound, the signature is not.
    expect(await verifySignedEvidenceReceiptV2(otherR, EXPECTED, [key.trusted])).toEqual(refused("signature_invalid"));
  });

  it.each(ed25519Points.rejected)(
    "refuses $name ($class) as a trusted key and as R, whatever the runtime would say",
    async (point) => {
      const key = testKey("kljuc-izmisljeni-1");
      const signed = key.sign(contract.payload);
      const weak = { ...key.trusted, keyBase64Url: spki(point.pointHex) };
      expect(await underLenientRuntime(() => verifySignedEvidenceReceiptV2(signed, EXPECTED, [weak]))).toEqual({
        result: refused("key_unknown"),
        imports: 0,
        verifications: 0,
      });
      const otherR = withSignature(signed, signatureText(point.pointHex, partsOf(signed).s));
      expect(await underLenientRuntime(() => verifySignedEvidenceReceiptV2(otherR, EXPECTED, [key.trusted]))).toEqual({
        result: refused("receipt_malformed"),
        imports: 0,
        verifications: 0,
      });
    },
  );

  it("refuses a signature that fits the equation of RFC 8032 under a mixed-order key", async () => {
    // The key is the golden key plus a point of order 8, and the nonce was
    // picked so that the challenge is a multiple of 8: [S]B = R + [h]A holds.
    // A runtime that checks that equation verifies it, one that multiplies by
    // the cofactor verifies every signature of that scalar; neither is asked.
    const { pointHex, signatureBase64Url, signatureHex } = ed25519Points.mixedOrderSignature;
    expect(Buffer.from(signatureBase64Url, "base64url").toString("hex")).toBe(signatureHex);
    const mixed = { ...GOLDEN, keyBase64Url: spki(pointHex) };
    const receipt = withSignature(signedOf(contract), signatureBase64Url);
    // R and S of that signature are sound: only the key is not.
    expect(await verifySignedEvidenceReceiptV2(receipt, EXPECTED, [GOLDEN])).toEqual(refused("signature_invalid"));
    expect(await verifySignedEvidenceReceiptV2(receipt, EXPECTED, [mixed])).toEqual(refused("key_unknown"));
    expect(await underLenientRuntime(() => verifySignedEvidenceReceiptV2(receipt, EXPECTED, [mixed]))).toEqual({
      result: refused("key_unknown"),
      imports: 0,
      verifications: 0,
    });
    // Nor does the honest signature of the golden key pass under the mixed-order key.
    expect(await verifySignedEvidenceReceiptV2(signedOf(contract), EXPECTED, [mixed])).toEqual(refused("key_unknown"));
  });

  it("refuses 44 bytes that are not an Ed25519 key in SPKI, without asking the runtime", async () => {
    const key = testKey("kljuc-izmisljeni-1");
    const signed = key.sign(contract.payload);
    const rawKey = Buffer.from(key.trusted.keyBase64Url, "base64url").subarray(12).toString("hex");
    expect(spki(rawKey)).toBe(key.trusted.keyBase64Url);
    // The same 32 bytes under the identifier of X25519, and of Ed448.
    for (const oid of ["2b656e", "2b6571"]) {
      const other = { ...key.trusted, keyBase64Url: spki(rawKey, oid) };
      expect(await underLenientRuntime(() => verifySignedEvidenceReceiptV2(signed, EXPECTED, [other]))).toEqual({
        result: refused("key_unknown"),
        imports: 0,
        verifications: 0,
      });
    }
  });
});

describe("verifier of receipt v2: oversized input (QA 6106245321)", () => {
  const LONG = 1 << 20;
  const FILLERS = [" ".repeat(LONG), "a".repeat(LONG)];
  // What a text may be at most when it is read: an instant, an id, a signature.
  const MOST = { parsed: 27, trimmed: 2048, matched: 4096 };

  /** Runs `act` and reports the costly work it did, and on texts of what size. */
  async function watched(act: () => Promise<unknown>) {
    const clone = vi.spyOn(globalThis, "structuredClone");
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    const importKey = vi.spyOn(globalThis.crypto.subtle, "importKey");
    const decode = vi.spyOn(globalThis, "atob");
    const parse = vi.spyOn(Date, "parse");
    const trim = vi.spyOn(String.prototype, "trim");
    const match = vi.spyOn(RegExp.prototype, "test");
    const longest = (texts: unknown[]) => texts.reduce<number>((most, text) => Math.max(most, String(text).length), 0);
    try {
      const result = await act();
      return {
        result,
        clones: clone.mock.calls.length,
        hashes: digest.mock.calls.length,
        imports: importKey.mock.calls.length,
        decoded: longest(decode.mock.calls.map(([text]) => text)),
        parsed: longest(parse.mock.calls.map(([text]) => text)),
        trimmed: longest(trim.mock.contexts),
        matched: longest(match.mock.calls.map(([text]) => text)),
      };
    } finally {
      for (const spy of [clone, digest, importKey, decode, parse, trim, match]) spy.mockRestore();
    }
  }

  it("does the costly work for a receipt of the right size, so the watch sees it", async () => {
    const seen = await watched(() => verifySignedEvidenceReceiptV2(signedOf(contract), EXPECTED, [GOLDEN]));
    expect(seen).toMatchObject({ result: { ok: true }, clones: 2, hashes: 1, imports: 1, decoded: 86, parsed: 24 });
    expect(seen.trimmed).toBeGreaterThan(0);
    expect(seen.matched).toBe(86);
  });

  it("refuses a receipt with an oversized text before it copies, hashes or reads that text", async () => {
    const honest = signedOf(contract);
    const oversized: unknown[] = [];
    for (const filler of FILLERS) {
      for (const field of Object.keys(honest.payload)) {
        oversized.push({ ...honest, payload: { ...honest.payload, [field]: filler } });
      }
      for (const field of Object.keys(honest.signature)) {
        oversized.push({ ...honest, signature: { ...honest.signature, [field]: filler } });
      }
      oversized.push({ ...honest, payloadDigestSha256: filler });
    }
    expect(oversized).toHaveLength(2 * (20 + 5 + 1));
    for (const receipt of oversized) {
      const seen = await watched(() => verifySignedEvidenceReceiptV2(receipt, EXPECTED, [GOLDEN]));
      expect(seen).toMatchObject({ result: refused("receipt_malformed"), clones: 0, hashes: 0, imports: 0, decoded: 0 });
      expect(seen.parsed).toBeLessThanOrEqual(MOST.parsed);
      expect(seen.trimmed).toBeLessThanOrEqual(MOST.trimmed);
      expect(seen.matched).toBeLessThanOrEqual(MOST.matched);
    }
  });

  it("refuses a trusted key with an oversized text before it copies or reads that text", async () => {
    const fields = Object.keys(GOLDEN).filter((field) => field !== "keyId");
    expect(fields).toHaveLength(9);
    for (const filler of FILLERS) {
      for (const field of fields) {
        const seen = await watched(() =>
          verifySignedEvidenceReceiptV2(signedOf(contract), EXPECTED, [{ ...GOLDEN, [field]: filler }]),
        );
        // One copy and one hash: of the receipt. The key is never copied.
        expect(seen).toMatchObject({ result: refused("key_unknown"), clones: 1, hashes: 1, imports: 0, decoded: 86 });
        expect(seen.parsed).toBeLessThanOrEqual(MOST.parsed);
        expect(seen.trimmed).toBeLessThanOrEqual(MOST.trimmed);
        expect(seen.matched).toBeLessThanOrEqual(MOST.matched);
      }
    }
  });

  it("refuses an oversized expectation before it reads that text", async () => {
    for (const filler of FILLERS) {
      for (const field of ["documentId", "clientTransactionId", "evidenceDomainId"]) {
        const seen = await watched(() =>
          verifySignedEvidenceReceiptV2(signedOf(contract), { ...EXPECTED, [field]: filler }, [GOLDEN]),
        );
        expect(seen).toMatchObject({ result: refused("expectation_invalid"), clones: 0, hashes: 0 });
        expect(seen.trimmed).toBeLessThanOrEqual(MOST.trimmed);
        expect(seen.matched).toBeLessThanOrEqual(MOST.matched);
      }
    }
    const longId = { ...EXPECTED, documentId: "d".repeat(257) };
    expect(await verifySignedEvidenceReceiptV2(signedOf(contract), longId, [GOLDEN])).toEqual(
      refused("expectation_invalid"),
    );
  });
});
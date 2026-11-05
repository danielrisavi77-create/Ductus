import { createHash, generateKeyPairSync, sign as nodeSign } from "node:crypto";

import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import { MAX_EVIDENCE_PROFILE_ID_LENGTH } from "./evidence-segment-v2";
import {
  digestEvidenceReceiptPayloadV2,
  EVIDENCE_RECEIPT_SCHEMA_V2,
  isEvidenceReceiptPayloadV2,
  isSignedEvidenceReceiptV2,
  MAX_RECEIPT_CLIENT_TRANSACTION_ID_LENGTH,
  type EvidenceReceiptPayloadV2,
  type SignedEvidenceReceiptV2,
} from "./evidence-receipt";
import { verifySignedEvidenceReceiptV2, type EvidenceDomainKey } from "./evidence-receipt-verifier";
import { loadGoldenVectors } from "./golden-vectors/load";
import { canonicalizeJcs } from "./jcs";

/**
 * Receipt v2 as a format (DAN-83, M3.1-P02; contract on #1091; D-92). A
 * generated payload goes through its canonical bytes and its signature and
 * back unchanged; a change of any field after signing is refused, whether the
 * digest is left stale or recomputed. The signing input is built here with
 * node:crypto, never with the code under test, and the key is made for this
 * file. All data is generated.
 */

const { receiptV2 } = loadGoldenVectors();
const DOMAIN = receiptV2.evidenceDomainId;
const OTHER_DOMAIN = receiptV2.otherEvidenceDomainId;
const KEY_ID = "kljuc-izmisljeni-format";
const pair = generateKeyPairSync("ed25519");
const TRUSTED: EvidenceDomainKey = {
  algorithm: "Ed25519",
  keyId: KEY_ID,
  keyVersion: "1",
  encoding: "spki-der",
  keyBase64Url: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
  ...receiptV2.keyEntry,
};

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest();
const PREFIX = Buffer.from(`${EVIDENCE_RECEIPT_SCHEMA_V2}\n`, "utf8");

function signed(payload: EvidenceReceiptPayloadV2): SignedEvidenceReceiptV2 {
  const digest = sha256(canonicalizeJcs(payload));
  return {
    payload,
    payloadDigestSha256: digest.toString("hex"),
    signature: {
      algorithm: "Ed25519",
      keyId: KEY_ID,
      keyVersion: TRUSTED.keyVersion,
      signatureEncoding: "raw",
      signatureBase64Url: nodeSign(null, Buffer.concat([PREFIX, digest]), pair.privateKey).toString("base64url"),
    },
  };
}

const expectationOf = (payload: EvidenceReceiptPayloadV2) => ({
  documentId: payload.documentId,
  clientTransactionId: payload.clientTransactionId,
  revision: payload.revision,
  evidenceDomainId: payload.evidenceDomainId,
});

const id = (max = 256) => fc.stringMatching(/^[a-z][a-z0-9-]{0,40}$/).filter((value) => value.length <= max);
const hash = fc.stringMatching(/^[0-9a-f]{64}$/);
const HEX_DIGIT = fc.constantFrom(..."0123456789abcdef");
const hex = (length: number) => fc.string({ unit: HEX_DIGIT, minLength: length, maxLength: length });
const uuidV4 = fc
  .tuple(hex(8), hex(4), hex(3), fc.constantFrom("8", "9", "a", "b"), hex(3), hex(12))
  .map(([a, b, c, variant, d, e]) => `${a}-${b}-4${c}-${variant}${d}-${e}`);
const FIRST_MINUTE = Date.parse("2026-01-01T00:00:00.000Z") / 60_000;
const minute = fc
  .integer({ min: FIRST_MINUTE, max: FIRST_MINUTE + 525_000 })
  .map((value) => new Date(value * 60_000).toISOString());

/** A valid payload v2 of the given evidence domain. */
const payloadOf = (domain: string) =>
  fc
    .record({
      receiptId: id(),
      evidencePackageId: id(),
      documentId: id(),
      sessionId: id(),
      segmentId: id(),
      segmentHash: hash,
      predecessorSegmentHash: fc.option(hash, { nil: null }),
      previousReceiptId: fc.option(id(), { nil: null }),
      evidenceSchema: fc.constantFrom("ductus-evidence-segment-v2" as const, "ductus-evidence-segment-v3" as const),
      evidenceProfileId: id(MAX_EVIDENCE_PROFILE_ID_LENGTH),
      sequenceFrom: fc.integer({ min: 1, max: 2 ** 40 }),
      eventCount: fc.integer({ min: 1, max: 5000 }),
      payloadBytes: fc.integer({ min: 1, max: 2 * 1024 * 1024 }),
      acceptedAt: minute,
      revision: fc.integer({ min: 1, max: 2 ** 40 }),
      clientTransactionId: id(MAX_RECEIPT_CLIENT_TRANSACTION_ID_LENGTH),
      principalId: uuidV4,
    })
    .map(
      (g): EvidenceReceiptPayloadV2 => ({
        ...g,
        receiptSchema: EVIDENCE_RECEIPT_SCHEMA_V2,
        sequenceTo: g.sequenceFrom + g.eventCount - 1,
        evidenceDomainId: domain,
      }),
    );

const payload = payloadOf(DOMAIN);
/** The fields a change is made in; the three numbers of the range move together. */
type Change = { name: string; keys: (keyof EvidenceReceiptPayloadV2)[] };
const CHANGES: Change[] = [
  ...(
    [
      "receiptId",
      "evidencePackageId",
      "documentId",
      "sessionId",
      "segmentId",
      "segmentHash",
      "predecessorSegmentHash",
      "previousReceiptId",
      "evidenceSchema",
      "evidenceProfileId",
      "payloadBytes",
      "acceptedAt",
      "revision",
      "clientTransactionId",
      "evidenceDomainId",
      "principalId",
    ] as const
  ).map((key) => ({ name: key, keys: [key] })),
  { name: "sequence range", keys: ["sequenceFrom", "sequenceTo", "eventCount"] },
];

const RUNS = { numRuns: 120 };

describe("receipt v2 format: round trip", () => {
  test.prop([payload], RUNS)(
    "a generated payload keeps its canonical bytes and digest, and its signature verifies",
    async (generated) => {
      expect(isEvidenceReceiptPayloadV2(generated)).toBe(true);
      const canonical = canonicalizeJcs(generated);
      const parsed: unknown = JSON.parse(canonical);
      expect(isEvidenceReceiptPayloadV2(parsed)).toBe(true);
      expect(canonicalizeJcs(parsed as EvidenceReceiptPayloadV2)).toBe(canonical);

      const digest = await digestEvidenceReceiptPayloadV2(parsed as EvidenceReceiptPayloadV2);
      const independent = sha256(canonical);
      expect(digest.canonical).toBe(canonical);
      expect(Buffer.from(digest.bytes).equals(Buffer.from(canonical, "utf8"))).toBe(true);
      expect(digest.sha256).toBe(independent.toString("hex"));
      expect(Buffer.from(digest.signingInput).equals(Buffer.concat([PREFIX, independent]))).toBe(true);
      expect(digest.signingInput.byteLength).toBe(59);

      // The receipt as the client keeps it: through JSON and back.
      const kept: unknown = JSON.parse(JSON.stringify(signed(generated)));
      expect(isSignedEvidenceReceiptV2(kept)).toBe(true);
      expect(await verifySignedEvidenceReceiptV2(kept, expectationOf(generated), [TRUSTED])).toEqual({
        ok: true,
        payload: generated,
      });
    },
  );
});

describe("receipt v2 format: a change after signing", () => {
  test.prop([payload], { numRuns: 20 })(
    "every key of a real payload but the schema tag is changed in some row",
    (generated) => {
      // The schema tag stays out: a payload with another tag is not v2 at all.
      const changed = CHANGES.flatMap((change) => change.keys).sort();
      expect(changed).toEqual(Object.keys(generated).filter((key) => key !== "receiptSchema").sort());
    },
  );

  test.prop([payload, payloadOf(OTHER_DOMAIN), fc.constantFrom(...CHANGES)], { numRuns: 400 })(
    "a payload changed in any field is refused, with a stale digest and with a recomputed one",
    async (original, other, change) => {
      const changed = { ...original };
      for (const key of change.keys) Object.assign(changed, { [key]: other[key] });
      fc.pre(canonicalizeJcs(changed) !== canonicalizeJcs(original));
      // The changed payload is valid by itself, so only the signature can refuse it.
      expect(isEvidenceReceiptPayloadV2(changed)).toBe(true);

      const receipt = signed(original);
      const expected = expectationOf(original);
      expect(await verifySignedEvidenceReceiptV2({ ...receipt, payload: changed }, expected, [TRUSTED])).toEqual({
        ok: false,
        reason: "digest_mismatch",
      });
      const recomputed = { ...receipt, payload: changed, payloadDigestSha256: sha256(canonicalizeJcs(changed)).toString("hex") };
      // The changed payload is also checked against its own commit, so a
      // reader that trusted the payload over its expectation gains nothing.
      for (const expectation of [expected, expectationOf(changed)]) {
        expect(await verifySignedEvidenceReceiptV2(recomputed, expectation, [TRUSTED])).toEqual({
          ok: false,
          reason: changed.evidenceDomainId === DOMAIN ? "signature_invalid" : "key_scope",
        });
      }
    },
  );

  test.prop([payload, fc.integer({ min: 0, max: 63 }), fc.integer({ min: 1, max: 15 })], RUNS)(
    "a changed digest or one changed byte of the signature is refused",
    async (generated, position, delta) => {
      const receipt = signed(generated);
      const expected = expectationOf(generated);
      const digest = receipt.payloadDigestSha256;
      const otherNibble = ((parseInt(digest[position], 16) + delta) % 16).toString(16);
      const staleDigest = { ...receipt, payloadDigestSha256: digest.slice(0, position) + otherNibble + digest.slice(position + 1) };
      expect(await verifySignedEvidenceReceiptV2(staleDigest, expected, [TRUSTED])).toEqual({
        ok: false,
        reason: "digest_mismatch",
      });

      const bytes = Buffer.from(receipt.signature.signatureBase64Url, "base64url");
      bytes[position] ^= delta;
      const forged = { ...receipt, signature: { ...receipt.signature, signatureBase64Url: bytes.toString("base64url") } };
      const result = await verifySignedEvidenceReceiptV2(forged, expected, [TRUSTED]);
      expect(result.ok).toBe(false);
      // A byte of R or S that leaves no canonical signature is refused as malformed.
      expect(["signature_invalid", "receipt_malformed"]).toContain(result.ok ? null : result.reason);
    },
  );

  test.prop([payload, fc.constantFrom("payload", "envelope", "signature"), fc.constantFrom("note", "signedAt", "keyUse")], RUNS)(
    "an unknown field in the payload, the envelope or the signature is refused",
    async (generated, where, key) => {
      const receipt: Record<string, unknown> = structuredClone(signed(generated));
      const target = where === "envelope" ? receipt : (receipt[where] as Record<string, unknown>);
      target[key] = "x";
      expect(isSignedEvidenceReceiptV2(receipt)).toBe(false);
      expect(await verifySignedEvidenceReceiptV2(receipt, expectationOf(generated), [TRUSTED])).toEqual({
        ok: false,
        reason: "receipt_malformed",
      });
    },
  );

  test.prop([payload, fc.integer({ min: 1, max: 59_999 })], RUNS)(
    "an acceptance time that is not a whole minute is refused before anything is signed",
    async (generated, offset) => {
      const acceptedAt = new Date(Date.parse(generated.acceptedAt) + offset).toISOString();
      const changed = { ...generated, acceptedAt };
      expect(isEvidenceReceiptPayloadV2(changed)).toBe(false);
      await expect(digestEvidenceReceiptPayloadV2(changed)).rejects.toThrow("evidence receipt v2: not a v2 payload");
      expect(await verifySignedEvidenceReceiptV2(signed(changed), expectationOf(changed), [TRUSTED])).toEqual({
        ok: false,
        reason: "receipt_malformed",
      });
    },
  );
});

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  digestEvidenceReceiptPayloadV2,
  EVIDENCE_RECEIPT_SCHEMA_V2,
  EVIDENCE_RECEIPT_V2_SIGNING_INPUT_BYTES,
  isEvidenceDomainId,
  isEvidenceReceiptPayloadV1,
  isEvidenceReceiptPayloadV2,
  isReceiptClientTransactionId,
  isReceiptPrincipalId,
  isReceiptRevision,
  isSignedEvidenceReceipt,
  isSignedEvidenceReceiptV2,
  MAX_RECEIPT_CLIENT_TRANSACTION_ID_LENGTH,
  type EvidenceReceiptPayloadV2,
} from "./evidence-receipt";
import { fromHex, goldenKeyVerifier, loadGoldenVectors, toHex } from "./golden-vectors/load";
import { canonicalizeJcs } from "./jcs";

/**
 * Receipt v2 (D-92, DAN-54; plan in issue 202). The expected bytes, digests
 * and signatures come from the golden-vector file, where they were derived
 * outside this repository. All data is invented.
 */
const { receiptV2, chain, sequenceRanges } = loadGoldenVectors();
const [contract, edges] = receiptV2.accepted;
const goldenKey = goldenKeyVerifier(chain.verificationKey);
const utf8 = new TextEncoder();
const NOT_V2 = "evidence receipt v2: not a v2 payload";

/** The contract payload with one refused change of the file applied. */
function changed(edit: (typeof receiptV2.rejectedPayloads)[number]): Record<string, unknown> {
  const payload: Record<string, unknown> = structuredClone(contract.payload);
  for (const key of edit.remove ?? []) delete payload[key];
  return Object.assign(payload, edit.set ?? {});
}

const signedWith = (payload: unknown) => ({
  payload,
  payloadDigestSha256: contract.payloadDigestSha256,
  signature: contract.signature,
});

describe("receipt v2: known-answer vectors (D-92)", () => {
  it.each(receiptV2.accepted)("$name: canonical bytes, digest, 59 bytes and signature", async (vector) => {
    expect(isEvidenceReceiptPayloadV2(vector.payload)).toBe(true);
    const digest = await digestEvidenceReceiptPayloadV2(vector.payload);
    expect(digest.canonical).toBe(vector.canonical);
    expect(toHex(digest.bytes)).toBe(vector.canonicalUtf8Hex);
    expect(digest.bytes.byteLength).toBe(vector.byteLength);
    expect(digest.sha256).toBe(vector.payloadDigestSha256);

    // The file agrees with itself: D is the SHA-256 of the canonical bytes,
    // and the signing input is the prefix, one line feed and the raw D.
    expect(createHash("sha256").update(fromHex(vector.canonicalUtf8Hex)).digest("hex")).toBe(
      vector.payloadDigestSha256,
    );
    expect(vector.signingInputHex).toBe(
      toHex(utf8.encode(`${receiptV2.signingPrefix}\n`)) + vector.payloadDigestSha256,
    );
    expect(toHex(digest.signingInput)).toBe(vector.signingInputHex);
    expect(digest.signingInput.byteLength).toBe(59);
    expect(EVIDENCE_RECEIPT_V2_SIGNING_INPUT_BYTES).toBe(59);

    expect(Buffer.from(vector.signature.signatureBase64Url, "base64url").toString("hex")).toBe(
      vector.signatureHex,
    );
    expect(await goldenKey.verify(digest.signingInput, vector.signature)).toBe(true);
    // Never the receipt v1 way (the JCS bytes) and never the bare digest.
    expect(await goldenKey.verify(digest.bytes, vector.signature)).toBe(false);
    expect(await goldenKey.verify(fromHex(digest.sha256), vector.signature)).toBe(false);
    expect(await goldenKey.verify(utf8.encode(digest.sha256), vector.signature)).toBe(false);
  });

  it("puts the four fields where RFC 8785 puts them", () => {
    expect(receiptV2.signingPrefix).toBe(EVIDENCE_RECEIPT_SCHEMA_V2);
    expect(Object.keys(JSON.parse(contract.canonical))).toEqual([
      "acceptedAt",
      "clientTransactionId",
      "documentId",
      "eventCount",
      "evidenceDomainId",
      "evidencePackageId",
      "evidenceProfileId",
      "evidenceSchema",
      "payloadBytes",
      "predecessorSegmentHash",
      "previousReceiptId",
      "principalId",
      "receiptId",
      "receiptSchema",
      "revision",
      "segmentHash",
      "segmentId",
      "sequenceFrom",
      "sequenceTo",
      "sessionId",
    ]);
    expect(contract.canonical).toContain(
      `"previousReceiptId":null,"principalId":"${receiptV2.principalId}","receiptId":"receipt-1",`,
    );
    expect(contract.canonical).toContain(
      '{"acceptedAt":"2026-10-03T06:05:00.000Z","clientTransactionId":"tx-š-1","documentId":"doc-1",',
    );
    expect(contract.canonical).toContain(
      `"eventCount":1,"evidenceDomainId":"${receiptV2.evidenceDomainId}","evidencePackageId":"evidence-1",`,
    );
    expect(contract.canonical).toContain(
      '"receiptSchema":"ductus-evidence-receipt-v2","revision":7,"segmentHash":"',
    );
    // One Croatian letter: two bytes in UTF-8, so the bytes are not UTF-16 or Latin-1.
    expect(contract.canonicalUtf8Hex).toContain(toHex(utf8.encode('"tx-')) + "c5a1" + toHex(utf8.encode('-1"')));
  });

  it("is the vector written in docs/backend/evidencija.md section 4.1", () => {
    const backend = readFileSync(new URL("../../../docs/backend/evidencija.md", import.meta.url), "utf8");
    expect(backend).toContain(`\`${contract.canonical}\``);
    expect(backend).toContain(`SHA-256/JCS: \`${contract.payloadDigestSha256}\``);
    expect(backend).toContain(`RAW ulaz (59B): \`${contract.signingInputHex}\``);
    expect(backend).toContain(`potpis nad RAW 59B: \`${contract.signatureHex}\``);
  });

  it("gives the same bytes for the same payload in any key order", async () => {
    const reordered = Object.fromEntries(Object.entries(edges.payload).reverse());
    expect(Object.keys(reordered)).not.toEqual(Object.keys(edges.payload));
    const digest = await digestEvidenceReceiptPayloadV2(reordered as EvidenceReceiptPayloadV2);
    expect(toHex(digest.signingInput)).toBe(edges.signingInputHex);
  });

  it("binds each signature to its own payload", async () => {
    expect(await goldenKey.verify(fromHex(edges.signingInputHex), contract.signature)).toBe(false);
    expect(await goldenKey.verify(fromHex(contract.signingInputHex), edges.signature)).toBe(false);
    // A change of one field outside the commit binding changes D too.
    const digest = await digestEvidenceReceiptPayloadV2({ ...contract.payload, payloadBytes: 124 });
    expect(digest.sha256).not.toBe(contract.payloadDigestSha256);
    expect(await goldenKey.verify(digest.signingInput, contract.signature)).toBe(false);
  });
});

describe("receipt v2: refused payloads", () => {
  it.each(receiptV2.rejectedPayloads)("refuses $name", async (edit) => {
    const payload = changed(edit);
    expect(isEvidenceReceiptPayloadV2(payload)).toBe(false);
    expect(isSignedEvidenceReceiptV2(signedWith(payload))).toBe(false);
    // No signing input exists for it, so nothing can sign it by the v2 way.
    await expect(digestEvidenceReceiptPayloadV2(payload as EvidenceReceiptPayloadV2)).rejects.toThrow(NOT_V2);
  });

  it("holds every class of refusal the plan asks for", () => {
    const names = (klass: string) =>
      receiptV2.rejectedPayloads.filter((edit) => edit.class === klass).map((edit) => edit.name);
    expect(new Set(receiptV2.rejectedPayloads.map((edit) => edit.class))).toEqual(
      new Set([
        "former-shape",
        "schema",
        "revision",
        "client-transaction-id",
        "evidence-domain-id",
        "principal-id",
        "unknown-fields",
        "acceptance-fields",
        "accepted-at-minute",
      ]),
    );
    expect(names("former-shape")).toHaveLength(4);
    // The author left out, a readable name in its place, and the other forms.
    expect(names("principal-id")).toEqual(
      expect.arrayContaining([
        "principal-id-missing",
        "principal-id-a-name",
        "principal-id-an-address",
        "principal-id-uppercase",
        "principal-id-version-1",
        "principal-id-version-7",
        "principal-id-null",
      ]),
    );
    expect(names("accepted-at-minute")).toEqual(
      expect.arrayContaining([
        "accepted-at-with-seconds",
        "accepted-at-with-milliseconds",
        "accepted-at-last-millisecond",
        "accepted-at-year-of-six-digits",
      ]),
    );
    // No field under which a client could name the author stays unknown and accepted.
    expect(names("unknown-fields")).toContain("unknown-author-id");
    expect(names("revision")).toEqual(
      expect.arrayContaining([
        "revision-zero",
        "revision-negative",
        "revision-fraction",
        "revision-above-safe-integer",
        "revision-as-string",
      ]),
    );
    expect(names("client-transaction-id")).toEqual(
      expect.arrayContaining([
        "transaction-id-empty",
        "transaction-id-too-long",
        "transaction-id-nul",
        "transaction-id-lone-high-surrogate",
        "transaction-id-lone-low-surrogate",
      ]),
    );
    expect(names("evidence-domain-id")).toEqual(
      expect.arrayContaining([
        "domain-id-uppercase",
        "domain-id-without-hyphens",
        "domain-id-version-1",
        "domain-id-version-7",
      ]),
    );
    // Each vector changes the contract payload, which itself is accepted.
    expect(isSignedEvidenceReceiptV2(signedWith(contract.payload))).toBe(true);
  });

  it("holds a refusal for every field a receipt v2 shares with a receipt v1", () => {
    const shared = Object.keys(contract.payload).filter(
      (field) =>
        !["receiptSchema", "revision", "clientTransactionId", "evidenceDomainId", "principalId"].includes(field),
    );
    expect(shared).toHaveLength(15);
    const edits = receiptV2.rejectedPayloads.filter((edit) => edit.class === "acceptance-fields");
    for (const field of shared) {
      // The field left out, and the field with a value it may not have.
      expect(edits.some((edit) => edit.remove?.length === 1 && edit.remove[0] === field)).toBe(true);
      expect(edits.some((edit) => Object.keys(edit.set ?? {}).includes(field))).toBe(true);
    }
    const names = edits.map((edit) => edit.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "payload-bytes-zero",
        "event-count-rounding-at-largest-number",
        "event-count-rounding-at-largest-count",
        "sequence-to-above-safe-integer",
        "accepted-at-without-milliseconds",
      ]),
    );
  });

  it("counts the events of a range exactly, up to the largest safe integer", () => {
    const LARGEST = Number.MAX_SAFE_INTEGER;
    const range = (sequenceFrom: number, sequenceTo: number, eventCount: number) =>
      isEvidenceReceiptPayloadV2({ ...contract.payload, sequenceFrom, sequenceTo, eventCount });
    expect(range(1, LARGEST, LARGEST)).toBe(true);
    expect(range(LARGEST, LARGEST, 1)).toBe(true);
    expect(range(LARGEST - 1, LARGEST, 2)).toBe(true);
    expect(range(2, LARGEST, LARGEST - 1)).toBe(true);
    // In a double, from + count - 1 rounds each of these back to the end of the range.
    expect(LARGEST + 2 - 1).toBe(LARGEST);
    expect(2 + LARGEST - 1).toBe(LARGEST);
    expect(range(LARGEST, LARGEST, 2)).toBe(false);
    expect(range(2, LARGEST, LARGEST)).toBe(false);
    expect(range(LARGEST - 1, LARGEST, 3)).toBe(false);
    expect(range(1, LARGEST, LARGEST - 1)).toBe(false);
  });

  it("holds the range vectors the descriptor and the segment are held to, in both receipts", () => {
    const v1 = chain.segments[0].receipt.payload;
    const { accepted, rejected } = sequenceRanges;
    expect(rejected.filter((range) => range.name.startsWith("rounding"))).toHaveLength(3);
    for (const [ranges, taken] of [[accepted, true], [rejected, false]] as const) {
      for (const { name, sequenceFrom, sequenceTo, eventCount } of ranges) {
        const range = { sequenceFrom, sequenceTo, eventCount };
        expect(isEvidenceReceiptPayloadV2({ ...contract.payload, ...range }), name).toBe(taken);
        expect(isEvidenceReceiptPayloadV1({ ...v1, ...range }), name).toBe(taken);
      }
    }
  });

  it("refuses a range of no event and one that ends before it starts, also where the count agrees with it", () => {
    const v1 = chain.segments[0].receipt.payload;
    const refuses = (name: string) => {
      const { sequenceFrom, sequenceTo, eventCount } = sequenceRanges.rejected.find((range) => range.name === name)!;
      const range = { sequenceFrom, sequenceTo, eventCount };
      expect(isEvidenceReceiptPayloadV2({ ...contract.payload, ...range }), name).toBe(false);
      expect(isEvidenceReceiptPayloadV1({ ...v1, ...range }), name).toBe(false);
      return range;
    };
    // to - from = count - 1 holds for these three, so it is not that equation
    // which refuses them: a range holds an event and does not end before it starts.
    for (const name of ["empty-range", "empty-range-above-one", "negative-count"]) {
      const { sequenceFrom, sequenceTo, eventCount } = refuses(name);
      expect(sequenceTo - sequenceFrom, name).toBe(eventCount - 1);
      expect(eventCount, name).toBeLessThan(1);
      expect(sequenceTo, name).toBeLessThan(sequenceFrom);
    }
    // Both ends valid numbers on their own, so no rule about one end refuses it either.
    expect(refuses("empty-range-above-one")).toEqual({ sequenceFrom: 5, sequenceTo: 4, eventCount: 0 });
    // Each of the two rules where the other one is kept: no event in a range
    // that does not end before it starts, and one event in a range that does.
    expect(refuses("no-event-in-one-number")).toEqual({ sequenceFrom: 1, sequenceTo: 1, eventCount: 0 });
    expect(refuses("end-before-start")).toEqual({ sequenceFrom: 2, sequenceTo: 1, eventCount: 1 });
  });

  it("takes acceptedAt only as a whole UTC minute, where a receipt v1 takes any instant", () => {
    // Issue 87, comment 6107934097, point 2: the minute and nothing finer.
    const v1 = chain.segments[0].receipt.payload;
    for (const vector of receiptV2.accepted) {
      expect(vector.payload.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
    }
    for (const acceptedAt of ["2026-10-03T06:05:00.000Z", "2026-12-31T23:59:00.000Z", "0001-01-01T00:00:00.000Z"]) {
      expect(isEvidenceReceiptPayloadV2({ ...contract.payload, acceptedAt }), acceptedAt).toBe(true);
    }
    const finer = receiptV2.rejectedPayloads.filter((edit) => edit.class === "accepted-at-minute");
    expect(finer.length).toBeGreaterThanOrEqual(6);
    let takenByV1 = 0;
    for (const edit of finer) {
      const acceptedAt = edit.set?.acceptedAt;
      expect(isEvidenceReceiptPayloadV2({ ...contract.payload, acceptedAt }), edit.name).toBe(false);
      // The same text is an instant a receipt v1 may carry: only the minute rule refuses it.
      if (isEvidenceReceiptPayloadV1({ ...v1, acceptedAt })) takenByV1 += 1;
      else expect(edit.name).toBe("accepted-at-without-seconds");
    }
    expect(takenByV1).toBe(finer.length - 1);
    // A golden receipt v1 keeps its full instant.
    const later = chain.segments[1].receipt.payload;
    expect(later.acceptedAt).toBe("2026-10-12T08:46:30.250Z");
    expect(isEvidenceReceiptPayloadV1(later)).toBe(true);
    expect(isEvidenceReceiptPayloadV2({ ...contract.payload, acceptedAt: later.acceptedAt })).toBe(false);
  });

  it("refuses the contract vector as it was before DAN-54", async () => {
    const { former } = receiptV2;
    const payload: unknown = JSON.parse(former.canonical);
    // The bytes docs/BACKEND.md published: canonical JCS with the former digest.
    expect(canonicalizeJcs(payload)).toBe(former.canonical);
    expect(toHex(utf8.encode(former.canonical))).toBe(former.canonicalUtf8Hex);
    expect(createHash("sha256").update(fromHex(former.canonicalUtf8Hex)).digest("hex")).toBe(
      "c829e34d42c491db3ab19132c9caa4574bfd86c752e9fa64c26470662e3566e6",
    );
    expect(former.payloadDigestSha256).toBe("c829e34d42c491db3ab19132c9caa4574bfd86c752e9fa64c26470662e3566e6");
    expect(await goldenKey.verify(fromHex(former.signingInputHex), former.signature)).toBe(true);

    expect(isEvidenceReceiptPayloadV2(payload)).toBe(false);
    expect(
      isSignedEvidenceReceiptV2({
        payload,
        payloadDigestSha256: former.payloadDigestSha256,
        signature: former.signature,
      }),
    ).toBe(false);
    await expect(digestEvidenceReceiptPayloadV2(payload as EvidenceReceiptPayloadV2)).rejects.toThrow(NOT_V2);
  });

  it("refuses a field nobody validated, however it is attached", () => {
    const base = contract.payload;
    expect(isEvidenceReceiptPayloadV2({ ...base, note: undefined })).toBe(false);
    expect(isEvidenceReceiptPayloadV2({ ...base, [Symbol("extra")]: 1 })).toBe(false);
    expect(isEvidenceReceiptPayloadV2(JSON.parse(`{"__proto__":{"x":1},${contract.canonical.slice(1)}`))).toBe(false);
    expect(isEvidenceReceiptPayloadV2(Object.create(base))).toBe(false);
    expect(isEvidenceReceiptPayloadV2([base])).toBe(false);
    expect(isSignedEvidenceReceiptV2({ ...signedWith(base), evidenceDomainId: receiptV2.evidenceDomainId })).toBe(false);
    expect(
      isSignedEvidenceReceiptV2({ ...signedWith(base), signature: { ...contract.signature, purpose: "receipt" } }),
    ).toBe(false);
  });
});

describe("receipt v2: limits of the four fields", () => {
  it("takes only a canonical lowercase UUID of version 4 as the author, and signs it", async () => {
    const { principalId, otherPrincipalId } = receiptV2;
    for (const id of [principalId, otherPrincipalId]) {
      expect(isReceiptPrincipalId(id)).toBe(true);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect(otherPrincipalId).not.toBe(principalId);
    expect(receiptV2.accepted.map((vector) => vector.payload.principalId)).toEqual([principalId, principalId]);
    for (const version of "012356789abcdef") {
      const other = `${principalId.slice(0, 14)}${version}${principalId.slice(15)}`;
      expect(isReceiptPrincipalId(other), `version ${version}`).toBe(false);
    }
    for (const value of ["student-izmisljeni-zv-1", principalId.toUpperCase(), ` ${principalId}`, "", null, 7]) {
      expect(isReceiptPrincipalId(value)).toBe(false);
    }

    // The author is under the signature: the same receipt for another author
    // is a valid payload with another digest, which the signature does not fit.
    const other = { ...contract.payload, principalId: otherPrincipalId };
    expect(isEvidenceReceiptPayloadV2(other)).toBe(true);
    const digest = await digestEvidenceReceiptPayloadV2(other);
    expect(digest.sha256).not.toBe(contract.payloadDigestSha256);
    expect(await goldenKey.verify(digest.signingInput, contract.signature)).toBe(false);
  });

  it("takes revisions from 1 to the largest safe integer", () => {
    expect([1, 7, 9007199254740991].map(isReceiptRevision)).toEqual([true, true, true]);
    expect([0, -1, 1.5, 9007199254740992, Number.NaN, Number.POSITIVE_INFINITY, "7", null].map(isReceiptRevision)).toEqual(
      [false, false, false, false, false, false, false, false],
    );
    expect(edges.payload.revision).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("takes a transaction id of 1 to 128 code units with no control character", () => {
    // Written as a number on purpose: the cap is the one of the commit request.
    expect(MAX_RECEIPT_CLIENT_TRANSACTION_ID_LENGTH).toBe(128);
    expect(edges.payload.clientTransactionId).toHaveLength(128);
    expect(isReceiptClientTransactionId("x".repeat(128))).toBe(true);
    expect(isReceiptClientTransactionId("x".repeat(129))).toBe(false);
    expect(isReceiptClientTransactionId("😀")).toBe(true);
    expect(isReceiptClientTransactionId("\ude00\ud83d")).toBe(false);
    for (let unit = 0; unit <= 0x9f; unit += 1) {
      const control = unit <= 0x1f || unit >= 0x7f;
      expect(isReceiptClientTransactionId(`tx${String.fromCharCode(unit)}1`), unit.toString(16)).toBe(!control);
    }
  });

  it("takes only a canonical lowercase UUID of version 4 as the evidence domain", () => {
    for (const id of [receiptV2.evidenceDomainId, receiptV2.otherEvidenceDomainId]) {
      expect(isEvidenceDomainId(id)).toBe(true);
      expect(id).toHaveLength(36);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      // Version 4 and the RFC 9562 variant: no time and no node in it.
      expect(id[14]).toBe("4");
      expect("89ab").toContain(id[19]);
    }
    expect(receiptV2.otherEvidenceDomainId).not.toBe(receiptV2.evidenceDomainId);
    for (const version of "012356789abcdef") {
      const other = `${receiptV2.evidenceDomainId.slice(0, 14)}${version}${receiptV2.evidenceDomainId.slice(15)}`;
      expect(isEvidenceDomainId(other), `version ${version}`).toBe(false);
    }
  });
});

describe("receipt v1 and receipt v2 stay apart (D-92)", () => {
  const v1 = chain.segments[0].receipt;

  it("never makes the v2 signing input for a v1 record", async () => {
    expect(isEvidenceReceiptPayloadV1(v1.payload)).toBe(true);
    expect(isEvidenceReceiptPayloadV2(v1.payload)).toBe(false);
    await expect(
      digestEvidenceReceiptPayloadV2(v1.payload as unknown as EvidenceReceiptPayloadV2),
    ).rejects.toThrow(NOT_V2);
    expect(
      isSignedEvidenceReceiptV2({
        payload: v1.payload,
        payloadDigestSha256: v1.payloadDigestSha256,
        signature: v1.signature,
      }),
    ).toBe(false);
  });

  it("never reads a v2 receipt by the v1 rules", () => {
    expect(isEvidenceReceiptPayloadV1(contract.payload)).toBe(false);
    expect(isSignedEvidenceReceipt(signedWith(contract.payload))).toBe(false);
  });

  it("takes pure Ed25519 only for receipt v2", () => {
    for (const [algorithm, signatureEncoding] of [
      ["ECDSA_P256_SHA256", "der"],
      ["RSA_PSS_SHA256", "raw"],
    ]) {
      expect(
        isSignedEvidenceReceiptV2({
          ...signedWith(contract.payload),
          signature: { ...contract.signature, algorithm, signatureEncoding },
        }),
      ).toBe(false);
    }
  });
});

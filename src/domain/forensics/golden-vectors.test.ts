import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  MAX_EVIDENCE_SEGMENT_BYTES,
  verifyCanonicalEvidencePayloadV2,
  verifyEvidenceChainV2,
} from "./evidence-chain-v2";
import { digestEvidenceReceiptPayload, isSignedEvidenceReceipt } from "./evidence-receipt";
import { digestCanonicalDocumentV2 } from "./evidence-replay-v2";
import {
  digestEvidenceSegmentV2,
  isEvidenceSegmentV2,
  isTimeOrderedIdentifierV2,
} from "./evidence-segment-v2";
import {
  applyPayloadEdit,
  fromHex,
  goldenKeyVerifier,
  loadGoldenVectors,
  toHex,
} from "./golden-vectors/load";
import { canonicalizeJcs, jcsUtf8Bytes } from "./jcs";

/**
 * Golden vectors (DAN-127). The expected bytes and hashes come from the file,
 * which was derived outside this repository; nothing here is computed twice
 * by the code under test and compared with itself.
 */
const vectors = loadGoldenVectors();
const { chain } = vectors;
const utf8 = new TextEncoder();

function strictText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

describe("golden vectors: canonical JCS bytes", () => {
  it.each(vectors.jcs.accepted)("$name", async (vector) => {
    expect(canonicalizeJcs(vector.input)).toBe(vector.canonical);
    expect(toHex(jcsUtf8Bytes(vector.input))).toBe(vector.utf8Hex);
    expect((await digestCanonicalDocumentV2(vector.input)).sha256).toBe(vector.sha256);
  });

  it.each(vectors.jcs.numbers)("number with IEEE 754 bits $ieee754", (vector) => {
    const value = new DataView(fromHex(vector.ieee754).buffer).getFloat64(0);
    if (vector.rejects === undefined) {
      expect(canonicalizeJcs(value)).toBe(vector.canonical);
    } else {
      expect(() => canonicalizeJcs(value)).toThrow(new Error(`jcs: ${vector.rejects}`));
    }
  });

  it.each(vectors.jcs.rejected)("$name has no canonical form", async (vector) => {
    const expected = new Error(`jcs: ${vector.rejects}`);
    expect(() => canonicalizeJcs(vector.input)).toThrow(expected);
    expect(() => jcsUtf8Bytes(vector.input)).toThrow(expected);
    await expect(digestCanonicalDocumentV2(vector.input)).rejects.toThrow(expected);
  });
});

describe("golden vectors: document hash", () => {
  it.each(vectors.documents)("$name", async (vector) => {
    const digest = await digestCanonicalDocumentV2(vector.value);
    expect(toHex(utf8.encode(digest.canonical))).toBe(vector.utf8Hex);
    expect(digest.sha256).toBe(vector.sha256);
  });

  it("hashes every document state of the chain, and the events carry those hashes", async () => {
    for (const state of chain.documentStates) {
      expect((await digestCanonicalDocumentV2(state.value)).sha256).toBe(state.sha256);
    }
    const hashAfter = new Map(chain.documentStates.map((s) => [s.afterSequence, s.sha256]));
    const events = chain.segments.flatMap((vector) => vector.segment.events);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    for (const event of events) {
      expect(event.beforeDocumentHash).toBe(hashAfter.get(event.sequence - 1));
      expect(event.afterDocumentHash).toBe(hashAfter.get(event.sequence));
    }
    const last = chain.documentStates.at(-1);
    expect((await digestCanonicalDocumentV2(chain.expectedDocumentReordered)).sha256).toBe(
      last?.sha256,
    );
  });
});

describe("golden vectors: segment hash and chain", () => {
  it.each(chain.segments)("segment $segment.segmentId", async (vector) => {
    expect(isEvidenceSegmentV2(vector.segment)).toBe(true);
    const digest = await digestEvidenceSegmentV2(vector.segment);
    expect(toHex(utf8.encode(digest.canonical))).toBe(vector.canonicalUtf8Hex);
    expect(digest.byteLength).toBe(vector.byteLength);
    expect(digest.sha256).toBe(vector.segmentHash);

    const accepted = {
      ok: true,
      segment: vector.segment,
      sha256: vector.segmentHash,
      byteLength: vector.byteLength,
    };
    const bytes = fromHex(vector.canonicalUtf8Hex);
    expect(await verifyCanonicalEvidencePayloadV2(bytes)).toEqual(accepted);
    expect(await verifyCanonicalEvidencePayloadV2(strictText(bytes))).toEqual(accepted);
  });

  it("verifies the chain against the stored head and no other", async () => {
    const payloads = chain.segments.map((vector) => fromHex(vector.canonicalUtf8Hex));
    expect(chain.segments[1].segment.predecessorSegmentHash).toBe(chain.segments[0].segmentHash);
    expect(await verifyEvidenceChainV2(payloads, chain.head)).toEqual({
      ok: true,
      head: chain.head,
      discontinuities: [],
    });
    expect(
      await verifyEvidenceChainV2(payloads, { ...chain.head, segmentHash: chain.segments[0].segmentHash }),
    ).toMatchObject({ ok: false, reason: "head_mismatch" });
    expect(await verifyEvidenceChainV2([payloads[1], payloads[0]], chain.head)).toMatchObject({
      ok: false,
      reason: "predecessor_mismatch",
    });
  });

  it.each(vectors.segmentPayloads.rejected)("rejects payload $name", async (edit) => {
    const base = chain.segments[edit.base];
    const edited = applyPayloadEdit(fromHex(base.canonicalUtf8Hex), edit);
    expect(await verifyCanonicalEvidencePayloadV2(edited)).toEqual({ ok: false, reason: edit.reason });

    const text = strictText(edited);
    if (text !== null) {
      expect(await verifyCanonicalEvidencePayloadV2(text)).toEqual({ ok: false, reason: edit.reason });
    }
    // The file says why each payload is rejected; hold it to that, so a
    // vector cannot pass for a reason other than the one it was written for.
    expect(edit.recanonicalizesToBase || edit.canonicalJcs ? text : "").not.toBeNull();
    if (edit.recanonicalizesToBase) {
      expect(toHex(jcsUtf8Bytes(JSON.parse(text ?? "")))).toBe(base.canonicalUtf8Hex);
    }
    if (edit.canonicalJcs) {
      expect(canonicalizeJcs(JSON.parse(text ?? ""))).toBe(text);
      expect(isEvidenceSegmentV2(JSON.parse(text ?? ""))).toBe(false);
    }
  });

  it("accepts a segment of exactly the limit and rejects one byte more", async () => {
    const { sizeLimit } = vectors;
    expect(MAX_EVIDENCE_SEGMENT_BYTES).toBe(sizeLimit.maxSegmentBytes);
    const padded = (extra: string) => {
      const segment = structuredClone(sizeLimit.segmentWithoutPadding);
      segment.events[0].steps[0].text =
        sizeLimit.padding.unit.repeat(sizeLimit.padding.count) + extra;
      return utf8.encode(canonicalizeJcs(segment));
    };

    const atLimit = padded("");
    expect(atLimit.byteLength).toBe(sizeLimit.atLimit.byteLength);
    expect(await verifyCanonicalEvidencePayloadV2(atLimit)).toMatchObject({
      ok: true,
      sha256: sizeLimit.atLimit.sha256,
      byteLength: sizeLimit.maxSegmentBytes,
    });

    const overLimit = padded(sizeLimit.overLimit.extraText);
    expect(overLimit.byteLength).toBe(sizeLimit.overLimit.byteLength);
    const tooLarge = { ok: false, reason: sizeLimit.overLimit.reason };
    expect(await verifyCanonicalEvidencePayloadV2(overLimit)).toEqual(tooLarge);
    expect(await verifyCanonicalEvidencePayloadV2(strictText(overLimit))).toEqual(tooLarge);
  });
});

describe("golden vectors: time in a segment (D-24, D-56)", () => {
  const { formerSegments, identifiers } = vectors.eventTime;

  it("stores two whole minutes and no other time in each accepted segment", () => {
    for (const { segment, canonicalUtf8Hex } of chain.segments) {
      const text = strictText(fromHex(canonicalUtf8Hex)) ?? "";
      expect(text.match(/\d{2}:\d{2}:\d{2}[^"]*/g)).toEqual([
        segment.observedEndedAt.slice(11),
        segment.observedStartedAt.slice(11),
      ]);
      expect(segment.observedStartedAt).toMatch(/T\d{2}:\d{2}:00\.000Z$/);
      expect(segment.observedEndedAt).toMatch(/T\d{2}:\d{2}:00\.000Z$/);
      expect(text).not.toMatch(/occurredAt|elapsedMs/);
    }
    // One segment runs across a minute boundary; the next lies within the minute it ended in.
    const [first, second] = chain.segments.map((vector) => vector.segment);
    expect(first.observedEndedAt).not.toBe(first.observedStartedAt);
    expect([second.observedStartedAt, second.observedEndedAt]).toEqual([
      first.observedEndedAt,
      first.observedEndedAt,
    ]);
  });

  it.each(formerSegments)("refuses $name, valid before the decision", async (former) => {
    const bytes = fromHex(former.canonicalUtf8Hex);
    const text = strictText(bytes) ?? "";
    // The bytes are the ones the first revision published: same hash, canonical JCS.
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(former.formerSegmentHash);
    expect(bytes.byteLength).toBe(former.byteLength);
    expect(canonicalizeJcs(JSON.parse(text))).toBe(text);
    expect(text).toMatch(/"elapsedMs":[0-9.]+,"occurredAt":"/);

    expect(isEvidenceSegmentV2(JSON.parse(text))).toBe(false);
    expect(await verifyCanonicalEvidencePayloadV2(bytes)).toEqual({ ok: false, reason: former.reason });
    expect(await verifyCanonicalEvidencePayloadV2(text)).toEqual({ ok: false, reason: former.reason });
  });

  it("keeps both chain segments of the first revision as refused vectors", () => {
    // The segment hashes of the file as merged for DAN-127.
    expect(formerSegments.map((former) => former.formerSegmentHash)).toEqual([
      "8a95172066e145b5b890b9a73a3b4ccedbdceaf46ec8c373d2b35e94328f692e",
      "af2a408d76db01c7b95962f8f854a460b3491879f39b033ebed725587e948cb4",
    ]);
  });

  it.each(identifiers.timeOrdered)("names $name as an identifier that embeds time", ({ value }) => {
    expect(isTimeOrderedIdentifierV2(value)).toBe(true);
  });

  it.each(identifiers.notTimeOrdered)("does not name $name as one", ({ value }) => {
    expect(isTimeOrderedIdentifierV2(value)).toBe(false);
  });
});

describe("golden vectors: receipt digest and signature (receipt v1)", () => {
  const verifier = goldenKeyVerifier(chain.verificationKey);

  it.each(chain.segments)("receipt of $segment.segmentId", async ({ receipt, segmentHash }) => {
    const { canonicalUtf8Hex, ...signed } = receipt;
    expect(isSignedEvidenceReceipt(signed)).toBe(true);
    expect(receipt.payload.segmentHash).toBe(segmentHash);

    const digest = await digestEvidenceReceiptPayload(receipt.payload);
    expect(toHex(digest.bytes)).toBe(canonicalUtf8Hex);
    expect(digest.sha256).toBe(receipt.payloadDigestSha256);

    // Receipt v1 is signed over its canonical bytes, not over their digest.
    expect(await verifier.verify(digest.bytes, receipt.signature)).toBe(true);
    expect(await verifier.verify(fromHex(digest.sha256), receipt.signature)).toBe(false);
    expect(await verifier.verify(utf8.encode(digest.sha256), receipt.signature)).toBe(false);
  });

  it("does not verify a signature of one receipt over the other", async () => {
    const [first, second] = chain.segments.map((vector) => vector.receipt);
    expect(second.payload.previousReceiptId).toBe(first.payload.receiptId);
    expect(await verifier.verify(fromHex(first.canonicalUtf8Hex), second.signature)).toBe(false);
  });
});

/**
 * True when `text` holds, as hex or as base64 or base64url, 32 bytes whose
 * SHA-256 is `seedSha256`. Every window of every run is tried, so bytes
 * embedded in a longer string are found too.
 */
function holdsSeed(text: string, seedSha256: string): boolean {
  const isSeed = (bytes: Buffer) =>
    bytes.length === 32 && createHash("sha256").update(bytes).digest("hex") === seedSha256;
  const windows = (runs: RegExp, size: number) =>
    (text.match(runs) ?? []).flatMap((run) =>
      Array.from({ length: run.length - size + 1 }, (_, at) => run.slice(at, at + size)),
    );
  return (
    windows(/[0-9a-fA-F]{64,}/g, 64).some((window) => isSeed(Buffer.from(window, "hex"))) ||
    windows(/[\w+/-]{43,}/g, 43).some((window) => isSeed(Buffer.from(window, "base64")))
  );
}

describe("golden vectors: the signing key", () => {
  const { spkiDerHex, signingSeedSha256 } = chain.verificationKey;
  // The 32 bytes printed as PUBLIC KEY of TEST 1 in RFC 8032 section 7.1.
  const rfc8032Test1Public = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

  it("is the public Ed25519 key of RFC 8032 section 7.1 TEST 1", () => {
    // SPKI of Ed25519 (RFC 8410): a fixed 12-byte header, then the 32 bytes.
    expect(spkiDerHex).toBe(`302a300506032b6570032100${rfc8032Test1Public}`);
    const parsed = createPublicKey({ key: Buffer.from(fromHex(spkiDerHex)), format: "der", type: "spki" });
    expect(parsed.type).toBe("public");
    expect(parsed.export({ format: "jwk" })).toEqual({
      kty: "OKP",
      crv: "Ed25519",
      x: Buffer.from(fromHex(rfc8032Test1Public)).toString("base64url"),
    });
  });

  it("comes without its private seed in every golden-vector file", () => {
    // The search finds a seed it is given, in each encoding and inside a longer run.
    const fresh = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" });
    const seed = fresh.subarray(fresh.length - 32);
    const seedSha256 = createHash("sha256").update(seed).digest("hex");
    for (const encoded of [
      seed.toString("hex"),
      seed.toString("hex").toUpperCase(),
      seed.toString("base64"),
      seed.toString("base64url"),
    ]) {
      expect(holdsSeed(`{"field":"0a${encoded}"}`, seedSha256)).toBe(true);
      expect(holdsSeed(`{"field":"0a${encoded}"}`, signingSeedSha256)).toBe(false);
    }

    const directory = new URL("./golden-vectors/", import.meta.url);
    const files = [
      ...readdirSync(directory).map((name) => new URL(name, directory)),
      new URL("./golden-vectors.test.ts", import.meta.url),
      new URL("../../application/evidence/evidence-golden-vectors.test.ts", import.meta.url),
    ];
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      expect(holdsSeed(readFileSync(file, "latin1"), signingSeedSha256), file.pathname).toBe(false);
    }
  });
});

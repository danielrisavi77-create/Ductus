import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";

import { EDIT_STEP_FORMAT_V1 } from "@/domain/document/edit-step";

import {
  MAX_EVIDENCE_SEGMENT_BYTES,
  verifyCanonicalEvidencePayloadV2,
  verifyEvidenceChainV2,
  type EvidencePayloadVerificationV2,
} from "./evidence-chain-v2";
import {
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  EVIDENCE_SOURCES_V2,
  type EvidenceSegmentV2,
} from "./evidence-segment-v2";
import { canonicalizeJcs } from "./jcs";

/**
 * DAN-320, plan #1504 (PR A): fuzz of the B-8 payload parser (P1) and the
 * chain (P2) over the input classes K1 to K12. Only generated, invented
 * content: ids such as `doc-fuzz`, never a real text or person.
 */

const enc = (text: string) => new TextEncoder().encode(text);
const hex = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const h = (n: number) => n.toString(16).padStart(64, "0");

// K11: characters that break naive comparison; NUL is mapped away, not filtered.
const awkward = fc.constantFrom("\u{1F600}", "\u200b", "\u202e", "\ufeff", "c\u030c", "\u010d", "/", "\u2028");
const text = fc
  .array(fc.oneof(fc.string({ unit: "binary", minLength: 1, maxLength: 4 }), awkward), { minLength: 1, maxLength: 4 })
  .map((parts) => parts.join("").replaceAll("\0", "x"));

function segment(texts: string[], index = 0, predecessor: string | null = null, from = 1): EvidenceSegmentV2 {
  return {
    evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
    canonicalization: EVIDENCE_CANONICALIZATION_V2,
    hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
    documentId: "doc-fuzz",
    sessionId: "session-fuzz",
    segmentId: `segment-fuzz-${index}`,
    sequenceFrom: from,
    sequenceTo: from + texts.length - 1,
    observedStartedAt: "2026-10-02T20:00:00.000Z",
    observedEndedAt: "2026-10-02T20:01:00.000Z",
    initialDocumentHash: h(from - 1),
    finalDocumentHash: h(from - 1 + texts.length),
    predecessorSegmentHash: predecessor,
    events: texts.map((t, i) => ({
      sequence: from + i,
      source: EVIDENCE_SOURCES_V2[0],
      steps: [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: t }] } }],
      beforeDocumentHash: h(from - 1 + i),
      afterDocumentHash: h(from + i),
    })),
    captureContext: { editorModel: "prosemirror", transactionFormat: EDIT_STEP_FORMAT_V1 },
    evidenceProfileId: "standard-v1",
  };
}

const texts = fc.array(text, { minLength: 1, maxLength: 3 });
const valid = texts.map((t) => enc(canonicalizeJcs(segment(t))));

/** N-01, N-02, N-03: a closed outcome, no echo of the input, `ok` only for the exact JCS bytes. */
async function verified(input: unknown, original?: Uint8Array): Promise<EvidencePayloadVerificationV2> {
  const snapshot = input instanceof Uint8Array ? new Uint8Array(input) : enc(String(input));
  const result = await verifyCanonicalEvidencePayloadV2(input);
  if (!result.ok) {
    expect(Object.keys(result).sort()).toEqual(["ok", "reason"]);
    expect(["invalid", "too_large"]).toContain(result.reason);
    return result;
  }
  expect(enc(canonicalizeJcs(result.segment))).toEqual(snapshot);
  expect(result.byteLength).toBe(snapshot.byteLength);
  expect(result.sha256).toBe(await hex(snapshot));
  if (original !== undefined && !sameBytes(original, snapshot)) {
    expect(result.sha256).not.toBe(await hex(original));
  }
  return result;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const splice = (bytes: Uint8Array, at: number, remove: number, insert: ArrayLike<number> = []) =>
  Uint8Array.from([...bytes.slice(0, at), ...Array.from(insert), ...bytes.slice(at + remove)]);
const invalid = { ok: false, reason: "invalid" };

// K2: malformed UTF-8 that a strict decoder must refuse wherever it stands.
const badUtf8 = fc.constantFrom([0xc4], [0xe2, 0x82], [0xc0, 0xaf], [0xe0, 0x80, 0xaf], [0xed, 0xa0, 0x80], [0xc1, 0xbf], [0xf5, 0x80, 0x80, 0x80], [0xff], [0x80]);

describe("verifyCanonicalEvidencePayloadV2 under fuzz (P1)", () => {
  test.prop([valid])("a generated valid segment is accepted as bytes, Buffer, subclass and offset view alike (N-03, N-08)", async (bytes) => {
    const base = await verified(bytes);
    expect(base.ok).toBe(true);
    class Sub extends Uint8Array {}
    const wide = new Uint8Array(bytes.length + 7);
    wide.set(bytes, 3);
    for (const view of [Buffer.from(bytes), new Sub(bytes), wide.subarray(3, 3 + bytes.length)]) {
      expect(await verifyCanonicalEvidencePayloadV2(view)).toEqual(base);
    }
    // N-09: the same text as a string has the same outcome and hash.
    expect(await verifyCanonicalEvidencePayloadV2(new TextDecoder().decode(bytes))).toEqual(base);
  });

  test.prop([fc.uint8Array({ maxLength: 512 })])("arbitrary bytes are never accepted and never too large below the limit (K1, N-04, N-10)", async (bytes) => {
    expect(await verified(bytes)).toEqual(invalid);
  });

  test.prop([fc.jsonValue()])("arbitrary JSON is invalid (K4)", async (value) => {
    expect(await verified(enc(JSON.stringify(value) ?? ""))).toEqual(invalid);
  });

  test.prop([texts, fc.constantFrom("documentId", "sequenceFrom", "events", "captureContext", "observedStartedAt", "predecessorSegmentHash"), fc.jsonValue(), fc.boolean()])(
    "a field of the wrong type, re-canonicalized, is invalid (K4)",
    async (t, field, value, asArray) => {
      const s: Record<string, unknown> = { ...segment(t) };
      s[field] = asArray ? [value] : { wrong: value };
      expect(await verified(enc(canonicalizeJcs(s)))).toEqual(invalid);
    },
  );

  test.prop([texts, fc.constantFrom("space", "order", "1.0", "1e0", "escape", "duplicate", "solidus")])(
    "the same value in non-canonical bytes is invalid; a duplicate key does not silently win (K5, N-05)",
    async (t, kind) => {
      const s = segment([...t, "a/b"]);
      const jcs = canonicalizeJcs(s);
      const variant = {
        space: () => jcs.replace(":", ": "),
        order: () => JSON.stringify(Object.fromEntries(Object.entries(s).reverse())),
        "1.0": () => jcs.replace('"sequenceFrom":1,', '"sequenceFrom":1.0,'),
        "1e0": () => jcs.replace('"sequenceFrom":1,', '"sequenceFrom":1e0,'),
        escape: () => jcs.replace('"canonicalization"', '"c\\u0061nonicalization"'),
        duplicate: () => `{"documentId":"doc-a",${jcs.slice(1)}`,
        solidus: () => jcs.replace("a/b", "a\\/b"),
      }[kind]();
      expect(variant).not.toBe(jcs);
      expect(await verified(enc(variant))).toEqual(invalid);
    },
  );

  test.prop([valid, fc.nat(), fc.nat(), fc.integer({ min: 0, max: 255 }), fc.constantFrom("replace", "delete", "insert", "truncate", "space", "swap")])(
    "a mutant of valid bytes is invalid or accepted under another hash, never the original one (K6, N-06)",
    async (bytes, a, b, byte, kind) => {
      const i = a % bytes.length;
      const j = b % bytes.length;
      const [lo, hi] = i < j ? [i, j] : [j, i];
      const mutant = {
        replace: () => splice(bytes, i, 1, [byte === bytes[i] ? byte ^ 1 : byte]),
        delete: () => splice(bytes, i, 1),
        insert: () => splice(bytes, i, 0, [byte]),
        truncate: () => bytes.slice(0, i),
        space: () => splice(bytes, i, 0, [0x20]),
        swap: () => Uint8Array.from([...bytes.slice(hi), ...bytes.slice(lo, hi), ...bytes.slice(0, lo)]),
      }[kind]();
      await verified(mutant, bytes);
    },
  );

  test.prop([valid, fc.nat(), badUtf8])("malformed UTF-8 anywhere is invalid, never read as U+FFFD (K2, N-07)", async (bytes, at, bad) => {
    expect(await verified(splice(bytes, at % (bytes.length + 1), 0, bad))).toEqual(invalid);
  });

  test.prop([valid, fc.nat()])("a byte order mark is never dropped: at the start it is invalid, elsewhere a changed text at most (K3, N-07)", async (bytes, at) => {
    expect(await verified(splice(bytes, 0, 0, [0xef, 0xbb, 0xbf]))).toEqual(invalid);
    await verified(splice(bytes, at % (bytes.length + 1), 0, [0xef, 0xbb, 0xbf]), bytes);
  });

  it("refuses a cut sequence in invented text and a lone surrogate, as bytes and as a string (K2, K11, N-07, N-09)", async () => {
    const jcs = canonicalizeJcs(segment(["Proba č"]));
    const cut = enc(jcs);
    const at = cut.indexOf(0xc4);
    expect(await verified(splice(cut, at, 2, [0xc4]))).toEqual(invalid);
    expect(await verified(enc(jcs.replace("Proba", "Proba\\ud800")))).toEqual(invalid);
    expect(await verified(jcs.replace("Proba", "Proba\uD800"))).toEqual(invalid);
  });

  test.prop([fc.constantFrom<unknown>(null, 3, {}, { length: 3 }, new ArrayBuffer(3), new DataView(new ArrayBuffer(3)), [123, 125], undefined)])(
    "a value that is not bytes or a string is invalid, without throwing (K8, N-08)",
    async (value) => {
      expect(await verifyCanonicalEvidencePayloadV2(value)).toEqual(invalid);
    },
  );

  test.prop([texts, fc.nat(), fc.constantFrom("root", "event", "captureContext", "step", "slice"), fc.oneof(fc.string().map((k) => `x-${k}`), fc.constantFrom("constructor", "suggestionId", "variantId", "elapsedMs"))])(
    "an unknown or reserved field at any level, re-canonicalized, is invalid (K7, N-12, N-13)",
    async (t, pick, level, key) => {
      const s = segment(t) as unknown as { events: { steps: { slice: object }[] }[]; captureContext: object };
      const event = s.events[pick % s.events.length];
      const target = { root: s, event, captureContext: s.captureContext, step: event.steps[0], slice: event.steps[0].slice }[level];
      Object.assign(target, { [key]: 1 });
      expect(await verified(enc(canonicalizeJcs(s)))).toEqual(invalid);
    },
  );

  it("refuses __proto__ as an own key, a reserved source and a time finer than a minute (K7, N-12, N-13)", async () => {
    const jcs = canonicalizeJcs(segment(["izmisljeno"]));
    expect(await verified(enc(`{"__proto__":{},${jcs.slice(1)}`))).toEqual(invalid);
    expect(await verified(enc(jcs.replace('"source":"', '"source":"applied-suggestion","x":"')))).toEqual(invalid);
    const reserved = segment(["izmisljeno"]);
    (reserved.events[0] as { source: string }).source = "applied-suggestion";
    expect(await verified(enc(canonicalizeJcs(reserved)))).toEqual(invalid);
    expect(await verified(enc(jcs.replace("20:00:00.000Z", "20:00:07.000Z")))).toEqual(invalid);
  });

  it("holds the D-96 limit in bytes, not in UTF-16 units (K9, N-10)", async () => {
    expect(await verified(new Uint8Array(MAX_EVIDENCE_SEGMENT_BYTES).fill(0x61))).toEqual(invalid);
    expect(await verified(new Uint8Array(MAX_EVIDENCE_SEGMENT_BYTES + 1))).toEqual({ ok: false, reason: "too_large" });
    expect(await verifyCanonicalEvidencePayloadV2("č".repeat(1_100_000))).toEqual({ ok: false, reason: "too_large" });
  });

  it("answers 10 000 levels of nesting in steps as invalid, without a stack overflow (K10, N-11)", async () => {
    const jcs = canonicalizeJcs(segment(["izmisljeno"]));
    const deep = jcs.replace('"steps":[', `"steps":[${"[".repeat(10_000)}${"]".repeat(10_000)},`);
    expect(deep.length).toBeLessThan(MAX_EVIDENCE_SEGMENT_BYTES);
    expect(await verified(enc(deep))).toEqual(invalid);
  });

  test.prop([valid, fc.uint8Array({ minLength: 1, maxLength: 64 })])(
    "bytes overwritten after the call do not change the outcome or the hash (N-34)",
    async (bytes, noise) => {
      const expected = await verifyCanonicalEvidencePayloadV2(new Uint8Array(bytes));
      const buffer = new Uint8Array(bytes);
      const pending = verifyCanonicalEvidencePayloadV2(buffer);
      buffer.set(noise.subarray(0, buffer.length));
      expect(await pending).toEqual(expected);
      // Negative: invalid bytes repaired after the call stay invalid.
      const broken = splice(bytes, 0, 1);
      const late = verifyCanonicalEvidencePayloadV2(broken);
      broken.set(bytes.subarray(0, broken.length));
      expect(await late).toEqual(invalid);
    },
  );

  test.prop([fc.array(fc.oneof(valid, valid.map((b) => splice(b, 0, 1)), fc.uint8Array({ maxLength: 64 })), { minLength: 2, maxLength: 8 })])(
    "concurrent calls share no state: Promise.all equals the serial run (N-35)",
    async (inputs) => {
      const serial = [];
      for (const input of inputs) serial.push(await verifyCanonicalEvidencePayloadV2(input));
      expect(await Promise.all(inputs.map((input) => verifyCanonicalEvidencePayloadV2(input)))).toEqual(serial);
    },
  );
});

async function chain(spec: string[][]): Promise<{ payloads: Uint8Array[]; head: { segmentHash: string; segmentCount: number } }> {
  const payloads: Uint8Array[] = [];
  let predecessor: string | null = null;
  let from = 1;
  for (const [index, t] of spec.entries()) {
    const bytes = enc(canonicalizeJcs(segment(t, index, predecessor, from)));
    payloads.push(bytes);
    predecessor = await hex(bytes);
    from += t.length;
  }
  return { payloads, head: { segmentHash: predecessor!, segmentCount: payloads.length } };
}

const spec = (min: number) => fc.array(fc.array(fc.string({ minLength: 1, maxLength: 6 }).map((s) => s.replaceAll("\0", "x")), { minLength: 1, maxLength: 2 }), { minLength: min, maxLength: 4 });
const failures = ["too_large", "invalid_segment", "predecessor_mismatch", "document_mismatch", "head_mismatch"];

describe("verifyEvidenceChainV2 under fuzz (P2)", () => {
  test.prop([spec(1), fc.array(fc.oneof(fc.nat(), fc.uint8Array({ maxLength: 32 }), fc.constantFrom<unknown>(null, "x", 3, new ArrayBuffer(2))), { maxLength: 4 }), fc.boolean()])(
    "a mix of valid payloads, mutants, bytes and non-bytes never throws and ends in a closed outcome (N-14)",
    async (s, picks, withHead) => {
      const { payloads, head } = await chain(s);
      const mixed = picks.map((pick) => (typeof pick === "number" ? splice(payloads[pick % payloads.length], pick % 7, pick % 2) : pick));
      const result = await verifyEvidenceChainV2(mixed, withHead ? head : null);
      if (result.ok) expect(result.discontinuities).toBeInstanceOf(Array);
      else expect(failures).toContain(result.reason);
    },
  );

  test.prop([spec(2), fc.nat(), fc.constantFrom("swap", "omit", "duplicate")])(
    "reordering, removing or duplicating a segment never verifies to the original head (N-15)",
    async (s, pick, kind) => {
      const { payloads, head } = await chain(s);
      const i = pick % (payloads.length - 1);
      const changed = [...payloads];
      if (kind === "swap") [changed[i], changed[i + 1]] = [changed[i + 1], changed[i]];
      else if (kind === "omit") changed.splice(i, 1);
      else changed.splice(i, 0, payloads[i]);
      expect(await verifyEvidenceChainV2(payloads, head)).toMatchObject({ ok: true });
      expect(await verifyEvidenceChainV2(changed, head)).toMatchObject({ ok: false });
    },
  );
});

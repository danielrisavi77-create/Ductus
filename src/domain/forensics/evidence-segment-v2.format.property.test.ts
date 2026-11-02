import { createHash } from "node:crypto";

import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";

import { EDIT_STEP_FORMAT_V1 } from "@/domain/document/edit-step";

import { MAX_EVIDENCE_SEGMENT_BYTES, verifyCanonicalEvidencePayloadV2 } from "./evidence-chain-v2";
import {
  digestEvidenceSegment,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  EVIDENCE_SEGMENT_SCHEMA_V3,
  EVIDENCE_SOURCES_V3,
  evidenceSchemaForEvents,
  isEvidenceSegment,
  isEvidenceSegmentV2,
  RESERVED_EVIDENCE_EVENT_FIELDS,
  RESERVED_EVIDENCE_SOURCES,
} from "./evidence-segment-v2";
import { canonicalizeJcs, type JcsJsonValue } from "./jcs";

/**
 * The segment format v2/v3 over edit steps v1, on document schema v1 (DAN-83,
 * M3.1-P02; contract on #1091). A generated valid segment goes through the
 * bytes and back unchanged; each row of the tables below changes one field
 * of such a segment and must be refused. Fields that a hash chain or the
 * sequence numbers tie together are changed together, so a row is refused for
 * its own reason and not because it broke a neighbour. All data is generated.
 */

type Loose = Record<string, JcsJsonValue>;
type Mutate = (segment: Loose) => void;

const hash = fc.stringMatching(/^[0-9a-f]{64}$/);
const id = fc.stringMatching(/^[a-z][a-z0-9-]{0,40}$/);
const FIRST_MINUTE = Date.parse("2026-01-01T00:00:00.000Z") / 60_000;
const minute = fc.integer({ min: FIRST_MINUTE, max: FIRST_MINUTE + 525_000 });

/** A valid segment of one to four events; v3 only when an event is `citation-form`. */
const segment = fc
  .record({
    documentId: id,
    sessionId: id,
    segmentId: id,
    profile: id,
    from: fc.integer({ min: 1, max: 1_000_000 }),
    start: minute,
    span: fc.integer({ min: 0, max: 600 }),
    hashes: fc.uniqueArray(hash, { minLength: 2, maxLength: 5 }),
    predecessor: fc.option(hash, { nil: null }),
    sources: fc.array(fc.constantFrom(...EVIDENCE_SOURCES_V3), { minLength: 4, maxLength: 4 }),
    texts: fc.array(fc.stringMatching(/^[a-zčćđšž ]{1,12}$/), { minLength: 4, maxLength: 4 }),
    touched: fc.uniqueArray(fc.stringMatching(/^p[a-z0-9]{1,6}$/), { maxLength: 3 }),
    withTouched: fc.boolean(),
  })
  .map((g): Loose => {
    const count = g.hashes.length - 1;
    const events = Array.from({ length: count }, (_, index): Loose => {
      const event: Loose = {
        sequence: g.from + index,
        source: g.sources[index],
        steps: [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: g.texts[index] }] } }],
        beforeDocumentHash: g.hashes[index],
        afterDocumentHash: g.hashes[index + 1],
      };
      if (g.withTouched) event.touchedNodeIds = [...g.touched].sort();
      return event;
    });
    return {
      evidenceSchema: evidenceSchemaForEvents(events as { source: (typeof EVIDENCE_SOURCES_V3)[number] }[]),
      canonicalization: "RFC8785-JCS",
      hashAlgorithm: "sha256",
      documentId: g.documentId,
      sessionId: g.sessionId,
      segmentId: g.segmentId,
      sequenceFrom: g.from,
      sequenceTo: g.from + count - 1,
      observedStartedAt: new Date(g.start * 60_000).toISOString(),
      observedEndedAt: new Date((g.start + g.span) * 60_000).toISOString(),
      initialDocumentHash: g.hashes[0],
      finalDocumentHash: g.hashes[count],
      predecessorSegmentHash: g.predecessor,
      events,
      captureContext: { editorModel: "prosemirror", transactionFormat: EDIT_STEP_FORMAT_V1 },
      evidenceProfileId: g.profile,
    };
  });

const eventsOf = (s: Loose) => s.events as Loose[];
const contextOf = (s: Loose) => s.captureContext as Loose;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const utf8 = new TextEncoder();

/** Sets a field and every field that must equal it, so only its form is judged. */
function setLinked(s: Loose, path: string, value: JcsJsonValue): void {
  const [level, key] = path.split(".");
  const events = eventsOf(s);
  const last = events.length - 1;
  if (level === "segment") {
    s[key] = value;
    if (key === "initialDocumentHash") events[0].beforeDocumentHash = value;
    if (key === "finalDocumentHash") events[last].afterDocumentHash = value;
    if (key === "sequenceFrom") {
      // The whole numbering moves with it: only the first number is wrong.
      events.forEach((event, index) => (event.sequence = typeof value === "number" ? value + index : value));
      s.sequenceTo = typeof value === "number" ? value + last : value;
    }
  } else if (level === "event") {
    events[0][key] = value;
    if (key === "beforeDocumentHash") s.initialDocumentHash = value;
    if (key === "afterDocumentHash") {
      if (last === 0) s.finalDocumentHash = value;
      else events[1].beforeDocumentHash = value;
    }
  } else {
    contextOf(s)[key] = value;
  }
}

const BAD_ID = ["", "   ", "x".repeat(257), "a\uD800b", null, 7, ["a"], {}];
const BAD_HASH = ["A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64), ` ${"a".repeat(63)}`, 0, ["a"]];
const BAD_MINUTE = ["2026-10-27T09:02:30.000Z", "2026-10-27T09:02:00Z", "2026-10-27T09:02:00.000+00:00", "", null, 0];
const BAD_INTEGER = [0, -1, 1.5, 2 ** 53, "1", null];

/**
 * Classes 3 to 6, 9 to 12 of the contract: refused values of each field, by
 * its path. Every field of a generated segment has a row (checked below).
 */
const FIELD_REJECTS: Record<string, JcsJsonValue[]> = {
  "segment.evidenceSchema": [
    null,
    2,
    [EVIDENCE_SEGMENT_SCHEMA_V2],
    "ductus-evidence-segment-v1",
    "ductus-evidence-segment-v4",
    "DUCTUS-EVIDENCE-SEGMENT-V2",
    "ductus-evidence-variant-v1",
    ` ${EVIDENCE_SEGMENT_SCHEMA_V2}`,
  ],
  "segment.canonicalization": [null, "RFC8785", "rfc8785-jcs", "JCS", 8785],
  "segment.hashAlgorithm": [null, "SHA256", "sha-256", "sha512", 256],
  "segment.documentId": BAD_ID,
  "segment.sessionId": BAD_ID,
  "segment.segmentId": BAD_ID,
  "segment.evidenceProfileId": ["", " ", "x".repeat(121), "a\uDC00", null, 1],
  "segment.sequenceFrom": BAD_INTEGER,
  "segment.sequenceTo": [null, "1", 1.5, 2 ** 53],
  "segment.observedStartedAt": BAD_MINUTE,
  "segment.observedEndedAt": BAD_MINUTE,
  "segment.initialDocumentHash": [...BAD_HASH, null],
  "segment.finalDocumentHash": [...BAD_HASH, null],
  "segment.predecessorSegmentHash": [...BAD_HASH, ""],
  "segment.events": [null, {}, [], "events"],
  "segment.captureContext": [null, [], "prosemirror", {}],
  "event.sequence": [null, "1", 1.5],
  "event.source": [null, 1, "Editor", "keyboard", "", ...RESERVED_EVIDENCE_SOURCES],
  "event.steps": [
    null,
    [],
    {},
    [{ stepType: "teleport", from: 1, to: 1 }],
    [{ stepType: "replace", from: 2, to: 1, slice: { content: [{ type: "text", text: "a" }] } }],
    [{ stepType: "replace", from: 1, to: 1 }],
    [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: "" }] } }],
    [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: "a" }] }, at: 1 }],
  ],
  "event.touchedNodeIds": [null, "p1", [""], ["pb", "pa"], ["pa", "pa"], [1], ["x".repeat(257)]],
  "event.beforeDocumentHash": [...BAD_HASH, null],
  "event.afterDocumentHash": [...BAD_HASH, null],
  "captureContext.editorModel": [null, 1, "tiptap", "ProseMirror", ""],
  "captureContext.transactionFormat": [null, 1, "ductus-edit-steps-v2", EDIT_STEP_FORMAT_V1.toUpperCase()],
};

/** Classes 1, 2, 7, 8, 10 and 13: rows that are not one value of one field. */
const SHAPE_REJECTS: [string, Mutate][] = [
  ...["note", "evidenceSchemaVersion", ...RESERVED_EVIDENCE_EVENT_FIELDS].flatMap((key): [string, Mutate][] => [
    [`unknown segment.${key}`, (s) => (s[key] = "x")],
    [`unknown event.${key}`, (s) => (eventsOf(s)[0][key] = "x")],
    [`unknown captureContext.${key}`, (s) => (contextOf(s)[key] = "x")],
  ]),
  ["sequenceTo one more than the events", (s) => (s.sequenceTo = Number(s.sequenceTo) + 1)],
  ["sequenceTo one less than the events", (s) => (s.sequenceTo = Number(s.sequenceTo) - 1)],
  [
    "a gap before the last event",
    (s) => {
      const last = eventsOf(s)[eventsOf(s).length - 1];
      last.sequence = Number(last.sequence) + 1;
    },
  ],
  ["an event dropped", (s) => (s.events = eventsOf(s).slice(1))],
  ["the chain broken at the start", (s) => (s.initialDocumentHash = "0".repeat(64))],
  ["the chain broken at the end", (s) => (s.finalDocumentHash = "0".repeat(64))],
  [
    "the chain broken between the last two events",
    (s) => {
      const events = eventsOf(s);
      if (events.length === 1) s.finalDocumentHash = "0".repeat(64);
      else events[events.length - 1].beforeDocumentHash = "0".repeat(64);
    },
  ],
  ["the minutes in reverse", (s) => ([s.observedStartedAt, s.observedEndedAt] = [s.observedEndedAt, "2025-12-31T23:59:00.000Z"])],
  [
    "citation-form under schema v2",
    (s) => {
      eventsOf(s)[0].source = "citation-form";
      s.evidenceSchema = EVIDENCE_SEGMENT_SCHEMA_V2;
    },
  ],
];

/** Every path a generated segment has, with `touchedNodeIds` present. */
function pathsOf(s: Loose): string[] {
  return [
    ...Object.keys(s).map((key) => `segment.${key}`),
    ...Object.keys(eventsOf(s)[0]).map((key) => `event.${key}`),
    ...Object.keys(contextOf(s)).map((key) => `captureContext.${key}`),
  ].sort();
}

async function isRefused(candidate: Loose): Promise<boolean> {
  let canonical: string;
  try {
    canonical = canonicalizeJcs(candidate);
  } catch {
    // No canonical bytes exist, so nothing of it can be sent; the object is still judged.
    return !isEvidenceSegment(candidate);
  }
  const verified = await verifyCanonicalEvidencePayloadV2(utf8.encode(canonical));
  return !verified.ok && !isEvidenceSegment(candidate);
}

const RUNS = { numRuns: 25 };

describe("evidence segment format v2/v3 on schema v1: round trip", () => {
  test.prop([segment], { numRuns: 300 })(
    "a generated segment is accepted, and its bytes, digest and version survive the round trip",
    async (generated) => {
      const canonical = canonicalizeJcs(generated);
      const bytes = utf8.encode(canonical);
      const verified = await verifyCanonicalEvidencePayloadV2(bytes);
      expect(verified.ok).toBe(true);
      if (!verified.ok) return;

      // Hashed independently, over the very bytes that were sent.
      expect(verified.sha256).toBe(sha256(bytes));
      expect(verified.byteLength).toBe(bytes.byteLength);
      expect(canonicalizeJcs(verified.segment)).toBe(canonical);
      expect(canonicalizeJcs(JSON.parse(canonical) as JcsJsonValue)).toBe(canonical);

      const digest = await digestEvidenceSegment(verified.segment);
      expect(digest).toEqual({ canonical, byteLength: bytes.byteLength, sha256: sha256(bytes) });

      const v3 = eventsOf(generated).some((event) => event.source === "citation-form");
      expect(verified.segment.evidenceSchema).toBe(v3 ? EVIDENCE_SEGMENT_SCHEMA_V3 : EVIDENCE_SEGMENT_SCHEMA_V2);
      expect(isEvidenceSegmentV2(generated)).toBe(!v3);
    },
  );

  test.prop([segment], { numRuns: 100 })("the same segment in bytes that are not canonical is refused", async (generated) => {
    const canonical = canonicalizeJcs(generated);
    const variants = [
      JSON.stringify(generated, null, 1),
      `${canonical}\n`,
      ` ${canonical}`,
      `﻿${canonical}`,
      canonical.replace('"canonicalization"', '"\\u0063anonicalization"'),
      canonical.replace(/"sequenceFrom":(\d+)/, '"sequenceFrom":$1.0'),
    ];
    for (const variant of variants) {
      expect(variant).not.toBe(canonical);
      expect((await verifyCanonicalEvidencePayloadV2(utf8.encode(variant))).ok).toBe(false);
    }
  });

  test.prop([segment], { numRuns: 50 })("a segment without touchedNodeIds and one at the largest first number are accepted", async (generated) => {
    for (const event of eventsOf(generated)) delete event.touchedNodeIds;
    expect(isEvidenceSegment(generated)).toBe(true);
    const first = eventsOf(generated)[0];
    const single: Loose = { ...generated, events: [first], finalDocumentHash: first.afterDocumentHash };
    setLinked(single, "segment.sequenceFrom", Number.MAX_SAFE_INTEGER);
    expect(isEvidenceSegment(single)).toBe(true);
    // One more event, chained correctly, and the last number is past the safe integers.
    const next: Loose = { ...first, sequence: 2 ** 53, beforeDocumentHash: first.afterDocumentHash };
    const pair: Loose = { ...single, events: [first, next], sequenceTo: 2 ** 53 };
    expect(isEvidenceSegment(pair)).toBe(false);
  });

  it("refuses a body over the size limit before it is parsed", async () => {
    const [generated] = fc.sample(segment, { numRuns: 1, seed: 83 });
    const canonical = canonicalizeJcs(generated);
    const oversized = canonical + " ".repeat(MAX_EVIDENCE_SEGMENT_BYTES - canonical.length + 1);
    expect(await verifyCanonicalEvidencePayloadV2(utf8.encode(oversized))).toEqual({ ok: false, reason: "too_large" });
    expect(await verifyCanonicalEvidencePayloadV2(oversized)).toEqual({ ok: false, reason: "too_large" });
  });

  it("refuses an own __proto__ key that only the bytes can carry", async () => {
    const [generated] = fc.sample(segment, { numRuns: 1, seed: 84 });
    const canonical = canonicalizeJcs(generated);
    const injected = `{"__proto__":{},${canonical.slice(1)}`;
    expect(Object.keys(JSON.parse(injected) as object)).toContain("__proto__");
    expect((await verifyCanonicalEvidencePayloadV2(utf8.encode(injected))).ok).toBe(false);
  });
});

describe("evidence segment format v2/v3 on schema v1: refusals by class", () => {
  it("has a row of refused values for every field of a generated segment", () => {
    const [generated] = fc.sample(segment.filter((s) => "touchedNodeIds" in eventsOf(s)[0]), { numRuns: 1, seed: 85 });
    expect(Object.keys(FIELD_REJECTS).sort()).toEqual(pathsOf(generated));
    for (const values of Object.values(FIELD_REJECTS)) expect(values.length).toBeGreaterThan(0);
  });

  it.each(Object.keys(FIELD_REJECTS))("refuses a missing %s, except touchedNodeIds", async (path) => {
    await fc.assert(
      fc.asyncProperty(segment, async (generated) => {
        const [level, key] = path.split(".");
        const target = level === "segment" ? generated : level === "event" ? eventsOf(generated)[0] : contextOf(generated);
        delete target[key];
        expect(await isRefused(generated)).toBe(key !== "touchedNodeIds");
      }),
      RUNS,
    );
  });

  it.each(Object.entries(FIELD_REJECTS).flatMap(([path, values]) => values.map((value) => [path, value] as const)))(
    "refuses %s = %j",
    async (path, value) => {
      await fc.assert(
        fc.asyncProperty(segment, async (generated) => {
          expect(await isRefused(generated)).toBe(false);
          setLinked(generated, path, structuredClone(value));
          expect(await isRefused(generated)).toBe(true);
        }),
        RUNS,
      );
    },
  );

  it.each(SHAPE_REJECTS)("refuses %s", async (_name, mutate) => {
    await fc.assert(
      fc.asyncProperty(segment, async (generated) => {
        expect(await isRefused(generated)).toBe(false);
        mutate(generated);
        expect(await isRefused(generated)).toBe(true);
      }),
      RUNS,
    );
  });

  test.prop([segment], { numRuns: 50 })("accepts citation-form under schema v3, the control of the v2 row", async (generated) => {
    eventsOf(generated)[0].source = "citation-form";
    generated.evidenceSchema = EVIDENCE_SEGMENT_SCHEMA_V3;
    expect(await isRefused(generated)).toBe(false);
  });
});

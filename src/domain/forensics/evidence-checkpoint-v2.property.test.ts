import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";

import { EDIT_STEP_FORMAT_V1 } from "@/domain/document/edit-step";

import { MAX_EVIDENCE_SEGMENT_BYTES } from "./evidence-chain-v2";
import {
  evidenceCheckpointHashesV2,
  evidenceResumeHashesV2,
  findEvidenceBreaksV2,
  replayEvidenceAcrossGapsV2,
  replayEvidenceFromCheckpointV2,
  verifyEvidenceCheckpointV2,
} from "./evidence-checkpoint-v2";
import type { EvidenceStepReplayerV2 } from "./evidence-replay-v2";
import {
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  type EvidenceEventV3,
  type EvidenceSegmentV2,
} from "./evidence-segment-v2";
import { canonicalizeJcs, type JcsJsonValue } from "./jcs";

/**
 * Property tests for checkpoints of a reconstruction (DAN-293, plan #1488):
 * the replay continues past a break only from a checkpoint that is the exact
 * canonical form of the document the next segment starts from, and only past
 * a gap. Every input class of the contract must end in a rejection at the
 * break it was put under. All texts are generated; none is a student text.
 */

type Doc = { text: string };

/** A minimal model: one text that every event appends to. */
const replayer: EvidenceStepReplayerV2<Doc> = {
  transactionFormat: EDIT_STEP_FORMAT_V1,
  load(canonical: JcsJsonValue): Doc {
    if (
      typeof canonical !== "object" ||
      canonical === null ||
      Array.isArray(canonical) ||
      Object.keys(canonical).join() !== "text" ||
      typeof canonical.text !== "string"
    ) {
      throw new Error("fixture: not a document");
    }
    return { text: canonical.text };
  },
  apply(document: Doc, event: EvidenceEventV3): Doc {
    let text = document.text;
    for (const step of event.steps) {
      const slice = (step as { slice?: { content?: { text?: unknown }[] } }).slice;
      const inserted = slice?.content?.[0]?.text;
      if (typeof inserted !== "string") throw new Error("fixture: unknown step");
      text += inserted;
    }
    return { text };
  },
  toCanonical: (document: Doc) => ({ text: document.text }),
};

const encode = (text: string) => new TextEncoder().encode(text);

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const canonicalBytes = (text: string) => encode(canonicalizeJcs({ text }));

/** The same document with its first character written as a JSON escape. */
function escapedFirst(text: string): string {
  const first = text.codePointAt(0);
  if (first === undefined || first > 0xffff) return `{"text":${JSON.stringify(text)} }`;
  const escape = `\\u${first.toString(16).padStart(4, "0")}`;
  return `{"text":"${escape}${JSON.stringify(text.slice(1)).slice(1)}}`;
}

type Boundary = "none" | "gap" | "gap_back" | "regression" | "hash_only";
type SegmentSpec = { before: Boundary; skipped: string[]; texts: string[] };

const text = fc.string({ unit: "grapheme", minLength: 1, maxLength: 4 });
const honestSegment = fc.record({
  before: fc.constantFrom<Boundary>("none", "gap"),
  skipped: fc.array(text, { minLength: 1, maxLength: 3 }),
  texts: fc.array(text, { minLength: 1, maxLength: 3 }),
});
const honestChain = fc.array(honestSegment, { minLength: 1, maxLength: 6 });
/** A chain with at least one gap after its first segment. */
const gappedChain = honestChain.filter((spec) => spec.some((segment) => segment.before === "gap"));

type BuiltChain = {
  segments: EvidenceSegmentV2[];
  /** Honest checkpoint for every gap, keyed by the hash it must have. */
  checkpoints: Map<string, Uint8Array>;
  /** Every document the record passes through, keyed by its hash. */
  everyDocument: Map<string, Uint8Array>;
  breaks: number[];
  finalText: string;
};

async function buildChain(spec: SegmentSpec[]): Promise<BuiltChain> {
  const segments: EvidenceSegmentV2[] = [];
  const checkpoints = new Map<string, Uint8Array>();
  const everyDocument = new Map<string, Uint8Array>();
  const breaks: number[] = [];
  let document = "";
  let sequence = 1;
  let lastSequenceTo = 0;
  const starts: string[] = [];
  everyDocument.set(await sha256(canonicalBytes(document)), canonicalBytes(document));

  for (const [index, segment] of spec.entries()) {
    if (segment.before === "gap" || segment.before === "gap_back") {
      // Events that never reached the server: the document moves on and their
      // numbers are skipped. `gap_back`: they undid the previous segment, so
      // this segment starts at the document that one started at.
      document = segment.before === "gap_back" && index > 0 ? starts[index - 1] : document + segment.skipped.join("");
      sequence += segment.skipped.length;
      checkpoints.set(await sha256(canonicalBytes(document)), canonicalBytes(document));
      breaks.push(index);
    } else if (segment.before === "regression") {
      sequence = Math.max(1, lastSequenceTo);
      breaks.push(index);
    } else if (segment.before === "hash_only") {
      document += segment.skipped.join("");
      breaks.push(index);
    }
    starts.push(document);
    const initialDocumentHash = await sha256(canonicalBytes(document));
    everyDocument.set(initialDocumentHash, canonicalBytes(document));
    const events: EvidenceEventV3[] = [];
    for (const [offset, inserted] of segment.texts.entries()) {
      const beforeDocumentHash = await sha256(canonicalBytes(document));
      document += inserted;
      const afterDocumentHash = await sha256(canonicalBytes(document));
      everyDocument.set(afterDocumentHash, canonicalBytes(document));
      events.push({
        sequence: sequence + offset,
        source: "editor",
        steps: [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: inserted }] } }],
        beforeDocumentHash,
        afterDocumentHash,
      } as EvidenceEventV3);
    }
    segments.push({
      evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
      canonicalization: EVIDENCE_CANONICALIZATION_V2,
      hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
      documentId: "dokument-izmisljeni",
      sessionId: "sesija-izmisljena",
      segmentId: `segment-${index + 1}`,
      sequenceFrom: sequence,
      sequenceTo: sequence + events.length - 1,
      observedStartedAt: "2026-11-09T08:00:00.000Z",
      observedEndedAt: "2026-11-09T08:01:00.000Z",
      initialDocumentHash,
      finalDocumentHash: events.at(-1)!.afterDocumentHash,
      predecessorSegmentHash: null,
      events: events as EvidenceSegmentV2["events"],
      captureContext: { editorModel: "prosemirror", transactionFormat: EDIT_STEP_FORMAT_V1 },
      evidenceProfileId: "standard-v1",
    });
    lastSequenceTo = sequence + events.length - 1;
    sequence = lastSequenceTo + 1;
  }
  return { segments, checkpoints, everyDocument, breaks, finalText: document };
}

const INITIAL: JcsJsonValue = { text: "" };

/** The forged or broken bytes of one class, built from the honest checkpoint. */
type Mutation = (honest: Uint8Array, text: string, other: Uint8Array) => Uint8Array;
const MUTATIONS: Record<string, fc.Arbitrary<Mutation>> = {
  // lažna
  other_valid_document: fc.constant((_h, text) => canonicalBytes(`${text}#`)),
  non_canonical_spacing: fc.constant((_h, text) => encode(JSON.stringify({ text }, null, 1))),
  non_canonical_escape: fc.constant((_h, text) => encode(escapedFirst(text))),
  trailing_newline: fc.constant((honest) => new Uint8Array([...honest, 0x0a])),
  extra_field: fc.constant((_h, text) => encode(canonicalizeJcs({ extra: 1, text }))),
  random_bytes: fc.uint8Array({ minLength: 1, maxLength: 64 }).map((bytes) => () => bytes),
  // prekinuta
  truncated: fc.nat().map((cut) => (honest: Uint8Array) => honest.slice(0, cut % honest.byteLength)),
  invalid_utf8: fc.nat().map((at) => (honest: Uint8Array) => {
    const position = at % (honest.byteLength + 1);
    return new Uint8Array([...honest.slice(0, position), 0xff, ...honest.slice(position)]);
  }),
  byte_order_mark: fc.constant((honest) => new Uint8Array([0xef, 0xbb, 0xbf, ...honest])),
  empty: fc.constant(() => new Uint8Array(0)),
  // preuređena
  other_break_bytes: fc.constant((_h, _t, other) => other),
};

describe("evidence checkpoints v2", () => {
  test.prop([honestChain])(
    "an honest record with its checkpoints replays to its final document, breaks exactly at the gaps",
    async (spec) => {
      const built = await buildChain(spec);
      const result = await replayEvidenceAcrossGapsV2(INITIAL, built.segments, replayer, built.checkpoints);
      expect(result).toMatchObject({
        ok: true,
        canonicalDocument: canonicalizeJcs({ text: built.finalText }),
        documentSha256: await sha256(canonicalBytes(built.finalText)),
      });
      if (!result.ok) return;
      expect(result.breaks.map((item) => item.index)).toEqual(built.breaks);
      expect(result.breaks.every((item) => item.sequence === "gap")).toBe(true);

      const found = await findEvidenceBreaksV2(INITIAL, built.segments, replayer);
      expect(found).toEqual({ ok: true, breaks: result.breaks });
      expect(evidenceCheckpointHashesV2(built.segments, result.breaks)).toEqual([...built.checkpoints.keys()].sort());
    },
  );

  test.prop([honestChain, fc.array(fc.tuple(fc.stringMatching(/^[0-9a-f]{64}$/), fc.uint8Array()))])(
    "checkpoints that are not at a break are never read, so extra or false ones change nothing",
    async (spec, junk) => {
      const built = await buildChain(spec);
      const honest = await replayEvidenceAcrossGapsV2(INITIAL, built.segments, replayer, built.checkpoints);
      // A false checkpoint under the hash of every document that is not a
      // checkpoint position: if one were read, the replay would change.
      const extras = new Map<string, Uint8Array>();
      for (const [hash] of built.everyDocument) extras.set(hash, canonicalBytes("lažno"));
      for (const [hash, bytes] of junk) extras.set(hash, bytes);
      for (const [hash, bytes] of built.checkpoints) extras.set(hash, bytes);
      const withExtras = await replayEvidenceAcrossGapsV2(INITIAL, built.segments, replayer, extras);
      expect(withExtras).toEqual(honest);
    },
  );

  test.prop([gappedChain, fc.nat()])("a missing checkpoint stops the replay at its break", async (spec, pick) => {
    const built = await buildChain(spec);
    const at = built.breaks[pick % built.breaks.length];
    const checkpoints = new Map(built.checkpoints);
    checkpoints.delete(built.segments[at].initialDocumentHash);
    const result = await replayEvidenceAcrossGapsV2(INITIAL, built.segments, replayer, checkpoints);
    expect(result).toMatchObject({ ok: false, reason: "checkpoint_missing", segmentIndex: at });
    if (!result.ok) expect(result.discontinuity).toMatchObject({ index: at, sequence: "gap" });
  });

  for (const [name, mutation] of Object.entries(MUTATIONS)) {
    test.prop([gappedChain, fc.nat(), mutation])(
      `a ${name} checkpoint is rejected at its break`,
      async (spec, pick, mutate) => {
        const built = await buildChain(spec);
        const at = built.breaks[pick % built.breaks.length];
        const key = built.segments[at].initialDocumentHash;
        const honest = built.checkpoints.get(key)!;
        const text = JSON.parse(new TextDecoder().decode(honest)).text as string;
        // Another break's bytes, or another valid document when there is none.
        const otherKey = built.breaks.map((index) => built.segments[index].initialDocumentHash).find((hash) => hash !== key);
        const other = otherKey ? built.checkpoints.get(otherKey)! : canonicalBytes(`${text}~`);
        const forged = mutate(honest, text, other);
        fc.pre(await sha256(forged) !== key);

        const checkpoints = new Map(built.checkpoints);
        checkpoints.set(key, forged);
        const result = await replayEvidenceAcrossGapsV2(INITIAL, built.segments, replayer, checkpoints);
        expect(result).toMatchObject({ ok: false, reason: "checkpoint_invalid", segmentIndex: at });
      },
    );
  }

  test.prop([
    fc.string({ unit: "grapheme", maxLength: 8 }),
    fc.constantFrom(
      ...(["non_canonical_spacing", "non_canonical_escape", "trailing_newline", "extra_field", "truncated", "invalid_utf8", "byte_order_mark", "empty", "random_bytes"] as const),
    ),
    fc.nat(),
  ])(
    "a non-canonical or unreadable checkpoint is rejected even under its own hash",
    async (text, name, seed) => {
      const honest = canonicalBytes(text);
      const mutate = fc.sample(MUTATIONS[name], { numRuns: 1, seed })[0];
      const forged = mutate(honest, text, honest);
      fc.pre(forged.byteLength !== honest.byteLength || forged.some((byte, index) => byte !== honest[index]));
      const result = await verifyEvidenceCheckpointV2(forged, await sha256(forged), replayer);
      expect(result.ok).toBe(false);
      // The honest bytes pass under their own hash and give the same document.
      expect(await verifyEvidenceCheckpointV2(honest, await sha256(honest), replayer)).toEqual({ ok: true, document: { text } });
    },
  );

  it("a checkpoint over the segment limit is rejected before it is parsed", async () => {
    const oversized = new Uint8Array(MAX_EVIDENCE_SEGMENT_BYTES + 1).fill(0x20);
    expect(await verifyEvidenceCheckpointV2(oversized, await sha256(oversized), replayer)).toEqual({
      ok: false,
      reason: "too_large",
    });
    const atLimit = encode(canonicalizeJcs({ text: "a".repeat(MAX_EVIDENCE_SEGMENT_BYTES - 11) }));
    expect(atLimit.byteLength).toBe(MAX_EVIDENCE_SEGMENT_BYTES);
    expect((await verifyEvidenceCheckpointV2(atLimit, await sha256(atLimit), replayer)).ok).toBe(true);
  });

  test.prop([gappedChain, fc.nat(), fc.constantFrom<Boundary>("regression", "hash_only")])(
    "a regression or a break in the document alone is never continued, even with a matching checkpoint",
    async (spec, pick, kind) => {
      fc.pre(spec.length > 1);
      const at = 1 + (pick % (spec.length - 1));
      const altered = spec.map((segment, index) => (index === at ? { ...segment, before: kind } : segment));
      const built = await buildChain(altered);
      // Every document of the record is offered, the one after this break too.
      const checkpoints = new Map([...built.checkpoints, ...built.everyDocument]);
      const result = await replayEvidenceAcrossGapsV2(INITIAL, built.segments, replayer, checkpoints);
      // Earlier gaps have their checkpoints, so this break is where it stops.
      expect(result).toMatchObject({ ok: false, reason: "break_not_resumable", segmentIndex: at });
      if (result.ok) return;
      expect(result.discontinuity).toMatchObject({
        index: at,
        sequence: kind === "regression" ? "regression" : "continuous",
      });
      const found = await findEvidenceBreaksV2(INITIAL, built.segments, replayer);
      expect(found.ok && evidenceCheckpointHashesV2(built.segments, found.breaks)).not.toContain(
        built.segments[at].initialDocumentHash,
      );
    },
  );

  test.prop([honestChain, fc.string({ unit: "grapheme", minLength: 1, maxLength: 4 })])(
    "a record that starts from another document is a break at the start that never resumes",
    async (spec, other) => {
      const built = await buildChain(spec);
      fc.pre(built.breaks[0] !== 0);
      const checkpoints = new Map([...built.checkpoints, ...built.everyDocument]);
      const result = await replayEvidenceAcrossGapsV2({ text: other }, built.segments, replayer, checkpoints);
      expect(result).toMatchObject({ ok: false, reason: "break_not_resumable", segmentIndex: 0 });
    },
  );

  test.prop([gappedChain, fc.nat()])(
    "after a checkpoint every event is still checked against its recorded hash",
    async (spec, pick) => {
      const built = await buildChain(spec);
      const at = built.breaks[pick % built.breaks.length];
      const event = built.segments[at].events[0];
      event.afterDocumentHash = "0".repeat(64);
      const result = await replayEvidenceAcrossGapsV2(INITIAL, built.segments, replayer, built.checkpoints);
      expect(result).toMatchObject({
        ok: false,
        reason: "document_hash_mismatch",
        segmentIndex: at,
        sequence: event.sequence,
      });
    },
  );
});

/**
 * Resuming from a checkpoint (DAN-293, M3.3-P02): the replay may start at the
 * newest position whose checkpoint the chain vouches for instead of at the
 * start. Measured against the full replay given the same checkpoints: the same
 * document, the same breaks, the same stop at a break it cannot cross.
 */

type Offer = "honest" | "absent" | keyof typeof MUTATIONS;
const anyBoundary = fc.constantFrom<Boundary>("none", "none", "gap", "regression", "hash_only");
const chainOf = (before: fc.Arbitrary<Boundary>) =>
  fc.array(fc.record({ before, skipped: honestSegment.map((s) => s.skipped), texts: honestSegment.map((s) => s.texts) }), { minLength: 1, maxLength: 6 });
const anyChain = chainOf(anyBoundary);
/** Chains in which the record may return to an earlier document, so positions share a hash. */
const revisitingChain = chainOf(fc.constantFrom<Boundary>("none", "gap", "gap_back", "gap_back", "regression", "hash_only"));
const offer = fc.oneof(
  { weight: 4, arbitrary: fc.constant<Offer>("honest") },
  { weight: 2, arbitrary: fc.constant<Offer>("absent") },
  { weight: 1, arbitrary: fc.constantFrom<Offer>(...Object.keys(MUTATIONS)) },
);

const documentText = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes)).text as string;

/** What a store might hold for each position of the record: honest, nothing or forged. */
function offered(built: BuiltChain, offers: Offer[], seed: number): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();
  for (const [index, segment] of built.segments.entries()) {
    const kind = offers[index % offers.length];
    const honest = built.everyDocument.get(segment.initialDocumentHash)!;
    if (kind === "absent") continue;
    if (kind === "honest") result.set(segment.initialDocumentHash, honest);
    else {
      const mutate = fc.sample(MUTATIONS[kind], { numRuns: 1, seed: seed + index })[0];
      result.set(segment.initialDocumentHash, mutate(honest, documentText(honest), canonicalBytes("iz drugog lanca")));
    }
  }
  return result;
}

/** The newest position after the first whose offered bytes are the document the chain names there. */
function newestVerified(built: BuiltChain, checkpoints: ReadonlyMap<string, Uint8Array>): number {
  for (let index = built.segments.length - 1; index >= 1; index--) {
    const hash = built.segments[index].initialDocumentHash;
    const bytes = checkpoints.get(hash);
    if (bytes !== undefined && Buffer.from(bytes).equals(Buffer.from(built.everyDocument.get(hash)!))) return index;
  }
  return 0;
}

describe("resuming a replay from a checkpoint v2", () => {
  test.prop([anyChain, fc.array(offer, { minLength: 1, maxLength: 6 }), fc.nat({ max: 1000 }), fc.array(fc.tuple(fc.stringMatching(/^[0-9a-f]{64}$/), fc.uint8Array()))])(
    "gives what the full replay gives with the same checkpoints, from the newest verified position",
    async (spec, offers, seed, junk) => {
      const built = await buildChain(spec);
      const checkpoints = new Map([...junk, ...offered(built, offers, seed)]);
      const full = await replayEvidenceAcrossGapsV2(INITIAL, built.segments, replayer, checkpoints);
      const resumed = await replayEvidenceFromCheckpointV2(INITIAL, built.segments, replayer, checkpoints);
      if (full.ok) {
        expect(resumed).toEqual({ ...full, resumedAt: newestVerified(built, checkpoints) });
      } else {
        // The same break, the same reason, no resume position reported.
        expect(resumed).toEqual(full);
      }
    },
  );

  test.prop([honestChain, fc.nat(), fc.nat()])(
    "a fault inside a segment is reported as by the full replay when the resume is at or before it, and is not seen when the resume is after it",
    async (spec, faultPick, checkpointPick) => {
      fc.pre(spec.length > 1);
      const built = await buildChain(spec);
      const fault = faultPick % built.segments.length;
      const position = 1 + (checkpointPick % (built.segments.length - 1));
      const step = built.segments[fault].events[0].steps[0] as unknown as { slice: { content: { text: string }[] } };
      step.slice.content[0].text += "x";
      const checkpoints = new Map(built.checkpoints);
      const key = built.segments[position].initialDocumentHash;
      checkpoints.set(key, built.everyDocument.get(key)!);

      const full = await replayEvidenceAcrossGapsV2(INITIAL, built.segments, replayer, checkpoints);
      expect(full).toMatchObject({ ok: false, reason: "document_hash_mismatch", segmentIndex: fault });
      const resumedAt = newestVerified(built, checkpoints);
      const resumed = await replayEvidenceFromCheckpointV2(INITIAL, built.segments, replayer, checkpoints);
      if (resumedAt <= fault) {
        expect(resumed).toEqual(full);
      } else {
        // The known limit: segments before the resume position are not replayed,
        // so their fault is not seen. `resumedAt` says where the replay started.
        expect(resumed).toMatchObject({ ok: true, resumedAt, documentSha256: built.segments.at(-1)!.finalDocumentHash });
      }
    },
  );

  const plain: SegmentSpec[] = ["a", "b", "c", "d"].map((value) => ({ before: "none", skipped: ["-"], texts: [value] }));
  const withGap: SegmentSpec[] = plain.map((segment, index) => (index === 1 ? { ...segment, before: "gap" } : segment));
  type Row = { name: string; spec: SegmentSpec[]; at: Record<number, Offer>; expected: object };
  const rows: Row[] = [
    { name: "a verified checkpoint", spec: plain, at: { 3: "honest" }, expected: { ok: true, resumedAt: 3, breaks: [] } },
    { name: "a checkpoint with a wrong hash, an older verified one", spec: plain, at: { 3: "other_valid_document", 1: "honest" }, expected: { ok: true, resumedAt: 1 } },
    { name: "a checkpoint with a wrong hash only", spec: plain, at: { 3: "other_valid_document" }, expected: { ok: true, resumedAt: 0 } },
    { name: "a checkpoint of another chain", spec: plain, at: { 3: "other_break_bytes" }, expected: { ok: true, resumedAt: 0 } },
    { name: "no checkpoint", spec: plain, at: {}, expected: { ok: true, resumedAt: 0, breaks: [] } },
    { name: "damaged bytes, an older verified one", spec: plain, at: { 3: "truncated", 2: "honest" }, expected: { ok: true, resumedAt: 2 } },
    { name: "a checkpoint after a gap", spec: withGap, at: { 1: "honest", 3: "honest" }, expected: { ok: true, resumedAt: 3, breaks: [expect.objectContaining({ index: 1, sequence: "gap" })] } },
    { name: "a checkpoint at the gap itself", spec: withGap, at: { 1: "honest" }, expected: { ok: true, resumedAt: 1, breaks: [expect.objectContaining({ index: 1, sequence: "gap" })] } },
    { name: "a checkpoint after a gap with no checkpoint", spec: withGap, at: { 3: "honest" }, expected: { ok: false, reason: "checkpoint_missing", segmentIndex: 1 } },
    { name: "a checkpoint after a gap with a damaged checkpoint", spec: withGap, at: { 1: "invalid_utf8", 3: "honest" }, expected: { ok: false, reason: "checkpoint_invalid", segmentIndex: 1 } },
  ];

  it.each(rows)("input class: $name", async ({ spec, at, expected }) => {
    const built = await buildChain(spec);
    const offers = built.segments.map((_segment, index) => at[index] ?? "absent");
    const checkpoints = offered(built, offers, 7);
    const resumed = await replayEvidenceFromCheckpointV2(INITIAL, built.segments, replayer, checkpoints);
    expect(resumed).toMatchObject(expected);
    const full = await replayEvidenceAcrossGapsV2(INITIAL, built.segments, replayer, checkpoints);
    if (full.ok) expect(resumed).toMatchObject(full);
    else expect(resumed).toEqual(full);
  });

  it("a repeated job and two jobs at once give the same result and leave their input as it was", async () => {
    const built = await buildChain(withGap);
    const checkpoints = offered(built, ["absent", "honest", "truncated", "honest"], 3);
    const before = JSON.stringify([built.segments, [...checkpoints].map(([hash, bytes]) => [hash, [...bytes]])]);
    const first = await replayEvidenceFromCheckpointV2(INITIAL, built.segments, replayer, checkpoints);
    const again = await replayEvidenceFromCheckpointV2(INITIAL, built.segments, replayer, checkpoints);
    const together = await Promise.all([1, 2].map(() => replayEvidenceFromCheckpointV2(INITIAL, built.segments, replayer, checkpoints)));
    expect(first).toMatchObject({ ok: true, resumedAt: 3 });
    expect([again, ...together]).toEqual([first, first, first]);
    expect(JSON.stringify([built.segments, [...checkpoints].map(([hash, bytes]) => [hash, [...bytes]])])).toBe(before);
  });

  it("reads each checkpoint once, so a store that changes during a job cannot split its answer", async () => {
    const built = await buildChain(withGap);
    const gap = built.segments[1].initialDocumentHash;
    // Only the gap has a checkpoint, so the scan for a start comes back to it.
    const honest = offered(built, ["absent", "honest", "absent", "absent"], 1);
    const reads = new Map<string, number>();
    // Honest on the first read of a hash, forged on every later one.
    const changing = {
      get(hash: string) {
        const count = (reads.get(hash) ?? 0) + 1;
        reads.set(hash, count);
        return count === 1 ? honest.get(hash) : canonicalBytes("zamijenjeno");
      },
    } as ReadonlyMap<string, Uint8Array>;
    const resumed = await replayEvidenceFromCheckpointV2(INITIAL, built.segments, replayer, changing);
    expect(resumed).toMatchObject({ ok: true, resumedAt: 1 });
    expect(resumed).toEqual(await replayEvidenceFromCheckpointV2(INITIAL, built.segments, replayer, honest));
    expect(reads.get(gap)).toBe(1);
    expect(Math.max(...reads.values())).toBe(1);
  });

  test.prop([fc.oneof(anyChain, revisitingChain), fc.integer({ min: 1, max: 8 })])(
    "resume candidates are the newest distinct documents the replay may start from, never the first position and never past a break it cannot cross",
    async (spec, limit) => {
      const built = await buildChain(spec);
      const found = await findEvidenceBreaksV2(INITIAL, built.segments, replayer);
      if (!found.ok) throw new Error("fixture: breaks");
      const hashes = evidenceResumeHashesV2(built.segments, found.breaks, limit);
      const end = found.breaks.find((item) => item.sequence !== "gap")?.index ?? built.segments.length;
      const eligible = built.segments.slice(1, Math.max(1, end)).map((segment) => segment.initialDocumentHash);
      const newest = new Set<string>();
      for (const hash of eligible.reverse()) if (newest.size < limit) newest.add(hash);
      expect(hashes).toEqual([...newest].sort());
    },
  );

  test("the limit counts documents, not positions: a document the record returns to does not push an older one out", async () => {
    const segment = (before: Boundary): SegmentSpec => ({ before, skipped: ["x"], texts: ["a"] });
    const built = await buildChain([segment("none"), segment("none"), segment("none"), segment("gap_back")]);
    const found = await findEvidenceBreaksV2(INITIAL, built.segments, replayer);
    if (!found.ok) throw new Error("fixture: breaks");
    const [, first, second, third] = built.segments.map((item) => item.initialDocumentHash);
    expect(third).toBe(second);
    expect(evidenceResumeHashesV2(built.segments, found.breaks, 2)).toEqual([first, second].sort());
    // Either position of the repeated document may carry the resume; the newest one does.
    const resumed = await replayEvidenceFromCheckpointV2(INITIAL, built.segments, replayer, built.everyDocument);
    expect(resumed).toEqual({ ...(await replayEvidenceAcrossGapsV2(INITIAL, built.segments, replayer, built.checkpoints)), resumedAt: 3 });
  });
});

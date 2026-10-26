import { createHash } from "node:crypto";

import type { Node as PmNode } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";

import { createEditStepsV1Replayer, removedRangeSha256 } from "@/adapters/evidence/edit-steps-v1-replayer";
import { createBrowserReplayStepsV1 } from "@/adapters/evidence/edit-steps-v1-replay-steps";
import { EDIT_STEP_FORMAT_V1 } from "@/domain/document/edit-step";
import { REVISION_ZERO_JCS } from "@/domain/document/revision-zero";
import {
  canonicalEvidenceSegmentV2,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  type EvidenceSourceV2,
  type EvidenceStepV2,
} from "@/domain/forensics/evidence-segment-v2";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";

import { buildReplayTimeline, type ReplayTimelineInput } from "./replay-timeline";

// Synthetic only: invented ids and filler text, no real work or person.
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "aaaaaaaa-0000-4000-8000-000000000002";
const C = "aaaaaaaa-0000-4000-8000-000000000003";
const D = "aaaaaaaa-0000-4000-8000-000000000004";
const text = (value: string) => ({ type: "text", text: value, marks: [] });
const START: JcsJsonValue = {
  schemaVersion: 1,
  nodes: [
    { type: "paragraph", id: A, children: [text("Odlomak A lorem.")] },
    { type: "heading", id: B, level: 2, children: [text("Odlomak B")] },
    { type: "paragraph", id: C, children: [text("Odlomak C ipsum.")] },
  ],
};

const server = createEditStepsV1Replayer();
const steps = createBrowserReplayStepsV1();
const schema = server.load(START).type.schema;
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const jcs = (document: PmNode) => canonicalizeJcs(server.toCanonical(document));

type Edit = { source?: EvidenceSourceV2; edit: (tr: Transform) => void };
type SegmentPlan = { at: string; until?: string; events: Edit[]; from?: PmNode };

/**
 * A record as capture writes it: each segment a list of events, each event
 * the steps of one transaction and the hash of each removed range. `from`
 * starts a segment from another document (a break in the chain).
 */
function record(start: PmNode, plans: SegmentPlan[]) {
  const segments: string[] = [];
  const hashes: string[] = [];
  const ends: PmNode[] = [];
  let document = start;
  let sequence = 0;
  for (const [index, plan] of plans.entries()) {
    document = plan.from ?? document;
    const initial = sha(jcs(document));
    const events = plan.events.map(({ source, edit }) => {
      const tr = new Transform(document);
      edit(tr);
      const json = tr.steps.map((step, i) => {
        const value = step.toJSON() as Record<string, unknown>;
        if (value.stepType === "replace" && (value.to as number) > (value.from as number) && !value.structure) {
          value.removedSha256 = removedRangeSha256(tr.docs[i], value.from as number, value.to as number);
        }
        return JSON.parse(JSON.stringify(value)) as EvidenceStepV2;
      });
      const before = sha(jcs(document));
      document = tr.doc;
      sequence++;
      return { sequence, source: source ?? "editor", steps: json, beforeDocumentHash: before, afterDocumentHash: sha(jcs(document)) };
    });
    const payload = canonicalEvidenceSegmentV2({
      evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
      canonicalization: EVIDENCE_CANONICALIZATION_V2,
      hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
      documentId: "doc-ana-z1",
      sessionId: "session-ana",
      segmentId: `segment-${index + 1}`,
      sequenceFrom: events[0].sequence,
      sequenceTo: events[events.length - 1].sequence,
      observedStartedAt: `2026-10-20T${plan.at}:00.000Z`,
      observedEndedAt: `2026-10-20T${plan.until ?? plan.at}:00.000Z`,
      initialDocumentHash: initial,
      finalDocumentHash: sha(jcs(document)),
      predecessorSegmentHash: hashes.at(-1) ?? null,
      events,
      captureContext: { editorModel: "prosemirror", transactionFormat: EDIT_STEP_FORMAT_V1 },
      evidenceProfileId: "standard-v1",
    });
    segments.push(payload);
    hashes.push(sha(payload));
    ends.push(document);
  }
  return { segments, hashes, ends, head: hashes.length ? { segmentHash: hashes.at(-1)!, segmentCount: hashes.length } : null };
}

const start = server.load(START);
const input = (r: ReturnType<typeof record>, over: Partial<ReplayTimelineInput> = {}): ReplayTimelineInput => ({
  startDocument: jcs(start),
  segments: r.segments,
  head: r.head,
  resumeDocuments: {},
  sessionBreakAboveMinutes: 30,
  ...over,
});
const build = (r: ReturnType<typeof record>, over: Partial<ReplayTimelineInput> = {}) =>
  buildReplayTimeline(input(r, over), steps);

describe("buildReplayTimeline (DAN-344 §4, D-143)", () => {
  it("gives one change per step in chain order, with its kind, source, minute and blocks", async () => {
    const r = record(start, [
      { at: "10:00", until: "10:02", events: [
        { edit: (tr) => tr.insert(17, schema.text("X")).insert(18, schema.text("Y")) },
        { edit: (tr) => tr.delete(27, 28) },
        { source: "paste", edit: (tr) => tr.replaceWith(19, 26, schema.text("Zamjena")) },
        { edit: (tr) => tr.addMark(2, 5, schema.marks.bold.create()) },
        { edit: (tr) => tr.setBlockType(1, 1, schema.nodes.heading, { level: 1, nodeId: A }) },
      ] },
    ]);
    const timeline = await build(r);
    if (!timeline.ok) throw new Error(timeline.reason);
    expect(timeline.changes.map((c) => [c.index, c.sequence, c.kind, c.source, c.blockIds.join()])).toStrictEqual([
      [1, 1, "insert", "editor", A],
      [2, 1, "insert", "editor", A],
      [3, 2, "delete", "editor", B],
      // Ends A and starts B: both blocks, one change.
      [4, 3, "replace", "paste", `${A},${B}`],
      [5, 4, "format", "editor", A],
      [6, 5, "structure", "editor", A],
    ]);
    expect(timeline.changes.every((c) => c.evidenceKind === "observed")).toBe(true);
    expect(timeline.changes[0].minute).toStrictEqual({ from: "2026-10-20T10:00:00.000Z", to: "2026-10-20T10:02:00.000Z" });
    // Character by character: the document after each step.
    expect(JSON.parse(timeline.documentAt(1)).nodes[0].children[0].text).toBe("Odlomak A lorem.X");
    expect(JSON.parse(timeline.documentAt(2)).nodes[0].children[0].text).toBe("Odlomak A lorem.XY");
    expect(timeline.documentAt(0)).toBe(jcs(start));
    expect(timeline.documentAt(6)).toBe(jcs(r.ends[0]));
    expect(() => timeline.documentAt(7)).toThrow(RangeError);
    expect(timeline.end).toBe("complete");
  });

  it("starts at revision 0 without a gap, and marks a record that starts later", async () => {
    const zero = server.load(JSON.parse(REVISION_ZERO_JCS) as JcsJsonValue);
    const r = record(zero, [{ at: "10:00", events: [{ edit: (tr) => tr.insert(1, schema.text("L")) }] }]);
    const fromZero = await buildReplayTimeline(input(r, { startDocument: REVISION_ZERO_JCS }), steps);
    expect(fromZero.ok && fromZero.markers).toStrictEqual([]);
    const later = await build(record(start, [{ at: "10:00", events: [{ edit: (tr) => tr.insert(17, schema.text("X")) }] }]));
    expect(later.ok && later.markers).toStrictEqual([{ kind: "gap", beforeIndex: 1, resumed: true }]);
  });

  it("marks a pause only above P-01 and gives it no duration", async () => {
    const r = record(start, [
      { at: "10:00", events: [{ edit: (tr) => tr.insert(17, schema.text("X")) }] },
      { at: "10:30", events: [{ edit: (tr) => tr.insert(18, schema.text("Y")) }] },
      { at: "11:01", events: [{ edit: (tr) => tr.insert(19, schema.text("Z")) }] },
    ]);
    const timeline = await build(r);
    // 10:00 to 10:30 is exactly P-01: no pause; 10:30 to 11:01 is above it.
    expect(timeline.ok && timeline.markers.filter((m) => m.kind === "pause")).toStrictEqual([{ kind: "pause", beforeIndex: 3 }]);
  });

  it("resumes after a break only from a document of exactly the next segment's start hash", async () => {
    const elsewhere = server.load({
      schemaVersion: 1,
      nodes: [{ type: "paragraph", id: A, children: [text("Drugi tekst.")] }, { type: "paragraph", id: D, children: [] }],
    } as JcsJsonValue);
    const r = record(start, [
      { at: "10:00", events: [{ edit: (tr) => tr.insert(17, schema.text("X")) }] },
      { at: "10:05", from: elsewhere, events: [{ edit: (tr) => tr.insert(13, schema.text("!")) }] },
    ]);
    const resumed = await build(r, { resumeDocuments: { [sha(jcs(elsewhere))]: jcs(elsewhere) } });
    if (!resumed.ok) throw new Error(resumed.reason);
    expect(resumed.markers).toContainEqual({ kind: "gap", beforeIndex: 2, resumed: true });
    expect(resumed.changes).toHaveLength(2);
    expect(resumed.end).toBe("complete");
    expect(resumed.documentAt(2)).toBe(jcs(r.ends[1]));

    const stopped = await build(r);
    if (!stopped.ok) throw new Error(stopped.reason);
    expect(stopped.markers).toContainEqual({ kind: "gap", beforeIndex: 2, resumed: false });
    expect(stopped.changes).toHaveLength(1);
    expect(stopped.end).toBe("stopped");

    // A text under another hash is no checkpoint for this break.
    const wrong = await build(r, { resumeDocuments: { [sha(jcs(elsewhere))]: jcs(start) } });
    expect(wrong.ok && wrong.end).toBe("stopped");
  });

  it("gives no timeline at all when one byte, the head, the start or a step is not the record", async () => {
    const r = record(start, [
      { at: "10:00", events: [{ edit: (tr) => tr.insert(17, schema.text("X")) }] },
      { at: "10:01", events: [{ edit: (tr) => tr.delete(27, 28) }] },
    ]);
    const changed = r.segments[1].replace("T10:01", "T10:02");
    expect(changed).not.toBe(r.segments[1]);
    expect(await build(r, { segments: [r.segments[0], changed] })).toStrictEqual({ ok: false, reason: "chain_mismatch" });
    expect(await build(r, { segments: [r.segments[0], `${r.segments[1]} `] })).toStrictEqual({ ok: false, reason: "invalid_segment" });
    expect(await build(r, { head: { segmentHash: r.hashes[0], segmentCount: 1 } })).toStrictEqual({ ok: false, reason: "chain_mismatch" });
    expect(await build(r, { startDocument: REVISION_ZERO_JCS })).toStrictEqual({ ok: false, reason: "document_mismatch" });
    expect(await build(r, { startDocument: null })).toStrictEqual({ ok: false, reason: "document_mismatch" });
  });

  it("gives no timeline when a chain that verifies has a step that does not produce its recorded document", async () => {
    const r = record(start, [{ at: "10:00", events: [{ edit: (tr) => tr.insert(17, schema.text("X")) }] }]);
    // Resealed so the chain and head verify: only the replay can find it.
    const reseal = (change: (segment: Record<string, unknown>) => void) => {
      const segment = JSON.parse(r.segments[0]) as Record<string, unknown>;
      change(segment);
      const payload = canonicalizeJcs(segment as JcsJsonValue);
      return build(r, { segments: [payload], head: { segmentHash: sha(payload), segmentCount: 1 } });
    };
    const other = sha("drugi dokument");
    expect(await reseal((s) => {
      const events = s.events as { afterDocumentHash: string }[];
      events[0].afterDocumentHash = other;
      s.finalDocumentHash = other;
    })).toStrictEqual({ ok: false, reason: "document_mismatch" });
    expect(await reseal((s) => {
      const events = s.events as { steps: { slice?: { content: { text?: string }[] } }[] }[];
      events[0].steps[0].slice!.content[0].text = "Y";
    })).toStrictEqual({ ok: false, reason: "document_mismatch" });
    expect(await reseal((s) => {
      const events = s.events as { steps: { from: number; to: number }[] }[];
      events[0].steps[0].from = 900;
      events[0].steps[0].to = 900;
    })).toStrictEqual({ ok: false, reason: "step_failed" });
  });

  it("is empty for an empty record", async () => {
    const timeline = await buildReplayTimeline(
      { startDocument: null, segments: [], head: null, resumeDocuments: {}, sessionBreakAboveMinutes: 30 }, steps);
    expect(timeline.ok && timeline.changes).toStrictEqual([]);
  });

  it("gives a block's history with the text before and after, a change across two blocks in both", async () => {
    const r = record(start, [
      { at: "10:00", events: [
        { edit: (tr) => tr.insert(17, schema.text("X")) },
        { edit: (tr) => tr.delete(10, 22) },
      ] },
    ]);
    const timeline = await build(r);
    if (!timeline.ok) throw new Error(timeline.reason);
    expect(timeline.blockHistory(A)).toStrictEqual([
      { index: 1, before: "Odlomak A lorem.", after: "Odlomak A lorem.X", removed: "", inserted: "X" },
      { index: 2, before: "Odlomak A lorem.X", after: "Odlomak Alomak B", removed: " lorem.X", inserted: "lomak B" },
    ]);
    expect(timeline.blockHistory(B)).toStrictEqual([
      { index: 2, before: "Odlomak B", after: null, removed: "Odlomak B", inserted: "" },
    ]);
    expect(timeline.blockHistory(C)).toStrictEqual([]);
  });

  it("does not put a split block's text on the wrong block", async () => {
    const r = record(start, [
      { at: "10:00", events: [{ edit: (tr) =>
        tr.split(9, 1, [{ type: schema.nodes.paragraph, attrs: { nodeId: null } }]).setNodeAttribute(10, "nodeId", D) }] },
    ]);
    const timeline = await build(r);
    if (!timeline.ok) throw new Error(timeline.reason);
    expect(timeline.changes.map((c) => [c.kind, c.blockIds.join()])).toStrictEqual([["structure", A], ["structure", D]]);
    // The split leaves A with its first part; the rest is in the new block, which has no id until the next step.
    expect(timeline.blockHistory(A)).toStrictEqual([
      { index: 1, before: "Odlomak A lorem.", after: "Odlomak ", removed: "A lorem.", inserted: "" },
    ]);
    // D did not exist before it was named: `before` is null, so the text is not shown as typed into another block.
    expect(timeline.blockHistory(D)).toStrictEqual([
      { index: 2, before: null, after: "A lorem.", removed: "", inserted: "A lorem." },
    ]);
    expect(timeline.blockHistory(B)).toStrictEqual([]);
  });

  it("carries no field that measures time, speed or a person", async () => {
    const timeline = await build(record(start, [{ at: "10:00", events: [{ edit: (tr) => tr.insert(17, schema.text("X")) }] }]));
    if (!timeline.ok) throw new Error(timeline.reason);
    const fields = new Set([...timeline.changes, ...timeline.markers].flatMap((item) => Object.keys(item)));
    expect([...fields].sort()).toStrictEqual(
      ["beforeIndex", "blockIds", "evidenceKind", "index", "kind", "minute", "resumed", "sequence", "source"].filter((f) =>
        fields.has(f)));
    for (const forbidden of ["duration", "speed", "rate", "ms", "seconds", "author", "score"]) {
      expect([...fields].some((f) => f.toLowerCase().includes(forbidden))).toBe(false);
    }
  });
});

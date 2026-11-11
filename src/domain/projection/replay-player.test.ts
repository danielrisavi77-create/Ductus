import fc from "fast-check";
import type { Node as PmNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { createBrowserReplayStepsV1 } from "@/adapters/evidence/edit-steps-v1-replay-steps";
import { REVISION_ZERO_JCS } from "@/domain/document/revision-zero";
import type { JcsJsonValue } from "@/domain/forensics/jcs";

import { buildReplayPlayer, type ReplayRecord } from "./replay-player";
import {
  BLOCK_A as A,
  BLOCK_B as B,
  BLOCK_C as C,
  BLOCK_D as D,
  buildRecord,
  jcsOf,
  recordSchema as schema,
  serverReplayer as server,
  sha,
  startNode as start,
  type BuiltRecord,
  type RecordSegmentPlan,
} from "./replay-record.fixture";

const steps = createBrowserReplayStepsV1();
const recordOf = (r: BuiltRecord, over: Partial<ReplayRecord> = {}): ReplayRecord => ({
  startDocument: jcsOf(start),
  segments: r.segments,
  head: r.head,
  resumeDocuments: {},
  ...over,
});
const play = (r: BuiltRecord, over: Partial<ReplayRecord> = {}) => buildReplayPlayer(recordOf(r, over), steps);

// Synthetic only: a document the record resumes from after a break.
const elsewhere = server.load({
  schemaVersion: 1,
  nodes: [{ type: "paragraph", id: A, children: [{ type: "text", text: "Drugi tekst.", marks: [] }] }, { type: "paragraph", id: D, children: [] }],
} as JcsJsonValue);
const checkpoint = { [sha(jcsOf(elsewhere))]: jcsOf(elsewhere) };
// Another synthetic document no checkpoint is ever given for.
const nowhere = server.load({
  schemaVersion: 1,
  nodes: [{ type: "paragraph", id: A, children: [{ type: "text", text: "Treći tekst.", marks: [] }] }],
} as JcsJsonValue);
const typeAt = (pos: number, value: string) => ({ edit: (tr: Parameters<RecordSegmentPlan["events"][0]["edit"]>[0]) => tr.insert(pos, schema.text(value)) });

describe("buildReplayPlayer (DAN-537, rb 261)", () => {
  it("lists the changes in chain order as change n of N, with no time", async () => {
    const r = buildRecord(start, [
      { at: "10:00", until: "10:02", events: [typeAt(17, "X"), { source: "paste", ...typeAt(1, "Y") }] },
      { at: "12:00", events: [{ edit: (tr) => tr.delete(27, 28) }] },
    ]);
    const player = await play(r);
    if (!player.ok) throw new Error(player.reason);
    expect(player.total).toBe(3);
    expect(player.end).toBe("complete");
    // Revision 0 is not where this record starts: one gap first, then the changes.
    expect(player.entries).toStrictEqual([
      { entry: "gap", gap: "starts_later", beforeIndex: 1 },
      { entry: "change", change: { index: 1, kind: "insert", source: "editor", evidenceKind: "observed", blockIds: [A] } },
      { entry: "change", change: { index: 2, kind: "insert", source: "paste", evidenceKind: "observed", blockIds: [A] } },
      { entry: "change", change: { index: 3, kind: "delete", source: "editor", evidenceKind: "observed", blockIds: [B] } },
    ]);
    expect(player.documentAt(0)).toStrictEqual(start.toJSON());
    expect(player.documentAt(3)).toStrictEqual(r.ends[1].toJSON());
  });

  it("has no gap for a record from revision 0, and no pause however far apart the segments are", async () => {
    const zero = server.load(JSON.parse(REVISION_ZERO_JCS) as JcsJsonValue);
    const r = buildRecord(zero, [
      { at: "08:00", events: [typeAt(1, "L")] },
      { at: "23:59", events: [typeAt(2, "M")] },
    ]);
    const player = await play(r, { startDocument: REVISION_ZERO_JCS });
    if (!player.ok) throw new Error(player.reason);
    expect(player.entries.map((e) => e.entry)).toStrictEqual(["change", "change"]);
  });

  it("shows a break resumed from a verified document as a gap at its place", async () => {
    const r = buildRecord(start, [
      { at: "10:00", events: [typeAt(17, "X")] },
      { at: "10:05", from: elsewhere, events: [typeAt(13, "!")] },
    ]);
    const player = await play(r, { resumeDocuments: checkpoint });
    if (!player.ok) throw new Error(player.reason);
    expect(player.entries.map((e) => (e.entry === "gap" ? e.gap : e.change.index))).toStrictEqual(["starts_later", 1, "resumed", 2]);
    expect(player.end).toBe("complete");
    expect(player.documentAt(2)).toStrictEqual(r.ends[1].toJSON());
  });

  it("ends a break with no document to resume from in a gap, and replays nothing after it", async () => {
    const r = buildRecord(start, [
      { at: "10:00", events: [typeAt(17, "X")] },
      { at: "10:05", from: elsewhere, events: [typeAt(13, "!")] },
      { at: "10:06", events: [typeAt(13, "?")] },
    ]);
    const player = await play(r);
    if (!player.ok) throw new Error(player.reason);
    expect(player.total).toBe(1);
    expect(player.end).toBe("stopped");
    // The last entry is the gap: the stop is never hidden.
    expect(player.entries.at(-1)).toStrictEqual({ entry: "gap", gap: "not_resumed", beforeIndex: 2 });
    expect(() => player.documentAt(2)).toThrow(RangeError);
  });

  it("gives a paragraph's history in order, with every gap of the record at its place", async () => {
    const r = buildRecord(start, [
      { at: "10:00", events: [typeAt(17, "X"), typeAt(28, "Z")] },
      { at: "10:05", from: elsewhere, events: [typeAt(13, "!")] },
      { at: "10:06", from: start, events: [typeAt(1, "Q")] },
    ]);
    const player = await play(r, { resumeDocuments: { ...checkpoint, [sha(jcsOf(start))]: jcsOf(start) } });
    if (!player.ok) throw new Error(player.reason);
    expect(player.paragraphHistory(A)).toStrictEqual([
      { entry: "gap", gap: "starts_later", beforeIndex: 1 },
      { entry: "change", index: 1, kind: "insert", source: "editor", before: "Odlomak A lorem.", after: "Odlomak A lorem.X", removed: "", inserted: "X" },
      { entry: "gap", gap: "resumed", beforeIndex: 3 },
      { entry: "change", index: 3, kind: "insert", source: "editor", before: "Drugi tekst.", after: "Drugi tekst.!", removed: "", inserted: "!" },
      { entry: "gap", gap: "resumed", beforeIndex: 4 },
      { entry: "change", index: 4, kind: "insert", source: "editor", before: "Odlomak A lorem.", after: "QOdlomak A lorem.", removed: "", inserted: "Q" },
    ]);
    // A paragraph no change touched still shows where the record has gaps.
    expect(player.paragraphHistory(C).map((e) => e.entry)).toStrictEqual(["gap", "gap", "gap"]);
    expect(player.paragraphHistory(B).filter((e) => e.entry === "change").map((e) => e.entry === "change" && e.index)).toStrictEqual([2]);
  });

  it("puts the stop at the end of a paragraph's history", async () => {
    const r = buildRecord(start, [
      { at: "10:00", events: [typeAt(17, "X")] },
      { at: "10:05", from: elsewhere, events: [typeAt(13, "!")] },
    ]);
    const player = await play(r);
    if (!player.ok) throw new Error(player.reason);
    expect(player.paragraphHistory(A).at(-1)).toStrictEqual({ entry: "gap", gap: "not_resumed", beforeIndex: 2 });
  });

  it("is empty for an empty record, and gives no player for a record that fails a check", async () => {
    const empty = await buildReplayPlayer({ startDocument: null, segments: [], head: null, resumeDocuments: {} }, steps);
    expect(empty.ok && [empty.total, empty.entries, empty.end]).toStrictEqual([0, [], "complete"]);

    const r = buildRecord(start, [{ at: "10:00", events: [typeAt(17, "X")] }]);
    const tampered = r.segments[0].replace("\"X\"", "\"W\"");
    expect(await play(r, { segments: [tampered] })).toStrictEqual({ ok: false, reason: "chain_mismatch" });
    expect(await play(r, { startDocument: REVISION_ZERO_JCS })).toStrictEqual({ ok: false, reason: "document_mismatch" });
  });

  it("takes no input about who looks: the same record gives the same player", async () => {
    const r = buildRecord(start, [{ at: "10:00", events: [typeAt(17, "X")] }]);
    expect(buildReplayPlayer.length).toBe(2);
    const [one, two] = await Promise.all([play(r), play(r)]);
    if (!one.ok || !two.ok) throw new Error("replay failed");
    expect(one.entries).toStrictEqual(two.entries);
    expect(one.paragraphHistory(A)).toStrictEqual(two.paragraphHistory(A));
  });
});

/** Every key and every string at any depth. */
function walk(value: unknown, keys: Set<string>, strings: Set<string>): void {
  if (typeof value === "string") strings.add(value);
  else if (Array.isArray(value)) for (const item of value) walk(item, keys, strings);
  else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key);
      walk(item, keys, strings);
    }
  }
}

const TIME_KEY = /minute|observed|pause|^at$|time|duration|speed|rate|tempo|second|ms$/i;
const INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

describe("buildReplayPlayer carries no time (D-143, D-239)", () => {
  it("has no time key or instant at any depth, for any record with gaps", async () => {
    const segmentPlan = fc.record({
      minute: fc.integer({ min: 0, max: 59 }),
      hour: fc.integer({ min: 0, max: 23 }),
      break: fc.constantFrom("none", "resumed", "not_resumed"),
      typed: fc.array(fc.constantFrom("a", "b", "č"), { minLength: 1, maxLength: 3 }),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(segmentPlan, { minLength: 1, maxLength: 5 }), async (plans) => {
        const resumeDocuments: Record<string, string> = {};
        const breakFrom = (kind: string): PmNode | undefined => {
          if (kind === "none") return undefined;
          if (kind === "not_resumed") return nowhere;
          Object.assign(resumeDocuments, checkpoint);
          return elsewhere;
        };
        const pad = (n: number) => String(n).padStart(2, "0");
        const r = buildRecord(start, plans.map((plan, i) => ({
          at: `${pad(plan.hour)}:${pad(plan.minute)}`,
          from: i === 0 ? undefined : breakFrom(plan.break),
          // Position 1 is the start of the first block in both documents.
          events: plan.typed.map((value) => typeAt(1, value)),
        })));
        const player = await play(r, { resumeDocuments });
        if (!player.ok) throw new Error(player.reason);
        const keys = new Set<string>();
        const strings = new Set<string>();
        walk(player, keys, strings);
        for (const id of [A, B, C, D]) walk(player.paragraphHistory(id), keys, strings);
        expect([...keys].filter((key) => TIME_KEY.test(key))).toStrictEqual([]);
        expect([...strings].filter((value) => INSTANT.test(value))).toStrictEqual([]);
        // Every break shows: as many gaps after the first as breaks up to a stop.
        const breaks = plans.slice(1).map((plan) => plan.break);
        const stop = breaks.indexOf("not_resumed");
        const shown = stop === -1 ? breaks.filter((b) => b !== "none").length : breaks.slice(0, stop + 1).filter((b) => b !== "none").length;
        expect(player.entries.filter((e) => e.entry === "gap")).toHaveLength(1 + shown);
        expect(player.end).toBe(stop === -1 ? "complete" : "stopped");
      }),
      { numRuns: 40 },
    );
  });
});

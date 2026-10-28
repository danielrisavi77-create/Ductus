// @vitest-environment node
import { createHash } from "node:crypto";

import { getSchema } from "@tiptap/core";
import { Slice, type Node as PmNode } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";

import {
  digestCanonicalDocumentV2,
  EvidenceContentNotSupportedV2,
  replayEvidenceSegmentsV2,
} from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceEventV2, EvidenceSegmentV2, EvidenceStepV2 } from "@/domain/forensics/evidence-segment-v2";
import type { JcsJsonValue } from "@/domain/forensics/jcs";
import { MARK_ORDER, PLAIN_BLOCK_TYPES } from "@/domain/document/schema";
import { createEditorExtensions } from "@/editor/schema";

import { createEditStepsV1Replayer, removedRangeSha256 } from "./edit-steps-v1-replayer";

// Synthetic only: invented ids and filler text, no real work or person.
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "aaaaaaaa-0000-4000-8000-000000000002";
const C = "aaaaaaaa-0000-4000-8000-000000000003";
const OTHER_HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
/**
 * removedSha256 of "Odlomak B" (the whole heading text) in `start`; pins the
 * definition. Computed outside the code under test:
 * printf '%s' '{"content":[{"text":"Odlomak B","type":"text"}]}' | sha256sum
 */
const KNOWN_ANSWER = "90d4f8aa06a3d89df35caec6d423df7e3f221ba5d01e33ffc23ecaa232c815bf";

const text = (value: string, marks: ("bold" | "italic")[] = []) => ({ type: "text", text: value, marks });
const start: JcsJsonValue = {
  schemaVersion: 1,
  nodes: [
    { type: "paragraph", id: A, children: [text("Odlomak A lorem.")] },
    { type: "heading", id: B, level: 2, children: [text("Odlomak B")] },
    { type: "paragraph", id: C, children: [text("Odlomak C ipsum.")] },
  ],
};

const replayer = createEditStepsV1Replayer();
// The replayer's own schema instance: ProseMirror does not mix node types of two schemas.
const schema = replayer.load(start).type.schema;
// The same extensions build the same schema, so capture and replay agree on the JSON.
const editorSchema = getSchema(createEditorExtensions());
const event = (steps: unknown[], sequence = 1): EvidenceEventV2 => ({
  sequence,
  source: "editor",
  steps: steps as EvidenceStepV2[],
  beforeDocumentHash: OTHER_HASH,
  afterDocumentHash: OTHER_HASH,
});

/** What capture does: ProseMirror's steps, plus the hash of each removed range. */
function capture(document: PmNode, edit: (tr: Transform) => void): { steps: unknown[]; after: PmNode } {
  const tr = new Transform(document);
  edit(tr);
  const steps = tr.steps.map((step, i) => {
    const json = step.toJSON() as Record<string, unknown>;
    const from = json.from as number;
    const to = json.to as number;
    if (json.stepType === "replace" && to > from && !json.structure) {
      json.removedSha256 = removedRangeSha256(tr.docs[i], from, to);
    }
    return JSON.parse(JSON.stringify(json)) as unknown;
  });
  return { steps, after: tr.doc };
}

const refused = (document: PmNode, steps: unknown[]) =>
  expect(() => replayer.apply(document, event(steps)));

describe("edit steps v1 replayer: removed range hash (B-12, STATE 'Ne smije se izgubiti')", () => {
  const doc = replayer.load(start);

  it("pins the definition with a known answer", () => {
    // "Odlomak B" is the whole text of the heading: positions 19..28. Inside
    // one block the slice is its text alone, with no open sides.
    const json = '{"content":[{"text":"Odlomak B","type":"text"}]}';
    expect(JSON.stringify(doc.slice(19, 28).toJSON())).not.toBe(json); // key order is JCS, not PM's
    expect(removedRangeSha256(doc, 19, 28)).toBe(createHash("sha256").update(json, "utf8").digest("hex"));
    expect(removedRangeSha256(doc, 19, 28)).toBe(KNOWN_ANSWER);
    // Across a block boundary the slice keeps the blocks, their attributes and open sides.
    const across = '{"content":[{"attrs":{"nodeId":"' + A + '"},"content":[{"text":"rem.","type":"text"}],' +
      '"type":"paragraph"},{"attrs":{"level":2,"nodeId":"' + B + '"},"content":[{"text":"Odlo","type":"text"}],' +
      '"type":"heading"}],"openEnd":1,"openStart":1}';
    expect(removedRangeSha256(doc, 13, 23)).toBe(createHash("sha256").update(across, "utf8").digest("hex"));
  });

  it.each([
    ["deleting a range", (tr: Transform) => tr.delete(27, 28)],
    ["cutting across blocks", (tr: Transform) => tr.delete(10, 33)],
    ["replacing a range", (tr: Transform) => tr.replaceWith(19, 27, schema.text("Zamjena"))],
    ["deleting a whole block", (tr: Transform) => tr.delete(18, 29)],
  ])("accepts %s when the recorded hash is the hash of the removed range", (_name, edit) => {
    const { steps, after } = capture(doc, edit);
    expect(replayer.apply(doc, event(steps)).toJSON()).toEqual(after.toJSON());
  });

  it.each([
    ["deleting", (tr: Transform) => tr.delete(19, 28)],
    ["cutting", (tr: Transform) => tr.delete(10, 33)],
    ["replacing", (tr: Transform) => tr.replaceWith(19, 28, schema.text("Odlomak X"))],
  ])("refuses %s when the recorded hash is of other content", (_name, edit) => {
    const { steps } = capture(doc, edit);
    const forged = steps.map((step) => ({ ...(step as object), removedSha256: OTHER_HASH }));
    refused(doc, forged).toThrow("removed_range_hash");
  });

  it("refuses the hash of a range shifted by one position", () => {
    const forged = { stepType: "replace", from: 19, to: 28, removedSha256: removedRangeSha256(doc, 20, 29) };
    refused(doc, [forged]).toThrow("removed_range_hash");
  });

  it("refuses a hash of the document after the step instead of before it", () => {
    const { steps, after } = capture(doc, (tr) => tr.delete(27, 28));
    const forged = { ...(steps[0] as object), removedSha256: removedRangeSha256(after, 26, 27) };
    refused(doc, [forged]).toThrow("removed_range_hash");
  });

  it("does not normalise: an NFD form of the removed text has another hash", () => {
    const nfc = replayer.load({ schemaVersion: 1, nodes: [{ type: "paragraph", id: A, children: [text("čž")] }] });
    const nfd = replayer.load({ schemaVersion: 1, nodes: [{ type: "paragraph", id: A, children: [text("čž")] }] });
    const step = { stepType: "replace", from: 1, to: 3, removedSha256: removedRangeSha256(nfd, 1, 5) };
    refused(nfc, [step]).toThrow("removed_range_hash");
  });

  it("requires the hash where a range removes text, even with structure", () => {
    refused(doc, [{ stepType: "replace", from: 2, to: 4, structure: true }]).toThrow("removed_range_record");
  });

  it("refuses a hash where a range removes only block boundaries (a join)", () => {
    refused(doc, [{ stepType: "replace", from: 17, to: 19, removedSha256: OTHER_HASH }]).toThrow(
      "removed_range_record",
    );
    const { steps, after } = capture(doc, (tr) => tr.join(18));
    expect(steps).toEqual([{ stepType: "replace", from: 17, to: 19, structure: true }]);
    expect(replayer.apply(doc, event(steps)).toJSON()).toEqual(after.toJSON());
  });

  it("deleting an empty block carries a hash, never structure", () => {
    const empty = replayer.load({
      schemaVersion: 1,
      nodes: [
        { type: "paragraph", id: A, children: [text("x")] },
        { type: "paragraph", id: B, children: [] },
        { type: "paragraph", id: C, children: [text("y")] },
      ],
    });
    refused(empty, [{ stepType: "replace", from: 3, to: 5, structure: true }]).toThrow("removed_range_record");
    const { steps, after } = capture(empty, (tr) => tr.delete(3, 5));
    expect(replayer.apply(empty, event(steps)).toJSON()).toEqual(after.toJSON());
  });
});

describe("edit steps v1 replayer: positions, identity and fail-closed", () => {
  const doc = replayer.load(start);

  it("replays on the editor's F1 schema", () => {
    for (const kind of ["nodes", "marks"] as const) {
      const spec = (s: typeof schema) =>
        Object.fromEntries(Object.entries(s[kind]).map(([name, type]) => [name, Object.keys(type.spec.attrs ?? {})]));
      expect(spec(schema)).toEqual(spec(editorSchema));
    }
  });

  it("refuses a position outside the document", () => {
    refused(doc, [{ stepType: "replace", from: 999, to: 999, slice: { content: [{ type: "text", text: "a" }] } }])
      .toThrow("position_outside_document");
  });

  it("refuses a position between the halves of a surrogate pair", () => {
    const emoji = replayer.load({ schemaVersion: 1, nodes: [{ type: "paragraph", id: A, children: [text("a😀b")] }] });
    refused(emoji, [{ stepType: "replace", from: 3, to: 3, slice: { content: [{ type: "text", text: "x" }] } }])
      .toThrow("position_splits_surrogate_pair");
  });

  it("gives a new block its id only through attr on a block without one", () => {
    const D = "aaaaaaaa-0000-4000-8000-000000000004";
    const { steps, after } = capture(doc, (tr) =>
      tr.split(5, 1, [{ type: schema.nodes.paragraph, attrs: { nodeId: null } }]).setNodeAttribute(6, "nodeId", D),
    );
    const replayed = replayer.apply(doc, event(steps));
    expect(replayed.toJSON()).toEqual(after.toJSON());
    expect(replayer.toCanonical(replayed)).toMatchObject({ nodes: [{ id: A }, { id: D }, { id: B }, { id: C }] });
    refused(doc, [{ stepType: "attr", pos: 0, attr: "nodeId", value: D }]).toThrow("attr_identity");
    refused(doc, [{ stepType: "attr", pos: 3, attr: "nodeId", value: D }]).toThrow("attr_identity");
  });

  it("refuses an event that leaves a block without an id or repeats one", () => {
    const { steps } = capture(doc, (tr) => tr.split(5, 1, [{ type: schema.nodes.paragraph, attrs: { nodeId: null } }]));
    const split = replayer.apply(doc, event(steps));
    expect(() => replayer.toCanonical(split)).toThrow("block_identity");
    const twice = split.type.create(null, [split.child(0), split.child(0).type.create({ nodeId: A })]);
    expect(() => replayer.toCanonical(twice)).toThrow("block_identity");
  });

  it("changes a block type only with replaceAround that keeps its id", () => {
    const { steps, after } = capture(doc, (tr) =>
      tr.setBlockType(1, 1, schema.nodes.heading, { level: 1, nodeId: A }),
    );
    expect(replayer.apply(doc, event(steps)).toJSON()).toEqual(after.toJSON());
    const around = steps[0] as { slice: { content: { attrs: Record<string, unknown> }[] } };
    const stolen = structuredClone(around);
    stolen.slice.content[0].attrs.nodeId = C;
    refused(doc, [stolen]).toThrow("replace_around_identity");
    const same = { stepType: "replaceAround", from: 18, to: 29, gapFrom: 19, gapTo: 28, insert: 1, structure: true,
      slice: { content: [{ type: "heading", attrs: { level: 2, nodeId: B } }] } };
    refused(doc, [same]).toThrow("replace_around_unchanged");
    refused(doc, [{ ...same, from: 0, gapFrom: 1 }]).toThrow("replace_around_range");
  });

  it("refuses a pasted tail that takes the id of an existing block", () => {
    const pasted = (tr: Transform) => tr.replace(5, 5, new Slice(doc.content.cut(0, 29), 1, 1));
    const { steps } = capture(doc, pasted);
    refused(doc, steps).toThrow("open_end_block");
  });

  it("refuses an open start that does not repeat the block it continues", () => {
    const slice = { content: [{ type: "heading", attrs: { level: 2, nodeId: B } }, { type: "paragraph", attrs: { nodeId: null } }],
      openStart: 1, openEnd: 1 };
    refused(doc, [{ stepType: "replace", from: 5, to: 5, structure: true, slice }]).toThrow("open_start_block");
  });

  it("refuses a step that changes nothing and a step ProseMirror cannot apply", () => {
    refused(doc, [{ stepType: "removeMark", from: 1, to: 5, mark: { type: "bold" } }]).toThrow("step_changes_nothing");
    // Text between two blocks: the shape is valid, ProseMirror's own check fails.
    refused(doc, [{ stepType: "replace", from: 18, to: 18, slice: { content: [{ type: "text", text: "x" }] } }])
      .toThrow("step_does_not_apply");
  });

  it("accepts a mark across a block boundary", () => {
    const { steps, after } = capture(doc, (tr) => tr.addMark(16, 22, schema.marks.bold.create()));
    expect(replayer.apply(doc, event(steps)).toJSON()).toEqual(after.toJSON());
  });

  it("refuses an unknown format and a malformed step before touching the document", () => {
    refused(doc, [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: "a" }] }, ts: 5 }])
      .toThrow("unknown_field");
    refused(doc, []).toThrow("steps_empty");
  });
});

// E1 part 1 (#823, DAN-326, contract issuecomment-6412639687): the bullet
// item is a flat block, so the replayer's rules hold for it unchanged. Tests
// only: no production code of this adapter changes (orchestrator, #823).
describe("edit steps v1 replayer: bullet item (E1)", () => {
  const doc = replayer.load(start);
  const D = "aaaaaaaa-0000-4000-8000-000000000004";
  const asItem = capture(doc, (tr) => tr.setBlockType(1, 1, schema.nodes.bulletItem!, { nodeId: A }));
  const itemDoc = replayer.apply(doc, event(asItem.steps));

  it("a change of type to an item and back keeps the id, and only that", () => {
    expect(itemDoc.toJSON()).toEqual(asItem.after.toJSON());
    expect(replayer.toCanonical(itemDoc)).toMatchObject({
      nodes: [{ type: "bulletItem", id: A }, { type: "heading", id: B }, { type: "paragraph", id: C }],
    });
    const back = capture(itemDoc, (tr) => tr.setBlockType(1, 1, schema.nodes.paragraph!, { nodeId: A }));
    expect(replayer.toCanonical(replayer.apply(itemDoc, event(back.steps)))).toEqual(replayer.toCanonical(doc));
    const stolen = structuredClone(asItem.steps[0]) as { slice: { content: { attrs: Record<string, unknown> }[] } };
    stolen.slice.content[0]!.attrs.nodeId = C;
    refused(doc, [stolen]).toThrow("replace_around_identity");
    refused(itemDoc, asItem.steps).toThrow("replace_around_unchanged");
  });

  it("refuses an item with a level, and an item wrapper with content, before touching the document", () => {
    const withLevel = structuredClone(asItem.steps[0]) as { slice: { content: { attrs: Record<string, unknown> }[] } };
    withLevel.slice.content[0]!.attrs.level = 1;
    refused(doc, [withLevel]).toThrow("unknown_field");
    const withContent = structuredClone(asItem.steps[0]) as { slice: { content: Record<string, unknown>[] } };
    withContent.slice.content[0]!.content = [{ type: "text", text: "x" }];
    refused(doc, [withContent]).toThrow("invalid_slice");
  });

  it("Enter at the end of an item: a new item without an id, then its id through attr", () => {
    const { steps, after } = capture(itemDoc, (tr) =>
      tr.split(17, 1, [{ type: schema.nodes.bulletItem! }]).setNodeAttribute(18, "nodeId", D),
    );
    const replayed = replayer.apply(itemDoc, event(steps));
    expect(replayed.toJSON()).toEqual(after.toJSON());
    expect(replayer.toCanonical(replayed)).toMatchObject({
      nodes: [{ type: "bulletItem", id: A }, { type: "bulletItem", id: D }, { id: B }, { id: C }],
    });
  });

  it("the removed hash across an item's boundary covers the item's type", () => {
    const { steps, after } = capture(itemDoc, (tr) => tr.delete(10, 22));
    expect(replayer.apply(itemDoc, event(steps)).toJSON()).toEqual(after.toJSON());
    // The same range with a paragraph in place of the item has another hash.
    const asParagraph = { ...(steps[0] as object), removedSha256: removedRangeSha256(doc, 10, 22) };
    expect(asParagraph.removedSha256).not.toBe((steps[0] as { removedSha256: string }).removedSha256);
    refused(itemDoc, [asParagraph]).toThrow("removed_range_hash");
  });
});

// E1 part 2 (#823): the quote paragraph is a flat block like the item; tests
// only, no production code of this adapter changes.
describe("edit steps v1 replayer: quote paragraph (E1)", () => {
  const doc = replayer.load(start);
  const asItem = capture(doc, (tr) => tr.setBlockType(1, 1, schema.nodes.bulletItem!, { nodeId: A }));
  const itemDoc = replayer.apply(doc, event(asItem.steps));
  const asQuote = capture(itemDoc, (tr) => tr.setBlockType(1, 1, schema.nodes.quote!, { nodeId: A }));
  const quoteDoc = replayer.apply(itemDoc, event(asQuote.steps));

  it("an item becomes a quote and the quote a paragraph, with the same id", () => {
    expect(quoteDoc.toJSON()).toEqual(asQuote.after.toJSON());
    expect(replayer.toCanonical(quoteDoc)).toMatchObject({ nodes: [{ type: "quote", id: A }, { id: B }, { id: C }] });
    const back = capture(quoteDoc, (tr) => tr.setBlockType(1, 1, schema.nodes.paragraph!, { nodeId: A }));
    expect(replayer.toCanonical(replayer.apply(quoteDoc, event(back.steps)))).toEqual(replayer.toCanonical(doc));
    const stolen = structuredClone(asQuote.steps[0]) as { slice: { content: { attrs: Record<string, unknown> }[] } };
    stolen.slice.content[0]!.attrs.nodeId = B;
    refused(itemDoc, [stolen]).toThrow("replace_around_identity");
    refused(quoteDoc, asQuote.steps).toThrow("replace_around_unchanged");
    const withLevel = structuredClone(asQuote.steps[0]) as { slice: { content: { attrs: Record<string, unknown> }[] } };
    withLevel.slice.content[0]!.attrs.level = 1;
    refused(itemDoc, [withLevel]).toThrow("unknown_field");
  });

  it("the removed hash across a quote's boundary tells a quote from an item", () => {
    const { steps, after } = capture(quoteDoc, (tr) => tr.delete(10, 22));
    expect(replayer.apply(quoteDoc, event(steps)).toJSON()).toEqual(after.toJSON());
    const asItemRange = { ...(steps[0] as object), removedSha256: removedRangeSha256(itemDoc, 10, 22) };
    expect(asItemRange.removedSha256).not.toBe((steps[0] as { removedSha256: string }).removedSha256);
    refused(quoteDoc, [asItemRange]).toThrow("removed_range_hash");
  });
});

describe("edit steps v1 replayer inside replayEvidenceSegmentsV2", () => {
  async function segment(events: { steps: unknown[] }[], initial: JcsJsonValue): Promise<EvidenceSegmentV2> {
    let document = replayer.load(initial);
    const initialHash = (await digestCanonicalDocumentV2(replayer.toCanonical(document))).sha256;
    let before = initialHash;
    const built: EvidenceEventV2[] = [];
    for (const [i, { steps }] of events.entries()) {
      document = replayer.apply(document, event(steps));
      const after = (await digestCanonicalDocumentV2(replayer.toCanonical(document))).sha256;
      built.push({ ...event(steps, i + 1), beforeDocumentHash: before, afterDocumentHash: after });
      before = after;
    }
    return {
      initialDocumentHash: initialHash,
      finalDocumentHash: before,
      events: built,
      captureContext: { editorModel: "prosemirror", transactionFormat: "ductus-edit-steps-v1" },
    } as EvidenceSegmentV2;
  }

  it("matches the document capture produced, and fails closed on a forged removed hash", async () => {
    const doc = replayer.load(start);
    const del = capture(doc, (tr) => tr.delete(19, 28));
    const typed = capture(del.after, (tr) => tr.insert(19, schema.text("Odlomak D")));
    const good = await segment([{ steps: del.steps }, { steps: typed.steps }], start);
    const result = await replayEvidenceSegmentsV2(start, [good], replayer);
    expect(result).toMatchObject({ ok: true, documentSha256: good.finalDocumentHash });

    const forged = structuredClone(good);
    (forged.events[0].steps[0] as Record<string, JcsJsonValue>).removedSha256 = OTHER_HASH;
    expect(await replayEvidenceSegmentsV2(start, [forged], replayer)).toEqual({
      ok: false, reason: "step_failed", segmentIndex: 0, sequence: 1,
    });
  });

  it("reports a refused step as step_failed, not as a thrown error", async () => {
    const good = await segment([], start);
    const attrOnText = { ...good, events: [{ ...event([{ stepType: "attr", pos: 3, attr: "nodeId", value: B }]),
      beforeDocumentHash: good.initialDocumentHash }] };
    expect(await replayEvidenceSegmentsV2(start, [attrOnText], replayer)).toMatchObject({ ok: false, reason: "step_failed" });
  });
});

describe("edit steps v1 replayer: content of a later format (F-150, BACKEND 4.1)", () => {
  const doc = replayer.load(start);
  // The first block becomes a bullet item (E1); its type is then renamed.
  const asItem = capture(doc, (tr) => tr.setBlockType(1, 1, schema.nodes.bulletItem!, { nodeId: A }));
  const typed = (type: unknown) => {
    const steps = structuredClone(asItem.steps) as { slice: { content: Record<string, unknown>[] } }[];
    steps[0]!.slice.content[0]!.type = type;
    return steps;
  };
  async function replayed(steps: unknown[]) {
    const segment = {
      initialDocumentHash: (await digestCanonicalDocumentV2(replayer.toCanonical(doc))).sha256,
      finalDocumentHash: OTHER_HASH,
      events: [{ ...event(steps), beforeDocumentHash: OTHER_HASH }],
      captureContext: { editorModel: "prosemirror", transactionFormat: "ductus-edit-steps-v1" },
    } as EvidenceSegmentV2;
    return replayEvidenceSegmentsV2(start, [segment], replayer);
  }

  it("pins the dated v1 node set of BACKEND 4.1: a new type is added there in the same change", () => {
    expect([...PLAIN_BLOCK_TYPES]).toEqual(["paragraph", "bulletItem", "quote"]);
    expect([...MARK_ORDER]).toEqual(["bold", "italic"]);
  });

  it("reports a block type it does not know as unsupported_format, not as step_failed", async () => {
    expect(() => replayer.apply(doc, event(typed("orderedItem")))).toThrow(EvidenceContentNotSupportedV2);
    expect(await replayed(typed("orderedItem"))).toEqual({ ok: false, reason: "unsupported_format", segmentIndex: 0, sequence: 1 });
    // A name the prototype of a plain object has is still a name it does not know.
    expect(await replayed(typed("constructor"))).toMatchObject({ ok: false, reason: "unsupported_format" });
  });

  it("reports a mark type it does not know as unsupported_format", async () => {
    const bold = capture(doc, (tr) => tr.insert(3, schema.text("x", [schema.marks.bold!.create()])));
    const steps = JSON.parse(JSON.stringify(bold.steps).replaceAll('"bold"', '"underline"')) as unknown[];
    expect(await replayed(steps)).toMatchObject({ ok: false, reason: "unsupported_format" });
  });

  it.each([
    ["a known type in the wrong place", "text"],
    ["a type that is not a string", 7],
    // #863 QA Q3: no later version names a type like these.
    ["an empty type name", ""],
    ["a type name that is not an identifier", " paragraph"],
  ])("keeps %s a refused step", async (_name, type) => {
    expect(await replayed(typed(type))).toMatchObject({ ok: false, reason: "step_failed" });
  });

  // #863 QA Q1: a later inline node fails on its keys before its type.
  const inserted = capture(doc, (tr) => tr.insert(3, schema.text("xy")));
  const withSlice = (content: unknown[]) => {
    const steps = structuredClone(inserted.steps) as { slice: { content: unknown[] } }[];
    steps[0]!.slice.content = content;
    return steps;
  };

  it.each([
    ["after text, with attrs", [{ type: "text", text: "xy" }, { type: "footnoteRef", attrs: { id: "x" } }]],
    ["alone, without text", [{ type: "hardBreak" }]],
  ])("reports an inline node of a later format %s as unsupported_format", async (_name, content) => {
    expect(await replayed(withSlice(content))).toMatchObject({ ok: false, reason: "unsupported_format" });
  });

  it("reports a later mark with attributes as unsupported_format", async () => {
    const marked = capture(doc, (tr) => tr.addMark(1, 3, schema.marks.bold!.create()));
    const steps = structuredClone(marked.steps) as { mark: unknown }[];
    steps[0]!.mark = { type: "link", attrs: { href: "https://example.org" } };
    expect(await replayed(steps)).toMatchObject({ ok: false, reason: "unsupported_format" });
  });

  it("gives the same reason whichever step the parser refuses first (#863 QA Q2)", async () => {
    const later = typed("orderedItem")[0]!;
    const broken = { stepType: "replace", from: -1 };
    expect(await replayed([later, broken])).toMatchObject({ ok: false, reason: "unsupported_format" });
    expect(await replayed([broken, later])).toMatchObject({ ok: false, reason: "unsupported_format" });
  });

  it("keeps an unknown attribute of a known block a refused step, whatever it holds", async () => {
    const steps = typed("bulletItem") as unknown as { slice: { content: { attrs: Record<string, unknown> }[] } }[];
    steps[0]!.slice.content[0]!.attrs.type = "footnote";
    expect(await replayed(steps)).toMatchObject({ ok: false, reason: "step_failed" });
  });
});
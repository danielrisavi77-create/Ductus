// @vitest-environment node
import { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import type { Step } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";

import { createEditStepsV1Replayer, removedRangeSha256 } from "@/adapters/evidence/edit-steps-v1-replayer";
import { verifyDocumentSnapshot } from "@/domain/document/snapshot";
import { verifyCanonicalEvidencePayloadV2 } from "@/domain/forensics/evidence-chain-v2";
import { replayEvidenceSegmentsV2 } from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceSourceV2 } from "@/domain/forensics/evidence-segment-v2";
import type { JcsJsonValue } from "@/domain/forensics/jcs";

import {
  CaptureError, changeOf, EvidenceRecorder, MAX_SEGMENT_SPAN_MS, removedSliceSha256, type SegmentContext,
} from "./capture";
import { tiptapToCanonical } from "./interop";
import { createEditorExtensions } from "./schema";

/**
 * F-8 step 3d-1 (DAN-37, contract #178 issuecomment-6265571198): segments
 * captured from the real editor schema replay on the server's replayer to the
 * same document. Synthetic text and ids only.
 */

const ID_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T0 = Date.parse("2026-10-19T09:00:00.000Z");
const CONTEXT: SegmentContext = {
  documentId: "dokument-izmisljeni",
  sessionId: "11111111-1111-4111-8111-111111111111",
  segmentId: "22222222-2222-4222-8222-222222222222",
  evidenceProfileId: "profil-izmisljeni",
  sequenceFrom: 1,
  predecessorSegmentHash: null,
};

/** An editor whose every change is recorded with the source and time the test sets. */
function setup(text = "Odlomak B") {
  const editor = new Editor({
    element: null,
    extensions: createEditorExtensions(),
    content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: ID_A }, content: [{ type: "text", text }] }] },
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  const recorder = new EvidenceRecorder();
  const initial = canonical(editor);
  let source: EvidenceSourceV2 = "editor";
  let at = T0 + 5_000;
  editor.on("transaction", ({ transaction, appendedTransactions }) => {
    const all: Transaction[] = [transaction, ...appendedTransactions];
    if (all.some((tr) => tr.docChanged)) recorder.record(changeOf(all, source, at));
  });
  return {
    editor, recorder, initial,
    as(next: EvidenceSourceV2, wait = 50) {
      source = next;
      at += wait;
    },
    type(chars: string, wait = 50) {
      for (const char of chars) {
        at += wait;
        editor.view.dispatch(editor.state.tr.insertText(char));
      }
    },
  };
}

function canonical(editor: Editor): JcsJsonValue {
  const candidate = tiptapToCanonical(editor.getJSON());
  if (!candidate.ok) throw new Error("test document is not canonical");
  return candidate.doc as unknown as JcsJsonValue;
}

async function replays(initial: JcsJsonValue, built: { bytes: Uint8Array; document: Uint8Array }) {
  const payload = await verifyCanonicalEvidencePayloadV2(built.bytes);
  expect(payload.ok).toBe(true);
  if (!payload.ok) return;
  const replay = await replayEvidenceSegmentsV2(initial, [payload.segment], createEditStepsV1Replayer());
  const snapshot = await verifyDocumentSnapshot(built.document);
  expect(replay).toMatchObject({ ok: true });
  expect(snapshot).toMatchObject({ ok: true });
  if (replay.ok && snapshot.ok) {
    expect(replay.documentSha256).toBe(payload.segment.finalDocumentHash);
    expect(snapshot.sha256).toBe(payload.segment.finalDocumentHash);
  }
}

describe("F-8 3d-1: removedSha256", () => {
  it("matches the known answer of BACKEND 4.1", async () => {
    const { editor } = setup("Odlomak B");
    expect(await removedSliceSha256(editor.state.doc, 1, 10)).toBe(
      "90d4f8aa06a3d89df35caec6d423df7e3f221ba5d01e33ffc23ecaa232c815bf",
    );
  });

  it("is the replayer's hash across a block boundary", async () => {
    const { editor } = setup("Prvi");
    editor.commands.setTextSelection(5);
    editor.commands.splitBlock();
    editor.view.dispatch(editor.state.tr.insertText("Drugi"));
    const doc = editor.state.doc;
    expect(await removedSliceSha256(doc, 3, doc.content.size - 2)).toBe(removedRangeSha256(doc, 3, doc.content.size - 2));
  });
});

describe("F-8 3d-1: a captured segment replays on the server's replayer", () => {
  it("typing, Enter, deleting, joining, bold and a heading", async () => {
    const t = setup("Odlomak B");
    t.editor.commands.setTextSelection(10);
    t.type(" i jos");
    t.editor.commands.splitBlock();
    t.type("Novi");
    t.editor.view.dispatch(t.editor.state.tr.delete(t.editor.state.selection.from - 2, t.editor.state.selection.from));
    t.as("editor", 500);
    t.editor.chain().setTextSelection({ from: 1, to: 8 }).toggleBold().run();
    t.editor.chain().setTextSelection(1).setHeading({ level: 2 }).run();
    t.as("paste", 500);
    t.editor.commands.setTextSelection(t.editor.state.doc.content.size - 1);
    t.editor.view.dispatch(t.editor.state.tr.insertText("zalijepljeno"));
    t.editor.chain().setTextSelection(t.editor.state.doc.content.size - 1).splitBlock().joinBackward().run();
    t.recorder.close();
    const built = await t.recorder.takeSegment(CONTEXT);
    expect(built).not.toBeNull();
    await replays(t.initial, built!);
    expect(built!.segment.events.map((e) => e.source)).toEqual(["editor", "editor", "paste"]);
  });

  it("a block made by Enter gets its id through an attr step of the same change", async () => {
    const t = setup("Jedan");
    t.editor.commands.setTextSelection(6);
    t.editor.commands.splitBlock();
    t.recorder.close();
    const built = (await t.recorder.takeSegment(CONTEXT))!;
    const steps = built.segment.events[0]!.steps.map((s) => s.stepType);
    expect(steps).toContain("attr");
    await replays(t.initial, built);
  });

  // Inside a block, Tiptap copies the id onto the new block, so ProseMirror
  // writes the split with the id twice; the format takes it with `null` on
  // the new block and the `attr` step that follows (edit-step.test.ts).
  it("Enter in the middle of a block replays, and the recorder keeps going", async () => {
    const t = setup("Izmisljeni tekst");
    t.editor.commands.setTextSelection(5);
    t.editor.commands.splitBlock();
    t.type("x");
    t.recorder.close();
    const built = (await t.recorder.takeSegment(CONTEXT))!;
    await replays(t.initial, built);
    expect(t.recorder.intact).toBe(true);
    const ids = t.editor.state.doc.content.content.map((block) => block.attrs.nodeId as string);
    expect(new Set(ids).size).toBe(2);
  });

  // A range that removes only the boundary of two blocks removes no content:
  // BACKEND 4.1 writes it with `structure` and without `removedSha256`.
  it.each([
    ["Backspace", (editor: Editor) => editor.commands.deleteSelection()],
    ["typing", (editor: Editor) => editor.view.dispatch(editor.state.tr.insertText("x"))],
  ])("a selection of exactly the boundary of two blocks, then %s, replays", async (_name, edit) => {
    const t = setup("Prvi odlomak");
    t.editor.commands.setTextSelection(13);
    t.editor.commands.splitBlock();
    t.type("Drugi red");
    t.editor.commands.setTextSelection({ from: 13, to: 15 });
    edit(t.editor);
    t.type("y");
    t.recorder.close();
    expect(t.editor.state.doc.childCount).toBe(1);
    await replays(t.initial, (await t.recorder.takeSegment(CONTEXT))!);
    expect(t.recorder.intact).toBe(true);
  });

  // Undo gives the identity plugin's step back with the id the block had; the
  // block it names is removed by the next step of the same change, so it has
  // no effect there and the format, whose `attr` only names a block without
  // an id, does not write it.
  it.each([["in the middle of", 5], ["at the end of", 10]])(
    "Undo after Enter %s a block replays, and the recorder keeps going",
    async (_name, at) => {
      const t = setup("Odlomak B");
      t.editor.commands.setTextSelection(at);
      t.editor.commands.splitBlock();
      t.as("editor", 1_000);
      t.editor.commands.undo();
      t.type("z");
      t.recorder.close();
      expect(t.editor.state.doc.childCount).toBe(1);
      await replays(t.initial, (await t.recorder.takeSegment(CONTEXT))!);
      expect(t.recorder.intact).toBe(true);
    },
  );

  // At the start of a block the identity plugin names the empty block in
  // front and the text keeps its id; an `attr` step only names a block
  // without one, so the format cannot write it. Refused here, never sent as a
  // segment the server would refuse (open: QA 494 finding 1).
  it("Enter at the start of a block is refused before it is built into a segment", async () => {
    const t = setup("Izmisljeni tekst");
    t.editor.commands.setTextSelection(1);
    t.editor.commands.splitBlock();
    t.recorder.close();
    await expect(t.recorder.takeSegment(CONTEXT)).rejects.toMatchObject({ code: "unsupported_step" });
    expect(t.recorder.intact).toBe(false);
  });

  // A step that changes nothing is refused by the replayer
  // (`step_changes_nothing`), so it is not written (review and QA 494, round 3).
  const pasteSame = (editor: Editor) =>
    editor.view.dispatch(editor.state.tr.replaceSelection(editor.state.selection.content()).setMeta("uiEvent", "paste"));
  it.each([
    ["pasting a selection over itself", 1, 8, pasteSame],
    ["typing the selected character over itself", 9, 10, (editor: Editor) => editor.view.dispatch(editor.state.tr.insertText("B"))],
  ])("%s replays, and the recorder keeps going", async (_name, from, to, edit) => {
    const t = setup("Odlomak B");
    t.editor.commands.setTextSelection({ from, to });
    edit(t.editor);
    t.as("editor", 1_000);
    edit(t.editor);
    t.type("y");
    t.recorder.close();
    await replays(t.initial, (await t.recorder.takeSegment(CONTEXT))!);
    expect(t.recorder.intact).toBe(true);
  });

  it("a step that changes nothing beside one that does in the same change replays", async () => {
    const t = setup("Odlomak B");
    t.editor.commands.setTextSelection({ from: 1, to: 8 });
    const tr = t.editor.state.tr.replaceSelection(t.editor.state.selection.content());
    t.editor.view.dispatch(tr.insertText("z", tr.doc.content.size - 1));
    t.recorder.close();
    const built = (await t.recorder.takeSegment(CONTEXT))!;
    expect(built.segment.events[0]!.steps).toHaveLength(1);
    await replays(t.initial, built);
  });

  // Tiptap's setNode on a block of the same type gives two steps that each
  // change the document and together leave it as it was (QA 494f VAŽNO 1).
  it.each([
    ["setParagraph on a paragraph", (editor: Editor) => editor.chain().focus().setParagraph().run(), () => {}],
    [
      "setHeading on a heading of the same level",
      (editor: Editor) => editor.chain().focus().setHeading({ level: 2 }).run(),
      (editor: Editor) => editor.chain().focus().setHeading({ level: 2 }).run(),
    ],
  ])("%s makes no step, and the segment replays", async (_name, edit, prepare) => {
    const t = setup("Prvi odlomak");
    t.editor.commands.setTextSelection(3);
    prepare(t.editor);
    t.recorder.close();
    await t.recorder.takeSegment(CONTEXT);
    const initial = canonical(t.editor);
    t.as("editor", 1_000);
    edit(t.editor);
    t.as("editor", 1_000);
    t.type("y");
    t.recorder.close();
    const built = (await t.recorder.takeSegment(CONTEXT))!;
    expect(built.segment.events.flatMap((event) => event.steps)).toHaveLength(1);
    await replays(initial, built);
    expect(t.recorder.intact).toBe(true);
  });

  it("a change whose every step changes nothing makes no event", async () => {
    const t = setup("Odlomak B");
    t.editor.commands.setTextSelection({ from: 1, to: 8 });
    pasteSame(t.editor);
    t.recorder.close();
    expect(await t.recorder.takeSegment(CONTEXT)).toBeNull();
    expect(t.recorder.intact).toBe(true);
  });
});

describe("F-8 3d-1: events, segments and time", () => {
  it("a pause over 400 ms or another source closes an event; the chain holds", async () => {
    const t = setup();
    t.editor.commands.setTextSelection(10);
    t.type("ab");
    t.type("c", 401);
    t.as("keyless-input", 10);
    t.type("d", 10);
    t.recorder.close();
    const { segment } = (await t.recorder.takeSegment(CONTEXT))!;
    expect(segment.events.map((e) => [e.sequence, e.source, e.steps.length])).toEqual([
      [1, "editor", 2], [2, "editor", 1], [3, "keyless-input", 1],
    ]);
    segment.events.slice(1).forEach((e, i) => expect(e.beforeDocumentHash).toBe(segment.events[i]!.afterDocumentHash));
    expect([segment.sequenceFrom, segment.sequenceTo]).toEqual([1, 3]);
  });

  it("keeps the time of every step apart, never in the segment", async () => {
    const t = setup();
    t.editor.commands.setTextSelection(10);
    t.type("abc", 37);
    t.recorder.close();
    const built = (await t.recorder.takeSegment(CONTEXT))!;
    expect(built.timing.segmentHash).toBe(built.sha256);
    expect(built.timing.events).toEqual([{ sequence: 1, stepOffsetsMs: [5_037, 5_074, 5_111] }]);
    expect([built.segment.observedStartedAt, built.segment.observedEndedAt]).toEqual([
      "2026-10-19T09:00:00.000Z", "2026-10-19T09:00:00.000Z",
    ]);
    expect(new TextDecoder().decode(built.bytes)).not.toMatch(/5037|Ms"|elapsed/);
  });

  it("leaves events past the 30 s span for the next segment, which continues the chain", async () => {
    const t = setup();
    t.editor.commands.setTextSelection(10);
    t.type("a");
    t.type("b", MAX_SEGMENT_SPAN_MS);
    t.recorder.close();
    const first = (await t.recorder.takeSegment(CONTEXT))!;
    expect(first.eventCount).toBe(1);
    const second = (await t.recorder.takeSegment({ ...CONTEXT, sequenceFrom: 2, predecessorSegmentHash: first.sha256 }))!;
    expect(second.segment.initialDocumentHash).toBe(first.segment.finalDocumentHash);
    expect(second.segment.sequenceFrom).toBe(2);
    expect(await t.recorder.takeSegment(CONTEXT)).toBeNull();
  });

  /** Every segment the recorder gives, each continuing the chain of the one before. */
  async function drain(recorder: EvidenceRecorder) {
    const segments = [];
    let context = CONTEXT;
    for (let built = await recorder.takeSegment(context); built; built = await recorder.takeSegment(context)) {
      segments.push(built);
      context = { ...CONTEXT, sequenceFrom: built.segment.sequenceTo + 1, predecessorSegmentHash: built.sha256 };
    }
    return segments;
  }

  /** From the first change of a segment to its last, from the separate timing record. */
  const spanMs = (built: { timing: { events: { stepOffsetsMs: number[] }[] } }) => {
    const offsets = built.timing.events.flatMap((e) => e.stepOffsetsMs);
    return Math.max(...offsets) - Math.min(...offsets);
  };

  it("never spans 30 s, even when typing never pauses (D-24): 1800 characters every 100 ms", async () => {
    const t = setup();
    t.editor.commands.setTextSelection(10);
    t.type("x".repeat(1_800), 100);
    t.recorder.close();
    const segments = await drain(t.recorder);
    expect(segments.length).toBeGreaterThanOrEqual(6);
    for (const built of segments) expect(spanMs(built)).toBeLessThan(MAX_SEGMENT_SPAN_MS);
    expect(segments.flatMap((b) => b.timing.events.flatMap((e) => e.stepOffsetsMs)).length).toBe(1_800);
    const payloads = await Promise.all(segments.map((b) => verifyCanonicalEvidencePayloadV2(b.bytes)));
    const chain = payloads.map((p) => (p.ok ? p.segment : null));
    expect(chain.every((segment) => segment !== null)).toBe(true);
    const replay = await replayEvidenceSegmentsV2(t.initial, chain.map((s) => s!), createEditStepsV1Replayer());
    expect(replay).toMatchObject({ ok: true, documentSha256: segments.at(-1)!.segment.finalDocumentHash });
  }, 60_000);

  it("an event that starts inside the span but lasts past it goes to the next segment", async () => {
    const t = setup();
    t.editor.commands.setTextSelection(10);
    t.type("a");
    t.type("b", 29_000);
    t.type("c".repeat(200), 100);
    t.recorder.close();
    const segments = await drain(t.recorder);
    expect(segments.map((b) => b.eventCount)).toEqual([1, 1]);
    for (const built of segments) expect(spanMs(built)).toBeLessThan(MAX_SEGMENT_SPAN_MS);
  });

  it("a segment that cannot be built stops the recorder, which says so and keeps nothing", async () => {
    const t = setup();
    const unsupported = { toJSON: () => { throw new Error("no JSON form"); } } as unknown as Step;
    const doc = t.editor.state.doc;
    // A change that changes the document: one that does not is ignored.
    const after = t.editor.state.tr.insertText("q").doc;
    t.recorder.record({ steps: [unsupported], docs: [doc], after, source: "editor", at: T0 });
    t.recorder.close();
    await expect(t.recorder.takeSegment(CONTEXT)).rejects.toMatchObject({ code: "unsupported_step" });
    expect(t.recorder.intact).toBe(false);
    expect(t.recorder.pendingEvents).toBe(0);
    expect(() => t.type("a")).toThrow(CaptureError);
    await expect(t.recorder.takeSegment(CONTEXT)).rejects.toMatchObject({ code: "unsupported_step" });
  });

  it("one event over the limit of a step or segment is too_large, and stops the recorder", async () => {
    const t = setup();
    t.editor.commands.setTextSelection(10);
    t.as("paste");
    t.editor.view.dispatch(t.editor.state.tr.insertText("z".repeat(2_200_000)));
    t.recorder.close();
    await expect(t.recorder.takeSegment(CONTEXT)).rejects.toMatchObject({ code: "too_large" });
    expect(t.recorder.intact).toBe(false);
  });

  it("a change that does not start where the last one ended is a gap, and nothing more is recorded", () => {
    const t = setup();
    t.type("a");
    const other = setup("Drugi");
    const foreign = changeOf([other.editor.state.tr.insertText("x")], "editor", T0);
    expect(() => t.recorder.record(foreign)).toThrow(CaptureError);
    expect(t.recorder.intact).toBe(false);
    expect(() => t.type("b")).toThrow(CaptureError);
  });

  it("an open event is not built until it is closed", async () => {
    const t = setup();
    t.type("a");
    expect(await t.recorder.takeSegment(CONTEXT)).toBeNull();
  });
});


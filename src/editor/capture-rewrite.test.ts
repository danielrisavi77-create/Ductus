// @vitest-environment node
import { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, Slice, type Node as PmNode } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { createEditStepsV1Replayer, removedRangeSha256 } from "@/adapters/evidence/edit-steps-v1-replayer";
import { verifyCanonicalEvidencePayloadV2 } from "@/domain/forensics/evidence-chain-v2";
import { replayEvidenceSegmentsV2 } from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceSegment, EvidenceSourceV2 } from "@/domain/forensics/evidence-segment-v2";
import type { JcsJsonValue } from "@/domain/forensics/jcs";

import { changeOf, EvidenceRecorder, type BuiltSegment, type SegmentContext } from "./capture";
import { tiptapToCanonical } from "./interop";
import { createEditorExtensions } from "./schema";

/**
 * F-8 step 3d-1b (DAN-282, contract #476 issuecomment-6383232090), QA t. 1:
 * plain edits that the identity plugin and ProseMirror name differently
 * replay on the server's replayer (#391) and leave the recorder running.
 * Every scenario runs on the real editor with Tiptap's own shortcuts (Enter,
 * Backspace, Ctrl+A, Ctrl+Z, Ctrl+Shift+Z) and the toolbar's commands.
 * Synthetic text and ids only.
 */

const IDS = ["a", "b", "c", "d"].map((x) => `${x.repeat(8)}-0000-4000-8000-${x.repeat(12)}`);
const T0 = Date.parse("2026-10-24T09:00:00.000Z");
const BASE: SegmentContext = {
  documentId: "dokument-izmisljeni",
  sessionId: "11111111-1111-4111-8111-111111111111",
  segmentId: "22222222-2222-4222-8222-222222222222",
  evidenceProfileId: "profil-izmisljeni",
  sequenceFrom: 1,
  predecessorSegmentHash: null,
};

type Kind = "p" | "h1" | "h2" | "h3";
const TEXTS = ["Prvi odlomak", "Drugi red", "Treci dio", "Cetvrti"];

function block(kind: Kind, i: number) {
  const attrs = kind === "p" ? { nodeId: IDS[i] } : { nodeId: IDS[i], level: Number(kind[1]) };
  return { type: kind === "p" ? "paragraph" : "heading", attrs, content: [{ type: "text", text: TEXTS[i] }] };
}

function canonical(editor: Editor): JcsJsonValue {
  const candidate = tiptapToCanonical(editor.getJSON());
  if (!candidate.ok) throw new Error("test document is not canonical");
  return candidate.doc as unknown as JcsJsonValue;
}

/** A key as the browser gives it, through the editor's own keymaps. */
function keyEvent(key: string, mods: { ctrl?: boolean; shift?: boolean } = {}) {
  const code = key.length === 1 ? key.toUpperCase().charCodeAt(0) : { Enter: 13, Backspace: 8 }[key]!;
  return {
    key: mods.shift && key.length === 1 ? key.toUpperCase() : key, keyCode: code, which: code,
    ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: false, metaKey: false,
    preventDefault() {}, stopPropagation() {},
  } as unknown as KeyboardEvent;
}

/** An editor with the given blocks whose every change goes to a recorder, and the chain of segments taken so far. */
function setup(kinds: Kind[]) {
  const editor = new Editor({
    element: null,
    extensions: createEditorExtensions(),
    content: { type: "doc", content: kinds.map((kind, i) => block(kind, i)) },
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  const recorder = new EvidenceRecorder();
  const initial = canonical(editor);
  const segments: EvidenceSegment[] = [];
  const built: BuiltSegment[] = [];
  let context = BASE;
  let source: EvidenceSourceV2 = "editor";
  let at = T0 + 1_000;
  editor.on("transaction", ({ transaction, appendedTransactions }) => {
    const all: Transaction[] = [transaction, ...appendedTransactions];
    if (all.some((tr) => tr.docChanged)) recorder.record(changeOf(all, source, at));
  });
  const t = {
    editor, recorder, built,
    get doc(): PmNode {
      return editor.state.doc;
    },
    /** Start of the text of block `i`. */
    start(i: number) {
      let pos = 0;
      for (let k = 0; k < i; k += 1) pos += editor.state.doc.child(k).nodeSize;
      return pos + 1;
    },
    ids: () => editor.state.doc.content.content.map((node) => node.attrs.nodeId as string),
    /** A pause the history and the recorder both see as one. */
    pause(ms = 1_000, next: EvidenceSourceV2 = "editor") {
      at += ms;
      source = next;
      editor.view.dispatch(closeHistory(editor.state.tr));
    },
    select(from: number, to = from) {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
    },
    press(key: string, mods?: { ctrl?: boolean; shift?: boolean }) {
      at += 50;
      // The editor is not mounted here, so its plugins' key handlers are asked in turn, as the view would.
      const event = keyEvent(key, mods);
      const handled = editor.state.plugins.some((plugin) => plugin.props.handleKeyDown?.call(plugin, editor.view, event));
      expect(handled, key).toBe(true);
    },
    type(text: string) {
      for (const char of text) {
        at += 50;
        editor.view.dispatch(editor.state.tr.insertText(char));
      }
    },
    /** Plain text from the clipboard, through the editor's own paste hook. */
    paste(text: string) {
      t.pause(500, "paste");
      let slice = new Slice(Fragment.from(editor.schema.text(text)), 0, 0);
      for (const plugin of editor.state.plugins) {
        slice = plugin.props.transformPasted?.call(plugin, slice, editor.view, true) ?? slice;
      }
      editor.view.dispatch(editor.state.tr.replaceSelection(slice).setMeta("uiEvent", "paste"));
      t.pause(500);
    },
    undo: () => (t.pause(), t.press("z", { ctrl: true })),
    redo: () => (t.pause(), t.press("z", { ctrl: true, shift: true })),
    /**
     * QA oracle: every segment taken so far passes the payload check and the
     * chain replays (#391) to the editor's document, whose hash is the last
     * `finalDocumentHash`; the recorder never stopped.
     */
    async replays() {
      recorder.close();
      for (let next = await recorder.takeSegment(context); next; next = await recorder.takeSegment(context)) {
        const payload = await verifyCanonicalEvidencePayloadV2(next.bytes);
        expect(payload.ok).toBe(true);
        if (!payload.ok) return;
        segments.push(payload.segment);
        built.push(next);
        context = { ...BASE, sequenceFrom: next.segment.sequenceTo + 1, predecessorSegmentHash: next.sha256 };
      }
      expect(recorder.intact).toBe(true);
      // Nothing changed (a block given the kind it has): nothing to replay.
      if (segments.length === 0) return expect(canonical(editor)).toEqual(initial);
      const replay = await replayEvidenceSegmentsV2(initial, segments, createEditStepsV1Replayer());
      expect(replay).toMatchObject({ ok: true, documentSha256: segments.at(-1)!.finalDocumentHash });
      const replayer = createEditStepsV1Replayer();
      const rebuilt = segments.flatMap((s) => s.events).reduce((doc, event) => replayer.apply(doc, event), replayer.load(initial));
      expect(replayer.toCanonical(rebuilt)).toEqual(canonical(editor));
    },
  };
  return t;
}

type T = ReturnType<typeof setup>;

/** Every scenario of QA t. 1.1 to 1.4: the blocks it starts from and what it does. */
const SCENARIOS: [string, Kind[], (t: T) => void][] = [
  ["1.1 Enter at the start of a paragraph with text", ["p", "p"], (t) => (t.select(t.start(1)), t.press("Enter"))],
  ["1.1 Enter at the start of a heading", ["p", "h2"], (t) => (t.select(t.start(1)), t.press("Enter"))],
  ["1.1 Enter at the start of the first block", ["p", "p"], (t) => (t.select(1), t.press("Enter"))],
  ["1.1 Enter at the start of a first block that is a heading", ["h1", "p"], (t) => (t.select(1), t.press("Enter"))],
  ["1.2 Ctrl+A, then Backspace", ["p", "p", "p"], (t) => (t.press("a", { ctrl: true }), t.press("Backspace"))],
  ["1.2 Ctrl+A, Backspace, then typing", ["p", "p"], (t) => (t.press("a", { ctrl: true }), t.press("Backspace"), t.type("Novo"))],
  ["1.2 Ctrl+A, then typing", ["p", "p"], (t) => (t.press("a", { ctrl: true }), t.type("Novo"))],
  ["1.2 Ctrl+A, then pasting", ["p", "p"], (t) => (t.press("a", { ctrl: true }), t.paste("Zalijepljeno"))],
  ["1.2 Ctrl+A, then Backspace, first block a heading", ["h2", "p"], (t) => (t.press("a", { ctrl: true }), t.press("Backspace"), t.type("x"))],
  ["1.2 Ctrl+A, then typing, first block a heading", ["h1", "p"], (t) => (t.press("a", { ctrl: true }), t.type("Novo"))],
  ["1.2 Ctrl+A, then pasting, first block a heading", ["h3", "p"], (t) => (t.press("a", { ctrl: true }), t.paste("Zalijepljeno"))],
  // All the text selected, not the document: Tiptap's clearDocument makes the heading a paragraph.
  ["1.2 all text selected, then Backspace, first block a heading", ["h2", "p"], (t) => (t.select(1, t.doc.content.size - 1), t.press("Backspace"), t.type("x"))],
  ["1.2 all text selected, then Backspace", ["p", "p"], (t) => (t.select(1, t.doc.content.size - 1), t.press("Backspace"))],
  ["1.4 typing over a selection from the start of a block to the middle of the next", ["p", "p"], (t) => (t.select(1, t.start(1) + 3), t.type("x"))],
  ["1.4 pasting over a selection from the start of a block to the middle of the next", ["p", "p"], (t) => (t.select(1, t.start(1) + 3), t.paste("Zalijepljeno"))],
  ["1.4 typing over the whole first block and part of the second", ["p", "p", "p"], (t) => (t.select(t.start(1), t.start(2) + 2), t.type("y"))],
  ["1.4 pasting over the whole first block and part of the second", ["p", "p"], (t) => (t.select(1, t.start(1) + 1), t.paste("Z"))],
  ["1.4 Backspace over a selection from the start of a block into the next but one", ["p", "p", "p"], (t) => (t.select(1, t.start(2) + 4), t.press("Backspace"))],
];

const toolbar: Record<Kind, (editor: Editor) => void> = {
  p: (editor) => editor.chain().focus().setParagraph().run(),
  h1: (editor) => editor.chain().focus().setHeading({ level: 1 }).run(),
  h2: (editor) => editor.chain().focus().setHeading({ level: 2 }).run(),
  h3: (editor) => editor.chain().focus().setHeading({ level: 3 }).run(),
};

/** QA t. 1.3: "¶" and "N1–N3" over two and three blocks, all of one kind, all of another and mixed. */
const BLOCK_SETS: Kind[][] = [["p", "p"], ["p", "p", "p"], ["h2", "h2"], ["h1", "h1", "h1"], ["p", "h2"], ["h2", "p"], ["h3", "h2"], ["p", "h3", "h1"]];
for (const kinds of BLOCK_SETS) {
  for (const target of ["p", "h1", "h2", "h3"] as Kind[]) {
    SCENARIOS.push([
      `1.3 ${target} over ${kinds.join("+")}, the selection starting and ending inside blocks`,
      kinds,
      (t) => {
        const ids = t.ids();
        t.select(t.start(0) + 2, t.start(kinds.length - 1) + 3);
        toolbar[target](t.editor);
        // Every block keeps its own id: none is taken from another (QA risk 2).
        expect(t.ids()).toEqual(ids);
      },
    ]);
  }
}

describe("F-8 3d-1b: plain edits replay on #391 and the recorder keeps going", () => {
  it.each(SCENARIOS)("%s", async (_name, kinds, edit) => {
    const t = setup(kinds);
    edit(t);
    t.pause();
    t.type("k");
    await t.replays();
  });

  // QA t. 1.5: Undo and Redo of every scenario of 1.1 to 1.4, each step drained on its own.
  it.each(SCENARIOS.filter(([name]) => !name.includes("all text selected")))("1.5 Undo, then Redo, of: %s", async (_name, kinds, edit) => {
    const t = setup(kinds);
    edit(t);
    await t.replays();
    t.undo();
    await t.replays();
    t.redo();
    await t.replays();
    t.undo();
    await t.replays();
  });

  // Beyond QA t. 1 (granica 2 of the contract): after all the text, not the
  // document, was selected and removed, Redo makes the identity plugin give
  // the empty block an id it held before, which no step of the format can
  // write. The recorder stops with unsupported_step; nothing it gave is refused.
  it.each([["p", "p"], ["h2", "p"]] as Kind[][])("Redo after removing all the selected text of %s stops, it is never refused", async (...kinds) => {
    const t = setup(kinds);
    t.select(1, t.doc.content.size - 1);
    t.press("Backspace");
    await t.replays();
    t.undo();
    await t.replays();
    t.redo();
    t.recorder.close();
    await expect(t.recorder.takeSegment(BASE)).rejects.toMatchObject({ code: "unsupported_step" });
    expect(t.recorder.intact).toBe(false);
  });

  it("1.5 Undo of deleting across the boundary of two blocks", async () => {
    const t = setup(["p", "h2", "p"]);
    t.select(t.start(0) + 3, t.start(1) + 4);
    t.press("Backspace");
    await t.replays();
    t.undo();
    await t.replays();
    expect(t.ids()).toEqual(IDS.slice(0, 3));
  });

  it.each([["in the middle of", 4], ["at the start of", 0], ["at the end of", 9]])(
    "1.5 Enter %s a block, Undo, Redo", async (_name, offset) => {
      const t = setup(["p", "p"]);
      t.select(t.start(1) + offset);
      t.press("Enter");
      t.undo();
      t.redo();
      t.pause();
      t.type("r");
      await t.replays();
      expect(t.doc.childCount).toBe(3);
    },
  );
});

describe("F-8 3d-1b: what the rewrites write", () => {
  // QA t. 1.1: the block with the text keeps its id and text; the empty one in front is new.
  it("Enter at the start of a block: a new empty block in front, and the text keeps its id", async () => {
    const t = setup(["p", "p"]);
    t.select(t.start(1));
    t.press("Enter");
    await t.replays();
    expect(t.ids()[0]).toBe(IDS[0]);
    expect(t.ids()[2]).toBe(IDS[1]);
    expect(t.doc.child(2).textContent).toBe(TEXTS[1]);
    const steps = t.built[0]!.segment.events.flatMap((event) => event.steps);
    expect(steps.map((step) => step.stepType)).toEqual(["replace", "attr"]);
    expect(steps[1]).toMatchObject({ pos: t.start(1) - 1, value: t.ids()[1] });
  });

  // QA risk 3: what is removed is exactly the selection, each hash the replayer's.
  it("a selection from the start of a block is removed as it is, end first, then the new text", async () => {
    const t = setup(["p", "p", "p"]);
    const before = t.doc;
    const [from, to, last] = [1, t.start(2) + 3, t.start(2)];
    t.select(from, to);
    t.type("x");
    await t.replays();
    const afterEnd = before.replace(last, to, Slice.empty);
    expect(t.built[0]!.segment.events[0]!.steps).toEqual([
      { stepType: "replace", from: last, to, removedSha256: removedRangeSha256(before, last, to) },
      { stepType: "replace", from: 0, to: last - 1, removedSha256: removedRangeSha256(afterEnd, 0, last - 1) },
      { stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: "x" }] } },
    ]);
    // Removed is exactly the selected text: the start of the last block, then the blocks before it.
    expect(before.textBetween(last, to) + afterEnd.textBetween(0, last - 1)).toBe(
      before.textBetween(last, to) + before.textBetween(from, last - 1),
    );
    expect(before.textBetween(from, to)).toBe(TEXTS[0]! + TEXTS[1]! + TEXTS[2]!.slice(0, 3));
    expect(t.ids()).toEqual([IDS[2]]);
    expect(t.doc.textContent).toBe(`x${TEXTS[2]!.slice(3)}`);
  });

  it("Ctrl+A, then typing: the new block goes in front, then the old ones are removed", async () => {
    const t = setup(["h2", "p"]);
    const size = t.doc.content.size;
    t.press("a", { ctrl: true });
    t.type("N");
    await t.replays();
    const steps = t.built[0]!.segment.events[0]!.steps;
    expect(steps.slice(0, 2)).toEqual([
      expect.objectContaining({ stepType: "replace", from: 0, to: 0 }),
      expect.objectContaining({ stepType: "replace", from: 3, to: 3 + size }),
    ]);
    expect(IDS).not.toContain(t.ids()[0]);
  });

  it("a type change over several blocks keeps every id in the wrapper and writes no attr", async () => {
    const t = setup(["p", "h3", "p"]);
    t.select(3, t.start(2) + 1);
    toolbar.h2(t.editor);
    await t.replays();
    const steps = t.built[0]!.segment.events[0]!.steps;
    expect(steps.map((step) => step.stepType)).toEqual(["replaceAround", "replaceAround", "replaceAround"]);
    expect(steps.map((step) => (step.slice as { content: unknown[] }).content[0])).toEqual(
      IDS.slice(0, 3).map((nodeId) => ({ type: "heading", attrs: { level: 2, nodeId } })),
    );
  });
});

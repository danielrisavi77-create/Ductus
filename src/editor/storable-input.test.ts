import { Editor } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep, StepMap, type Step } from "@tiptap/pm/transform";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CanonicalDocument, NodeId } from "../domain/document";

import { tiptapToCanonical, type TiptapDocumentJSON } from "./interop";
import { createEditorExtensions, NODE_ID_ATTRIBUTE } from "./schema";
import { RepairRuns, StorableInput } from "./storable-input";
import { storableDocument } from "./storable-text";

/**
 * Text the journal would store differently never stays in the editor
 * (#206 Codex r4240240763). Synthetic text only.
 */

const ID_A = "aaaaaaaa-0000-4000-8000-00000000000a" as NodeId;
const ID_B = "bbbbbbbb-0000-4000-8000-00000000000b" as NodeId;
const ID_C = "cccccccc-0000-4000-8000-00000000000c" as NodeId;
const ID_D = "dddddddd-0000-4000-8000-00000000000d" as NodeId;

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function editorWith(texts: string[]): Editor {
  const content: TiptapDocumentJSON = {
    type: "doc",
    content: [ID_A, ID_B, ID_C, ID_D].slice(0, texts.length).map((id, index) => ({
      type: "paragraph", attrs: { [NODE_ID_ATTRIBUTE]: id }, content: [{ type: "text", text: texts[index]! }],
    })),
  };
  const editor = new Editor({ element: null, extensions: [...createEditorExtensions(), StorableInput], content });
  // Tiptap attaches its plugins when it mounts; without a DOM they are attached here.
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  editors.push(editor);
  return editor;
}

function editorWithManyBlocks(count: number): Editor {
  const content: TiptapDocumentJSON = {
    type: "doc",
    content: Array.from({ length: count }, (_, index) => ({
      type: "paragraph",
      attrs: { [NODE_ID_ATTRIBUTE]: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}` },
      content: [{ type: "text", text: `original-${index}` }],
    })),
  };
  const editor = new Editor({ element: null, extensions: [...createEditorExtensions(), StorableInput], content });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  editors.push(editor);
  return editor;
}

function caretAt(editor: Editor, pos: number): void {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
}

function shown(editor: Editor): CanonicalDocument {
  const result = tiptapToCanonical(editor.getJSON() as TiptapDocumentJSON);
  if (!result.ok) throw new Error("the editor holds a document interop refuses");
  return result.doc;
}

/** What the editor shows is exactly what the saver would journal. */
function expectStorable(editor: Editor): void {
  const doc = shown(editor);
  expect(storableDocument(doc)).toBe(doc);
}

describe("StorableInput", () => {
  it("typed NUL is dropped and a lone surrogate becomes U+FFFD, in the same update", () => {
    const editor = editorWith(["ab"]);
    editor.view.dispatch(editor.state.tr.insertText("\u0000x\uD800", 2));
    expect(editor.state.doc.textContent).toBe("ax�b");
    expectStorable(editor);
  });

  it("a pasted slice with marks is made storable, keeping marks and every block id", () => {
    const editor = editorWith(["Prvi", "Drugi"]);
    const { schema } = editor.state;
    const bold = schema.marks.bold!.create();
    const slice = new Slice(Fragment.from([
      schema.text("a\u0000b"),
      schema.text("\uDC00c", [bold]),
    ]), 0, 0);
    editor.view.dispatch(editor.state.tr.replace(7, 7, slice));
    expect(editor.state.doc.child(0).textContent).toBe("Prvi");
    expect(editor.state.doc.child(1).textContent).toBe("ab�cDrugi");
    expect(editor.state.doc.child(1).child(1).marks.map((m) => m.type.name)).toEqual(["bold"]);
    expect(shown(editor).nodes.map((node) => node.id)).toEqual([ID_A, ID_B]);
    expectStorable(editor);
  });

  it("a run holding only NUL disappears", () => {
    const editor = editorWith(["ab"]);
    const { schema } = editor.state;
    editor.view.dispatch(editor.state.tr.replaceWith(2, 2, schema.text("\u0000\u0000", [schema.marks.bold!.create()])));
    expect(editor.state.doc.textContent).toBe("ab");
    expectStorable(editor);
  });

  it("a valid surrogate pair and text elsewhere are left alone", () => {
    const editor = editorWith(["😀 čćžšđ", "Drugi"]);
    const before = editor.state.doc.child(1);
    editor.view.dispatch(editor.state.tr.insertText("😀", 1));
    expect(editor.state.doc.child(0).textContent).toBe("😀😀 čćžšđ");
    expect(editor.state.doc.child(1)).toBe(before);
    expectStorable(editor);
  });

  it("text made unstorable by a later step in the same transaction is still fixed", () => {
    const editor = editorWith(["ab"]);
    const tr = editor.state.tr.insertText("\u0000", 2).insertText("x\uD83D", 1);
    editor.view.dispatch(tr);
    expect(editor.state.doc.textContent).toBe("x�ab");
    expectStorable(editor);
  });

  // #251 review 6109174031: the step's own range stops at the edge of the half
  // it leaves behind. Positions over "ab😀": the pair sits at 3..5.

  it("a delete at the edge of a run that leaves half a pair is fixed", () => {
    const end = editorWith(["ab😀"]);
    end.view.dispatch(end.state.tr.delete(4, 5));
    expect(end.state.doc.textContent).toBe("ab\uFFFD");
    expectStorable(end);

    const start = editorWith(["😀ab"]);
    start.view.dispatch(start.state.tr.delete(1, 2));
    expect(start.state.doc.textContent).toBe("\uFFFDab");
    expectStorable(start);
  });

  it("a split between the halves of a pair fixes both new blocks", () => {
    const editor = editorWith(["ab😀"]);
    editor.view.dispatch(editor.state.tr.split(4));
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.child(0).textContent).toBe("ab\uFFFD");
    expect(editor.state.doc.child(1).textContent).toBe("\uFFFD");
    expectStorable(editor);
  });

  it("adding or removing a mark over half a pair is fixed, though mark steps map no positions", () => {
    const added = editorWith(["ab😀"]);
    const bold = added.state.schema.marks.bold!.create();
    added.view.dispatch(added.state.tr.addMark(4, 5, bold));
    expect(added.state.doc.textContent).toBe("ab\uFFFD\uFFFD");
    expectStorable(added);

    const removed = editorWith(["ab😀"]);
    removed.view.dispatch(removed.state.tr.addMark(1, 5, bold));
    expect(removed.state.doc.textContent).toBe("ab😀");
    removed.view.dispatch(removed.state.tr.removeMark(3, 4, bold));
    expect(removed.state.doc.textContent).toBe("ab\uFFFD\uFFFD");
    expectStorable(removed);
  });

  it("text in other blocks is left alone when a block is widened", () => {
    const editor = editorWith(["ab😀", "Drugi"]);
    const before = editor.state.doc.child(1);
    editor.view.dispatch(editor.state.tr.delete(4, 5));
    expect(editor.state.doc.child(1)).toBe(before);
    expectStorable(editor);
  });

  // Only the code units the journal would change are repaired; the rest of
  // the run, the caret and the blocks around it keep their positions.

  it("a repair inside a long run keeps the caret right after the typed text", () => {
    const editor = editorWith(["prije poslije"]);
    // "prije " ends at 7; typing at the caret moves it past the typed text.
    caretAt(editor, 7);
    editor.view.dispatch(editor.state.tr.insertText("x\uD800"));
    expect(editor.state.doc.textContent).toBe("prije x\uFFFDposlije");
    expect(editor.state.selection.from).toBe(9);
    expect(editor.state.selection.empty).toBe(true);
    expectStorable(editor);
  });

  it("a NUL dropped mid-run leaves the caret where the typed text ended", () => {
    const editor = editorWith(["prije poslije"]);
    caretAt(editor, 7);
    editor.view.dispatch(editor.state.tr.insertText("a\u0000b"));
    expect(editor.state.doc.textContent).toBe("prije abposlije");
    expect(editor.state.selection.from).toBe(9);
    expectStorable(editor);
  });

  it("each repair is a step over the offending code units only, never the whole run", () => {
    const editor = editorWith(["prije poslije"]);
    const { state, transactions } = editor.state.applyTransaction(
      editor.state.tr.insertText("\u0000\u0000x\uDC00", 7),
    );
    expect(state.doc.textContent).toBe("prije x\uFFFDposlije");
    const repair = transactions.slice(1).flatMap((tr) => tr.steps.map((step) => step.toJSON() as { from: number; to: number }));
    // From the end: the lone surrogate at 10..11, then the NUL run at 7..9.
    expect(repair.map(({ from, to }) => [from, to])).toEqual([[10, 11], [7, 9]]);
  });

  it("at a block boundary a split pair is repaired in place in both blocks and the caret stays where it was", () => {
    const editor = editorWith(["ab😀cd", "Drugi"]);
    const second = editor.state.doc.child(1);
    // Positions over "ab😀cd": the pair sits at 3..5, the caret between c and d
    // at 6; split between the halves of the pair.
    caretAt(editor, 6);
    editor.view.dispatch(editor.state.tr.split(4));
    expect(editor.state.doc.childCount).toBe(3);
    expect(editor.state.doc.child(0).textContent).toBe("ab\uFFFD");
    expect(editor.state.doc.child(1).textContent).toBe("\uFFFDcd");
    expect(editor.state.doc.child(2)).toBe(second);
    // The caret is still between c and d, now in the new block.
    const $caret = editor.state.selection.$from;
    expect($caret.parent).toBe(editor.state.doc.child(1));
    expect($caret.parentOffset).toBe(2);
    expect(shown(editor).nodes.map((node) => node.id)).toContain(ID_A);
    expect(shown(editor).nodes.map((node) => node.id)).toContain(ID_B);
    expectStorable(editor);
  });

  // F-067: many offending runs are repaired in one step, so the cost does not
  // grow as runs times document size. F-071: that step maps only the runs.

  function repairSteps(editor: Editor, tr: Transaction): Step[] {
    const { state, transactions } = editor.state.applyTransaction(tr);
    editor.view.updateState(state);
    // Block ids the identity plugin gives new blocks are its own step, not a repair.
    return transactions
      .slice(1)
      .flatMap((t) => t.steps.filter((step) => step instanceof ReplaceStep || step instanceof RepairRuns));
  }

  /** Id and text of every block, in order. */
  function blocks(editor: Editor): [string, string][] {
    const out: [string, string][] = [];
    editor.state.doc.forEach((node) => out.push([node.attrs[NODE_ID_ATTRIBUTE] as string, node.textContent]));
    return out;
  }

  function idOfText(editor: Editor, text: string): string | undefined {
    return blocks(editor).find(([, shownText]) => shownText === text)?.[0];
  }

  it("up to eight runs are still repaired one step each", () => {
    const editor = editorWith(["prije poslije"]);
    expect(repairSteps(editor, editor.state.tr.insertText("a\uD800".repeat(8), 7))).toHaveLength(8);
    expect(editor.state.doc.textContent).toBe(`prije ${"a\uFFFD".repeat(8)}poslije`);
    expectStorable(editor);
  });

  it("more runs are one step that maps only the runs, and the caret stays after the paste", () => {
    const editor = editorWith(["prije poslije"]);
    caretAt(editor, 7);
    const steps = repairSteps(editor, editor.state.tr.insertText("a\uD800\u0000".repeat(9)));
    expect(steps).toHaveLength(1);
    const ranges: number[][] = [];
    steps[0]!.getMap().forEach((from, to, newFrom, newTo) => ranges.push([from, to, newFrom, newTo]));
    // Each "\uD800\u0000" at 8 + 3i becomes one U+FFFD at 8 + 2i.
    expect(ranges).toEqual(Array.from({ length: 9 }, (_, i) => [8 + 3 * i, 10 + 3 * i, 8 + 2 * i, 9 + 2 * i]));
    expect(editor.state.doc.textContent).toBe(`prije ${"a\uFFFD".repeat(9)}poslije`);
    expect(editor.state.selection.from).toBe(7 + 18);
    expectStorable(editor);
  });

  it("the single step keeps marks and the text between runs", () => {
    const editor = editorWith(["Prvi", "Drugi"]);
    const { schema } = editor.state;
    const bold = schema.marks.bold!.create();
    const nodes = Array.from({ length: 10 }, (_, i) =>
      schema.text(`b${i}\uDC00`, i % 2 === 0 ? [bold] : []));
    const steps = repairSteps(editor, editor.state.tr.replace(7, 7, new Slice(Fragment.from(nodes), 0, 0)));
    expect(steps).toHaveLength(1);
    const block = editor.state.doc.child(1);
    expect(block.textContent).toBe(`${Array.from({ length: 10 }, (_, i) => `b${i}\uFFFD`).join("")}Drugi`);
    expect(block.child(0).marks.map((m) => m.type.name)).toEqual(["bold"]);
    expect(block.child(1).marks).toEqual([]);
    expect(editor.state.doc.child(0).textContent).toBe("Prvi");
    expect(shown(editor).nodes.map((node) => node.id)).toEqual([ID_A, ID_B]);
    expectStorable(editor);
  });

  it("a paste of 100,000 code units with 50,000 runs over two blocks is one repair step", () => {
    const editor = editorWith(["prije poslije", "Drugi"]);
    const pasted = "a\uD800".repeat(25_000);
    const tr = editor.state.tr.insertText(pasted, 7).insertText(pasted, 7 + pasted.length + 10);
    expect(repairSteps(editor, tr)).toHaveLength(1);
    expect(editor.state.doc.child(0).textContent).toBe(`prije ${"a\uFFFD".repeat(25_000)}poslije`);
    expect(editor.state.doc.child(1).textContent).toBe(`D${"a\uFFFD".repeat(25_000)}rugi`);
    expect(shown(editor).nodes.map((node) => node.id)).toEqual([ID_A, ID_B]);
    expectStorable(editor);
  });

  it("a paste of many blocks with one run each is one repair step that keeps every block", () => {
    const editor = editorWith(["prije poslije", "Drugi"]);
    const { schema } = editor.state;
    const blocks = Array.from({ length: 2_000 }, (_, i) => schema.nodes.paragraph!.create(null, schema.text(`r${i}\u0000`)));
    const steps = repairSteps(editor, editor.state.tr.replace(7, 7, new Slice(Fragment.from(blocks), 1, 1)));
    expect(steps).toHaveLength(1);
    const texts: string[] = [];
    editor.state.doc.forEach((node) => texts.push(node.textContent));
    expect(texts).toEqual(["prije r0", ...Array.from({ length: 1_998 }, (_, i) => `r${i + 1}`), "r1999poslije", "Drugi"]);
    const ids = shown(editor).nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(ID_A);
    expect(ids).toContain(ID_B);
    expectStorable(editor);
  });

  it("maps a many-run repair across many existing blocks in one ordered pass", () => {
    const count = 4_000;
    const editor = editorWithManyBlocks(count);
    const { schema } = editor.state;
    const pasted = Array.from({ length: count }, (_, index) =>
      schema.nodes.paragraph!.create(null, schema.text(`pasted-${index}\u0000`)));
    const insertAt = editor.state.doc.child(0).nodeSize;
    const tr = editor.state.tr.replace(insertAt, insertAt, new Slice(Fragment.from(pasted), 0, 0));

    const originalMapResult = StepMap.prototype.mapResult;
    let repairMapQueries = 0;
    const spy = vi.spyOn(StepMap.prototype, "mapResult").mockImplementation(function (this: StepMap, pos, assoc) {
      const ranges = (this as unknown as { ranges: readonly number[] }).ranges;
      if (ranges.length >= count * 3) repairMapQueries += 1;
      return originalMapResult.call(this, pos, assoc);
    });
    try {
      repairSteps(editor, tr);
      expect(repairMapQueries).toBeLessThan(10);
    } finally {
      spy.mockRestore();
    }

    expect(editor.state.doc.textContent).not.toContain("\u0000");
    const firstOriginal = editor.state.doc.child(0);
    const lastOriginal = [...Array(editor.state.doc.childCount)].map((_, index) => editor.state.doc.child(index))
      .find((node) => node.textContent.endsWith(`original-${count - 1}`));
    expect(firstOriginal.attrs[NODE_ID_ATTRIBUTE]).toBe("00000000-0000-4000-8000-000000000000");
    expect(lastOriginal?.attrs[NODE_ID_ATTRIBUTE]).toBe(`00000000-0000-4000-8000-${(count - 1).toString(16).padStart(12, "0")}`);
  });

  it("F-071: inserts around an existing block's text leave its id on that text, not on the inserted text", () => {
    const editor = editorWith(["stari tekst odlomka", "drugi"]);
    const inserted = [..."NOVI TEKST"].map((c) => `\u0000${c}`).join("");
    const tr = editor.state.tr.insertText("\u0000", 20).insertText(inserted, 1).split(1 + inserted.length);
    expect(repairSteps(editor, tr)).toHaveLength(1);
    expect(blocks(editor).map(([, text]) => text)).toEqual(["NOVI TEKST", "stari tekst odlomka", "drugi"]);
    expect(idOfText(editor, "stari tekst odlomka")).toBe(ID_A);
    expect(idOfText(editor, "NOVI TEKST")).not.toBe(ID_A);
    expect(idOfText(editor, "drugi")).toBe(ID_B);
    expectStorable(editor);
  });

  it("F-071: untouched identical blocks between the runs keep their ids", () => {
    const editor = editorWith(["Prvi", "isto", "isto", "Zadnji"]);
    const runs = "x\u0000".repeat(5);
    const end = editor.state.doc.content.size - 1;
    const tr = editor.state.tr.insertText(runs, end).insertText(runs, 1);
    expect(repairSteps(editor, tr)).toHaveLength(1);
    expect(blocks(editor)).toEqual([
      [ID_A, "xxxxxPrvi"],
      [ID_B, "isto"],
      [ID_C, "isto"],
      [ID_D, "Zadnjixxxxx"],
    ]);
    expectStorable(editor);
  });

  it("F-071: a block whose end alone got runs keeps its id", () => {
    const editor = editorWith(["Prvi", "Drugi"]);
    const runs = "x\u0000".repeat(5);
    const tr = editor.state.tr.insertText(runs, 12).insertText(runs, 1);
    expect(repairSteps(editor, tr)).toHaveLength(1);
    expect(blocks(editor)).toEqual([
      [ID_A, "xxxxxPrvi"],
      [ID_B, "Drugixxxxx"],
    ]);
    expectStorable(editor);
  });

  it("undo and redo of a repair with many runs give back the same text and ids", () => {
    const editor = editorWith(["Prvi", "isto", "Zadnji"]);
    const runs = "y\uD800".repeat(5);
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(editor.state.tr.insertText(runs, end).insertText(runs, 1));
    const after = shown(editor);
    editor.commands.undo();
    expect(blocks(editor)).toEqual([
      [ID_A, "Prvi"],
      [ID_B, "isto"],
      [ID_C, "Zadnji"],
    ]);
    editor.commands.redo();
    expect(shown(editor)).toEqual(after);
    expectStorable(editor);
  });
});

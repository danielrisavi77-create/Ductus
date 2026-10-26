import { Editor } from "@tiptap/core";
import { AllSelection, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { afterEach, describe, expect, it } from "vitest";

import { ArrowCollapse, collapsedByArrow } from "./arrow-collapse";
import { EvidenceRecorder } from "./capture";
import type { TiptapDocumentJSON } from "./interop";
import { createEditorExtensions, NODE_ID_ATTRIBUTE } from "./schema";
import { NO_OBSERVATION, recordWithSource } from "./source";
import { StorableInput } from "./storable-input";

/** DAN-247: a plain arrow on a selection across blocks. Invented text only. */

const ONE = "Izmisljen prvi odlomak.";
const TWO = "Izmisljen drugi odlomak.";

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function editorWith(texts: string[]): Editor {
  const content: TiptapDocumentJSON = {
    type: "doc",
    content: texts.map((text, index) => ({
      type: "paragraph",
      attrs: { [NODE_ID_ATTRIBUTE]: `aaaaaaaa-0000-4000-8000-00000000000${index}` },
      content: [{ type: "text", text }],
    })),
  };
  const editor = new Editor({
    element: null, extensions: [...createEditorExtensions(), StorableInput, ArrowCollapse], content,
  });
  // Tiptap attaches its plugins when it mounts; without a DOM they are attached here.
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  editors.push(editor);
  return editor;
}

const key = (k: string, mods: Partial<Record<"shiftKey" | "ctrlKey" | "altKey" | "metaKey", boolean>> = {}) =>
  ({ key: k, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods }) as KeyboardEvent;

/**
 * Runs the editor's keydown props in order, as prosemirror-view does; true
 * when one handled the key. Without a DOM the view offers only `state` and
 * `dispatch`, which is all the props read.
 */
function press(editor: Editor, event: KeyboardEvent): boolean {
  const view = { get state() { return editor.state; }, dispatch: (tr: Transaction) => editor.view.dispatch(tr) };
  return editor.state.plugins.some((plugin) =>
    plugin.props.handleKeyDown?.call(plugin, view as unknown as EditorView, event) === true);
}

function selectAll(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
}

describe("ArrowCollapse (DAN-247)", () => {
  it("ArrowRight on select-all puts the caret at the end of the text, ArrowLeft at its start", () => {
    const editor = editorWith([ONE, TWO]);
    const end = editor.state.doc.content.size - 1;
    selectAll(editor);
    expect(press(editor, key("ArrowRight"))).toBe(true);
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([end, end]);
    selectAll(editor);
    expect(press(editor, key("ArrowLeft"))).toBe(true);
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([1, 1]);
  });

  it("a text selection across two blocks collapses to its own end or start", () => {
    const editor = editorWith([ONE, TWO]);
    const from = 5;
    const to = ONE.length + 2 + 6; // inside the second paragraph
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
    expect(press(editor, key("ArrowRight"))).toBe(true);
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([to, to]);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
    expect(press(editor, key("ArrowLeft"))).toBe(true);
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([from, from]);
  });

  it("a caret, a selection inside one block, a modifier and any other key stay with the browser", () => {
    const editor = editorWith([ONE, TWO]);
    const state = (from: number, to: number) =>
      editor.state.apply(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
    expect(collapsedByArrow(state(3, 3), key("ArrowRight"))).toBeNull();
    expect(collapsedByArrow(state(2, 8), key("ArrowRight"))).toBeNull();
    selectAll(editor);
    for (const mod of ["shiftKey", "ctrlKey", "altKey", "metaKey"] as const) {
      expect(collapsedByArrow(editor.state, key("ArrowRight", { [mod]: true }))).toBeNull();
    }
    for (const other of ["ArrowUp", "ArrowDown", "Home", "End", "a"]) {
      expect(collapsedByArrow(editor.state, key(other))).toBeNull();
    }
    expect(press(editor, key("ArrowDown"))).toBe(false);
    expect(editor.state.selection).toBeInstanceOf(AllSelection);
  });

  it("the collapse changes only the selection: no step, no update, nothing for the evidence", () => {
    const editor = editorWith([ONE, TWO]);
    selectAll(editor);
    const before = editor.state.doc;
    const seen: Transaction[][] = [];
    let updates = 0;
    editor.on("transaction", ({ transaction, appendedTransactions }) => {
      seen.push([transaction, ...appendedTransactions]);
    });
    editor.on("update", () => updates++);
    expect(press(editor, key("ArrowRight"))).toBe(true);
    expect(seen).toHaveLength(1);
    const all = seen[0]!;
    expect(all.every((tr) => !tr.docChanged && tr.steps.length === 0)).toBe(true);
    expect(editor.state.doc).toBe(before);
    // LocalDocument journals only from `onUpdate`, which Tiptap emits only on a changed document.
    expect(updates).toBe(0);
    const recorder = new EvidenceRecorder();
    expect(recordWithSource(recorder, all, NO_OBSERVATION, 1_000)).toBeNull();
    recorder.close();
    expect(recorder.pendingEvents).toBe(0);
  });
});

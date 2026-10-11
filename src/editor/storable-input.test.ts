import { Editor } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { afterEach, describe, expect, it } from "vitest";

import type { CanonicalDocument, NodeId } from "../domain/document";

import { tiptapToCanonical, type TiptapDocumentJSON } from "./interop";
import { createEditorExtensions, NODE_ID_ATTRIBUTE } from "./schema";
import { StorableInput } from "./storable-input";
import { storableDocument } from "./storable-text";

/**
 * Text the journal would store differently never stays in the editor
 * (#206 Codex r4240240763). Synthetic text only.
 */

const ID_A = "aaaaaaaa-0000-4000-8000-00000000000a" as NodeId;
const ID_B = "bbbbbbbb-0000-4000-8000-00000000000b" as NodeId;

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function editorWith(texts: string[]): Editor {
  const content: TiptapDocumentJSON = {
    type: "doc",
    content: [ID_A, ID_B].slice(0, texts.length).map((id, index) => ({
      type: "paragraph", attrs: { [NODE_ID_ATTRIBUTE]: id }, content: [{ type: "text", text: texts[index]! }],
    })),
  };
  const editor = new Editor({ element: null, extensions: [...createEditorExtensions(), StorableInput], content });
  // Tiptap attaches its plugins when it mounts; without a DOM they are attached here.
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  editors.push(editor);
  return editor;
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
});

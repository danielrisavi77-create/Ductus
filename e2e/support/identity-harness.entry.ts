/**
 * Browser side of the block identity suite: the editor exactly as the
 * application builds it (`createEditorExtensions`), mounted on a bare page, so
 * clipboard, drop and keyboard paths run through a real browser engine. It is
 * bundled by `identity-harness.ts` and never shipped: nothing under `app/`
 * imports it.
 */

import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";

import { tiptapToCanonical } from "../../src/editor/interop";
import { createEditorExtensions } from "../../src/editor/schema";

export type HarnessBlock = { id: string; type: string; text: string };

export type IdentityHarness = {
  ready: boolean;
  /** The canonical blocks, or the errors when the document has no canonical form. */
  blocks(): HarnessBlock[] | { errors: unknown };
  /** Puts the caret at a document position, or at the start or end. */
  caret(at: number | "start" | "end"): void;
  /** Selects the whole block with the given index, as a node. */
  selectBlock(index: number): void;
  /** Document position of the start of the content of a block. */
  contentStart(index: number): number;
  /** What the last copy or cut put on the clipboard, as the event carried it. */
  copied: { html: string; text: string };
  /** Dispatches a paste event that carries `copied` (not a trusted event). */
  pasteCopied(): void;
  editor: Editor;
};

declare global {
  interface Window {
    __identitySeed?: object;
    __identity?: IdentityHarness;
  }
}

const editor = new Editor({
  element: document.querySelector("#editor"),
  extensions: createEditorExtensions(),
  content: window.__identitySeed ?? "",
});

function blockPos(index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i += 1) {
    pos += editor.state.doc.child(i).nodeSize;
  }
  return pos;
}

const harness: IdentityHarness = {
  ready: false,
  blocks() {
    const result = tiptapToCanonical(editor.getJSON());
    if (!result.ok) {
      return { errors: result.errors };
    }
    return result.doc.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      text: node.children.map((child) => child.text).join(""),
    }));
  },
  caret(at) {
    editor.view.focus();
    const { doc, tr } = editor.state;
    const pos = at === "start" ? 1 : at === "end" ? doc.content.size - 1 : at;
    editor.view.dispatch(tr.setSelection(TextSelection.create(doc, pos)));
  },
  selectBlock(index) {
    editor.view.focus();
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, blockPos(index))));
  },
  contentStart(index) {
    return blockPos(index) + 1;
  },
  copied: { html: "", text: "" },
  pasteCopied() {
    const data = new DataTransfer();
    data.setData("text/html", harness.copied.html);
    data.setData("text/plain", harness.copied.text);
    editor.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  },
  editor,
};

// Runs after the editor's own copy and cut handler, which fills the event.
for (const type of ["copy", "cut"] as const) {
  document.addEventListener(type, (event) => {
    harness.copied = {
      html: event.clipboardData?.getData("text/html") ?? "",
      text: event.clipboardData?.getData("text/plain") ?? "",
    };
  });
}

editor.on("create", () => {
  harness.ready = true;
});
window.__identity = harness;

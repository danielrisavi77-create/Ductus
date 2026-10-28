import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { paragraphNode, textNode, DOCUMENT_SCHEMA_VERSION, type CanonicalDocument, type NodeId } from "../domain/document";

import { startFreshHistory } from "./history";
import { replaceWithStoredDocument } from "./identity";
import { tiptapToCanonical } from "./interop";
import { createEditorExtensions, NODE_ID_ATTRIBUTE } from "./schema";

/**
 * F-086: what one sheet held never comes back through undo once the editor
 * starts afresh, as it does when a session ends and before a journal is
 * loaded (LocalDocument). Invented text only.
 */

const ID_B = "bbbbbbbb-0000-4000-8000-00000000000b" as NodeId;
const EARLIER = "Ranija bilješka iz izmišljenog nacrta.";
const NEXT: CanonicalDocument = {
  schemaVersion: DOCUMENT_SCHEMA_VERSION,
  nodes: [paragraphNode(ID_B, [textNode("Sljedeći izmišljeni nacrt.")])],
};

const EMPTY = { type: "doc", content: [{ type: "paragraph" }] };

function written(): Editor {
  const editor = new Editor({ element: null, extensions: createEditorExtensions(), content: EMPTY });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  editor.view.dispatch(editor.state.tr.insertText(EARLIER, 1));
  expect(editor.getText()).toBe(EARLIER);
  expect(editor.can().undo()).toBe(true);
  return editor;
}

function undoAll(editor: Editor): void {
  for (let i = 0; i < 50 && editor.can().undo(); i += 1) editor.commands.undo();
}

describe("startFreshHistory", () => {
  it("empties the sheet so that neither undo nor redo brings the earlier text back", () => {
    const editor = written();
    let updates = 0;
    editor.on("update", () => {
      updates += 1;
    });

    startFreshHistory(editor.view, "empty");

    expect(editor.getText()).toBe("");
    expect(editor.can().undo()).toBe(false);
    expect(editor.can().redo()).toBe(false);
    undoAll(editor);
    expect(editor.getText()).toBe("");
    expect(updates).toBe(0);
    // The empty block has its id, as after any other start.
    expect(editor.state.doc.child(0).attrs[NODE_ID_ATTRIBUTE]).toEqual(expect.any(String));
  });

  it("after a session end and the next journal, undo stays inside the next sheet", () => {
    const editor = written();
    startFreshHistory(editor.view, "empty");
    startFreshHistory(editor.view, "keep");
    expect(replaceWithStoredDocument(editor.view, NEXT)).toEqual({ ok: true });

    expect(editor.can().undo()).toBe(false);
    undoAll(editor);
    expect(tiptapToCanonical(editor.getJSON())).toEqual({ ok: true, doc: NEXT });
  });

  it("before a load into a sheet that was never emptied, undo cannot reach the earlier text", () => {
    const editor = written();
    startFreshHistory(editor.view, "keep");
    expect(editor.getText()).toBe(EARLIER);
    expect(editor.can().undo()).toBe(false);

    replaceWithStoredDocument(editor.view, NEXT);
    undoAll(editor);
    expect(tiptapToCanonical(editor.getJSON())).toEqual({ ok: true, doc: NEXT });
  });

  it("keeps the editor working: what is typed next is undoable as usual and keeps the stored id", () => {
    const editor = written();
    startFreshHistory(editor.view, "keep");
    replaceWithStoredDocument(editor.view, NEXT);
    editor.view.dispatch(editor.state.tr.insertText(" Dopuna.", editor.state.doc.content.size - 1));

    expect(editor.getText()).toBe("Sljedeći izmišljeni nacrt. Dopuna.");
    expect(editor.state.doc.child(0).attrs[NODE_ID_ATTRIBUTE]).toBe(ID_B);
    undoAll(editor);
    expect(tiptapToCanonical(editor.getJSON())).toEqual({ ok: true, doc: NEXT });
  });
});

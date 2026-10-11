import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { NodeId } from "../domain/document";

import { createEditorExtensions, NODE_ID_ATTRIBUTE } from "./schema";
import { StorableInput } from "./storable-input";
import { storableText } from "./storable-text";

/**
 * Property: whatever code units are typed at the caret, the editor ends up
 * with exactly the text the journal would store, and the caret right after
 * the stored form of what was typed. Only the offending code units are
 * repaired, so nothing around them moves. Synthetic text only.
 */

const ID = "aaaaaaaa-0000-4000-8000-00000000000a" as NodeId;
const BEFORE = "prije ";
const AFTER = " poslije";

// Halves of "😀" and other surrogates, NUL, a whole pair and ordinary text.
const unit = fc.constantFrom("a", "č", " ", "\u0000", "\uD83D", "\uDE00", "\uD800", "\uDFFF", "😀");

describe("StorableInput property", () => {
  it("typed text is stored as storableText and the caret ends right after it", () => {
    fc.assert(
      fc.property(fc.array(unit, { minLength: 1, maxLength: 12 }), fc.nat({ max: BEFORE.length }), (units, at) => {
        const before = BEFORE.slice(0, at);
        const after = BEFORE.slice(at) + AFTER;
        const editor = new Editor({
          element: null,
          extensions: [...createEditorExtensions(), StorableInput],
          content: {
            type: "doc",
            content: [{ type: "paragraph", attrs: { [NODE_ID_ATTRIBUTE]: ID }, content: [{ type: "text", text: before + after }] }],
          },
        });
        try {
          editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
          const caret = 1 + before.length;
          editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, caret)));
          const typed = units.join("");
          editor.view.dispatch(editor.state.tr.insertText(typed));
          const stored = storableText(typed);
          expect(editor.state.doc.textContent).toBe(before + stored + after);
          expect(editor.state.selection.empty).toBe(true);
          expect(editor.state.selection.from).toBe(caret + stored.length);
        } finally {
          editor.destroy();
        }
      }),
    );
  });
});

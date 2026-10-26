// @vitest-environment node
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { describe, expect, it } from "vitest";

import type { SegmentContext } from "./capture";
import { blocks, ID_A, recordedEditor, replays, typeChar } from "./capture.fixture";
import { emptyHeadingBackspace } from "./schema";

/**
 * "# ", "## " and "### " at the start of a block make it a heading. When the
 * marker was the block's only text, the change of type and the removal of
 * the marker in one transaction left a block with no text and a new type,
 * which identity.ts (rule 1) takes for a new block: it got a new id and the
 * evidence recorder stopped. Found in E1 (#823), where "- " had the same
 * problem. Invented text only.
 */

const SEGMENT: SegmentContext = {
  documentId: "dokument-izmisljeni",
  sessionId: "11111111-1111-4111-8111-111111111111",
  segmentId: "33333333-3333-4333-8333-333333333333",
  evidenceProfileId: "profil-izmisljeni",
  sequenceFrom: 2,
  predecessorSegmentHash: null,
};

/** Types `text` as the browser would: through the editor's input rules first. */
function typeThroughRules(editor: Editor, text: string): void {
  const { from, to } = editor.state.selection;
  // Every input rules plugin, as the view asks each in turn.
  const handled = editor.state.plugins
    .filter((plugin) => (plugin.spec as { isInputRules?: boolean }).isInputRules)
    .some((plugin) => (plugin.props.handleTextInput as (view: EditorView, from: number, to: number, text: string) => boolean)
      .call(plugin, editor.view, from, to, text));
  if (!handled) typeChar(editor, text);
}

describe("heading marker", () => {
  it.each([[1, "#"], [2, "##"], [3, "###"]] as const)(
    "level %i: the marker on an empty line keeps the block's id, and replays",
    async (level, marker) => {
      const t = recordedEditor("");
      t.editor.commands.setTextSelection(1);
      for (const char of marker) typeThroughRules(t.editor, char);
      t.as("editor");
      typeThroughRules(t.editor, " ");
      expect(blocks(t.editor)).toEqual([["heading", "", ID_A]]);
      expect(t.editor.state.doc.firstChild!.attrs.level).toBe(level);
      typeThroughRules(t.editor, "U");
      expect(blocks(t.editor)).toEqual([["heading", "U", ID_A]]);
      await replays(t);
    },
  );

  it("in front of text makes a heading of it with the same id, and replays", async () => {
    const t = recordedEditor("Uvod");
    t.editor.commands.setTextSelection(1);
    typeThroughRules(t.editor, "#");
    t.as("editor");
    typeThroughRules(t.editor, " ");
    expect(blocks(t.editor)).toEqual([["heading", "Uvod", ID_A]]);
    await replays(t);
  });

  it("one undo in front of text gives the paragraph with the marker back, with its id", async () => {
    const t = recordedEditor("Uvod");
    t.editor.commands.setTextSelection(1);
    typeThroughRules(t.editor, "#");
    t.as("editor");
    typeThroughRules(t.editor, " ");
    t.as("editor");
    t.editor.commands.undo();
    expect(blocks(t.editor)).toEqual([["paragraph", "# Uvod", ID_A]]);
    await replays(t);
  });

  // Undo puts "# " back into the empty block and its old type in one
  // transaction, so identity.ts gives the block a new id: the class of
  // capture-rewrite.test.ts "Redo after removing all the selected text".
  // The recorder stops with unsupported_step there; nothing is refused.
  it("one undo on an empty line stops the recorder after what it gave replays", async () => {
    const t = recordedEditor("");
    t.editor.commands.setTextSelection(1);
    typeThroughRules(t.editor, "#");
    t.as("editor");
    typeThroughRules(t.editor, " ");
    await replays(t);
    t.as("editor");
    t.editor.commands.undo();
    expect(blocks(t.editor).map(([type, text]) => [type, text])).toEqual([["paragraph", "# "]]);
    t.recorder.close();
    await expect(t.recorder.takeSegment(SEGMENT)).rejects.toMatchObject({ code: "unsupported_step" });
    expect(t.recorder.intact).toBe(false);
  });

  it("Backspace in an empty heading gives a paragraph with the same id; in a heading with text it is the editor's", async () => {
    const t = recordedEditor("");
    t.editor.commands.setTextSelection(1);
    typeThroughRules(t.editor, "#");
    t.as("editor");
    typeThroughRules(t.editor, " ");
    t.as("editor");
    expect(emptyHeadingBackspace(t.editor)).toBe(true);
    expect(blocks(t.editor)).toEqual([["paragraph", "", ID_A]]);
    expect(emptyHeadingBackspace(t.editor)).toBe(false);
    t.editor.commands.setHeading({ level: 2 });
    typeChar(t.editor, "U");
    t.editor.commands.setTextSelection(1);
    expect(emptyHeadingBackspace(t.editor)).toBe(false);
    await replays(t);
  });

  it("is no marker in the middle of text, or with four #", () => {
    const t = recordedEditor("Tekst");
    t.editor.commands.setTextSelection(6);
    typeThroughRules(t.editor, "#");
    typeThroughRules(t.editor, " ");
    expect(blocks(t.editor)).toEqual([["paragraph", "Tekst# ", ID_A]]);
    const four = recordedEditor("");
    four.editor.commands.setTextSelection(1);
    for (const char of "#### ") typeThroughRules(four.editor, char);
    expect(blocks(four.editor)).toEqual([["paragraph", "#### ", ID_A]]);
  });
});

// @vitest-environment node
import { Editor } from "@tiptap/core";
import { Fragment, type Node as PmNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { deriveChapters } from "../domain/document";

import { blockPosition, ChapterNumbers, chapterNumbersOf, numberedHeadings } from "./chapter-numbers";
import { tiptapToCanonical } from "./interop";
import { createEditorExtensions, NODE_ID_ATTRIBUTE } from "./schema";

/**
 * M5.3-P02 (DAN-395): heading numbers and the table of contents are read from
 * the one chapter projection, `deriveChapters`, and a link follows the block
 * id, not a position, through a move and its undo. Invented text only.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Spec = { kind: "p" } | { kind: "h"; level: 1 | 2 | 3 };

function editorOf(blocks: readonly [Spec, string][]): Editor {
  const editor = new Editor({
    element: null,
    extensions: [...createEditorExtensions(), ChapterNumbers],
    content: {
      type: "doc",
      content: blocks.map(([spec, text], i) => ({
        type: spec.kind === "p" ? "paragraph" : "heading",
        attrs: spec.kind === "p" ? { nodeId: ID(i + 1) } : { nodeId: ID(i + 1), level: spec.level },
        ...(text ? { content: [{ type: "text", text }] } : {}),
      })),
    },
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  return editor;
}

/** The numbers the plugin decorates, by block id, in document order. */
function decorated(editor: Editor): [string, string][] {
  const out: [string, string][] = [];
  const set = chapterNumbersOf(editor.state);
  set.find().forEach((decoration) => {
    const node = editor.state.doc.nodeAt(decoration.from)!;
    const attrs = (decoration as unknown as { type: { attrs: Record<string, string> } }).type.attrs;
    out.push([String(node.attrs[NODE_ID_ATTRIBUTE]), attrs["data-chapter-number"]!]);
  });
  return out;
}

/** The same numbers straight from the projection over the canonical document. */
function projected(editor: Editor): [string, string][] {
  const candidate = tiptapToCanonical(editor.getJSON());
  if (!candidate.ok) throw new Error("test document is not canonical");
  return deriveChapters(candidate.doc).chapters.map((c) => [c.blockId, c.number]);
}

describe("numberedHeadings: input classes", () => {
  const cases: [string, [Spec, string][], string[]][] = [
    ["no headings", [[{ kind: "p" }, "Samo tekst."]], []],
    ["preamble before the first heading", [[{ kind: "p" }, "Prije."], [{ kind: "h", level: 1 }, "Uvod"]], ["1"]],
    ["nested levels", [[{ kind: "h", level: 1 }, "A"], [{ kind: "h", level: 2 }, "B"], [{ kind: "h", level: 3 }, "C"], [{ kind: "h", level: 1 }, "D"]], ["1", "1.1", "1.1.1", "2"]],
    ["skipped level keeps the gap", [[{ kind: "h", level: 1 }, "A"], [{ kind: "h", level: 3 }, "B"]], ["1", "1.0.1"]],
    ["first heading below level 1", [[{ kind: "h", level: 2 }, "A"]], ["0.1"]],
    ["empty heading is numbered", [[{ kind: "h", level: 1 }, ""], [{ kind: "h", level: 1 }, "B"]], ["1", "2"]],
  ];

  it.each(cases)("%s", (_name, blocks, numbers) => {
    const editor = editorOf(blocks);
    expect(numberedHeadings(editor.state.doc).map((h) => h.number)).toEqual(numbers);
    expect(decorated(editor).map(([, n]) => n)).toEqual(numbers);
    editor.destroy();
  });

  it("numbers a heading that has no id yet, by position", () => {
    const editor = editorOf([[{ kind: "h", level: 1 }, "A"]]);
    const doc: PmNode = editor.state.schema.node("doc", null, [
      editor.state.schema.node("heading", { level: 1, [NODE_ID_ATTRIBUTE]: null }, [editor.state.schema.text("A")]),
      editor.state.schema.node("heading", { level: 2, [NODE_ID_ATTRIBUTE]: ID(9) }, [editor.state.schema.text("B")]),
    ]);
    expect(numberedHeadings(doc).map(({ id, number, pos }) => ({ id, number, pos }))).toEqual([
      { id: null, number: "1", pos: 0 },
      { id: ID(9), number: "1.1", pos: 3 },
    ]);
    editor.destroy();
  });

  it("is the projection of deriveChapters for any sequence of blocks", () => {
    const spec = fc.oneof(
      fc.constant<Spec>({ kind: "p" }),
      fc.constantFrom<Spec>({ kind: "h", level: 1 }, { kind: "h", level: 2 }, { kind: "h", level: 3 }),
    );
    fc.assert(
      fc.property(fc.array(fc.tuple(spec, fc.constantFrom("", "Tekst", " Naslov ")), { minLength: 1, maxLength: 12 }), (blocks) => {
        const editor = editorOf(blocks);
        try {
          expect(decorated(editor)).toEqual(projected(editor));
          expect(numberedHeadings(editor.state.doc).map((h) => [h.id, h.number])).toEqual(projected(editor));
        } finally {
          editor.destroy();
        }
      }),
      { numRuns: 60 },
    );
  });
});

describe("a link follows the block id through a move and undo", () => {
  /** Moves the block at `index` to the end, in one transaction, as a drag would. */
  function moveToEnd(editor: Editor, index: number): void {
    const { doc } = editor.state;
    const nodes: PmNode[] = [];
    doc.forEach((node) => nodes.push(node));
    const [moved] = nodes.splice(index, 1);
    nodes.push(moved!);
    const tr: Transaction = editor.state.tr.replaceWith(0, doc.content.size, Fragment.fromArray(nodes));
    editor.view.dispatch(tr);
  }

  it("keeps the number and the target with the heading", () => {
    const editor = editorOf([
      [{ kind: "h", level: 1 }, "Uvod"],
      [{ kind: "p" }, "Prvi odlomak."],
      [{ kind: "h", level: 1 }, "Okvir"],
      [{ kind: "p" }, "Drugi odlomak."],
    ]);
    const uvod = ID(1);
    const okvir = ID(3);
    const headingAt = (id: string) => {
      const pos = blockPosition(editor.state.doc, id);
      return pos === null ? null : editor.state.doc.nodeAt(pos);
    };

    expect(decorated(editor)).toEqual([[uvod, "1"], [okvir, "2"]]);

    moveToEnd(editor, 0);
    // The move kept the id (identity.ts rule 2, move).
    expect(decorated(editor)).toEqual([[okvir, "1"], [uvod, "2"]]);
    expect(headingAt(uvod)?.textContent).toBe("Uvod");
    expect(blockPosition(editor.state.doc, uvod)).toBeGreaterThan(blockPosition(editor.state.doc, okvir)!);

    expect(editor.commands.undo()).toBe(true);
    expect(decorated(editor)).toEqual([[uvod, "1"], [okvir, "2"]]);
    expect(headingAt(uvod)?.textContent).toBe("Uvod");
    expect(blockPosition(editor.state.doc, uvod)).toBe(0);
    expect(headingAt(okvir)?.textContent).toBe("Okvir");

    expect(editor.commands.redo()).toBe(true);
    expect(headingAt(uvod)?.textContent).toBe("Uvod");
    expect(decorated(editor)).toEqual([[okvir, "1"], [uvod, "2"]]);
    editor.destroy();
  });

  it("finds no block for an unknown or removed id", () => {
    const editor = editorOf([[{ kind: "h", level: 1 }, "Uvod"], [{ kind: "p" }, "Tekst."]]);
    expect(blockPosition(editor.state.doc, ID(42))).toBeNull();
    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", attrs: { nodeId: ID(7) } }] });
    expect(blockPosition(editor.state.doc, ID(1))).toBeNull();
    editor.destroy();
  });

  it("never writes the number into the document or its text", () => {
    const editor = editorOf([[{ kind: "h", level: 1 }, "Uvod"], [{ kind: "h", level: 2 }, "Pojmovi"]]);
    expect(editor.state.doc.textContent).toBe("UvodPojmovi");
    expect(editor.getText()).not.toMatch(/\d/u);
    expect(JSON.stringify(editor.getJSON())).not.toContain("chapter");
    editor.destroy();
  });
});

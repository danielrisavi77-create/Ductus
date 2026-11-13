// @vitest-environment node
import { Editor } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { CITATION_UNMARK_META } from "./citation";
import { tiptapToCanonicalV2 } from "./interop-v2";
import { createEditorExtensionsV2 } from "./schema";

/**
 * DAN-620 a: the citation guard of the v2 editor. A citation never keeps a
 * mark (contract §3.1): the guard takes marks off in a transaction of its own,
 * outside the history, and refuses a mark transaction that would touch only
 * citations. Invented ids and filler text only.
 */

const ID_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const SRC_1 = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** "Ab" + citation + "Cd": positions 1–2 text, 3 citation, 4–5 text. */
const CONTENT = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { nodeId: ID_A },
      content: [
        { type: "text", text: "Ab" },
        { type: "citation", attrs: { sourceId: SRC_1, locator: null } },
        { type: "text", text: "Cd" },
      ],
    },
  ],
};

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function setUp(): { editor: Editor; seen: Transaction[] } {
  const seen: Transaction[] = [];
  editor = new Editor({ element: null, extensions: createEditorExtensionsV2(), content: CONTENT });
  // A headless editor is never mounted, so its plugins are put on the state here, as in history.test.ts.
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  editor.on("transaction", ({ transaction, appendedTransactions }) => seen.push(transaction, ...appendedTransactions));
  return { editor, seen };
}

/** Marks of every inline child of the first block, as `type:mark,mark`. */
function inline(e: Editor): string[] {
  const out: string[] = [];
  e.state.doc.firstChild!.forEach((child) =>
    out.push(`${child.isText ? child.text : child.type.name}:${child.marks.map((m) => m.type.name).join(",")}`),
  );
  return out;
}

const citationNode = (e: Editor, marks: string[]) =>
  e.schema.nodes.citation!.create(
    { sourceId: SRC_1 },
    null,
    marks.map((name) => e.schema.marks[name]!.create()),
  );

describe("citation guard", () => {
  it("bold over text and a citation marks the text and leaves the citation bare", () => {
    const { editor: e } = setUp();
    e.chain().setTextSelection({ from: 1, to: 6 }).toggleBold().run();
    expect(inline(e)).toEqual(["Ab:bold", "citation:", "Cd:bold"]);
  });

  it("its own transaction carries the meta and is not in the history", () => {
    const { editor: e, seen } = setUp();
    e.chain().setTextSelection({ from: 1, to: 6 }).toggleBold().run();
    const own = seen.filter((tr) => tr.getMeta(CITATION_UNMARK_META) === true);
    expect(own).toHaveLength(1);
    expect(own[0]!.getMeta("addToHistory")).toBe(false);
  });

  it("undo after bold brings back the unmarked text, and redo the bold, with the citation bare throughout", () => {
    const { editor: e } = setUp();
    e.chain().setTextSelection({ from: 1, to: 6 }).toggleBold().run();
    e.commands.undo();
    expect(inline(e)).toEqual(["Ab:", "citation:", "Cd:"]);
    e.commands.redo();
    expect(inline(e)).toEqual(["Ab:bold", "citation:", "Cd:bold"]);
    e.commands.undo();
    expect(inline(e)).toEqual(["Ab:", "citation:", "Cd:"]);
    expect(e.can().undo()).toBe(false);
  });

  it("refuses bold over the citation alone and leaves no undo step", () => {
    const { editor: e, seen } = setUp();
    const before = e.state.doc;
    e.chain().setTextSelection({ from: 3, to: 4 }).toggleBold().run();
    expect(e.state.doc.eq(before)).toBe(true);
    expect(seen.some((tr) => tr.docChanged)).toBe(false);
    expect(e.can().undo()).toBe(false);
  });

  it("refuses a node mark on the citation", () => {
    const { editor: e } = setUp();
    const before = e.state.doc;
    e.view.dispatch(e.state.tr.addNodeMark(3, e.schema.marks.italic!.create()));
    expect(e.state.doc.eq(before)).toBe(true);
  });

  it("unmarks a marked citation that a paste brings in, and the paste stays one undo step", () => {
    const { editor: e } = setUp();
    const slice = new Slice(Fragment.from(citationNode(e, ["bold", "italic"])), 0, 0);
    e.view.dispatch(e.state.tr.replace(6, 6, slice));
    expect(inline(e)).toEqual(["Ab:", "citation:", "Cd:", "citation:"]);
    e.commands.undo();
    expect(inline(e)).toEqual(["Ab:", "citation:", "Cd:"]);
  });

  it("unmarks a marked citation inserted by a command", () => {
    const { editor: e } = setUp();
    e.chain().setTextSelection(1).insertContent({ type: "citation", attrs: { sourceId: SRC_1 }, marks: [{ type: "bold" }] }).run();
    expect(inline(e)).toEqual(["citation:", "Ab:", "citation:", "Cd:"]);
  });

  it("K8: the projection refuses a marked citation, while the editor takes the mark off the same one", () => {
    const { editor: e } = setUp();
    const marked = structuredClone(CONTENT);
    Object.assign(marked.content[0]!.content[1]!, { marks: [{ type: "bold" }] });
    const refused = tiptapToCanonicalV2(marked);
    expect(refused.ok ? [] : refused.errors.map((error) => error.code)).toEqual(["TIPTAP_CITATION_MARKED"]);
    e.commands.setContent(marked);
    expect(inline(e)).toEqual(["Ab:", "citation:", "Cd:"]);
    expect(tiptapToCanonicalV2(e.getJSON()).ok).toBe(true);
  });

  it("does not append a transaction when no step can mark a citation", () => {
    const { editor: e, seen } = setUp();
    e.view.dispatch(e.state.tr.insertText("ef", 6));
    expect(seen.some((tr) => tr.getMeta(CITATION_UNMARK_META) === true)).toBe(false);
    expect(inline(e)).toEqual(["Ab:", "citation:", "Cdef:"]);
  });
});

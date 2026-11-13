// @vitest-environment node
import { Editor } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { afterEach, describe, expect, it } from "vitest";

import { CITATION_UNMARK_META, unmarkCitations } from "./citation";
import { tiptapToCanonicalV2 } from "./interop-v2";
import { createEditorExtensionsV2 } from "./schema";

/**
 * DAN-620 a: the citation guard of the v2 editor. A citation never keeps a
 * mark (contract §3.1): the guard takes marks off in a transaction of its own,
 * outside the history, and refuses a mark transaction that would touch only
 * citations. Invented ids and filler text only.
 */

const ID_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const ID_H = "aaaaaaaa-0000-4000-8000-00000000000b";
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

/** "Hx" heading (positions 0–4), then a paragraph of a citation and "Cd" (from 4; text at 5, citation at 5). */
const WITH_HEADING = {
  type: "doc",
  content: [
    { type: "heading", attrs: { nodeId: ID_H, level: 1 }, content: [{ type: "text", text: "Hx" }] },
    {
      type: "paragraph",
      attrs: { nodeId: ID_A },
      content: [
        { type: "citation", attrs: { sourceId: SRC_1, locator: null } },
        { type: "text", text: "Cd" },
      ],
    },
  ],
};

function setUp(content: object = CONTENT): { editor: Editor; seen: Transaction[] } {
  const seen: Transaction[] = [];
  editor = new Editor({ element: null, extensions: createEditorExtensionsV2(), content });
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

  it("lets undo through when its mark step is left over a citation alone", () => {
    const { editor: e } = setUp();
    e.chain().setTextSelection({ from: 3, to: 6 }).toggleBold().run();
    // An edit outside the history (a remote step, say) removes the text after the citation.
    e.view.dispatch(e.state.tr.delete(4, 6).setMeta("addToHistory", false));
    expect(e.commands.undo()).toBe(true);
    expect(e.can().undo()).toBe(false);
    expect(inline(e)).toEqual(["Ab:", "citation:"]);
  });

  it("unmarks a marked citation of the initial content in the transaction it runs on create", () => {
    const marked = structuredClone(CONTENT);
    Object.assign(marked.content[0]!.content[1]!, { marks: [{ type: "italic" }] });
    const { editor: e } = setUp(marked);
    expect(inline(e)).toEqual(["Ab:", "citation:italic", "Cd:"]);
    // What a mounted editor runs once (`onCreate`); a headless one never emits `create`.
    e.view.dispatch(unmarkCitations(e.state)!);
    expect(inline(e)).toEqual(["Ab:", "citation:", "Cd:"]);
    expect(e.can().undo()).toBe(false);
  });
});

describe("citation guard, headings", () => {
  const blocks = (e: Editor) => e.state.doc.content.content.map((block) => `${block.type.name}:${block.childCount}`);

  it("refuses setting a paragraph with a citation to a heading", () => {
    const { editor: e } = setUp();
    const before = e.state.doc;
    e.chain().setTextSelection(2).setNode("heading", { level: 2 }).run();
    expect(e.state.doc.eq(before)).toBe(true);
    expect(e.can().undo()).toBe(false);
  });

  it("refuses toggleHeading on a paragraph with a citation", () => {
    const { editor: e } = setUp();
    const before = e.state.doc;
    e.chain().setTextSelection(2).toggleHeading({ level: 1 }).run();
    expect(e.state.doc.eq(before)).toBe(true);
  });

  it("refuses the typed heading marker in a paragraph with a citation", () => {
    const { editor: e } = setUp({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { nodeId: ID_A },
          content: [
            { type: "text", text: "#" },
            { type: "citation", attrs: { sourceId: SRC_1, locator: null } },
          ],
        },
      ],
    });
    e.commands.setTextSelection(2);
    // As the view asks every input rules plugin, as in heading-marker.test.ts.
    const handled = e.state.plugins
      .filter((plugin) => (plugin.spec as { isInputRules?: boolean }).isInputRules)
      .some((plugin) => (plugin.props.handleTextInput as (view: EditorView, from: number, to: number, text: string) => boolean)
        .call(plugin, e.view, 2, 2, " "));
    expect(handled).toBe(true);
    expect(blocks(e)).toEqual(["paragraph:2"]);
    expect(inline(e)).toEqual(["# :", "citation:"]);
  });

  it("refuses joining a paragraph that holds a citation into the heading before it", () => {
    const { editor: e } = setUp(WITH_HEADING);
    const before = e.state.doc;
    e.chain().setTextSelection(5).joinBackward().run();
    expect(e.state.doc.eq(before)).toBe(true);
  });

  it("still makes a heading of a paragraph without a citation, and joins text into a heading", () => {
    const { editor: e } = setUp(WITH_HEADING);
    e.view.dispatch(e.state.tr.delete(5, 6));
    e.chain().setTextSelection(5).joinBackward().run();
    expect(blocks(e)).toEqual(["heading:1"]);
    expect(e.state.doc.textContent).toBe("HxCd");
  });

  it("still deletes a selected citation, and splits a block over a selection that holds one", () => {
    const { editor: e } = setUp();
    e.chain().setTextSelection({ from: 2, to: 5 }).splitBlock().run();
    expect(blocks(e)).toEqual(["paragraph:1", "paragraph:1"]);
    expect(e.state.doc.textContent).toBe("Ad");
  });

  it("still deletes from a heading into the paragraph before its citation, and keeps the citation", () => {
    const { editor: e } = setUp(WITH_HEADING);
    e.chain().setTextSelection({ from: 2, to: 5 }).deleteSelection().run();
    expect(e.state.doc.textContent).toBe("HCd");
    let citations = 0;
    e.state.doc.descendants((node) => void (citations += node.type.name === "citation" ? 1 : 0));
    expect(citations).toBe(1);
  });
});

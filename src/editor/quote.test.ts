// @vitest-environment node
import { Fragment, Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { blocks, ID_A, recordedEditor, replays, typeChar, type Recorded } from "./capture.fixture";
import { canonicalToTiptap, tiptapToCanonical } from "./interop";
import { markerToQuote, Quote, QUOTE_MARKER, quoteBackspace, quoteEnter } from "./quote";
import { createEditorExtensions, F1_EXTENSION_NAMES } from "./schema";

/**
 * E1 part 2 (#823, DAN-326, contract issuecomment-6412639687, QA criterion
 * §4): the quote paragraph in the real editor schema. Every change is
 * captured and replayed on the server's replayer to the same document. A
 * headless editor has no view to send keys to, so the key handlers are called
 * as the keymap calls them; e2e/quote.spec.ts presses the real keys. Invented
 * ids and filler text only.
 */

const shortcuts = () =>
  Quote.config.addKeyboardShortcuts!.call({ editor: null, name: "quote" } as never) as Record<string, unknown>;

function quoted(text = "Navod iz izvora"): Recorded {
  const t = recordedEditor(text);
  t.editor.chain().setTextSelection(1).toggleNode("quote", "paragraph").run();
  t.as("editor");
  return t;
}

describe("E1: making and leaving a quote paragraph", () => {
  it("the button's command turns a paragraph into a quote and back with the same id; undo and redo", async () => {
    const t = quoted();
    expect(blocks(t.editor)).toEqual([["quote", "Navod iz izvora", ID_A]]);
    expect(t.editor.isActive("quote")).toBe(true);
    t.editor.commands.undo();
    expect(blocks(t.editor)).toEqual([["paragraph", "Navod iz izvora", ID_A]]);
    t.as("editor");
    t.editor.commands.redo();
    t.as("editor");
    t.editor.commands.toggleNode("quote", "paragraph");
    expect(blocks(t.editor)).toEqual([["paragraph", "Navod iz izvora", ID_A]]);
    await replays(t);
  });

  it("binds Mod-Shift-b, Enter and Backspace, and not Tab; is read before Bold's Mod-B", () => {
    expect(Object.keys(shortcuts()).sort()).toEqual(["Backspace", "Enter", "Mod-Shift-b"]);
    // Tiptap runs keymaps of equal priority last-first (schema.ts).
    const names = createEditorExtensions().map((extension) => extension.name);
    expect(Quote.config.priority).toBeUndefined();
    expect(names.indexOf("quote")).toBeGreaterThan(names.indexOf("bold"));
    expect(names.indexOf("quote")).toBeLessThan(names.indexOf("nodeIdentity"));
    expect(F1_EXTENSION_NAMES).toContain("quote");
  });

  it("the paragraph stays the schema's first block, so an empty document is a paragraph", () => {
    const t = recordedEditor("");
    expect(t.editor.schema.topNodeType.contentMatch.defaultType?.name).toBe("paragraph");
  });

  it("a list item becomes a quote and back to an item, keeping the id", async () => {
    const t = recordedEditor("Stavka");
    t.editor.chain().setTextSelection(1).toggleNode("bulletItem", "paragraph").run();
    t.as("editor");
    t.editor.commands.toggleNode("quote", "paragraph");
    expect(blocks(t.editor)).toEqual([["quote", "Stavka", ID_A]]);
    t.as("editor");
    t.editor.commands.toggleNode("bulletItem", "paragraph");
    expect(blocks(t.editor)).toEqual([["bulletItem", "Stavka", ID_A]]);
    await replays(t);
  });
});

describe("E1: Enter and Backspace at the edges of a quote", () => {
  it("Enter at the end opens a new quote paragraph with its own id; on an empty one gives a paragraph", async () => {
    const t = quoted();
    t.editor.commands.setTextSelection(16);
    expect(quoteEnter(t.editor)).toBe(true);
    typeChar(t.editor, "D");
    const second = blocks(t.editor)[1]!;
    expect(second.slice(0, 2)).toEqual(["quote", "D"]);
    expect(second[2]).not.toBe(ID_A);
    t.as("editor");
    expect(quoteEnter(t.editor)).toBe(true);
    t.as("editor");
    expect(quoteEnter(t.editor)).toBe(true);
    expect(blocks(t.editor).map(([type, text]) => [type, text])).toEqual([["quote", "Navod iz izvora"], ["quote", "D"], ["paragraph", ""]]);
    await replays(t);
  });

  it("Enter in the middle is the editor's own split, which keeps the quote", async () => {
    const t = quoted();
    t.editor.commands.setTextSelection(6);
    expect(quoteEnter(t.editor)).toBe(false);
    t.editor.commands.splitBlock();
    expect(blocks(t.editor).map(([type, text]) => [type, text])).toEqual([["quote", "Navod"], ["quote", " iz izvora"]]);
    await replays(t);
  });

  it("Backspace at the start gives a paragraph and keeps the text; the next one joins", async () => {
    const t = recordedEditor("Odlomak");
    t.editor.chain().setTextSelection(8).splitBlock().run();
    typeChar(t.editor, "N");
    t.editor.commands.toggleNode("quote", "paragraph");
    t.as("editor");
    t.editor.commands.setTextSelection(10);
    expect(quoteBackspace(t.editor)).toBe(true);
    expect(blocks(t.editor).map(([type, text]) => [type, text])).toEqual([["paragraph", "Odlomak"], ["paragraph", "N"]]);
    t.as("editor");
    expect(quoteBackspace(t.editor)).toBe(false);
    t.editor.commands.joinBackward();
    expect(blocks(t.editor)).toEqual([["paragraph", "OdlomakN", ID_A]]);
    await replays(t);
  });

  it("leaves Enter and Backspace to the editor outside a quote and in a list item", () => {
    const t = recordedEditor("Tekst");
    t.editor.commands.setTextSelection(6);
    expect(quoteEnter(t.editor)).toBe(false);
    t.editor.chain().toggleNode("bulletItem", "paragraph").setTextSelection(1).run();
    expect(quoteBackspace(t.editor)).toBe(false);
  });
});

describe("E1: the quote marker", () => {
  it.each(["> ", "  > "])("'%s' at the start of a block is the marker", (typed) => {
    expect(QUOTE_MARKER.test(typed)).toBe(true);
  });

  it.each(["Tekst > ", ">", ">> ", "» ", "„ "])("'%s' is not", (typed) => {
    expect(QUOTE_MARKER.test(typed)).toBe(false);
  });

  const rule = (t: Recorded, from: number, to: number) =>
    t.editor.commands.command(({ tr }) => markerToQuote(tr, from, to, t.editor.schema.nodes.quote!));

  it("on an empty line keeps the block's id, and replays", async () => {
    const t = recordedEditor("");
    t.editor.commands.setTextSelection(1);
    typeChar(t.editor, ">");
    t.as("editor");
    expect(rule(t, 1, 2)).toBe(true);
    expect(blocks(t.editor)).toEqual([["quote", "", ID_A]]);
    typeChar(t.editor, "N");
    expect(blocks(t.editor)).toEqual([["quote", "N", ID_A]]);
    await replays(t);
  });

  it("in front of text makes a quote of it; one undo gives the paragraph back", async () => {
    const t = recordedEditor("Tekst");
    t.editor.commands.setTextSelection(1);
    typeChar(t.editor, ">");
    t.as("editor");
    expect(rule(t, 1, 2)).toBe(true);
    expect(blocks(t.editor)).toEqual([["quote", "Tekst", ID_A]]);
    t.as("editor");
    t.editor.commands.undo();
    // The history joins the typed ">" with the change here (no time passes);
    // e2e/quote.spec.ts checks the real keys.
    expect(blocks(t.editor).map(([type, , id]) => [type, id])).toEqual([["paragraph", ID_A]]);
    await replays(t);
  });

  it("does nothing in a block that is a quote already", () => {
    const t = quoted("Tekst");
    expect(t.editor.can().command(({ tr }) => markerToQuote(tr, 1, 1, t.editor.schema.nodes.quote!))).toBe(false);
  });
});

describe("E1: a whole sequence and interop", () => {
  it("typing, list, quote, back, a cut across blocks and a pasted quote replay to the same document", async () => {
    const t = recordedEditor("Prvi");
    t.editor.chain().setTextSelection(5).splitBlock().run();
    for (const c of "Drugi") typeChar(t.editor, c);
    t.as("editor");
    t.editor.commands.toggleNode("bulletItem", "paragraph");
    t.as("editor");
    t.editor.commands.toggleNode("quote", "paragraph");
    t.as("editor");
    t.editor.chain().setTextSelection(1).toggleNode("quote", "paragraph").run();
    t.as("cut");
    // Across the boundary of two quote paragraphs: the removed range's hash covers the type.
    t.editor.chain().setTextSelection({ from: 3, to: 9 }).deleteSelection().run();
    expect(blocks(t.editor)).toEqual([["quote", "Prugi", ID_A]]);
    t.as("paste");
    // A paste as ProseMirror makes it: a slice open at both ends, so the first
    // block flows into the caret's quote and the last takes the rest.
    const { schema } = t.editor;
    const slice = new Slice(Fragment.from([
      schema.nodes.paragraph!.create(null, schema.text("Zalijepljeni")),
      schema.nodes.quote!.create(null, schema.text("Navod")),
      schema.nodes.paragraph!.create(null, schema.text("Kraj")),
    ]), 1, 1);
    t.editor.view.dispatch(t.editor.state.tr.setSelection(TextSelection.create(t.editor.state.doc, 6)).replaceSelection(slice));
    const after = blocks(t.editor);
    expect(after.map(([type, text]) => [type, text])).toEqual([["quote", "PrugiZalijepljeni"], ["quote", "Navod"], ["paragraph", "Kraj"]]);
    expect(after[0]![2]).toBe(ID_A);
    expect(new Set(after.map(([, , id]) => id)).size).toBe(3);
    await replays(t);
  });

  it("a quote survives the round trip canonical → Tiptap → canonical", () => {
    const doc = {
      schemaVersion: 1 as const,
      nodes: [{ type: "quote" as const, id: ID_A as never, children: [{ type: "text" as const, text: "Navod", marks: ["italic" as const] }] }],
    };
    const json = canonicalToTiptap(doc);
    expect(json.content[0]).toEqual({ type: "quote", attrs: { nodeId: ID_A }, content: [{ type: "text", text: "Navod", marks: [{ type: "italic" }] }] });
    expect(tiptapToCanonical(json)).toEqual({ ok: true, doc });
    expect(tiptapToCanonical({ type: "doc", content: [{ type: "blockquote", attrs: { nodeId: ID_A } }] }))
      .toMatchObject({ ok: false, errors: [{ code: "TIPTAP_UNKNOWN_NODE_TYPE" }] });
  });
});

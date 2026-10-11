import { Editor } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { createTextAnchor, resolveTextAnchor } from "../domain/collaboration/anchor";
import type { NodeId } from "../domain/document";

import { tiptapToCanonical, type TiptapDocumentJSON, type TiptapNodeJSON } from "./interop";
import { createEditorExtensions, ID_CARRYING_TYPES, NODE_ID_ATTRIBUTE } from "./schema";

/**
 * Block identity under editing. Everything here goes through the editor the
 * way the application builds it (`createEditorExtensions`) and reads the
 * result the way the application does (`tiptapToCanonical`), so the tests say
 * which block ends up with which id, not how that is achieved.
 *
 * Synthetic documents only: blocks A, B, C with ids ID_A, ID_B, ID_C.
 */

const ID_A = "aaaaaaaa-0000-4000-8000-00000000000a" as NodeId;
const ID_B = "bbbbbbbb-0000-4000-8000-00000000000b" as NodeId;
const ID_C = "cccccccc-0000-4000-8000-00000000000c" as NodeId;
const ID_OUTSIDE = "dddddddd-0000-4000-8000-00000000000d" as NodeId;
const TEXT_A = "Prvi blok.";
const TEXT_B = "Drugi blok s napomenom.";
const TEXT_C = "Treći blok.";
const MINTED = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type BlockType = (typeof ID_CARRYING_TYPES)[number];
type Seen = { id: string; text: string };

function block(type: BlockType, id: unknown, text: string): TiptapNodeJSON {
  const attrs = type === "heading" ? { [NODE_ID_ATTRIBUTE]: id, level: 2 } : { [NODE_ID_ATTRIBUTE]: id };
  return text === "" ? { type, attrs } : { type, attrs, content: [{ type: "text", text }] };
}

function abc(type: BlockType): TiptapDocumentJSON {
  return { type: "doc", content: [block(type, ID_A, TEXT_A), block(type, ID_B, TEXT_B), block(type, ID_C, TEXT_C)] };
}

/** Tiptap attaches its plugins when it mounts; without a DOM they are attached the same way here. */
function open(content: TiptapDocumentJSON): Editor {
  const editor = new Editor({ element: null, extensions: createEditorExtensions(), content });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  return editor;
}

function project(editor: Editor) {
  return tiptapToCanonical(editor.getJSON());
}

/** The canonical blocks; fails the test when the document has no canonical form. */
function seen(editor: Editor): Seen[] {
  const first = project(editor);
  const second = project(editor);
  if (!first.ok || !second.ok) {
    throw new Error(`no canonical form: ${JSON.stringify(first.ok ? second : first)}`);
  }
  const blocks = first.doc.nodes.map((node) => ({ id: node.id as string, text: node.children.map((child) => child.text).join("") }));
  // Identity is settled in the editor, not re-decided by each projection.
  expect(second.doc.nodes.map((node) => node.id)).toEqual(blocks.map((entry) => entry.id));
  expect(new Set(blocks.map((entry) => entry.id.toLowerCase())).size).toBe(blocks.length);
  return blocks;
}

function idOfText(editor: Editor, text: string): string[] {
  return seen(editor).filter((entry) => entry.text === text).map((entry) => entry.id);
}

function posOf(editor: Editor, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i += 1) {
    pos += editor.state.doc.child(i).nodeSize;
  }
  return pos;
}

function endOf(editor: Editor): number {
  return editor.state.doc.content.size;
}

const ORIGINALS: Seen[] = [
  { id: ID_A, text: TEXT_A },
  { id: ID_B, text: TEXT_B },
  { id: ID_C, text: TEXT_C },
];

function expectNew(ids: string[], count: number): void {
  expect(ids).toHaveLength(count);
  for (const id of ids) {
    expect(id).toMatch(MINTED);
    expect([ID_A, ID_B, ID_C, ID_OUTSIDE]).not.toContain(id);
  }
}

describe.each(ID_CARRYING_TYPES)("block identity (%s)", (type) => {
  const copies = () => abc(type).content;

  it("copies inserted before the originals get new ids and the originals keep theirs", () => {
    const editor = open(abc(type));
    editor.commands.insertContentAt(0, copies());

    const blocks = seen(editor);
    expect(blocks.slice(3)).toEqual(ORIGINALS);
    expect(blocks.slice(0, 3).map((entry) => entry.text)).toEqual([TEXT_A, TEXT_B, TEXT_C]);
    expectNew(blocks.slice(0, 3).map((entry) => entry.id), 3);
  });

  it("copies inserted after the originals get new ids and the originals keep theirs", () => {
    const editor = open(abc(type));
    editor.commands.insertContentAt(endOf(editor), copies());

    const blocks = seen(editor);
    expect(blocks.slice(0, 3)).toEqual(ORIGINALS);
    expectNew(blocks.slice(3).map((entry) => entry.id), 3);
  });

  it("copies inserted inside a block leave the id on the part before the insertion", () => {
    const editor = open(abc(type));
    editor.commands.insertContentAt(posOf(editor, 1) + 1 + 5, copies());

    const blocks = seen(editor);
    expect(blocks[0]).toEqual(ORIGINALS[0]);
    expect(blocks.at(-1)).toEqual(ORIGINALS[2]);
    const holders = blocks.filter((entry) => entry.id === ID_B);
    expect(holders).toEqual([{ id: ID_B, text: TEXT_B.slice(0, 5) }]);
    expectNew(blocks.slice(2, -1).map((entry) => entry.id), blocks.length - 3);
  });

  describe("blocks inserted into the text of a block", () => {
    /** Two blocks with open ends, as a paste of two paragraphs arrives: the first carries a copy of B. */
    const twoBlocks = (editor: Editor) => {
      const node = (id: unknown, text: string) => editor.schema.nodeFromJSON(block(type, id, text));
      return new Slice(Fragment.from([node(ID_B, TEXT_B), node(ID_OUTSIDE, "Rep.")]), 1, 1);
    };

    it("at the very start of the text: the id stays with the text of the block, not with what was put in front of it", () => {
      const editor = open(abc(type));
      const start = posOf(editor, 1) + 1;
      editor.view.dispatch(editor.state.tr.replace(start, start, twoBlocks(editor)));

      const blocks = seen(editor);
      expect(blocks.map((entry) => entry.text)).toEqual([TEXT_A, TEXT_B, `Rep.${TEXT_B}`, TEXT_C]);
      expect([blocks[0].id, blocks[2].id, blocks[3].id]).toEqual([ID_A, ID_B, ID_C]);
      expectNew([blocks[1].id], 1);
    });

    it("over the first characters of the text: the id stays with the rest of the text", () => {
      const editor = open(abc(type));
      const start = posOf(editor, 1) + 1;
      editor.view.dispatch(editor.state.tr.replace(start, start + 1, twoBlocks(editor)));

      const blocks = seen(editor);
      expect(blocks.map((entry) => entry.text)).toEqual([TEXT_A, TEXT_B, `Rep.${TEXT_B.slice(1)}`, TEXT_C]);
      expect([blocks[0].id, blocks[2].id, blocks[3].id]).toEqual([ID_A, ID_B, ID_C]);
      expectNew([blocks[1].id], 1);
    });

    it("over both ends of the text in one transaction: the id stays with the middle that is left", () => {
      const editor = open(abc(type));
      const start = posOf(editor, 1) + 1;
      const tr = editor.state.tr.replace(start, start + 1, twoBlocks(editor));
      const end = tr.mapping.map(posOf(editor, 2) - 1);
      editor.view.dispatch(tr.replace(end - 1, end, twoBlocks(editor)));

      const blocks = seen(editor);
      const middle = `Rep.${TEXT_B.slice(1, -1)}${TEXT_B}`;
      expect(blocks.map((entry) => entry.text)).toEqual([TEXT_A, TEXT_B, middle, "Rep.", TEXT_C]);
      expect([blocks[0].id, blocks[2].id, blocks[4].id]).toEqual([ID_A, ID_B, ID_C]);
      expectNew([blocks[1].id, blocks[3].id], 2);
    });

    it("over all of the text: nothing of the block is left elsewhere, so the rewritten block keeps the id", () => {
      const editor = open(abc(type));
      const start = posOf(editor, 1) + 1;
      editor.view.dispatch(editor.state.tr.insertText("Posve novi tekst.", start, start + TEXT_B.length));

      expect(seen(editor)).toEqual([ORIGINALS[0], { id: ID_B, text: "Posve novi tekst." }, ORIGINALS[2]]);
    });

    it("text typed at the very start or over the first words keeps the id", () => {
      const editor = open(abc(type));
      const start = posOf(editor, 1) + 1;
      editor.view.dispatch(editor.state.tr.insertText("Uvod. ", start));
      editor.view.dispatch(editor.state.tr.insertText("Novi u", start, start + 4));

      expect(seen(editor)[1]).toEqual({ id: ID_B, text: `Novi u. ${TEXT_B}` });
    });
  });

  it.each([
    ["before the block", (editor: Editor) => posOf(editor, 1)],
    ["after the block", (editor: Editor) => posOf(editor, 2)],
  ])("a block arriving with an id in use does not get it (%s)", (_where, at) => {
    const editor = open(abc(type));
    editor.commands.insertContentAt(at(editor), block(type, ID_B, "Umetnuti tekst."));

    expect(idOfText(editor, TEXT_B)).toEqual([ID_B]);
    expectNew(idOfText(editor, "Umetnuti tekst."), 1);
    expect(seen(editor)).toHaveLength(4);
  });

  it("a block that replaces another does not inherit its id", () => {
    const editor = open(abc(type));
    const from = posOf(editor, 1);
    editor.commands.insertContentAt({ from, to: posOf(editor, 2) }, block(type, ID_B, "Zamjenski tekst."));

    const blocks = seen(editor);
    expect(blocks.map((entry) => entry.text)).toEqual([TEXT_A, "Zamjenski tekst.", TEXT_C]);
    expect(blocks.map((entry) => entry.id)).not.toContain(ID_B);
    expectNew([blocks[1].id], 1);
  });

  it("an id that is not in the document is not adopted", () => {
    const editor = open(abc(type));
    editor.commands.insertContentAt(0, block(type, ID_OUTSIDE, "Tekst s odabranim id-jem."));

    expectNew(idOfText(editor, "Tekst s odabranim id-jem."), 1);
    expect(seen(editor).slice(1)).toEqual(ORIGINALS);
  });

  it("the id of a block removed earlier is not handed to different content", () => {
    const editor = open(abc(type));
    editor.commands.deleteRange({ from: posOf(editor, 1), to: posOf(editor, 2) });
    expect(seen(editor).map((entry) => entry.id)).toEqual([ID_A, ID_C]);

    editor.commands.insertContentAt(endOf(editor), block(type, ID_B, "Drugi tekst pod starim id-jem."));

    expectNew(idOfText(editor, "Drugi tekst pod starim id-jem."), 1);
  });

  it.each([
    ["upper case", ID_B.toUpperCase()],
    ["mixed case", ID_B.slice(0, 4).toUpperCase() + ID_B.slice(4)],
    ["surrounding whitespace", ` ${ID_B}\n`],
    ["a zero-width character inside", `${ID_B.slice(0, 8)}​${ID_B.slice(8)}`],
  ])("a variant spelling of an id in use is not adopted and the document stays canonical (%s)", (_name, variant) => {
    const editor = open(abc(type));
    editor.commands.insertContentAt(0, block(type, variant, "Varijanta."));

    expect(project(editor).ok).toBe(true);
    expectNew(idOfText(editor, "Varijanta."), 1);
    expect(seen(editor).slice(1)).toEqual(ORIGINALS);
  });

  it.each([
    ["too short", "1234"],
    ["wrong alphabet", "zzzzzzzz-0000-4000-8000-00000000000z"],
    ["empty", ""],
    ["very long", "a".repeat(10_000)],
    ["not a string", 42],
  ])("a malformed id on inserted content is replaced by a new one, not reported (%s)", (_name, malformed) => {
    const editor = open(abc(type));
    editor.commands.insertContentAt(endOf(editor), block(type, malformed, "Neispravan id."));

    expect(project(editor).ok).toBe(true);
    expectNew(idOfText(editor, "Neispravan id."), 1);
  });

  it("a malformed id in content the editor was opened with is still reported after edits elsewhere", () => {
    const editor = open({ type: "doc", content: [block(type, "not-a-uuid", "Učitano."), block(type, ID_B, TEXT_B)] });
    editor.view.dispatch(editor.state.tr.insertText(" Dopisano.", endOf(editor) - 1));
    editor.commands.insertContentAt(endOf(editor), block(type, null, "Novi blok."));

    const result = project(editor);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toEqual([
      { path: `$.content[0].attrs.${NODE_ID_ATTRIBUTE}`, code: "TIPTAP_NODE_ID_INVALID" },
    ]);
  });

  it("two inserted blocks carrying the same id get two different new ids", () => {
    const editor = open(abc(type));
    editor.commands.insertContentAt(0, [block(type, ID_OUTSIDE, "Jedan."), block(type, ID_OUTSIDE, "Dva.")]);

    const [one, two] = seen(editor);
    expectNew([one.id, two.id], 2);
    expect(one.id).not.toBe(two.id);
  });

  it("replacing the whole content does not bring chosen ids in", () => {
    const editor = open(abc(type));
    editor.commands.setContent({
      type: "doc",
      content: [block(type, ID_B, "Novi sadržaj."), block(type, ID_OUTSIDE, "Još jedan.")],
    });

    expectNew(seen(editor).map((entry) => entry.id), 2);
  });

  it.each([
    ["another block's id", ID_B],
    ["an id from outside", ID_OUTSIDE],
    ["no id", null],
    ["a malformed id", "x"],
  ])("a step that rewrites the id attribute does not change the id (%s)", (_name, value) => {
    const editor = open(abc(type));
    editor.view.dispatch(editor.state.tr.setNodeAttribute(0, NODE_ID_ATTRIBUTE, value));
    expect(seen(editor)).toEqual(ORIGINALS);

    const node = editor.state.doc.child(0);
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...node.attrs, [NODE_ID_ATTRIBUTE]: value }));
    expect(seen(editor)).toEqual(ORIGINALS);
  });

  it("two blocks cannot trade ids", () => {
    const editor = open(abc(type));
    editor.view.dispatch(
      editor.state.tr
        .setNodeAttribute(0, NODE_ID_ATTRIBUTE, ID_B)
        .setNodeAttribute(posOf(editor, 1), NODE_ID_ATTRIBUTE, ID_A),
    );

    expect(seen(editor)).toEqual(ORIGINALS);
  });

  it("a block moved inside one transaction keeps its id, with or without the attribute", () => {
    for (const stripped of [false, true]) {
      const editor = open(abc(type));
      const node = editor.state.doc.child(1);
      const from = posOf(editor, 1);
      const moved = stripped ? node.type.create({ ...node.attrs, [NODE_ID_ATTRIBUTE]: null }, node.content) : node;
      const tr = editor.state.tr.delete(from, from + node.nodeSize);
      editor.view.dispatch(tr.insert(tr.doc.content.size, moved));

      expect(seen(editor)).toEqual([ORIGINALS[0], ORIGINALS[2], ORIGINALS[1]]);
    }
  });

  it("a block joined into another is not moved: an identical block inserted in the same transaction is new", () => {
    const editor = open(abc(type));
    const joined = editor.state.doc.child(2);
    const tr = editor.state.tr.join(posOf(editor, 2));
    editor.view.dispatch(tr.insert(tr.doc.content.size, joined));

    const blocks = seen(editor);
    expect(blocks.slice(0, 2)).toEqual([ORIGINALS[0], { id: ID_B, text: TEXT_B + TEXT_C }]);
    expect(blocks[2].text).toBe(TEXT_C);
    expectNew([blocks[2].id], 1);
  });

  it("a copy placed elsewhere in one transaction is a new block", () => {
    const editor = open(abc(type));
    editor.view.dispatch(editor.state.tr.insert(endOf(editor), editor.state.doc.child(1)));

    const blocks = seen(editor);
    expect(blocks.slice(0, 3)).toEqual(ORIGINALS);
    expectNew([blocks[3].id], 1);
  });

  it("a block removed and inserted again in a later transaction is a new block unless it comes back unchanged with its id", () => {
    const editor = open(abc(type));
    const node = editor.state.doc.child(1);
    const from = posOf(editor, 1);
    editor.view.dispatch(editor.state.tr.delete(from, from + node.nodeSize));
    // What a paste inserts: the same content with the id removed.
    const pasted = node.type.create({ ...node.attrs, [NODE_ID_ATTRIBUTE]: null }, node.content);
    editor.view.dispatch(editor.state.tr.insert(endOf(editor), pasted));

    const blocks = seen(editor);
    expect(blocks.slice(0, 2)).toEqual([ORIGINALS[0], ORIGINALS[2]]);
    expect(blocks[2].text).toBe(TEXT_B);
    expectNew([blocks[2].id], 1);
  });

  it("splitting a block leaves the id on the part before the caret", () => {
    const editor = open(abc(type));
    editor.commands.setTextSelection(posOf(editor, 1) + 1 + 5);
    editor.commands.splitBlock();

    const blocks = seen(editor);
    expect(blocks.map((entry) => entry.text)).toEqual([TEXT_A, TEXT_B.slice(0, 5), TEXT_B.slice(5), TEXT_C]);
    expect([blocks[0].id, blocks[1].id, blocks[3].id]).toEqual([ID_A, ID_B, ID_C]);
    expectNew([blocks[2].id], 1);
  });

  it.each([
    ["start", (editor: Editor) => posOf(editor, 1) + 1, [TEXT_A, "", TEXT_B, TEXT_C]],
    ["end", (editor: Editor) => posOf(editor, 2) - 1, [TEXT_A, TEXT_B, "", TEXT_C]],
  ])("splitting at the very %s of a block leaves the id with the text; the empty block is new", (_where, at, texts) => {
    const editor = open(abc(type));
    editor.commands.setTextSelection(at(editor));
    editor.commands.splitBlock();

    const blocks = seen(editor);
    expect(blocks.map((entry) => entry.text)).toEqual(texts);
    expect(blocks.filter((entry) => entry.text !== "")).toEqual(ORIGINALS);
    expectNew(idOfText(editor, ""), 1);
  });

  it("joining a block into the one before it keeps the first id and drops the second", () => {
    const editor = open(abc(type));
    editor.commands.setTextSelection(posOf(editor, 2) + 1);
    editor.commands.joinBackward();

    expect(seen(editor)).toEqual([ORIGINALS[0], { id: ID_B, text: TEXT_B + TEXT_C }]);
  });

  it("joining into an empty block keeps the id of the block that has the text", () => {
    const editor = open({ type: "doc", content: [block(type, ID_A, TEXT_A), block(type, ID_B, ""), block(type, ID_C, TEXT_C)] });
    editor.view.dispatch(editor.state.tr.join(posOf(editor, 2)));

    expect(seen(editor)).toEqual([ORIGINALS[0], ORIGINALS[2]]);
  });

  it("changing the block type keeps the id", () => {
    const editor = open(abc(type));
    editor.commands.setTextSelection(posOf(editor, 1) + 2);
    editor.commands.setNode(type === "heading" ? "paragraph" : "heading", { level: 3 });

    expect(editor.getJSON().content[1].type).not.toBe(type);
    expect(seen(editor)).toEqual(ORIGINALS);
  });

  it("deleting across blocks keeps the id of the block the selection started in", () => {
    const editor = open(abc(type));
    editor.commands.deleteRange({ from: posOf(editor, 0) + 1 + 4, to: posOf(editor, 2) + 1 + 5 });

    expect(seen(editor)).toEqual([{ id: ID_A, text: TEXT_A.slice(0, 4) + TEXT_C.slice(5) }]);
  });

  describe("undo and redo", () => {
    const actions: [string, (editor: Editor) => void][] = [
      ["inserted copies", (editor) => editor.commands.insertContentAt(0, copies())],
      ["a replaced block", (editor) =>
        editor.commands.insertContentAt({ from: posOf(editor, 1), to: posOf(editor, 2) }, block(type, ID_B, "Zamjena."))],
      ["a removed block", (editor) => editor.commands.deleteRange({ from: posOf(editor, 1), to: posOf(editor, 2) })],
      ["a split", (editor) => {
        editor.commands.setTextSelection(posOf(editor, 1) + 1 + 5);
        editor.commands.splitBlock();
      }],
      ["a join", (editor) => {
        editor.commands.setTextSelection(posOf(editor, 2) + 1);
        editor.commands.joinBackward();
      }],
      ["a deletion across blocks", (editor) =>
        editor.commands.deleteRange({ from: posOf(editor, 0) + 1 + 4, to: posOf(editor, 2) + 1 + 5 })],
      ["a rewritten id attribute", (editor) =>
        editor.view.dispatch(editor.state.tr.setNodeAttribute(0, NODE_ID_ATTRIBUTE, ID_B))],
    ];

    it.each(actions)("undo of %s restores every id, and redo gives none to another block", (_name, act) => {
      const editor = open(abc(type));
      act(editor);
      const after = seen(editor);

      editor.commands.undo();
      expect(seen(editor)).toEqual(ORIGINALS);

      editor.commands.redo();
      const redone = seen(editor);
      expect(redone.map((entry) => entry.text)).toEqual(after.map((entry) => entry.text));
      for (const original of ORIGINALS) {
        const holder = redone.find((entry) => entry.id === original.id);
        const before = after.find((entry) => entry.id === original.id);
        expect(holder?.text).toBe(before?.text);
      }

      editor.commands.undo();
      expect(seen(editor)).toEqual(ORIGINALS);
    });
  });

  it("a copy of a block that was removed and brought back by undo is a new block", () => {
    const editor = open(abc(type));
    const original = editor.state.doc.child(1);
    editor.commands.deleteRange({ from: posOf(editor, 1), to: posOf(editor, 2) });
    editor.commands.undo();
    expect(seen(editor)).toEqual(ORIGINALS);

    // Same id, same content: all that sets it apart is that the original is back.
    editor.view.dispatch(editor.state.tr.insert(endOf(editor), original));

    const blocks = seen(editor);
    expect(blocks.slice(0, 3)).toEqual(ORIGINALS);
    expect(blocks[3].text).toBe(TEXT_B);
    expectNew([blocks[3].id], 1);
  });

  it("two copies of a removed block inserted together are both new", () => {
    const editor = open(abc(type));
    const original = editor.state.doc.child(1);
    editor.commands.deleteRange({ from: posOf(editor, 1), to: posOf(editor, 2) });
    editor.view.dispatch(editor.state.tr.insert(endOf(editor), [original, original]));

    const blocks = seen(editor);
    expect(blocks.slice(0, 2)).toEqual([ORIGINALS[0], ORIGINALS[2]]);
    expectNew(blocks.slice(2).map((entry) => entry.id), 2);
  });

  describe("a move that cannot be told apart", () => {
    const stripped = (editor: Editor, index: number) => {
      const node = editor.state.doc.child(index);
      return node.type.create({ ...node.attrs, [NODE_ID_ATTRIBUTE]: null }, node.content);
    };

    it("two identical blocks removed, one identical block inserted: it is new", () => {
      const editor = open({ type: "doc", content: [block(type, ID_A, TEXT_A), block(type, ID_B, "Isti."), block(type, ID_C, "Isti.")] });
      const arrival = stripped(editor, 1);
      const tr = editor.state.tr.delete(posOf(editor, 1), endOf(editor));
      editor.view.dispatch(tr.insert(0, arrival));

      const blocks = seen(editor);
      expect(blocks[1]).toEqual(ORIGINALS[0]);
      expectNew([blocks[0].id], 1);
    });

    it("one block removed, two identical blocks inserted: both are new", () => {
      const editor = open(abc(type));
      const arrival = stripped(editor, 1);
      const tr = editor.state.tr.delete(posOf(editor, 1), posOf(editor, 2));
      editor.view.dispatch(tr.insert(0, [arrival, arrival]));

      const blocks = seen(editor);
      expect(blocks.slice(2)).toEqual([ORIGINALS[0], ORIGINALS[2]]);
      expectNew(blocks.slice(0, 2).map((entry) => entry.id), 2);
    });

    it("the moved block's id is already held by another block: the moved block is new", () => {
      // Content the editor was opened with can hold the same id twice.
      const editor = open({ type: "doc", content: [block(type, ID_A, TEXT_A), block(type, ID_A, TEXT_B), block(type, ID_C, TEXT_C)] });
      const arrival = stripped(editor, 1);
      const tr = editor.state.tr.delete(posOf(editor, 1), posOf(editor, 2));
      editor.view.dispatch(tr.insert(tr.doc.content.size, arrival));

      const blocks = seen(editor);
      expect(blocks.slice(0, 2)).toEqual([ORIGINALS[0], ORIGINALS[2]]);
      expect(blocks[2].text).toBe(TEXT_B);
      expectNew([blocks[2].id], 1);
    });
  });

  it("a block opened with a malformed id is the same block after a move: the id is still reported, not replaced", () => {
    const editor = open({ type: "doc", content: [block(type, "not-a-uuid", "Učitano."), block(type, ID_B, TEXT_B)] });
    const node = editor.state.doc.child(0);
    const tr = editor.state.tr.delete(0, node.nodeSize);
    editor.view.dispatch(tr.insert(tr.doc.content.size, node));

    const result = project(editor);
    expect(!result.ok && result.errors).toEqual([
      { path: `$.content[1].attrs.${NODE_ID_ATTRIBUTE}`, code: "TIPTAP_NODE_ID_INVALID" },
    ]);
  });

  it("a move is decided before a restore: the arrival takes the id of the block that left in this transaction", () => {
    const editor = open({ type: "doc", content: [block(type, ID_A, TEXT_A), block(type, ID_B, "Isti."), block(type, ID_C, "Isti.")] });
    const earlier = editor.state.doc.child(1);
    editor.view.dispatch(editor.state.tr.delete(posOf(editor, 1), posOf(editor, 2)));
    // Identical to the block removed before and to the one removed now; it carries the id of the first.
    const tr = editor.state.tr.delete(posOf(editor, 1), endOf(editor));
    editor.view.dispatch(tr.insert(0, earlier));

    expect(seen(editor)).toEqual([{ id: ID_C, text: "Isti." }, ORIGINALS[0]]);
  });

  it("a block that stayed where it was is never taken for the arrival of a move", () => {
    // Opened with a block that has no id yet and is identical to B.
    const editor = open({ type: "doc", content: [block(type, ID_A, TEXT_A), block(type, ID_B, TEXT_B), block(type, null, TEXT_B)] });
    editor.view.dispatch(editor.state.tr.delete(posOf(editor, 1), posOf(editor, 2)));

    const blocks = seen(editor);
    expect(blocks[0]).toEqual(ORIGINALS[0]);
    expect(blocks[1].text).toBe(TEXT_B);
    expectNew([blocks[1].id], 1);
  });

  it("a change of selection alone changes nothing, even with a block that has no id yet", () => {
    const editor = open({ type: "doc", content: [block(type, ID_A, TEXT_A), block(type, null, TEXT_B)] });
    let transactions = 0;
    editor.on("transaction", () => {
      transactions += 1;
    });
    editor.commands.setTextSelection(3);

    expect(transactions).toBe(1);
    expect(editor.getJSON().content[1].attrs?.[NODE_ID_ATTRIBUTE]).toBeNull();
  });

  it("changing the type of an empty block keeps the id", () => {
    const editor = open({ type: "doc", content: [block(type, ID_A, TEXT_A), block(type, ID_B, ""), block(type, ID_C, TEXT_C)] });
    editor.commands.setTextSelection(posOf(editor, 1) + 1);
    editor.commands.setNode(type === "heading" ? "paragraph" : "heading", { level: 3 });

    expect(editor.getJSON().content[1].type).not.toBe(type);
    expect(seen(editor).map((entry) => entry.id)).toEqual([ID_A, ID_B, ID_C]);
  });

  describe.each([
    ["exactly", ID_A as string],
    ["in another letter case", ID_A.toUpperCase()],
  ])("content the editor was opened with holds the same id twice, %s", (_name, twin) => {
    const twice = (): TiptapDocumentJSON => ({
      type: "doc",
      content: [block(type, ID_A, TEXT_A), block(type, twin, TEXT_B), block(type, ID_C, TEXT_C)],
    });

    it("the first edit leaves the id with the earlier block and gives the later one a new id that stays", () => {
      const editor = open(twice());
      editor.view.dispatch(editor.state.tr.insertText("!", endOf(editor) - 1));

      const blocks = seen(editor);
      expect([blocks[0], blocks[2]]).toEqual([ORIGINALS[0], { id: ID_C, text: `${TEXT_C}!` }]);
      expectNew([blocks[1].id], 1);
      expect(editor.getJSON().content.map((node) => node.attrs?.[NODE_ID_ATTRIBUTE])).toEqual(blocks.map((entry) => entry.id));
    });
  });

  it("an anchor on a block resolves on that block only, never on a copy", () => {
    const editor = open(abc(type));
    const anchor = createTextAnchor({ nodeId: ID_B, nodeText: TEXT_B, start: 6, end: 10 });

    editor.commands.insertContentAt(0, copies());
    editor.commands.insertContentAt(posOf(editor, 4), block(type, ID_B, TEXT_B));
    const withCopies = seen(editor);
    const resolved = withCopies.map((entry) => resolveTextAnchor(anchor, entry.id as NodeId, entry.text).status);
    // Blocks 0-2 are the first copies, block 3 is A, block 4 the second copy of B, block 5 the original B.
    expect(resolved).toEqual(["missing", "missing", "missing", "missing", "missing", "exact", "missing"]);
    expect(withCopies[5]).toEqual(ORIGINALS[1]);

    // The original is rewritten; the untouched copies must not stand in for it.
    const from = posOf(editor, 5) + 1;
    editor.view.dispatch(editor.state.tr.insertText("Posve drugi sadržaj.", from, from + TEXT_B.length));
    const rewritten = seen(editor);
    expect(rewritten[5]).toEqual({ id: ID_B, text: "Posve drugi sadržaj." });
    expect(rewritten.map((entry) => resolveTextAnchor(anchor, entry.id as NodeId, entry.text).status)).toEqual(
      Array.from({ length: 7 }, () => "missing"),
    );
  });
});

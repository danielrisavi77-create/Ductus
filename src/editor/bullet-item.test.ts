// @vitest-environment node
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createEditStepsV1Replayer } from "@/adapters/evidence/edit-steps-v1-replayer";
import { REVISION_ZERO_JCS, REVISION_ZERO_SHA256 } from "@/domain/document/revision-zero";
import { digestCanonicalDocumentV2 } from "@/domain/forensics/evidence-replay-v2";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";

import { BulletItem, bulletItemBackspace, bulletItemEnter } from "./bullet-item";
import { blocks, canonical, ID_A, recordedEditor, replays, typeChar } from "./capture.fixture";
import { canonicalToTiptap, tiptapToCanonical } from "./interop";
import { createEditorExtensions } from "./schema";

/**
 * E1 part 1 (#823, DAN-326, contract issuecomment-6412639687, QA criterion
 * §4): the bullet item in the real editor schema. Every change is captured
 * and replayed on the server's replayer to the same document. A headless
 * editor has no view to send keys to, so the key handlers are called as the
 * keymap calls them; e2e/bullet-item.spec.ts presses the real keys. Invented
 * ids and filler text only.
 */

/** What the keymap runs for each key of the item (bullet-item.ts). */
const shortcuts = () =>
  BulletItem.config.addKeyboardShortcuts!.call({ editor: null, name: "bulletItem" } as never) as Record<string, unknown>;

const setup = (text = "Prva stavka") => recordedEditor(text);

describe("E1: making and leaving a bullet item", () => {
  it("the button's command turns a paragraph into an item and back with the same id; undo and redo", async () => {
    const t = setup();
    t.editor.chain().setTextSelection(3).toggleNode("bulletItem", "paragraph").run();
    expect(blocks(t.editor)).toEqual([["bulletItem", "Prva stavka", ID_A]]);
    expect(t.editor.isActive("bulletItem")).toBe(true);
    t.as("editor");
    t.editor.commands.undo();
    expect(blocks(t.editor)).toEqual([["paragraph", "Prva stavka", ID_A]]);
    t.as("editor");
    t.editor.commands.redo();
    expect(blocks(t.editor)).toEqual([["bulletItem", "Prva stavka", ID_A]]);
    t.as("editor");
    t.editor.chain().toggleNode("bulletItem", "paragraph").run();
    expect(blocks(t.editor)).toEqual([["paragraph", "Prva stavka", ID_A]]);
    await replays(t);
  });

  it("binds Mod-Shift-8 (the toggle, also from a heading), Enter and Backspace, and not Tab", async () => {
    expect(Object.keys(shortcuts()).sort()).toEqual(["Backspace", "Enter", "Mod-Shift-8"]);
    const t = setup();
    t.editor.chain().setTextSelection(3).setHeading({ level: 2 }).run();
    t.as("editor");
    t.editor.commands.toggleNode("bulletItem", "paragraph");
    expect(blocks(t.editor)).toEqual([["bulletItem", "Prva stavka", ID_A]]);
    await replays(t);
  });
});

describe("E1: Enter, Backspace and Tab at the edges of an item", () => {
  function list(text = "Prva stavka") {
    const t = setup(text);
    t.editor.chain().setTextSelection(1).toggleNode("bulletItem", "paragraph").run();
    t.as("editor");
    return t;
  }

  it("Enter at the end opens a new item with its own id", async () => {
    const t = list();
    t.editor.commands.setTextSelection(12);
    expect(bulletItemEnter(t.editor)).toBe(true);
    typeChar(t.editor, "D");
    const [first, second] = blocks(t.editor);
    expect(first).toEqual(["bulletItem", "Prva stavka", ID_A]);
    expect(second?.slice(0, 2)).toEqual(["bulletItem", "D"]);
    expect(second?.[2]).toMatch(/^[0-9a-f-]{36}$/);
    expect(second?.[2]).not.toBe(ID_A);
    await replays(t);
  });

  it("Enter in the middle splits the item into two items", async () => {
    const t = list();
    t.editor.commands.setTextSelection(5);
    // In the middle the keymap leaves Enter to the editor's own split.
    expect(bulletItemEnter(t.editor)).toBe(false);
    t.editor.commands.splitBlock();
    expect(blocks(t.editor).map(([type, text]) => [type, text])).toEqual([["bulletItem", "Prva"], ["bulletItem", " stavka"]]);
    await replays(t);
  });

  it("Enter on an empty item gives a paragraph back, with the item's id", async () => {
    const t = list();
    t.editor.commands.setTextSelection(12);
    bulletItemEnter(t.editor);
    const id = blocks(t.editor)[1]![2];
    t.as("editor");
    expect(bulletItemEnter(t.editor)).toBe(true);
    expect(blocks(t.editor)).toEqual([["bulletItem", "Prva stavka", ID_A], ["paragraph", "", id]]);
    await replays(t);
  });

  it("Backspace at the start of an item gives a paragraph and keeps the text; the next Backspace joins", async () => {
    const t = list();
    t.editor.commands.setTextSelection(12);
    bulletItemEnter(t.editor);
    typeChar(t.editor, "D");
    t.as("editor");
    t.editor.commands.setTextSelection(14);
    expect(bulletItemBackspace(t.editor)).toBe(true);
    expect(blocks(t.editor).map(([type, text]) => [type, text])).toEqual([["bulletItem", "Prva stavka"], ["paragraph", "D"]]);
    t.as("editor");
    // A paragraph now: the keymap leaves Backspace to the editor, which joins.
    expect(bulletItemBackspace(t.editor)).toBe(false);
    t.editor.commands.joinBackward();
    expect(blocks(t.editor)).toEqual([["bulletItem", "Prva stavkaD", ID_A]]);
    await replays(t);
  });

  it("Delete at the end of a paragraph before an item joins without losing text", async () => {
    const t = setup("Odlomak");
    t.editor.commands.setTextSelection(8);
    t.editor.commands.splitBlock();
    typeChar(t.editor, "S");
    t.editor.commands.toggleNode("bulletItem", "paragraph");
    t.as("editor");
    t.editor.chain().setTextSelection(8).joinForward().run();
    expect(blocks(t.editor)).toEqual([["paragraph", "OdlomakS", ID_A]]);
    await replays(t);
  });

  it("leaves Enter and Backspace to the editor outside an item, or with a selection", () => {
    const t = setup();
    t.editor.commands.setTextSelection(12);
    expect(bulletItemEnter(t.editor)).toBe(false);
    t.editor.commands.setTextSelection(1);
    expect(bulletItemBackspace(t.editor)).toBe(false);
    t.editor.chain().toggleNode("bulletItem", "paragraph").setTextSelection({ from: 1, to: 3 }).run();
    expect(bulletItemEnter(t.editor)).toBe(false);
    expect(bulletItemBackspace(t.editor)).toBe(false);
  });
});

describe("E1: interop and revision 0", () => {
  it("an item survives the round trip canonical → Tiptap → canonical, and Tiptap's JSON loads", () => {
    const doc = {
      schemaVersion: 1 as const,
      nodes: [{ type: "bulletItem" as const, id: ID_A as never, children: [{ type: "text" as const, text: "Lorem", marks: ["bold" as const] }] }],
    };
    const json = canonicalToTiptap(doc);
    expect(json.content[0]).toEqual({ type: "bulletItem", attrs: { nodeId: ID_A }, content: [{ type: "text", text: "Lorem", marks: [{ type: "bold" }] }] });
    expect(tiptapToCanonical(json)).toEqual({ ok: true, doc });
    expect(tiptapToCanonical({ type: "doc", content: [{ type: "listItem", attrs: { nodeId: ID_A } }] }))
      .toMatchObject({ ok: false, errors: [{ code: "TIPTAP_UNKNOWN_NODE_TYPE" }] });
  });

  it("revision 0 keeps its bytes and hash through the new schema, interop and the replayer", async () => {
    const replayer = createEditStepsV1Replayer();
    const loaded = replayer.load(JSON.parse(REVISION_ZERO_JCS) as JcsJsonValue);
    expect(canonicalizeJcs(replayer.toCanonical(loaded))).toBe(REVISION_ZERO_JCS);
    const editor = new Editor({ element: null, extensions: createEditorExtensions(), content: loaded.toJSON() });
    expect(canonicalizeJcs(canonical(editor))).toBe(REVISION_ZERO_JCS);
    expect((await digestCanonicalDocumentV2(JSON.parse(REVISION_ZERO_JCS) as JcsJsonValue)).sha256).toBe(REVISION_ZERO_SHA256);
  });
});

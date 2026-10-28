// @vitest-environment node
import { describe, expect, it } from "vitest";

import { BULLET_MARKER, markerToBulletItem } from "./bullet-item";
import { blocks, ID_A, recordedEditor, replays, typeChar, type Recorded } from "./capture.fixture";

/**
 * E1 part 1 (#823): "- " or "* " at the start of a block makes it a bullet
 * item. The change of type and the removal of the marker are two
 * transactions, so the block keeps its id even when the marker was its only
 * text (identity.ts rule 1 follows the text), and the recorder writes both.
 * Invented text only.
 */

/** What the input rule does once the space after the marker is typed. */
function rule(t: Recorded, from: number, to: number): boolean {
  return t.editor.commands.command(({ tr }) => markerToBulletItem(tr, from, to, t.editor.schema.nodes.bulletItem!));
}

describe("E1: the bullet marker", () => {
  it.each(["- ", "* ", "  - "])("'%s' at the start of a block is the marker", (typed) => {
    expect(BULLET_MARKER.test(typed)).toBe(true);
  });

  it.each(["Tekst - ", "-", "+ ", "1. ", "-  x", "– "])("'%s' is not", (typed) => {
    expect(BULLET_MARKER.test(typed)).toBe(false);
  });

  it("on an empty line makes an empty item that keeps the block's id, and replays", async () => {
    const t = recordedEditor("");
    t.editor.commands.setTextSelection(1);
    typeChar(t.editor, "-");
    t.as("editor");
    expect(rule(t, 1, 2)).toBe(true);
    expect(blocks(t.editor)).toEqual([["bulletItem", "", ID_A]]);
    typeChar(t.editor, "S");
    expect(blocks(t.editor)).toEqual([["bulletItem", "S", ID_A]]);
    await replays(t);
  });

  it("in front of text makes an item of that text with the same id, and replays", async () => {
    const t = recordedEditor("Tekst");
    t.editor.commands.setTextSelection(1);
    typeChar(t.editor, "*");
    t.as("editor");
    expect(rule(t, 1, 2)).toBe(true);
    expect(blocks(t.editor)).toEqual([["bulletItem", "Tekst", ID_A]]);
    await replays(t);
  });

  it("one undo gives the paragraph with the marker back", async () => {
    const t = recordedEditor("Tekst");
    t.editor.commands.setTextSelection(1);
    typeChar(t.editor, "-");
    t.as("editor");
    rule(t, 1, 2);
    t.as("editor");
    t.editor.commands.undo();
    expect(blocks(t.editor)[0]![0]).toBe("paragraph");
    expect(blocks(t.editor)[0]![2]).toBe(ID_A);
    await replays(t);
  });

  it("does nothing in a block that is an item already", () => {
    const t = recordedEditor("Tekst");
    t.editor.commands.setTextSelection(1);
    typeChar(t.editor, "-");
    expect(rule(t, 1, 2)).toBe(true);
    const before = t.editor.state.doc;
    expect(t.editor.can().command(({ tr }) => markerToBulletItem(tr, 1, 1, t.editor.schema.nodes.bulletItem!))).toBe(false);
    expect(t.editor.state.doc.eq(before)).toBe(true);
  });
});

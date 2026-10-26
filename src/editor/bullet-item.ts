/**
 * One item of a bullet list (E1, #823, contract issuecomment-6412639687).
 *
 * A flat text block of the same level as a paragraph, never a wrapper:
 * consecutive items are one list on screen. The canonical model, the edit
 * step format and the replayer all assume blocks of depth 1, so Tiptap's
 * `BulletList` > `ListItem` > `Paragraph` cannot be used (schema.ts).
 *
 * Keys: Mod-Shift-8 turns the block into an item and back; "- " or "* " at
 * the start of a block makes it an item. Enter at the end of an item opens
 * the next item; Enter on an empty item and Backspace at the start of an
 * item give a paragraph back, keeping the text and the block's id. Tab is
 * not taken: there is no nesting.
 *
 * Pasted HTML: an item of `ul` becomes an item, a nested `ul` becomes the
 * following items, an item of `ol` stays a paragraph (no numbered list).
 */

import { InputRule, Node, type Editor } from "@tiptap/core";
import type { NodeType } from "@tiptap/pm/model";
import { PluginKey, type Transaction } from "@tiptap/pm/state";

import { markerRemoval, markerToBlock, textBlockBackspace, textBlockEnter } from "./text-block";

export const BULLET_ITEM = "bulletItem";

/** How the editor writes an item into its own HTML (and reads it back). */
export const BULLET_ITEM_HTML_ATTRIBUTE = "data-block";
export const BULLET_ITEM_HTML_VALUE = "bullet-item";

const markerKey = new PluginKey<null>("bulletItemMarker");

export const BulletItem = Node.create({
  name: BULLET_ITEM,
  group: "block",
  content: "inline*",

  parseHTML() {
    return [
      { tag: `p[${BULLET_ITEM_HTML_ATTRIBUTE}="${BULLET_ITEM_HTML_VALUE}"]`, priority: 60 },
      // An item holding paragraphs (as Google Docs writes it) is read through
      // them, so it gives items, never an empty item before a paragraph.
      { tag: "ul > li", getAttrs: (element) => (element.querySelector(":scope > p") ? false : null) },
      { tag: "ul > li > p", priority: 60 },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["p", { ...HTMLAttributes, [BULLET_ITEM_HTML_ATTRIBUTE]: BULLET_ITEM_HTML_VALUE }, 0];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-8": () => this.editor.commands.toggleNode(this.name, "paragraph"),
      Enter: () => bulletItemEnter(this.editor),
      Backspace: () => bulletItemBackspace(this.editor),
    };
  },

  addProseMirrorPlugins() {
    return [markerRemoval(markerKey)];
  },

  addInputRules() {
    return [
      new InputRule({
        find: BULLET_MARKER,
        handler: ({ state, range }) => (markerToBulletItem(state.tr, range.from, range.to, this.type) ? undefined : null),
      }),
    ];
  },
});

/** "- " or "* " typed at the start of a block. */
export const BULLET_MARKER = /^\s*([-*])\s$/;

/** Enter in a bullet item (`textBlockEnter`). */
export function bulletItemEnter(editor: Editor): boolean {
  return textBlockEnter(editor, BULLET_ITEM);
}

/** Backspace at the start of a bullet item (`textBlockBackspace`). */
export function bulletItemBackspace(editor: Editor): boolean {
  return textBlockBackspace(editor, BULLET_ITEM);
}

/** The input rule's change for "- " and "* " (`markerToBlock`). */
export function markerToBulletItem(tr: Transaction, from: number, to: number, item: NodeType): boolean {
  return markerToBlock(tr, from, to, item, markerKey);
}

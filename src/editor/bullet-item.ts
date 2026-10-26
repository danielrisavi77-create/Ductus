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
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";

import { NODE_ID_ATTRIBUTE } from "./interop";

export const BULLET_ITEM = "bulletItem";

/** How the editor writes an item into its own HTML (and reads it back). */
export const BULLET_ITEM_HTML_ATTRIBUTE = "data-block";
export const BULLET_ITEM_HTML_VALUE = "bullet-item";

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
    return [markerRemoval];
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

/**
 * Enter in a bullet item, or false to leave the key to the editor: at the
 * end of an item a new item, on an empty item a paragraph. Elsewhere the
 * editor's own split already keeps the item's type.
 */
export function bulletItemEnter(editor: Editor): boolean {
  const { state } = editor;
  const { $from, empty } = state.selection;
  const item = state.schema.nodes[BULLET_ITEM];
  if (!empty || !item || $from.parent.type !== item) return false;
  if ($from.parent.content.size === 0) return editor.commands.setNode("paragraph");
  if ($from.parentOffset < $from.parent.content.size) return false;
  const marks = state.storedMarks ?? $from.marks();
  return editor.commands.command(({ tr, dispatch }) => {
    // The new item has no id: the identity plugin gives it its own.
    if (dispatch) tr.split($from.pos, 1, [{ type: item }]).ensureMarks(marks).scrollIntoView();
    return true;
  });
}

/**
 * Backspace at the start of a bullet item: the item becomes a paragraph and
 * keeps its text. Only the next Backspace joins it with the block before.
 */
export function bulletItemBackspace(editor: Editor): boolean {
  const { $from, empty } = editor.state.selection;
  if (!empty || $from.parent.type.name !== BULLET_ITEM || $from.parentOffset !== 0) return false;
  return editor.commands.setNode("paragraph");
}

type Marker = { from: number; to: number; text: string };

const markerKey = new PluginKey<null>("bulletItemMarker");

/**
 * Removes the typed marker in a transaction of its own, right after the
 * change of type. In one transaction a block whose only text is the marker
 * would have no text left and a new wrapper, so identity.ts (rule 1) would
 * take it for a new block and give it a new id. Apart, the change of type
 * keeps the id because the text is still there, and the removal keeps it
 * because the wrapper is. Removes nothing unless the marker is still there.
 */
const markerRemoval = new Plugin({
  key: markerKey,
  appendTransaction(transactions, _old, state) {
    const marker = transactions.map((tr) => tr.getMeta(markerKey) as Marker | undefined).find(Boolean);
    if (!marker || marker.to > state.doc.content.size || state.doc.textBetween(marker.from, marker.to) !== marker.text) {
      return null;
    }
    return state.tr.delete(marker.from, marker.to);
  },
});

/**
 * The input rule's change: makes the block of the marker `from..to` an item
 * that keeps its id (a change of type is not a new block), and leaves the
 * marker to `markerRemoval`. False when the block is an item already or
 * cannot become one.
 */
export function markerToBulletItem(tr: Transaction, from: number, to: number, item: NodeType): boolean {
  const $start = tr.doc.resolve(from);
  const block = $start.parent;
  if (block.type === item || !$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), item)) {
    return false;
  }
  const marker: Marker = { from, to, text: tr.doc.textBetween(from, to) };
  tr.setBlockType(from, from, item, { [NODE_ID_ATTRIBUTE]: block.attrs[NODE_ID_ATTRIBUTE] }).setMeta(markerKey, marker);
  return true;
}

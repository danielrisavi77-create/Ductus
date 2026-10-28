/**
 * What the flat text blocks of E1 (#823) share: the bullet item
 * (`bullet-item.ts`) and the quote (`quote.ts`). Each is a text block of the
 * same level as a paragraph, never a wrapper, so Enter, Backspace and the
 * typed marker work the same way for both; only the type differs.
 */

import type { Editor } from "@tiptap/core";
import type { NodeType } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";

import { NODE_ID_ATTRIBUTE } from "./interop";

/**
 * Enter in a block of `type`, or false to leave the key to the editor: at the
 * end of the block a new block of the same type, on an empty block a
 * paragraph. Elsewhere the editor's own split already keeps the type.
 */
export function textBlockEnter(editor: Editor, type: string): boolean {
  const { state } = editor;
  const { $from, empty } = state.selection;
  const block = state.schema.nodes[type];
  if (!empty || !block || $from.parent.type !== block) return false;
  if ($from.parent.content.size === 0) return editor.commands.setNode("paragraph");
  if ($from.parentOffset < $from.parent.content.size) return false;
  const marks = state.storedMarks ?? $from.marks();
  return editor.commands.command(({ tr, dispatch }) => {
    // The new block has no id: the identity plugin gives it its own.
    if (dispatch) tr.split($from.pos, 1, [{ type: block }]).ensureMarks(marks).scrollIntoView();
    return true;
  });
}

/**
 * Backspace at the start of a block of `type`: it becomes a paragraph and
 * keeps its text. Only the next Backspace joins it with the block before.
 */
export function textBlockBackspace(editor: Editor, type: string): boolean {
  const { $from, empty } = editor.state.selection;
  if (!empty || $from.parent.type.name !== type || $from.parentOffset !== 0) return false;
  return editor.commands.setNode("paragraph");
}

type Marker = { from: number; to: number; text: string };

/**
 * Removes a typed marker in a transaction of its own, right after the change
 * of type. In one transaction a block whose only text is the marker would
 * have no text left and a new wrapper, so identity.ts (rule 1) would take it
 * for a new block and give it a new id. Apart, the change of type keeps the
 * id because the text is still there, and the removal keeps it because the
 * wrapper is. Removes nothing unless the marker is still there.
 */
export function markerRemoval(key: PluginKey<null>): Plugin<null> {
  return new Plugin({
    key,
    appendTransaction(transactions, _old, state) {
      const marker = transactions.map((tr) => tr.getMeta(key) as Marker | undefined).find(Boolean);
      if (!marker || marker.to > state.doc.content.size || state.doc.textBetween(marker.from, marker.to) !== marker.text) {
        return null;
      }
      return state.tr.delete(marker.from, marker.to);
    },
  });
}

/**
 * An input rule's change: makes the block of the marker `from..to` a block of
 * `type` that keeps its id (a change of type is not a new block), and leaves
 * the marker to the `markerRemoval` plugin of `key`. False when the block has
 * that type already or cannot take it.
 */
export function markerToBlock(tr: Transaction, from: number, to: number, type: NodeType, key: PluginKey<null>): boolean {
  const $start = tr.doc.resolve(from);
  const block = $start.parent;
  if (block.type === type || !$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), type)) {
    return false;
  }
  const marker: Marker = { from, to, text: tr.doc.textBetween(from, to) };
  tr.setBlockType(from, from, type, { [NODE_ID_ATTRIBUTE]: block.attrs[NODE_ID_ATTRIBUTE] }).setMeta(key, marker);
  return true;
}

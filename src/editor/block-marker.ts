/**
 * A typed marker that changes the type of its block ("# " for a heading),
 * in two transactions instead of Tiptap's one.
 *
 * In one transaction a block whose only text is the marker would have no text
 * left and a new type, so identity.ts (rule 1) would take it for a new block
 * and give it a new id; the evidence recorder then stops, as the edit steps
 * cannot carry an id taken over that way. Apart, the change of type keeps the
 * id because the text is still there, and the removal of the marker keeps it
 * because the type is. Found in E1 (#823), where "- " had the same problem.
 */

import { InputRule } from "@tiptap/core";
import type { Attrs, NodeType } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";

import { NODE_ID_ATTRIBUTE } from "./interop";

type Marker = { from: number; to: number; text: string };

/**
 * Removes the marker in a transaction of its own, right after the change of
 * type. Removes nothing unless the marker is still there. Its extension must
 * come before NodeIdentity in the extension list, so NodeIdentity sees the
 * change of type before the removal (Tiptap runs plugins last-first).
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
 * Makes the block of the marker `from..to` a block of `type` with `attrs`,
 * keeping its id, and leaves the marker to the `markerRemoval` plugin of
 * `key`. When the block has that type already, only removes the marker, as
 * Tiptap's rule did; the type stays, so the id does. False when the block
 * cannot take that type.
 */
export function markerToBlock(
  tr: Transaction, from: number, to: number, type: NodeType, attrs: Attrs, key: PluginKey<null>,
): boolean {
  const $start = tr.doc.resolve(from);
  const block = $start.parent;
  const same = block.type === type && Object.entries(attrs).every(([name, value]) => block.attrs[name] === value);
  if (same) {
    tr.delete(from, to);
    return true;
  }
  if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), type)) return false;
  const marker: Marker = { from, to, text: tr.doc.textBetween(from, to) };
  tr.setBlockType(from, from, type, { ...attrs, [NODE_ID_ATTRIBUTE]: block.attrs[NODE_ID_ATTRIBUTE] }).setMeta(key, marker);
  return true;
}

/** The input rule: `find` at the start of a block, `attrs` from its match. */
export function blockMarkerRule(
  find: RegExp, type: NodeType, key: PluginKey<null>, attrs: (match: RegExpMatchArray) => Attrs,
): InputRule {
  return new InputRule({
    find,
    // Tiptap's undoInputRule (Backspace right after the rule) would revert
    // only the change of type, not the removal that follows it; the removal
    // also clears its state, so say so instead of relying on that.
    undoable: false,
    handler: ({ state, range, match }) => (markerToBlock(state.tr, range.from, range.to, type, attrs(match), key) ? undefined : null),
  });
}

/**
 * Comments next to a paragraph, shown in the editor (F-9 step 1, BACKEND 4.11).
 *
 * A comment is a separate record with an anchor, never a mark in the
 * document: the server returns the anchor as the teacher saved it and the
 * client resolves it here against the text it holds. Only an `exact` or
 * `moved` resolution gives a place in the text; `ambiguous` and `missing`
 * give none, so a comment is never shown at the wrong place (attack 7).
 * The highlight is a decoration: it changes neither the document nor the
 * journal.
 */

import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { resolveTextAnchor, type TextAnchor } from "@/domain/collaboration";

import { NODE_ID_ATTRIBUTE } from "./interop";

export type CommentRange = { readonly from: number; readonly to: number };

/** Document position of a text offset inside a textblock, or null. */
function positionOf(block: PmNode, blockPos: number, offset: number, atEnd: boolean): number | null {
  let text = 0;
  let found: number | null = null;
  block.forEach((child, childOffset) => {
    if (found !== null) return;
    // A leaf such as a line break counts with its leaf text, as in textContent.
    const length = child.isText ? child.text!.length : child.textContent.length;
    // An end offset belongs to the text node it closes, a start to the one it opens.
    if (child.isText && offset >= text && (atEnd ? offset <= text + length : offset < text + length)) {
      found = blockPos + 1 + childOffset + (offset - text);
    }
    text += length;
  });
  return found;
}

/** Where the anchor lies in `doc`, or null when it cannot be placed reliably. */
export function anchorRange(doc: PmNode, anchor: TextAnchor): CommentRange | null {
  let range: CommentRange | null = null;
  doc.descendants((node, pos) => {
    if (range !== null) return false;
    if (node.attrs[NODE_ID_ATTRIBUTE] !== anchor.nodeId) return true;
    if (!node.isTextblock) return false;
    const resolved = resolveTextAnchor(anchor, anchor.nodeId, node.textContent);
    if (resolved.status === "exact" || resolved.status === "moved") {
      const from = positionOf(node, pos, resolved.start, false);
      const to = positionOf(node, pos, resolved.end, true);
      if (from !== null && to !== null && from < to) range = { from, to };
    }
    return false;
  });
  return range;
}

/**
 * Places a list of items again only when the document or the list changed.
 * The editor asks on every transaction, a cursor move included; the document
 * of an unchanged text is the same object, so the last places are returned.
 */
export function createAnchorPlacer<T>(anchorOf: (item: T) => TextAnchor | null) {
  let last: { doc: PmNode; items: readonly T[]; ranges: readonly (CommentRange | null)[] } | null = null;
  return (doc: PmNode, items: readonly T[]): readonly (CommentRange | null)[] => {
    if (last && last.doc === doc && last.items === items) return last.ranges;
    const ranges = items.map((item) => {
      const anchor = anchorOf(item);
      return anchor ? anchorRange(doc, anchor) : null;
    });
    last = { doc, items, ranges };
    return ranges;
  };
}

export const commentHighlightKey = new PluginKey<DecorationSet>("commentHighlight");

/** Marks the placed comments. A transaction with this key's meta replaces the ranges. */
export function commentHighlightPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: commentHighlightKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const ranges = tr.getMeta(commentHighlightKey) as readonly CommentRange[] | undefined;
        if (ranges === undefined) return set.map(tr.mapping, tr.doc);
        return DecorationSet.create(
          tr.doc,
          ranges.map((r) => Decoration.inline(r.from, r.to, { class: "comment-mark" })),
        );
      },
    },
    props: {
      decorations: (state: EditorState) => commentHighlightKey.getState(state),
    },
  });
}

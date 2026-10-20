/**
 * Comment anchors over the document of the teacher's live view (DAN-86 step
 * 2c; anchors: BACKEND 4.11, src/domain/collaboration/anchor.ts). The view
 * renders a CanonicalDocument, not an editor, so the text of a block is the
 * concatenation of its inline texts and offsets count UTF-16 code units, as
 * `createTextAnchor` and `resolveTextAnchor` do.
 */

import {
  ANCHOR_QUOTE_MAX, createTextAnchor, isTextAnchorInput, resolveTextAnchor, type TextAnchor,
} from "@/domain/collaboration";
import type { CanonicalDocument, DocumentNode, Mark, NodeId } from "@/domain/document";

export type TextRange = { readonly nodeId: NodeId; readonly start: number; readonly end: number };

export const blockText = (node: DocumentNode): string => node.children.map((child) => child.text).join("");

/**
 * The anchor for a selection inside one block, or null when it cannot be a
 * valid anchor: another block, an empty or blank selection, more than
 * ANCHOR_QUOTE_MAX code points. Surrounding white space is left out of the quote.
 */
export function anchorForSelection(
  doc: CanonicalDocument, nodeId: string, start: number, end: number,
): TextAnchor | null {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const text = blockText(node);
  let from = Math.min(start, end);
  let to = Math.max(start, end);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to > text.length) return null;
  while (from < to && /\s/u.test(text[from]!)) from += 1;
  while (to > from && /\s/u.test(text[to - 1]!)) to -= 1;
  if (from === to || [...text.slice(from, to)].length > ANCHOR_QUOTE_MAX) return null;
  const anchor = createTextAnchor({ nodeId: node.id, nodeText: text, start: from, end: to });
  return isTextAnchorInput(anchor) ? anchor : null;
}

/**
 * Where an anchor stands in the document now: only `exact` and `moved` give a
 * place; anything else is no place, never a guessed one (attack 7).
 */
export function placeAnchor(doc: CanonicalDocument | null, anchor: TextAnchor | null): TextRange | null {
  if (!doc || !anchor) return null;
  const node = doc.nodes.find((n) => n.id === anchor.nodeId);
  if (!node) return null;
  const found = resolveTextAnchor(anchor, node.id, blockText(node));
  return found.status === "exact" || found.status === "moved" ? { nodeId: node.id, start: found.start, end: found.end } : null;
}

/**
 * Each thread with its place in `doc`. Before any text has been shown (`doc`
 * null: still loading, nothing sent yet, or the connection retrying before a
 * first text) a thread is `pending`, not lost: there is nothing to look in, so
 * saying the place cannot be found would be untrue.
 */
export function placeThreads<T extends { readonly anchor: TextAnchor | null }>(
  doc: CanonicalDocument | null, threads: readonly T[],
): { thread: T; range: TextRange | null; pending: boolean }[] {
  return threads.map((thread) => ({ thread, range: placeAnchor(doc, thread.anchor), pending: doc === null }));
}

export type Segment = { readonly text: string; readonly marks: readonly Mark[]; readonly marked: boolean };

/**
 * The inline texts of a block cut at the edges of `ranges`, each piece saying
 * whether it lies in one of them. Joined, the pieces are the block's text, so
 * marking a comment never changes what is shown.
 */
export function blockSegments(node: DocumentNode, ranges: readonly { start: number; end: number }[]): Segment[] {
  const inRange = (at: number) => ranges.some((r) => r.start <= at && at < r.end);
  const cuts = new Set(ranges.flatMap((r) => [r.start, r.end]));
  const out: Segment[] = [];
  let at = 0;
  for (const child of node.children) {
    let piece = "";
    let marked = inRange(at);
    for (const ch of child.text) {
      if (piece !== "" && (cuts.has(at) || inRange(at) !== marked)) {
        out.push({ text: piece, marks: child.marks, marked });
        piece = "";
        marked = inRange(at);
      }
      piece += ch;
      at += ch.length;
    }
    if (piece !== "") out.push({ text: piece, marks: child.marks, marked });
  }
  return out;
}


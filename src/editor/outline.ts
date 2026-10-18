/**
 * The heading list of the structure rail (F-8 step 1).
 *
 * Read from the document the editor holds, never stored: the canonical
 * document already has every heading, so the outline is a view of it and adds
 * nothing to the journal. Pure, so it is tested without a DOM.
 */

import type { Node as PmNode } from "@tiptap/pm/model";

import { NODE_ID_ATTRIBUTE } from "./interop";

export type OutlineEntry = {
  /** The block id from the identity plugin, or null before it is minted. */
  readonly id: string | null;
  readonly level: number;
  /** The heading's text, trimmed; "" for an empty heading. */
  readonly text: string;
  /** Document position of the heading node. */
  readonly pos: number;
};

/** Every top-level heading, in document order. */
export function headingOutline(doc: PmNode): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name !== "heading") return;
    const id = node.attrs[NODE_ID_ATTRIBUTE];
    entries.push({
      id: typeof id === "string" && id !== "" ? id : null,
      level: Number(node.attrs.level),
      text: node.textContent.trim(),
      pos: offset,
    });
  });
  return entries;
}

/**
 * Index of the heading whose section holds `from` (the selection start): the
 * last heading at or before it. -1 when the selection is above every heading.
 */
export function currentHeading(outline: readonly OutlineEntry[], from: number): number {
  let current = -1;
  for (let i = 0; i < outline.length; i += 1) {
    if (outline[i]!.pos > from) break;
    current = i;
  }
  return current;
}

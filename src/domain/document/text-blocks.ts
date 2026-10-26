import type { CanonicalDocument } from "./schema";

/** One block of a document's text, in document order, without marks. */
export type TextBlock = { kind: "heading" | "paragraph"; text: string };

/**
 * The text of a document as blocks: a heading of any level is a heading, and
 * every other text block (a paragraph, a bullet list item from E1) is a
 * paragraph. The fast path contract (#757) knows only these two kinds, and its
 * reader refuses a whole response with any other kind, so a new block type of
 * the editor must not reach it unmapped.
 */
export function textBlocksOf(document: CanonicalDocument): TextBlock[] {
  return document.nodes.map((node) => ({
    kind: node.type === "heading" ? "heading" : "paragraph",
    text: node.children.map((child) => child.text).join(""),
  }));
}

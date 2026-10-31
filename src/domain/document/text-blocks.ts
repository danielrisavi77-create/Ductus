import type { CanonicalDocument } from "./schema";

/**
 * One block of a document's text, in document order, without marks. The fast
 * path reader knows four kinds (F-150 point 1); `bulletItem` and `quote` are
 * not sent yet.
 */
export type TextBlock = { kind: "heading" | "paragraph" | "bulletItem" | "quote"; text: string };

/**
 * The text of a document as blocks: a heading of any level is a heading, and
 * every other text block (a paragraph, a bullet list item from E1) is still a
 * paragraph until the server part of F-150 point 1. The fast path reader
 * refuses a whole response with a kind it does not know, so a new block type
 * of the editor must not reach it unmapped.
 */
export function textBlocksOf(document: CanonicalDocument): TextBlock[] {
  return document.nodes.map((node) => ({
    kind: node.type === "heading" ? "heading" : "paragraph",
    text: node.children.map((child) => child.text).join(""),
  }));
}

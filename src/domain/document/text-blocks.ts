import type { CanonicalDocument } from "./schema";

/** One block of a document's text, in document order, without marks. */
export type TextBlock = { kind: "heading" | "paragraph"; text: string };

/** The text of a document as blocks: a heading of any level is a heading. */
export function textBlocksOf(document: CanonicalDocument): TextBlock[] {
  return document.nodes.map((node) => ({
    kind: node.type,
    text: node.children.map((child) => child.text).join(""),
  }));
}

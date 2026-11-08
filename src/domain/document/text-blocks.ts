import { deriveBibliography, formatCitation, type CitationStyle } from "@/domain/citation";

import type { CanonicalDocument, CanonicalDocumentV2, InlineNodeV2 } from "./schema";

/**
 * One block of a document's text, in document order, without marks. The fast
 * path reader knows four kinds (F-150 point 1); `bulletItem` and `quote` are
 * not sent yet.
 */
export type TextBlock = { kind: "heading" | "paragraph" | "bulletItem" | "quote"; text: string };

/**
 * How a v2 citation is shown as text (contract §9.1): the in-text form of the
 * style, and `orphanMark` for a citation whose source is not in the document.
 * The caller supplies the mark, so no interface text lives in the domain.
 */
export type CitationRendering = { style: CitationStyle; orphanMark: string };

/**
 * The text of a document as blocks: a heading of any level is a heading, and
 * every other text block (a paragraph, a bullet list item from E1) is still a
 * paragraph until the server part of F-150 point 1. The fast path reader
 * refuses a whole response with a kind it does not know, so a new block type
 * of the editor must not reach it unmapped.
 *
 * A v2 citation is never dropped: it becomes its visible in-text form, or the
 * orphan mark, with the locator as stored.
 */
export function textBlocksOf(document: CanonicalDocument): TextBlock[];
export function textBlocksOf(document: CanonicalDocumentV2, rendering: CitationRendering): TextBlock[];
export function textBlocksOf(document: CanonicalDocument | CanonicalDocumentV2, rendering?: CitationRendering): TextBlock[] {
  let text: (child: InlineNodeV2) => string = (child) => (child.type === "citation" ? "" : child.text);
  if (document.schemaVersion === 2 && rendering !== undefined) {
    const bibliography = deriveBibliography(document, rendering.style);
    text = (child) =>
      child.type === "citation"
        ? (formatCitation(child, bibliography, rendering.style) ?? rendering.orphanMark)
        : child.text;
  }
  return (document.nodes as readonly { type: string; children: readonly InlineNodeV2[] }[]).map((node) => ({
    kind: node.type === "heading" ? "heading" : "paragraph",
    text: node.children.map(text).join(""),
  }));
}

import type { InlineNodeV2, VersionedDocument } from "./schema";

/**
 * Word count over the canonical text: whitespace-separated runs, counted per
 * block so a paragraph break never fuses two words. A v2 citation is one
 * position without characters (contract §9.1): it adds no word and no
 * character.
 *
 * A reading aid, nothing more. It is never evidence about authorship and
 * never decides anything.
 */
export function documentWordCount(doc: VersionedDocument): number {
  let total = 0;
  for (const node of doc.nodes) {
    const children: readonly InlineNodeV2[] = node.children;
    const text = children.map((child) => (child.type === "citation" ? "" : child.text)).join("");
    for (const word of text.split(/\s+/u)) {
      if (word.length > 0) {
        total += 1;
      }
    }
  }
  return total;
}

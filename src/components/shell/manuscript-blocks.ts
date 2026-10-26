import type { BulletItemNode, DocumentNode, QuoteNode } from "@/domain/document";

/**
 * The blocks of a document as the read-only views show them (E1, #823):
 * consecutive bullet items are one list, consecutive quote paragraphs one
 * block quote, every other block stands alone. The document has no list or
 * quote node (flat model), so the grouping is only here.
 */
export type BlockRun =
  | { readonly kind: "block"; readonly node: Exclude<DocumentNode, BulletItemNode | QuoteNode> }
  | { readonly kind: "list"; readonly items: readonly BulletItemNode[] }
  | { readonly kind: "quote"; readonly items: readonly QuoteNode[] };

export function blockRuns(nodes: readonly DocumentNode[]): BlockRun[] {
  const runs: BlockRun[] = [];
  let open: { kind: "list"; items: BulletItemNode[] } | { kind: "quote"; items: QuoteNode[] } | null = null;
  for (const node of nodes) {
    if (node.type === "bulletItem") {
      if (open?.kind === "list") open.items.push(node);
      else runs.push((open = { kind: "list", items: [node] }));
    } else if (node.type === "quote") {
      if (open?.kind === "quote") open.items.push(node);
      else runs.push((open = { kind: "quote", items: [node] }));
    } else {
      open = null;
      runs.push({ kind: "block", node });
    }
  }
  return runs;
}

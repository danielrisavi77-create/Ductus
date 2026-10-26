import type { BulletItemNode, DocumentNode } from "@/domain/document";

/**
 * The blocks of a document as the read-only views show them (E1, #823):
 * consecutive bullet items are one list, every other block stands alone.
 * The document has no list node (flat model), so the grouping is only here.
 */
export type BlockRun =
  | { readonly kind: "block"; readonly node: Exclude<DocumentNode, BulletItemNode> }
  | { readonly kind: "list"; readonly items: readonly BulletItemNode[] };

export function blockRuns(nodes: readonly DocumentNode[]): BlockRun[] {
  const runs: BlockRun[] = [];
  let list: BulletItemNode[] | null = null;
  for (const node of nodes) {
    if (node.type !== "bulletItem") {
      list = null;
      runs.push({ kind: "block", node });
    } else if (list) {
      list.push(node);
    } else {
      list = [node];
      runs.push({ kind: "list", items: list });
    }
  }
  return runs;
}

/**
 * Canonical document model (F1 step F1-2a).
 *
 * Plain TypeScript: no React, no Supabase, no editor library. The canonical
 * document is the academic source of truth; editor state is only a projection
 * of it, never the other way around.
 *
 * F1 node model (dossier §5): text blocks of one level (paragraph, heading 1-3
 * and, from E1, the bullet list item and the quote paragraph) and a single
 * inline type (text with bold/italic marks). Blocks never nest: a list is
 * consecutive list items, a block quote consecutive quote paragraphs. Ids are opaque UUIDs and
 * are part of the canonical identity of a node, not a rendering detail.
 */

/** Schema version stamped on every canonical document produced in F1. */
export const DOCUMENT_SCHEMA_VERSION = 1;

declare const nodeIdBrand: unique symbol;

/**
 * Opaque node identity. Branded so a raw `string` cannot be passed where a
 * validated node id is expected; at runtime it is just the UUID text.
 */
export type NodeId = string & { readonly [nodeIdBrand]: "NodeId" };

/**
 * RFC 4122 shape: 8-4-4-4-12 hex, version nibble 1-8, variant nibble 8/9/a/b.
 * Case-insensitive on input; ids we mint are lowercase. The nil UUID and
 * other version-0 strings are deliberately rejected: they are never a real
 * identity and would silently collide across documents.
 */
const NODE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Structural check only: says nothing about whether the id exists anywhere. */
export function isNodeId(value: unknown): value is NodeId {
  return typeof value === "string" && NODE_ID_PATTERN.test(value);
}

/**
 * Mints a new node id. `uuidFn` is injectable so tests and future replay
 * tooling stay deterministic; the default is the platform CSPRNG.
 *
 * Throws if the generator returns something that is not a UUID, because a
 * malformed id would poison the document and every later CAS round-trip.
 */
export function newNodeId(uuidFn: () => string = defaultUuid): NodeId {
  const candidate = uuidFn();
  if (!isNodeId(candidate)) {
    throw new Error(`newNodeId: generator returned a non-UUID value`);
  }
  return candidate;
}

function defaultUuid(): string {
  return crypto.randomUUID();
}

/** Inline formatting available in F1. */
export type Mark = "bold" | "italic";

/** Canonical mark order: bold before italic. Stored arrays are sorted by it. */
export const MARK_ORDER: readonly Mark[] = ["bold", "italic"];

const MARK_RANK: Record<Mark, number> = { bold: 0, italic: 1 };

export function isMark(value: unknown): value is Mark {
  return value === "bold" || value === "italic";
}

/** Sort comparator for the canonical mark order. */
export function compareMarks(a: Mark, b: Mark): number {
  return MARK_RANK[a] - MARK_RANK[b];
}

/** True when `marks` is deduplicated and in canonical order. */
export function marksAreCanonical(marks: readonly Mark[]): boolean {
  for (let i = 1; i < marks.length; i += 1) {
    if (compareMarks(marks[i - 1], marks[i]) >= 0) {
      return false;
    }
  }
  return true;
}

/** Deduplicates and sorts marks into canonical order. Pure. */
export function canonicalMarks(marks: readonly Mark[]): Mark[] {
  return [...new Set(marks)].sort(compareMarks);
}

/** Set equality on two canonical mark arrays. */
export function marksEqual(a: readonly Mark[], b: readonly Mark[]): boolean {
  const left = canonicalMarks(a);
  const right = canonicalMarks(b);
  return (
    left.length === right.length && left.every((mark, i) => mark === right[i])
  );
}

/** The only inline node in F1. `text` is always non-empty in a valid document. */
export type InlineNode = {
  type: "text";
  text: string;
  marks: Mark[];
};

export type ParagraphNode = {
  type: "paragraph";
  id: NodeId;
  children: InlineNode[];
};

export type HeadingLevel = 1 | 2 | 3;

export type HeadingNode = {
  type: "heading";
  id: NodeId;
  level: HeadingLevel;
  children: InlineNode[];
};

/**
 * One item of a bullet list (E1, #823). A flat text block like a paragraph:
 * consecutive items are shown as one list, and there is no nesting.
 */
export type BulletItemNode = {
  type: "bulletItem";
  id: NodeId;
  children: InlineNode[];
};

/**
 * One paragraph of a block quote (E1, #823). A flat text block like a
 * paragraph: consecutive quote paragraphs are shown as one block quote.
 */
export type QuoteNode = {
  type: "quote";
  id: NodeId;
  children: InlineNode[];
};

export type DocumentNode = ParagraphNode | HeadingNode | BulletItemNode | QuoteNode;

/** Block types whose only fields are `type`, `id` and `children`. */
export const PLAIN_BLOCK_TYPES = ["paragraph", "bulletItem", "quote"] as const;

export type PlainBlockType = (typeof PLAIN_BLOCK_TYPES)[number];

export function isPlainBlockType(value: unknown): value is PlainBlockType {
  return (PLAIN_BLOCK_TYPES as readonly unknown[]).includes(value);
}

/**
 * A whole document. Always at least one block node: an "empty document" is one
 * paragraph with no children, never an empty `nodes` array.
 */
export type CanonicalDocument = {
  schemaVersion: typeof DOCUMENT_SCHEMA_VERSION;
  nodes: DocumentNode[];
};

export function isHeadingLevel(value: unknown): value is HeadingLevel {
  return value === 1 || value === 2 || value === 3;
}

/** Builder for a text node; marks are canonicalised for the caller. */
export function textNode(text: string, marks: readonly Mark[] = []): InlineNode {
  return { type: "text", text, marks: canonicalMarks(marks) };
}

export function paragraphNode(
  id: NodeId,
  children: readonly InlineNode[] = [],
): ParagraphNode {
  return { type: "paragraph", id, children: [...children] };
}

export function headingNode(
  id: NodeId,
  level: HeadingLevel,
  children: readonly InlineNode[] = [],
): HeadingNode {
  return { type: "heading", id, level, children: [...children] };
}

export function bulletItemNode(
  id: NodeId,
  children: readonly InlineNode[] = [],
): BulletItemNode {
  return { type: "bulletItem", id, children: [...children] };
}

export function quoteNode(
  id: NodeId,
  children: readonly InlineNode[] = [],
): QuoteNode {
  return { type: "quote", id, children: [...children] };
}

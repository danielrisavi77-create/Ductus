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

/**
 * Document v2: the citation node and the list of sources
 * (docs/contracts/document-schema-v2.md, DAN-619). Accepted by
 * `validateVersionedDocument` only; `validateDocument` and every caller that
 * expects a v1 document still refuse it. A work keeps the version of its
 * revision zero, and a v1 document never changes version on load,
 * normalisation or sync: `schemaVersion` is in the hashed bytes.
 */
export const DOCUMENT_SCHEMA_VERSION_V2 = 2;

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
 * The block types each accepted document version takes, and the only list of
 * accepted versions. A version is accepted only with its own entry here; a
 * new node joins the version that brings it, never v1.
 */
export const DOCUMENT_BLOCK_TYPES_BY_VERSION: ReadonlyMap<number, ReadonlySet<string>> = new Map([
  [DOCUMENT_SCHEMA_VERSION, new Set<string>(["heading", ...PLAIN_BLOCK_TYPES])],
  [DOCUMENT_SCHEMA_VERSION_V2, new Set<string>(["heading", ...PLAIN_BLOCK_TYPES])],
]);

export type DocumentSchemaVersion = typeof DOCUMENT_SCHEMA_VERSION | typeof DOCUMENT_SCHEMA_VERSION_V2;

export function isAcceptedDocumentSchemaVersion(value: unknown): value is DocumentSchemaVersion {
  return typeof value === "number" && DOCUMENT_BLOCK_TYPES_BY_VERSION.has(value);
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

// ---------------------------------------------------------------------------
// Document v2 (docs/contracts/document-schema-v2.md §1 to §3)

declare const sourceIdBrand: unique symbol;

/** Id of a source record: a canonical lowercase UUID v4 (contract §2.1). */
export type SourceId = string & { readonly [sourceIdBrand]: "SourceId" };

/** The pattern of `STEP_NODE_ID` (edit-step.ts): lowercase v4, nil refused. */
const SOURCE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isSourceId(value: unknown): value is SourceId {
  return typeof value === "string" && SOURCE_ID_PATTERN.test(value);
}

/** Most sources one document holds (contract §1). */
export const MAX_DOCUMENT_SOURCES = 500;
/** Longest citation locator, in code points (contract §3.1). */
export const MAX_CITATION_LOCATOR_CODE_POINTS = 100;
export const MAX_SOURCE_AUTHORS = 50;
export const MAX_SOURCE_EDITORS = 20;
export const MAX_SOURCE_URL_LENGTH = 2048;

/** Longest value of each text field of a source, in code points (§2.3). */
export const SOURCE_TEXT_FIELD_MAX = {
  title: 1000,
  bookTitle: 1000,
  journal: 500,
  name: 300,
  publisher: 300,
  family: 200,
  given: 200,
  place: 200,
  acronym: 50,
  volume: 50,
  issue: 50,
  pages: 50,
} as const;

/**
 * Inline atom pointing at a source (D-134, D-226). No marks, no text: it takes
 * one position. `locator`, when present, is 1 to 100 code points.
 */
export type CitationNode = {
  type: "citation";
  sourceId: SourceId;
  locator?: string;
};

export type InlineNodeV2 = InlineNode | CitationNode;

export type ParagraphNodeV2 = { type: "paragraph"; id: NodeId; children: InlineNodeV2[] };
export type BulletItemNodeV2 = { type: "bulletItem"; id: NodeId; children: InlineNodeV2[] };
export type QuoteNodeV2 = { type: "quote"; id: NodeId; children: InlineNodeV2[] };

/** A heading takes no citation (contract §3.1), so it is the v1 heading. */
export type DocumentNodeV2 = ParagraphNodeV2 | HeadingNode | BulletItemNodeV2 | QuoteNodeV2;

export type SourcePerson = { kind: "person"; family: string; given: string };
export type SourceOrganization = { kind: "organization"; name: string; acronym?: string };
export type SourceAuthor = SourcePerson | SourceOrganization;

type DocumentSourceBase = {
  id: SourceId;
  authors: SourceAuthor[];
  year: number;
  title: string;
};

/**
 * A source record as the document stores it (contract §2). The fields of
 * `Source` in `src/domain/citation/types.ts` without `yearSuffix`, which the
 * formatter derives from the whole list, plus the `id` citations point at.
 */
export type DocumentSource =
  | (DocumentSourceBase & { type: "book"; place: string; publisher: string })
  | (DocumentSourceBase & { type: "article"; journal: string; volume?: string; issue?: string; pages?: string })
  | (DocumentSourceBase & {
      type: "chapter";
      editors: SourcePerson[];
      bookTitle: string;
      place: string;
      publisher: string;
      pages?: string;
    })
  | (DocumentSourceBase & { type: "web"; url: string; accessed: string });

export const SOURCE_TYPES = ["book", "article", "chapter", "web"] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export type CanonicalDocumentV2 = {
  schemaVersion: typeof DOCUMENT_SCHEMA_VERSION_V2;
  nodes: DocumentNodeV2[];
  sources: DocumentSource[];
};

/** A document of any accepted version. */
export type VersionedDocument = CanonicalDocument | CanonicalDocumentV2;

export function citationNode(sourceId: SourceId, locator?: string): CitationNode {
  return locator === undefined ? { type: "citation", sourceId } : { type: "citation", sourceId, locator };
}
